export interface NetState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: string;
  hat: string;
  car: boolean;
  skin: string;
  speaking?: boolean;
  emote?: string;
  lobby?: string;
  look?: string;
  holder?: boolean;
}

export interface ChatLine {
  id: string;
  name: string;
  text: string;
  self: boolean;
}

type Envelope =
  | { t: "state"; state: NetState }
  | { t: "chat"; id: string; name: string; text: string }
  | { t: "bye"; id: string };

export interface NetAdapter {
  readonly id: string;
  readonly mode: string;
  sendState(state: NetState): void;
  sendChat(name: string, text: string): void;
  close(): void;
}

/**
 * Same-browser tabs share a BroadcastChannel. A real relay is the same JSON
 * envelopes over a WebSocket: connect with ?server=ws://host:8787
 * See README for the message shapes. No accounts and no secrets.
 */
export function createNet(
  onState: (state: NetState) => void,
  onChat: (line: ChatLine) => void,
  onBye: (id: string) => void,
): NetAdapter {
  const id = crypto.randomUUID();
  const params = new URLSearchParams(location.search);
  const server = params.get("server");
  if (server) return websocketNet(id, server, onState, onChat, onBye);
  return channelNet(id, onState, onChat, onBye);
}

function channelNet(
  id: string,
  onState: (state: NetState) => void,
  onChat: (line: ChatLine) => void,
  onBye: (id: string) => void,
): NetAdapter {
  if (typeof BroadcastChannel === "undefined") {
    return {
      id,
      mode: "Offline on this browser",
      sendState() {},
      sendChat() {},
      close() {},
    };
  }
  const channel = new BroadcastChannel("orbitx-city-v1");
  channel.onmessage = (event: MessageEvent<Envelope>) => {
    deliver(id, event.data, onState, onChat, onBye);
  };
  return {
    id,
    mode: "This browser (tabs on this site)",
    sendState(state) {
      channel.postMessage({ t: "state", state } satisfies Envelope);
    },
    sendChat(name, text) {
      channel.postMessage({ t: "chat", id, name, text } satisfies Envelope);
    },
    close() {
      channel.postMessage({ t: "bye", id } satisfies Envelope);
      channel.close();
    },
  };
}

function websocketNet(
  id: string,
  url: string,
  onState: (state: NetState) => void,
  onChat: (line: ChatLine) => void,
  onBye: (id: string) => void,
): NetAdapter {
  let socket: WebSocket | null = null;
  let queue: Envelope[] = [];
  const send = (message: Envelope) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else queue.push(message);
  };
  try {
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      try {
        deliver(id, JSON.parse(String(event.data)) as Envelope, onState, onChat, onBye);
      } catch {
        /* ignore malformed relay traffic */
      }
    };
    socket.onopen = () => {
      for (const message of queue) socket?.send(JSON.stringify(message));
      queue = [];
    };
  } catch {
    socket = null;
  }
  return {
    id,
    mode: socket ? `Live relay ${url}` : "Relay failed — tab mode",
    sendState(state) {
      send({ t: "state", state });
    },
    sendChat(name, text) {
      send({ t: "chat", id, name, text });
    },
    close() {
      send({ t: "bye", id });
      socket?.close();
    },
  };
}

function deliver(
  self: string,
  message: Envelope,
  onState: (state: NetState) => void,
  onChat: (line: ChatLine) => void,
  onBye: (id: string) => void,
) {
  if (!message || typeof message !== "object") return;
  if (message.t === "state") {
    if (message.state?.id && message.state.id !== self) onState(message.state);
    return;
  }
  if (message.t === "chat") {
    if (!message.text || message.id === self) return;
    onChat({ id: message.id, name: message.name || "Guest", text: message.text.slice(0, 180), self: false });
    return;
  }
  if (message.t === "bye" && message.id !== self) onBye(message.id);
}
