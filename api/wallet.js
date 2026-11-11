// In-app Solana wallets. Keys are generated on the server and encrypted at rest.
// The secret leaves the server only on an explicit export. Shop purchases stay on demo credits.

import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { b58decode, b58encode } from "./live.js";

const SYSTEM = b58decode("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
// The Solana incinerator: SOL sent here is gone for good. SPL/Token-2022
// tokens are NOT burned by sending them to this address (that would leave
// them in the supply) — a real token burn is the Token program's Burn
// instruction, which reduces the mint's supply. The incinerator address is
// kept here as the documented burn destination for SOL.
export const INCINERATOR = "11111111111111111111111111111111";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function bag() {
  const slot = globalThis;
  if (!slot.__orbitxWallets) {
    slot.__orbitxWallets = { secrets: new Map(), ledger: [], audit: [], limits: new Map() };
  }
  return slot.__orbitxWallets;
}

export function networkName() {
  return process.env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
}

export function rpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  return networkName() === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}

export function chainShopEnabled() {
  return process.env.ONCHAIN_SHOP_ENABLED === "true";
}

export function transfersEnabled() {
  if (networkName() !== "mainnet-beta") return true;
  return process.env.ONCHAIN_TRANSFERS_ENABLED === "true";
}

export function masterKey() {
  const raw = process.env.WALLET_MASTER_KEY || "";
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function aes(mode, key, iv, data, tag) {
  const cipher = mode === "enc" ? createCipheriv("aes-256-gcm", key, iv) : createDecipheriv("aes-256-gcm", key, iv);
  if (mode === "dec") cipher.setAuthTag(tag);
  const out = Buffer.concat([mode === "enc" ? cipher.update(data) : cipher.update(data), cipher.final()]);
  return mode === "enc" ? { ct: out, tag: cipher.getAuthTag() } : out;
}

export function sealSecret(secret) {
  const master = masterKey();
  if (!master) throw new Error("WALLET_MASTER_KEY is missing or not 32 bytes of base64.");
  const dataKey = randomBytes(32);
  const wrapIv = randomBytes(12);
  const wrapped = aes("enc", master, wrapIv, dataKey);
  const secretIv = randomBytes(12);
  const sealed = aes("enc", dataKey, secretIv, secret);
  return {
    wrapped_key: wrapped.ct.toString("base64"),
    wrap_iv: wrapIv.toString("base64"),
    wrap_tag: wrapped.tag.toString("base64"),
    secret_iv: secretIv.toString("base64"),
    secret_tag: sealed.tag.toString("base64"),
    secret_ct: sealed.ct.toString("base64"),
  };
}

export function openSecret(row) {
  const master = masterKey();
  if (!master) throw new Error("WALLET_MASTER_KEY is missing or not 32 bytes of base64.");
  const dataKey = aes("dec", master, Buffer.from(row.wrap_iv, "base64"), Buffer.from(row.wrapped_key, "base64"), Buffer.from(row.wrap_tag, "base64"));
  return aes(
    "dec",
    dataKey,
    Buffer.from(row.secret_iv, "base64"),
    Buffer.from(row.secret_ct, "base64"),
    Buffer.from(row.secret_tag, "base64"),
  );
}

function keyFromSeed(seed) {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

export function createSolanaKeypair() {
  const seed = randomBytes(32);
  const priv = keyFromSeed(seed);
  const spki = createPublicKey(priv).export({ format: "der", type: "spki" });
  const pub = Buffer.from(spki.subarray(spki.length - 32));
  const secret = Buffer.concat([seed, pub]);
  return { publicKey: b58encode(pub), secret };
}

function record(userId) {
  return bag().secrets.get(userId) || null;
}

async function persist(row) {
  bag().secrets.set(row.user_id, row);
  const client = globalThis.__orbitxSbClient || null;
  if (!client) return;
  const { error } = await client.from("wallet_secrets").upsert(row);
  if (error) globalThis.__orbitxSbError = error.message;
}

async function load(userId) {
  const local = record(userId);
  if (local) return local;
  const client = globalThis.__orbitxSbClient || null;
  if (!client) return null;
  const { data, error } = await client.from("wallet_secrets").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    globalThis.__orbitxSbError = error.message;
    return null;
  }
  if (data) bag().secrets.set(userId, data);
  return data;
}

export async function ensureWallet(userId) {
  if (!userId) return null;
  const existing = await load(userId);
  if (existing) return { publicKey: existing.public_key };
  if (!masterKey()) return null;
  const made = createSolanaKeypair();
  const sealed = sealSecret(made.secret);
  const row = { user_id: userId, public_key: made.publicKey, created_at: new Date().toISOString(), ...sealed };
  await persist(row);
  await audit(userId, "create", "In-app wallet created");
  return { publicKey: made.publicKey };
}

function hitLimit(key, limit, windowMs) {
  const now = Date.now();
  const list = (bag().limits.get(key) || []).filter((at) => now - at < windowMs);
  if (list.length >= limit) {
    bag().limits.set(key, list);
    return true;
  }
  list.push(now);
  bag().limits.set(key, list);
  return false;
}

export async function audit(userId, action, detail) {
  const row = { id: `aud_${randomBytes(8).toString("hex")}`, user_id: userId, action, detail: String(detail || "").slice(0, 180), created_at: new Date().toISOString() };
  bag().audit.push(row);
  const client = globalThis.__orbitxSbClient || null;
  if (client) {
    const { error } = await client.from("wallet_audit").insert(row);
    if (error) globalThis.__orbitxSbError = error.message;
  }
  return row;
}

let rpcImpl = null;
export function setRpcForTests(fn) {
  rpcImpl = fn;
}

export async function walletRow(userId) {
  return load(userId);
}

export async function solanaRpc(method, params) {
  if (rpcImpl) return rpcImpl(method, params);
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

async function rpc(method, params) {
  return solanaRpc(method, params);
}

async function qrSvg(text) {
  try {
    const QR = (await import("qrcode")).default;
    return await QR.toString(text, { type: "svg", margin: 1, width: 168, color: { dark: "#071018", light: "#ffffff" } });
  } catch {
    return "";
  }
}

function historyFor(userId) {
  return bag().ledger.filter((row) => row.user_id === userId).slice(-8).reverse().map((row) => ({
    id: row.id,
    status: row.status,
    amount: row.amount,
    unit: row.unit,
    destination: row.destination,
    signature: row.signature || "",
    at: row.created_at,
  }));
}

export async function walletView(userId) {
  const row = await load(userId);
  const network = networkName();
  const base = {
    ok: true,
    network,
    address: row?.public_key || "",
    sol: null,
    orbitx: null,
    holder: false,
    history: historyFor(userId),
    qr: "",
    shopOnChain: chainShopEnabled(),
    transfers: transfersEnabled(),
    note: "",
  };
  if (!row) {
    base.note = masterKey() ? "The in-app wallet is created the first time this account signs in." : "Set WALLET_MASTER_KEY on the server to create in-app wallets.";
    return base;
  }
  base.qr = await qrSvg(row.public_key);
  const mint = process.env.ORBITX_MINT || "";
  try {
    const raw = await rpc("getBalance", [row.public_key]);
    const lamports = typeof raw === "number" ? raw : raw?.value;
    if (typeof lamports !== "number" || !Number.isFinite(lamports)) {
      base.note = "SOL balance was not read (unexpected RPC result). Nothing was invented.";
    } else {
      base.sol = lamports / 1e9;
    }
  } catch (err) {
    base.note = `SOL balance was not read (${err.message || "RPC"}). Nothing was invented.`;
  }
  if (!mint) {
    base.note = [base.note, "ORBITX_MINT is not set, so no token balance was read."].filter(Boolean).join(" ");
    return base;
  }
  try {
    const result = await rpc("getTokenAccountsByOwner", [row.public_key, { mint }, { encoding: "jsonParsed" }]);
    let amount = 0;
    for (const item of result?.value || []) amount += Number(item.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
    base.orbitx = amount;
    const min = Number(process.env.ORBITX_HOLDER_MIN || 1);
    base.holder = amount >= min;
  } catch (err) {
    base.note = [base.note, `$ORBITX balance was not read (${err.message || "RPC"}).`].filter(Boolean).join(" ");
  }
  return base;
}

function compact(n) {
  const out = [];
  let left = n;
  while (true) {
    let elem = left & 0x7f;
    left = Math.floor(left / 128);
    if (left) elem |= 0x80;
    out.push(elem);
    if (!left) break;
  }
  return Buffer.from(out);
}

export function buildSolTransfer(fromAddress, toAddress, lamports, blockhash) {
  const from = b58decode(fromAddress);
  const to = b58decode(toAddress);
  const hash = b58decode(blockhash);
  if (!from || from.length !== 32 || !to || to.length !== 32 || !hash || hash.length !== 32) return null;
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0);
  data.writeBigUInt64LE(BigInt(lamports), 4);
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),
    compact(3),
    from,
    to,
    SYSTEM,
    hash,
    compact(1),
    Buffer.from([2]),
    compact(2),
    Buffer.from([0, 1]),
    compact(data.length),
    data,
  ]);
  return message;
}

export function signMessage(secret64, message) {
  const seed = Buffer.from(secret64).subarray(0, 32);
  return sign(null, message, keyFromSeed(seed));
}

// Which token program owns a mint (legacy SPL Token vs Token-2022).
// ORBITX is a Token-2022 mint. The Burn instruction is the same shape
// (instruction 8, u64 amount) on both programs — only the program id differs.
export async function tokenProgramForMint(mint, cache) {
  if (cache?.has(mint)) return cache.get(mint);
  let program = TOKEN_PROGRAM_ID;
  try {
    const info = await solanaRpc("getAccountInfo", [mint, { encoding: "base64" }]);
    const value = info?.value || info;
    if (value?.owner === TOKEN_2022_PROGRAM_ID) program = TOKEN_2022_PROGRAM_ID;
  } catch {
    // Unknown owner: fall back to the legacy program id.
  }
  cache?.set(mint, program);
  return program;
}

/**
 * Build an unsigned legacy burn transaction message.
 * Instruction (Token / Token-2022): Burn = 8, data [8, amount u64 LE].
 * Accounts: [token account (writable), mint (writable), owner (signer)].
 * The program id is the 4th account (readonly, index 3).
 * Same hand-rolled message layout as buildSolTransfer.
 */
export function buildTokenBurn(ownerAddress, tokenAccountAddress, mintAddress, amountBaseUnits, blockhash, programId) {
  const owner = b58decode(ownerAddress);
  const account = b58decode(tokenAccountAddress);
  const mint = b58decode(mintAddress);
  const program = b58decode(programId);
  const hash = b58decode(blockhash);
  if (!owner || owner.length !== 32 || !account || account.length !== 32 || !mint || mint.length !== 32 || !program || program.length !== 32 || !hash || hash.length !== 32) {
    return null;
  }
  const amount = BigInt(amountBaseUnits);
  if (amount <= 0n) return null;
  const data = Buffer.alloc(9);
  data.writeUInt8(8, 0);
  data.writeBigUInt64LE(amount, 1);
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),
    compact(4),
    owner,
    account,
    mint,
    program,
    hash,
    compact(1),
    Buffer.from([3]),
    compact(3),
    Buffer.from([0, 1, 2]),
    compact(data.length),
    data,
  ]);
  return message;
}

/** Sign a legacy message built by buildSolTransfer/buildTokenBurn and serialize it. */
export function signLegacyMessage(secret, message) {
  const sig = signMessage(secret, message);
  const tx = Buffer.concat([compact(1), sig, message]).toString("base64");
  return { signedTx: tx, signature: b58encode(sig) };
}

export async function sendSignedTx(signedBase64) {
  const sent = await solanaRpc("sendTransaction", [signedBase64, { encoding: "base64", preflightCommitment: "confirmed" }]);
  return String(sent || "");
}

/** "confirmed" | "finalized" | "failed" | null (not seen yet / unknown). */
export async function getSignatureStatus(signature) {
  try {
    const res = await solanaRpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const entry = (res?.value || res || [])[0];
    if (!entry) return null;
    if (entry.err) return "failed";
    if (entry.confirmationStatus === "finalized" || entry.confirmationStatus === "confirmed") return entry.confirmationStatus;
    return null;
  } catch {
    return null;
  }
}

/** Confirmed transaction meta (pre/post token balances), or null. */
export async function getTransactionMeta(signature) {
  try {
    const tx = await solanaRpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    return tx?.meta || null;
  } catch {
    return null;
  }
}

/** Token accounts holding a mint for an owner: [{ pubkey, amount (base units, string) }]. */
export async function getTokenAccounts(owner, mint) {
  const result = await solanaRpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  const out = [];
  for (const item of result?.value || []) {
    const info = item.account?.data?.parsed?.info;
    if (!info) continue;
    out.push({ pubkey: item.pubkey, amount: String(info.tokenAmount?.amount || "0"), decimals: Number(info.tokenAmount?.decimals || 0) });
  }
  return out;
}

function badDest(value) {
  const raw = b58decode(String(value || ""));
  return !raw || raw.length !== 32;
}

function dailySent(userId) {
  const since = Date.now() - DAY;
  return bag().ledger
    .filter((row) => row.user_id === userId && row.status === "sent" && row.unit === "SOL" && Date.parse(row.created_at) > since)
    .reduce((sum, row) => sum + Number(row.lamports || 0), 0);
}

export async function confirmSend(userId, body) {
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return { ok: false, status: 400, message: "Missing a confirm id. Open the review sheet again." };
  const prior = bag().ledger.find((row) => row.user_id === userId && row.idempotency_key === idem);
  if (prior?.status === "sent") {
    return { ok: true, message: "Already sent. This confirm was not broadcast again.", signature: prior.signature, history: historyFor(userId) };
  }
  if (!transfersEnabled()) {
    return { ok: false, status: 400, message: "Mainnet sends are off. Set SOLANA_NETWORK only with ONCHAIN_TRANSFERS_ENABLED after a separate review." };
  }
  const destination = String(body.destination || "").trim();
  if (badDest(destination)) return { ok: false, status: 400, message: "That destination is not a Solana address." };
  const sol = Number(body.amount);
  if (!Number.isFinite(sol) || sol <= 0 || sol > 1) return { ok: false, status: 400, message: "Amount must be between 0 and 1 SOL per confirm." };
  const lamports = Math.round(sol * 1e9);
  if (hitLimit(`send:${userId}`, 8, HOUR)) return { ok: false, status: 429, message: "Too many sends this hour. Wait and try again." };
  const cap = Number(process.env.ONCHAIN_DAILY_LAMPORTS || 1_000_000_000);
  if (dailySent(userId) + lamports > cap) return { ok: false, status: 400, message: "That confirm is over the daily send cap." };
  const row = await load(userId);
  if (!row) return { ok: false, status: 400, message: "This account has no in-app wallet yet." };
  if (destination === row.public_key) return { ok: false, status: 400, message: "Choose a different destination." };
  const entry = prior && prior.status !== "sent" ? prior : {
    id: `led_${randomBytes(8).toString("hex")}`,
    user_id: userId,
    idempotency_key: idem,
    destination,
    amount: String(sol),
    lamports,
    unit: "SOL",
    status: "pending",
    signature: "",
    created_at: new Date().toISOString(),
  };
  if (!prior) bag().ledger.push(entry);
  let blockhash = "";
  try {
    const latest = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    blockhash = latest?.value?.blockhash || latest?.blockhash || "";
  } catch (err) {
    entry.status = "error";
    return { ok: false, status: 502, message: `The RPC did not return a blockhash (${err.message || "RPC"}). Nothing was signed.` };
  }
  const message = buildSolTransfer(row.public_key, destination, lamports, blockhash);
  if (!message) {
    entry.status = "error";
    return { ok: false, status: 400, message: "Could not build that transfer." };
  }
  let signature = "";
  try {
    const secret = openSecret(row);
    const sig = signMessage(secret, message);
    secret.fill(0);
    const tx = Buffer.concat([compact(1), sig, message]).toString("base64");
    const sent = await rpc("sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed" }]);
    signature = String(sent || b58encode(sig));
  } catch (err) {
    entry.status = "error";
    await audit(userId, "send-failed", destination);
    return { ok: false, status: 502, message: `The transfer was not accepted (${err.message || "RPC"}).` };
  }
  entry.status = "sent";
  entry.signature = signature;
  await audit(userId, "send", `${sol} SOL to ${destination}`);
  const client = globalThis.__orbitxSbClient || null;
  if (client) {
    const { error } = await client.from("wallet_ledger").upsert({
      id: entry.id,
      user_id: userId,
      idempotency_key: idem,
      destination,
      amount: String(sol),
      unit: "SOL",
      status: "sent",
      signature,
    });
    if (error) globalThis.__orbitxSbError = error.message;
  }
  return { ok: true, message: `Sent ${sol} SOL on ${networkName()}.`, signature, history: historyFor(userId) };
}

export async function exportWallet(userId, allowed) {
  if (!allowed) return { ok: false, status: 401, message: "Export needs your password or a fresh email code on this request." };
  if (hitLimit(`export:${userId}`, 3, HOUR)) return { ok: false, status: 429, message: "Export is limited to 3 times an hour." };
  const row = await load(userId);
  if (!row) return { ok: false, status: 400, message: "This account has no in-app wallet yet." };
  await audit(userId, "export", "Private key exported");
  const secret = openSecret(row);
  const phantom = [...secret];
  const secretBase58 = b58encode(secret);
  secret.fill(0);
  return {
    ok: true,
    publicKey: row.public_key,
    secretBase58,
    phantom,
    warning: "Anyone with this key can move the funds. The city will not ask you to paste it back.",
  };
}

export function quoteSend(body) {
  const destination = String(body.destination || "").trim();
  const sol = Number(body.amount);
  if (badDest(destination)) return { ok: false, status: 400, message: "That destination is not a Solana address." };
  if (!Number.isFinite(sol) || sol <= 0 || sol > 1) return { ok: false, status: 400, message: "Amount must be between 0 and 1 SOL per confirm." };
  return {
    ok: true,
    network: networkName(),
    destination,
    amount: String(sol),
    unit: "SOL",
    fee: "0.000005",
    transfers: transfersEnabled(),
    shopOnChain: chainShopEnabled(),
  };
}
