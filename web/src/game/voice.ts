// Voice chat on LiveKit (SFU) — one LiveKit room per voice channel.
// Channels: proximity ("nearby", one room per universe), named public
// channels (Plaza, HQ, Club Orbit, Casino — one room each, city-wide),
// and one private room per party. The server (voice-token op) mints the
// token and validates the player may join that room; this file only ever
// connects with a token the server issued.
//
// Proximity stays proximity: everyone in the universe room is connected
// and each remote voice fades with distance (full up close, silent past
// 36 units). Named channels and party rooms play at full volume —
// distance means nothing there. No dialing, no per-player hangups, no
// mesh: the SFU routes everything.
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteParticipant, RemoteTrack } from "livekit-client";
import { world } from "./world";

let liveRoom: Room | null = null;
/** Attached remote audio, by participant identity (= player id). */
const remoteAudio = new Map<string, HTMLAudioElement>();
let room = "";
let livekitRoomName = "";
let analyser: AnalyserNode | null = null;
let context: AudioContext | null = null;
let localStream: MediaStream | null = null;

/** Proximity voice: the synthetic room everyone in proximity mode joins,
 * and the range (world units) inside which you can hear each other. */
export const PROXIMITY_ROOM = "nearby";
export const PROXIMITY_RANGE = 30;
/** Fade-out edge: past this, a proximity voice is silent (the player is
 * still connected — they just can't be heard until they walk back). */
export const PROXIMITY_FALLOFF = 36;
/** When true, only players within PROXIMITY_RANGE are audible (see
 * voiceTick); when false the lobby rules apply (same named room). */
let proximity = false;

/** Distance from me to a player, from the last sync's presence (up to
 * 250ms stale — fine for a 30-unit voice range). Infinity if either side
 * is unknown. */
function distanceTo(id: string): number {
  const me = world.people.find((person) => person.id === world.id);
  const other = world.people.find((person) => person.id === id);
  if (!me || !other) return Infinity;
  return Math.hypot(other.x - me.x, other.z - me.z);
}

/** 1.0 up close, fading to 0 at the falloff — a player walking away
 * sounds quieter, then silent, before they are out of range. Unknown
 * distance = full. */
function distanceVolume(distance: number): number {
  if (!Number.isFinite(distance)) return 1;
  if (distance <= 10) return 1;
  if (distance >= PROXIMITY_FALLOFF) return 0;
  return 1 - (distance - 10) / (PROXIMITY_FALLOFF - 10);
}

/** The audio volume for a remote voice: the player's manual per-person
 * volume times the distance fade (proximity only — named channels and
 * party rooms play at full volume regardless of distance). */
function peerVolume(id: string): number {
  const manual = world.volumes[id] ?? 1;
  return proximity ? manual * distanceVolume(distanceTo(id)) : manual;
}

// Debug hook for the two-client test and future debugging — the room,
// the participant count, and whether remote audio is live. No names,
// no PII.
if (typeof window !== "undefined") {
  (window as unknown as { __orbitxVoice?: unknown }).__orbitxVoice = {
    peerCount: () => remoteAudio.size,
    connectionStates: () => [liveRoom?.state ?? "disconnected"],
    // Per remote voice: does the attached audio element have a live
    // audio track? (proves media actually arrived, not just that the
    // join worked).
    remoteAudio: () =>
      [...remoteAudio.values()].map((audio) => {
        const stream = audio.srcObject as MediaStream | null;
        const track = stream?.getAudioTracks()[0];
        return { hasStream: !!stream, live: !!track && track.readyState === "live", paused: audio.paused };
      }),
    proximity: () => proximity,
    room: () => room,
    livekitRoom: () => livekitRoomName,
  };
}

export function voiceState() {
  return {
    muted: world.muted,
    deafened: world.deafened,
    pushToTalk: world.pushToTalk,
    provider: world.provider,
    error: world.voiceError,
    lobby: world.lobby,
  };
}

export async function joinVoice(nextRoom: string): Promise<boolean> {
  // Switching channels leaves the old room first.
  if (liveRoom) leaveVoice();
  room = nextRoom;
  // Proximity mode is the "nearby" room: voices fade with distance (see
  // voiceTick). Any named room is a channel — full volume.
  proximity = nextRoom === PROXIMITY_ROOM;
  world.proximity = proximity;
  world.lobby = nextRoom;
  // Send the lobby change on the next flush — don't wait for a frame.
  world.pushLobby();
  world.voiceError = "";
  try {
    // world.call throws on a non-OK token answer, carrying the server's
    // message (not set up yet / not in that party / no such channel).
    const ticket = await world.voiceToken(nextRoom);
    if (ticket.provider !== "livekit" || !ticket.url || !ticket.token) {
      throw new Error("Voice isn't set up yet — the city needs its LiveKit keys.");
    }
    world.provider = "livekit";
    await ensureMic();
    await joinLiveKit(String(ticket.url), String(ticket.token), String(ticket.room || nextRoom));
    return true;
  } catch (err) {
    // A failed join must NOT leave the player "in" the room: the old
    // code set room/lobby before the token + mic, then left them set
    // when either failed — the panel read "In room" while the player
    // had no mic, no provider and no peers, so they never actually
    // joined the other person. Reset and say why, so a retry works.
    leaveLiveKit();
    world.voiceError = err instanceof Error ? err.message : "Voice needs a microphone.";
    world.provider = "off";
    room = "";
    livekitRoomName = "";
    proximity = false;
    world.proximity = false;
    world.lobby = "";
    world.pushLobby();
    return false;
  }
}

export function leaveVoice() {
  leaveLiveKit();
  world.lobby = "";
  world.proximity = false;
  proximity = false;
  world.pushLobby();
  room = "";
  livekitRoomName = "";
}

/** Disconnect the LiveKit room and drop every attached remote voice. */
function leaveLiveKit() {
  liveRoom?.disconnect();
  liveRoom = null;
  for (const audio of remoteAudio.values()) audio.remove();
  remoteAudio.clear();
}

export function joinProximity() {
  return joinVoice(PROXIMITY_ROOM);
}

/** Mic on/off for mute + push-to-talk: publish only while the player
 * should actually be heard (not muted, and either open-mic or holding
 * talk). The local stream's tracks feed the speaking analyser. */
function applyMicState() {
  const on = !world.muted && (!world.pushToTalk || world.talking);
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = on;
  });
  void liveRoom?.localParticipant.setMicrophoneEnabled(on);
}

export function setMuted(on: boolean) {
  world.muted = on;
  applyMicState();
}

export function setDeafened(on: boolean) {
  world.deafened = on;
  for (const audio of remoteAudio.values()) audio.muted = on;
}

export function setPushToTalk(on: boolean) {
  world.pushToTalk = on;
  if (on) setTalking(false);
  else applyMicState();
}

export function setTalking(on: boolean) {
  world.talking = on;
  applyMicState();
}

export function setVolume(id: string, value: number) {
  world.volumes[id] = value;
  const audio = remoteAudio.get(id);
  if (audio) audio.volume = peerVolume(id);
}

export function voiceTick() {
  if (analyser && localStream && !world.muted && (!world.pushToTalk || world.talking)) {
    const bins = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bins);
    let sum = 0;
    for (const bin of bins) {
      const v = (bin - 128) / 128;
      sum += v * v;
    }
    world.speaking = Math.sqrt(sum / bins.length) > 0.04;
  } else if (new URLSearchParams(location.search).has("voiceDemo")) {
    world.speaking = Math.floor(Date.now() / 700) % 2 === 0;
  } else world.speaking = false;
  // Proximity fade: re-read every tick so a player walking away gets
  // quieter, then silent, without any dial/hangup. Named channels skip
  // this (peerVolume is the manual volume there).
  if (proximity) {
    for (const [id, audio] of remoteAudio) audio.volume = peerVolume(id);
  }
}

async function ensureMic() {
  if (localStream || new URLSearchParams(location.search).has("voiceDemo")) return;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  context = new AudioContext();
  const source = context.createMediaStreamSource(localStream);
  analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  if (world.muted || world.pushToTalk) localStream.getAudioTracks().forEach((track) => (track.enabled = false));
}

async function joinLiveKit(url: string, token: string, livekitRoom: string) {
  const live = new Room();
  // Handlers first, so no track is missed between connect and subscribe.
  live.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio) return;
    const old = remoteAudio.get(participant.identity);
    if (old) old.remove();
    const audio = track.attach() as HTMLAudioElement;
    audio.autoplay = true;
    audio.volume = peerVolume(participant.identity);
    audio.muted = world.deafened;
    document.body.appendChild(audio);
    remoteAudio.set(participant.identity, audio);
  });
  live.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
    track.detach();
    const audio = remoteAudio.get(participant.identity);
    if (audio) {
      audio.remove();
      remoteAudio.delete(participant.identity);
    }
  });
  live.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    const audio = remoteAudio.get(participant.identity);
    if (audio) {
      audio.remove();
      remoteAudio.delete(participant.identity);
    }
  });
  await live.connect(url, token);
  liveRoom = live;
  livekitRoomName = livekitRoom;
  applyMicState();
}
