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
//
// The mic is NOT published raw. It runs through one Web Audio graph
// (filters + reverb/echo) and the processed track is what LiveKit
// publishes — so a voice filter or effect actually changes how the
// player sounds to everyone else, not just a label in the panel.
import { Room, RoomEvent, Track } from "livekit-client";
import type { Participant, RemoteParticipant, RemoteTrack } from "livekit-client";
import { world } from "./world";

let liveRoom: Room | null = null;
/** Attached remote audio, by participant identity (= player id). */
const remoteAudio = new Map<string, HTMLAudioElement>();
let room = "";
let livekitRoomName = "";
let analyser: AnalyserNode | null = null;
let localStream: MediaStream | null = null;
/** True once the processed mic track is published in the current room. */
let publishedProcessed = false;

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

// ---------------------------------------------------------------------------
// Voice filters + effects (Web Audio, applied to the live mic)
// ---------------------------------------------------------------------------

function identityCurve(): Float32Array {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) curve[i] = (i / 1023) * 2 - 1;
  return curve;
}

function distortionCurve(amount = 30): Float32Array {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

/** Stepped curve — the mic signal snaps to a few levels, which reads as
 * a metallic robot voice. */
function quantizeCurve(steps = 8): Float32Array {
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

export interface VoiceFilterPreset {
  id: string;
  label: string;
  blurb: string;
  /** Lowpass cutoff (Hz) — lower = darker. */
  lowpass: number;
  /** Highpass cutoff (Hz) — higher = thinner. */
  highpass: number;
  /** Peaking EQ centre (Hz) + gain (dB). */
  peakFreq: number;
  peakGain: number;
  /** Input gain — whisper is quieter by design. */
  inputGain: number;
  /** WaveShaper curve ("identity" = no shaping). */
  shaper: Float32Array;
}

/** Filters that actually change the sound. True pitch shifting needs a
 * phase vocoder and is not reliable live on a phone mic, so these presets
 * use EQ + shaping instead: deep cuts the highs and boosts the lows,
 * chipmunk cuts the lows and boosts the presence, robot quantizes the
 * waveform, distorted clips it, whisper thins it and drops the level. */
export const VOICE_FILTERS: VoiceFilterPreset[] = [
  { id: "normal", label: "Normal", blurb: "Your real voice.", lowpass: 18000, highpass: 80, peakFreq: 2500, peakGain: 0, inputGain: 1, shaper: identityCurve() },
  { id: "deep", label: "Deep", blurb: "Darker, bass-heavy.", lowpass: 600, highpass: 60, peakFreq: 180, peakGain: 7, inputGain: 1.1, shaper: identityCurve() },
  { id: "chipmunk", label: "Chipmunk", blurb: "Bright and squeaky.", lowpass: 14000, highpass: 700, peakFreq: 3200, peakGain: 8, inputGain: 1, shaper: identityCurve() },
  { id: "robot", label: "Robot", blurb: "Stepped, metallic.", lowpass: 1400, highpass: 300, peakFreq: 1000, peakGain: 4, inputGain: 1, shaper: quantizeCurve(8) },
  { id: "distorted", label: "Distorted", blurb: "Crunchy and loud.", lowpass: 4200, highpass: 100, peakFreq: 800, peakGain: 3, inputGain: 0.9, shaper: distortionCurve(30) },
  { id: "whisper", label: "Whisper", blurb: "Soft and breathy.", lowpass: 5200, highpass: 1200, peakFreq: 2600, peakGain: 6, inputGain: 0.55, shaper: identityCurve() },
];

/** One mic graph, built once and live-tweaked: the mic feeds the filter
 * section, the filtered signal feeds a dry path plus a reverb send and
 * an echo send, and the mix goes to a MediaStreamDestination whose
 * track is what LiveKit publishes. Changing a filter or an effect only
 * moves node parameters — the published track never has to be
 * re-published, so there is no audio dropout when the player switches
 * presets mid-sentence. */
let audioCtx: AudioContext | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let inputGainNode: GainNode | null = null;
let lowpassNode: BiquadFilterNode | null = null;
let highpassNode: BiquadFilterNode | null = null;
let peakingNode: BiquadFilterNode | null = null;
let shaperNode: WaveShaperNode | null = null;
let filterOut: GainNode | null = null;
let dryGainNode: GainNode | null = null;
let mixBus: GainNode | null = null;
let convolverNode: ConvolverNode | null = null;
let reverbSendNode: GainNode | null = null;
let wetGainNode: GainNode | null = null;
let echoSendNode: GainNode | null = null;
let echoDelayNode: DelayNode | null = null;
let echoFeedbackNode: GainNode | null = null;
let echoGainNode: GainNode | null = null;
let micDestination: MediaStreamAudioDestinationNode | null = null;
let processedTrack: MediaStreamTrack | null = null;

/** Generated impulse response — decaying noise, no asset needed. */
function makeImpulse(ctx: AudioContext, seconds = 1.8, decay = 3.5): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function buildMicGraph() {
  if (!audioCtx || !localStream) return;
  // Tear the old graph down first (the processed track may have been
  // stopped by a previous room's unpublish — rebuild from scratch).
  try {
    micSource?.disconnect();
    inputGainNode?.disconnect();
    lowpassNode?.disconnect();
    highpassNode?.disconnect();
    peakingNode?.disconnect();
    shaperNode?.disconnect();
    filterOut?.disconnect();
    dryGainNode?.disconnect();
    mixBus?.disconnect();
    convolverNode?.disconnect();
    reverbSendNode?.disconnect();
    wetGainNode?.disconnect();
    echoSendNode?.disconnect();
    echoDelayNode?.disconnect();
    echoFeedbackNode?.disconnect();
    echoGainNode?.disconnect();
    micDestination?.disconnect();
    analyser?.disconnect();
  } catch {
    // A node that was never connected throws — ignore, rebuild anyway.
  }
  const ctx = audioCtx;
  micSource = ctx.createMediaStreamSource(localStream);
  inputGainNode = ctx.createGain();
  lowpassNode = ctx.createBiquadFilter();
  lowpassNode.type = "lowpass";
  lowpassNode.frequency.value = 18000;
  highpassNode = ctx.createBiquadFilter();
  highpassNode.type = "highpass";
  highpassNode.frequency.value = 80;
  peakingNode = ctx.createBiquadFilter();
  peakingNode.type = "peaking";
  peakingNode.frequency.value = 2500;
  peakingNode.Q.value = 1;
  peakingNode.gain.value = 0;
  shaperNode = ctx.createWaveShaper();
  shaperNode.oversample = "2x";
  shaperNode.curve = identityCurve();
  filterOut = ctx.createGain();
  dryGainNode = ctx.createGain();
  dryGainNode.gain.value = 1;
  mixBus = ctx.createGain();
  convolverNode = ctx.createConvolver();
  convolverNode.buffer = makeImpulse(ctx);
  reverbSendNode = ctx.createGain();
  reverbSendNode.gain.value = 0;
  wetGainNode = ctx.createGain();
  wetGainNode.gain.value = 0;
  echoSendNode = ctx.createGain();
  echoSendNode.gain.value = 0;
  echoDelayNode = ctx.createDelay(1);
  echoDelayNode.delayTime.value = 0.28;
  echoFeedbackNode = ctx.createGain();
  echoFeedbackNode.gain.value = 0;
  echoGainNode = ctx.createGain();
  echoGainNode.gain.value = 0;
  micDestination = ctx.createMediaStreamDestination();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  micSource.connect(inputGainNode);
  inputGainNode.connect(lowpassNode);
  lowpassNode.connect(highpassNode);
  highpassNode.connect(peakingNode);
  peakingNode.connect(shaperNode);
  shaperNode.connect(filterOut);
  filterOut.connect(dryGainNode);
  dryGainNode.connect(mixBus);
  filterOut.connect(reverbSendNode);
  reverbSendNode.connect(convolverNode);
  convolverNode.connect(wetGainNode);
  wetGainNode.connect(mixBus);
  filterOut.connect(echoSendNode);
  echoSendNode.connect(echoDelayNode);
  echoDelayNode.connect(echoGainNode);
  echoGainNode.connect(mixBus);
  echoDelayNode.connect(echoFeedbackNode);
  echoFeedbackNode.connect(echoDelayNode);
  mixBus.connect(micDestination);
  mixBus.connect(analyser);

  processedTrack = micDestination.stream.getAudioTracks()[0] ?? null;
  // Apply the stored preset + effects (the player may have picked them
  // before the mic was ever built).
  applyVoiceFilter(world.voiceFilter);
  applyFx();
}

/** Move the filter nodes to a preset (smooth ramps, no clicks). No-op
 * until the mic graph exists — the stored preset applies at build. */
function applyVoiceFilter(id: string) {
  if (!audioCtx || !lowpassNode || !highpassNode || !peakingNode || !shaperNode || !inputGainNode) return;
  const preset = VOICE_FILTERS.find((item) => item.id === id) ?? VOICE_FILTERS[0];
  const t = audioCtx.currentTime;
  lowpassNode.frequency.setTargetAtTime(preset.lowpass, t, 0.02);
  highpassNode.frequency.setTargetAtTime(preset.highpass, t, 0.02);
  peakingNode.frequency.setTargetAtTime(preset.peakFreq, t, 0.02);
  peakingNode.gain.setTargetAtTime(preset.peakGain, t, 0.02);
  inputGainNode.gain.setTargetAtTime(preset.inputGain, t, 0.02);
  shaperNode.curve = preset.shaper;
}

/** Move the effect sends to the stored amounts (0 = off). */
function applyFx() {
  if (!audioCtx || !reverbSendNode || !wetGainNode || !echoSendNode || !echoGainNode || !echoFeedbackNode) return;
  const t = audioCtx.currentTime;
  const reverb = world.voiceReverb;
  const echo = world.voiceEcho;
  reverbSendNode.gain.setTargetAtTime(reverb * 0.9, t, 0.03);
  wetGainNode.gain.setTargetAtTime(reverb * 0.7, t, 0.03);
  echoSendNode.gain.setTargetAtTime(echo * 0.8, t, 0.03);
  echoGainNode.gain.setTargetAtTime(echo * 0.5, t, 0.03);
  echoFeedbackNode.gain.setTargetAtTime(echo > 0 ? 0.35 : 0, t, 0.03);
}

export function setVoiceFilter(id: string) {
  if (!VOICE_FILTERS.some((item) => item.id === id)) id = "normal";
  world.voiceFilter = id;
  applyVoiceFilter(id);
}

export function setVoiceReverb(amount: number) {
  world.voiceReverb = Math.min(1, Math.max(0, amount));
  applyFx();
}

export function setVoiceEcho(amount: number) {
  world.voiceEcho = Math.min(1, Math.max(0, amount));
  applyFx();
}

// ---------------------------------------------------------------------------
// Room participants + active speakers
// ---------------------------------------------------------------------------

/** Display name for a LiveKit identity (= player id): presence first,
 * then the channel member lists, then the local player's own name, then
 * a short id. The token's name IS the player id, so the client has to
 * resolve it — the server never sends display names in the token. */
function displayNameFor(id: string): string {
  const person = world.people.find((item) => item.id === id);
  if (person?.name) return person.name;
  for (const lobby of world.lobbies) {
    const member = lobby.members.find((item) => item.id === id);
    if (member?.name) return member.name;
  }
  if (id === world.id) return world.me?.name || "You";
  return id.length > 10 ? `${id.slice(0, 6)}…` : id;
}

let lastPeersKey = "";

/** Rebuild world.voicePeers from the LiveKit room (you first, then
 * everyone else). Speaking comes from LiveKit's active-speaker set and
 * the SDK's per-participant flag, with presence speaking as a fallback
 * for a peer whose audio level hasn't fired yet. Only assigns when
 * something actually changed, so the 5 Hz Snap isn't churned. */
export function refreshVoicePeers() {
  if (!liveRoom) {
    if (world.voicePeers.length) world.voicePeers = [];
    lastPeersKey = "";
    return;
  }
  const speaking = new Set(liveRoom.activeSpeakers.map((item) => item.identity));
  const presenceSpeaking = new Map(world.people.map((item) => [item.id, !!item.speaking]));
  const peers: { id: string; name: string; speaking: boolean; isLocal: boolean }[] = [
    { id: world.id, name: displayNameFor(world.id), speaking: world.speaking, isLocal: true },
  ];
  for (const participant of liveRoom.remoteParticipants.values()) {
    const id = participant.identity;
    peers.push({
      id,
      name: displayNameFor(id),
      speaking: speaking.has(id) || participant.isSpeaking || presenceSpeaking.get(id) === true,
      isLocal: false,
    });
  }
  const key = JSON.stringify(peers);
  if (key !== lastPeersKey) {
    lastPeersKey = key;
    world.voicePeers = peers;
  }
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
    // Room participants as the panel sees them (you first).
    peers: () => world.voicePeers.map((item) => ({ ...item })),
    // The mic graph, for the rig: whether it is built, whether the
    // published track is live, and the exact node parameters the
    // current filter + effects produce (proves a preset actually
    // changes the sound, not just a label).
    micGraph: () => ({
      built: !!processedTrack,
      trackState: processedTrack?.readyState ?? "none",
      published: publishedProcessed,
      filter: world.voiceFilter,
      lowpass: lowpassNode?.frequency.value ?? null,
      highpass: highpassNode?.frequency.value ?? null,
      peakGain: peakingNode?.gain.value ?? null,
      inputGain: inputGainNode?.gain.value ?? null,
      reverb: world.voiceReverb,
      reverbSend: reverbSendNode?.gain.value ?? null,
      echo: world.voiceEcho,
      echoSend: echoSendNode?.gain.value ?? null,
    }),
    // Rig-only: build the mic graph without joining a room (the rig
    // uses a fake mic device) so filters + effects can be verified.
    // Never called by the game itself.
    testMic: () => ensureMic().then(() => true),
    // Rig-only: render a fake room list in the panel so the speaking
    // highlight + volume sliders can be verified without a second
    // real player. Never called by the game itself.
    simulatePeers: (peers: { id: string; name: string; speaking: boolean; isLocal: boolean }[]) => {
      world.voicePeers = peers.map((item) => ({ ...item }));
      lastPeersKey = JSON.stringify(world.voicePeers);
    },
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
    filter: world.voiceFilter,
    reverb: world.voiceReverb,
    echo: world.voiceEcho,
    peers: world.voicePeers,
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
  world.voicePeers = [];
  world.pushLobby();
  room = "";
  livekitRoomName = "";
}

/** Disconnect the LiveKit room and drop every attached remote voice.
 * The mic graph stays alive across channel switches (filters + effects
 * persist) — only the publication is dropped. */
function leaveLiveKit() {
  if (liveRoom && processedTrack && publishedProcessed) {
    // stopOnUnpublish = false: the destination track must survive so
    // the next join can publish it again without rebuilding the graph.
    try {
      liveRoom.localParticipant.unpublishTrack(processedTrack, false);
    } catch {
      // Already unpublished — ignore.
    }
  }
  publishedProcessed = false;
  liveRoom?.disconnect();
  liveRoom = null;
  for (const audio of remoteAudio.values()) audio.remove();
  remoteAudio.clear();
  refreshVoicePeers();
}

export function joinProximity() {
  return joinVoice(PROXIMITY_ROOM);
}

/** Mic on/off for mute + push-to-talk: publish only while the player
 * should actually be heard (not muted, and either open-mic or holding
 * talk). The processed track is enabled/disabled directly — NEVER
 * setMicrophoneEnabled while it is published, or LiveKit would create
 * a second, RAW mic track alongside it. The setMicrophoneEnabled path
 * is only the fallback for when there is no processed track (demo
 * mode, or a mic that failed to build). */
function applyMicState() {
  const on = !world.muted && (!world.pushToTalk || world.talking);
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = on;
  });
  if (publishedProcessed && processedTrack) {
    processedTrack.enabled = on;
  } else if (liveRoom) {
    void liveRoom.localParticipant.setMicrophoneEnabled(on).catch(() => {
      // No mic to publish (demo mode) — not a failure.
    });
  }
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

let lastSpeakerKey = "";

export function voiceTick() {
  if (analyser && localStream && !world.muted && (!world.pushToTalk || world.talking)) {
    const bins = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bins);
    let sum = 0;
    for (const bin of bins) {
      const v = (bin - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bins.length);
    world.micLevel = Math.min(1, rms * 4);
    world.speaking = rms > 0.04;
  } else if (new URLSearchParams(location.search).has("voiceDemo")) {
    world.speaking = Math.floor(Date.now() / 700) % 2 === 0;
    world.micLevel = world.speaking ? 0.6 : 0.05;
  } else {
    world.speaking = false;
    world.micLevel = 0;
  }
  // Active speakers change live — refresh the room list when the set
  // moves (or local speaking flips), so the highlight follows the talker.
  if (liveRoom) {
    const key = `${liveRoom.activeSpeakers.map((item) => item.identity).sort().join(",")}|${world.speaking}`;
    if (key !== lastSpeakerKey) {
      lastSpeakerKey = key;
      refreshVoicePeers();
    }
  }
  // Proximity fade: re-read every tick so a player walking away gets
  // quieter, then silent, without any dial/hangup. Named channels skip
  // this (peerVolume is the manual volume there).
  if (proximity) {
    for (const [id, audio] of remoteAudio) audio.volume = peerVolume(id);
  }
}

async function ensureMic() {
  if (new URLSearchParams(location.search).has("voiceDemo")) return;
  const liveTrack = localStream?.getAudioTracks()[0];
  if (localStream && liveTrack?.readyState === "live" && processedTrack?.readyState === "live") return;
  // (Re)acquire the mic when there is none, or when the old track died.
  if (!localStream || liveTrack?.readyState !== "live") {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  buildMicGraph();
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
    refreshVoicePeers();
  });
  live.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
    track.detach();
    const audio = remoteAudio.get(participant.identity);
    if (audio) {
      audio.remove();
      remoteAudio.delete(participant.identity);
    }
    refreshVoicePeers();
  });
  live.on(RoomEvent.ParticipantConnected, () => refreshVoicePeers());
  live.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    const audio = remoteAudio.get(participant.identity);
    if (audio) {
      audio.remove();
      remoteAudio.delete(participant.identity);
    }
    refreshVoicePeers();
  });
  live.on(RoomEvent.ActiveSpeakersChanged, () => refreshVoicePeers());
  live.on(RoomEvent.LocalTrackPublished, () => refreshVoicePeers());
  await live.connect(url, token);
  liveRoom = live;
  livekitRoomName = livekitRoom;
  // Publish the PROCESSED mic (filters + effects) — not the raw mic.
  // If that fails, applyMicState falls back to the default mic path.
  if (processedTrack && processedTrack.readyState === "live") {
    try {
      await live.localParticipant.publishTrack(processedTrack, { source: Track.Source.Microphone });
      publishedProcessed = true;
    } catch {
      publishedProcessed = false;
    }
  }
  refreshVoicePeers();
  applyMicState();
}
