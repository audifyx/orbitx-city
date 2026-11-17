// On-device Solana wallet for OrbitX City.
//
// The keypair is generated IN THIS BROWSER, encrypted with a PIN-derived
// key (PBKDF2-SHA256 + AES-GCM), and stored ONLY in this device's
// localStorage. The server never sees the secret key — it only ever
// receives the public address (for balance reads) and signatures this
// device produced (ad buys / SOL sends, broadcast by the server relay).
// No WalletConnect, no imports, no export: if the PIN is forgotten the
// wallet is unrecoverable, and that is stated on the create screen.
//
// The v3 envelope mirrors the platform's PIN-envelope shape (salt + iv +
// ciphertext + public key) so the rule "PIN re-wrap replaces the stored
// copy, forgotten PIN unrecoverable" holds here too.

import nacl from "tweetnacl";
import bs58 from "bs58";

export const LOCAL_WALLET_KEY = "orbitx-local-wallet-v1";
const PBKDF2_ITERATIONS = 210_000;
const PIN_RE = /^\d{4,8}$/;

export interface LocalWalletEnvelope {
  v: 3;
  salt: string;
  iv: string;
  ct: string;
  publicKey: string;
  createdAt: string;
}

export function validPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

export function shortAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64decode(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readEnvelope(): LocalWalletEnvelope | null {
  try {
    const raw = localStorage.getItem(LOCAL_WALLET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalWalletEnvelope;
    if (parsed?.v !== 3 || typeof parsed.publicKey !== "string" || !parsed.salt || !parsed.iv || !parsed.ct) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasLocalWallet(): boolean {
  return readEnvelope() !== null;
}

export function localWalletAddress(): string {
  return readEnvelope()?.publicKey || "";
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot lock a wallet (no WebCrypto).");
  const base = await subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// The unlocked secret lives ONLY in this module's memory, never in
// localStorage, never in a React state (which could be serialized). It is
// zeroed on lock / forget.
let unlockedSecret: Uint8Array | null = null;

export function isLocalWalletUnlocked(): boolean {
  return unlockedSecret !== null;
}

export function lockLocalWallet(): void {
  if (unlockedSecret) {
    unlockedSecret.fill(0);
    unlockedSecret = null;
  }
}

export function forgetLocalWallet(): void {
  lockLocalWallet();
  try {
    localStorage.removeItem(LOCAL_WALLET_KEY);
  } catch {
    // Storage already gone; nothing to do.
  }
}

export async function createLocalWallet(pin: string): Promise<{ address: string }> {
  if (!validPin(pin)) throw new Error("Pick a PIN of 4 to 8 digits.");
  if (hasLocalWallet()) throw new Error("This device already has a wallet. Forget it first to make a new one.");
  const pair = nacl.sign.keyPair();
  const address = bs58.encode(pair.publicKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const subtle = globalThis.crypto.subtle;
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, pair.secretKey as BufferSource);
  const envelope: LocalWalletEnvelope = {
    v: 3,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ct: b64encode(new Uint8Array(ct)),
    publicKey: address,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_WALLET_KEY, JSON.stringify(envelope));
  unlockedSecret = new Uint8Array(pair.secretKey);
  return { address };
}

export async function unlockLocalWallet(pin: string): Promise<boolean> {
  const envelope = readEnvelope();
  if (!envelope) return false;
  if (!validPin(pin)) return false;
  let secret: Uint8Array;
  try {
    const key = await deriveKey(pin, b64decode(envelope.salt));
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(envelope.iv) as BufferSource },
      key,
      b64decode(envelope.ct) as BufferSource,
    );
    secret = new Uint8Array(plain);
  } catch {
    return false;
  }
  // A wrong PIN fails the AES-GCM tag, but verify the key anyway: the
  // decrypted secret must reproduce the stored public key.
  if (secret.length !== 64) {
    secret.fill(0);
    return false;
  }
  const check = nacl.sign.keyPair.fromSecretKey(secret);
  if (bs58.encode(check.publicKey) !== envelope.publicKey) {
    secret.fill(0);
    return false;
  }
  lockLocalWallet();
  unlockedSecret = secret;
  return true;
}

function requireSecret(): Uint8Array {
  if (!unlockedSecret) throw new Error("Unlock your on-device wallet with your PIN first.");
  return unlockedSecret;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let at = offset;
  while (true) {
    const byte = bytes[at++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error("Varint too long.");
  }
  return { value, next: at };
}

/**
 * Sign a versioned (v0) transaction the server composed (Jupiter swap +
 * burn), exactly mirroring the server's signVersionedTransaction layout:
 * [sig-count varint][signatures (64 bytes each)][serialized message].
 * The message bytes are signed as-is; the signature is spliced into slot
 * 0 (the fee payer = this device's wallet). Returns the signed tx base64.
 */
export function signVersionedTx(unsignedBase64: string): string {
  const secret = requireSecret();
  const bytes = b64decode(unsignedBase64);
  const { value: sigCount, next: sigStart } = readVarint(bytes, 0);
  if (sigCount < 1) throw new Error("That transaction has no signature slot.");
  const message = bytes.subarray(sigStart + sigCount * 64);
  if (!message.length) throw new Error("That transaction has no message to sign.");
  const sig = nacl.sign.detached(message, secret);
  const out = new Uint8Array(bytes.length);
  out.set(bytes.subarray(0, sigStart), 0);
  out.set(sig, sigStart);
  out.set(bytes.subarray(sigStart + 64, sigStart + sigCount * 64), sigStart + 64);
  out.set(message, sigStart + sigCount * 64);
  return b64encode(out);
}

function compact(n: number): Uint8Array {
  const out: number[] = [];
  let left = n;
  while (true) {
    let elem = left & 0x7f;
    left = Math.floor(left / 128);
    if (left) elem |= 0x80;
    out.push(elem);
    if (!left) break;
  }
  return new Uint8Array(out);
}

/**
 * Build an unsigned legacy SOL transfer message, byte-for-byte the same
 * layout as the server's buildSolTransfer (1 signer, System Program
 * transfer instruction 2). The caller signs it with signLegacyMessage
 * and submits it through the server's broadcast relay.
 */
export function buildSolTransferMessage(fromAddress: string, toAddress: string, lamports: number, blockhash: string): Uint8Array | null {
  let from: Uint8Array;
  let to: Uint8Array;
  let hash: Uint8Array;
  try {
    from = bs58.decode(fromAddress);
    to = bs58.decode(toAddress);
    hash = bs58.decode(blockhash);
  } catch {
    return null;
  }
  if (from.length !== 32 || to.length !== 32 || hash.length !== 32) return null;
  if (!Number.isInteger(lamports) || lamports <= 0) return null;
  const system = new Uint8Array(32); // System Program: 11111111111111111111111111111111
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, BigInt(lamports), true);
  const parts: Uint8Array[] = [
    new Uint8Array([1, 0, 1]),
    compact(3),
    from,
    to,
    system,
    hash,
    compact(1),
    new Uint8Array([2]),
    compact(2),
    new Uint8Array([0, 1]),
    compact(data.length),
    data,
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const message = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    message.set(part, at);
    at += part.length;
  }
  return message;
}

/** Sign a legacy message built by buildSolTransferMessage. Returns base64 [1][sig][message]. */
export function signLegacyMessage(message: Uint8Array): string {
  const secret = requireSecret();
  const sig = nacl.sign.detached(message, secret);
  const out = new Uint8Array(1 + 64 + message.length);
  out[0] = 1;
  out.set(sig, 1);
  out.set(message, 65);
  return b64encode(out);
}

export function validAddress(address: string): boolean {
  try {
    return bs58.decode(String(address || "")).length === 32;
  } catch {
    return false;
  }
}
