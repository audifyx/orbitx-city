import { world } from "./world";

type PeerLink = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
};

const peers = new Map<string, PeerLink>();
let localStream: MediaStream | null = null;
let room = "";
let meshTimer = 0;
let provider: "livekit" | "mesh" | "" = "";
let liveRoom: { disconnect: () => void; localParticipant: { setMicrophoneEnabled: (on: boolean) => Promise<unknown> } } | null = null;
let analyser: AnalyserNode | null = null;
let context: AudioContext | null = null;

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

export async function joinVoice(nextRoom: string) {
  room = nextRoom;
  world.lobby = nextRoom;
  // Send the lobby change on the next flush — don't wait for a frame.
  world.pushLobby();
  world.voiceError = "";
  try {
    const ticket = await world.voiceToken(nextRoom);
    world.provider = String(ticket.provider || "mesh");
    provider = world.provider === "livekit" ? "livekit" : "mesh";
    await ensureMic();
    if (provider === "livekit") await joinLiveKit(String(ticket.url || ""), String(ticket.token || ""));
    // meshStep must not wait on animation frames: on a slow or backgrounded
    // tab frames can stall for seconds, and a call would never start.
    // The 1s timer only reads world state, so it is safe to run on its own.
    if (provider === "mesh" && !meshTimer) {
      meshTimer = window.setInterval(() => voiceTick(), 1000);
    }
  } catch (err) {
    world.voiceError = err instanceof Error ? err.message : "Voice needs a microphone.";
    world.provider = "off";
    provider = "";
    disarmMeshTimer();
  }
}

function disarmMeshTimer() {
  if (meshTimer) window.clearInterval(meshTimer);
  meshTimer = 0;
}

export function leaveVoice() {
  world.lobby = "";
  world.pushLobby();
  room = "";
  disarmMeshTimer();
  liveRoom?.disconnect();
  liveRoom = null;
  for (const link of peers.values()) hangup(link);
  peers.clear();
}

export function setMuted(on: boolean) {
  world.muted = on;
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = !on && (!world.pushToTalk || world.talking);
  });
  void liveRoom?.localParticipant.setMicrophoneEnabled(!on);
}

export function setDeafened(on: boolean) {
  world.deafened = on;
  for (const link of peers.values()) link.audio.muted = on;
}

export function setPushToTalk(on: boolean) {
  world.pushToTalk = on;
  if (on) setTalking(false);
  else setMuted(world.muted);
}

export function setTalking(on: boolean) {
  world.talking = on;
  const enabled = on && !world.muted;
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function setVolume(id: string, value: number) {
  world.volumes[id] = value;
  const link = peers.get(id);
  if (link) link.audio.volume = value;
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
  if (provider === "mesh" && room) void meshStep();
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

async function joinLiveKit(url: string, token: string) {
  const load = new Function("url", "return import(url)") as (url: string) => Promise<{
    Room: new () => {
      connect: (url: string, token: string) => Promise<void>;
      localParticipant: { setMicrophoneEnabled: (on: boolean) => Promise<unknown> };
      on: (event: string, cb: (track: { kind: string; attach: () => HTMLMediaElement }) => void) => void;
      disconnect: () => void;
    };
    RoomEvent: { TrackSubscribed: string };
  }>;
  const mod = await load("https://esm.sh/livekit-client@2.9.8");
  const live = new mod.Room();
  await live.connect(url, token);
  await live.localParticipant.setMicrophoneEnabled(!world.muted);
  live.on(mod.RoomEvent.TrackSubscribed, (track: { kind: string; attach: () => HTMLMediaElement }) => {
    if (track.kind !== "audio") return;
    const audio = track.attach();
    audio.autoplay = true;
    document.body.appendChild(audio);
  });
  liveRoom = live;
}

const pending = new Set<string>();
const pendingCandidates = new Map<string, RTCIceCandidateInit[]>();

function flushCandidates(id: string) {
  const link = peers.get(id);
  const queued = pendingCandidates.get(id) ?? [];
  pendingCandidates.delete(id);
  if (!link) return;
  for (const candidate of queued) {
    // A stale candidate must never break the peer.
    link.pc.addIceCandidate(candidate).catch(() => {});
  }
}

async function meshStep() {
  const members = world.people.filter((person) => person.lobby === room && person.id !== world.id);
  for (const member of members) {
    if (peers.has(member.id) || pending.has(member.id)) continue;
    if (world.id > member.id) void callPeer(member.id);
  }
  for (const signal of world.takeSignals()) {
    if (signal.room !== room) continue;
    await onSignal(signal.from, signal.data as { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit });
  }
}

async function callPeer(id: string) {
  pending.add(id);
  try {
    const pc = makePeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await world.voiceSignal(id, room, { kind: "offer", sdp: pc.localDescription });
  } catch {
    // The next meshStep retries the call.
    peers.delete(id);
  } finally {
    pending.delete(id);
  }
}

function makePeer(id: string) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream as MediaStream));
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.volume = world.volumes[id] ?? 1;
  audio.muted = world.deafened;
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) void world.voiceSignal(id, room, { kind: "ice", candidate: event.candidate.toJSON() });
  };
  peers.set(id, { pc, audio });
  return pc;
}

async function onSignal(from: string, data: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
  let link = peers.get(from);
  if (!link && data.kind === "offer") {
    let pc: RTCPeerConnection | null = null;
    try {
      pc = makePeer(from);
      await pc.setRemoteDescription(data.sdp as RTCSessionDescriptionInit);
      flushCandidates(from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await world.voiceSignal(from, room, { kind: "answer", sdp: pc.localDescription });
    } catch {
      // A bad offer must not kill the mesh loop; the caller retries.
      pc?.close();
      peers.delete(from);
      pendingCandidates.delete(from);
    }
    return;
  }
  if (!link) return;
  try {
    if (data.kind === "answer" && data.sdp) {
      await link.pc.setRemoteDescription(data.sdp);
      flushCandidates(from);
    }
    if (data.kind === "ice" && data.candidate) {
      if (link.pc.remoteDescription) {
        await link.pc.addIceCandidate(data.candidate);
      } else {
        // ICE usually arrives before the SDP on a slow link; hold it.
        const queued = pendingCandidates.get(from) ?? [];
        queued.push(data.candidate);
        pendingCandidates.set(from, queued);
      }
    }
  } catch {
    // One bad signal must not break the peer.
  }
}

function hangup(link: PeerLink) {
  link.pc.close();
  link.audio.remove();
}
