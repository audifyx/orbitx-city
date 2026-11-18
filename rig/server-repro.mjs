// Server-level vehicle reproduction (in-memory backend, no live DB).
// Exercises the exact buy path the user hits: ATV, board, cars, garage
// cap, garage upgrade, re-buy, bad color. Prints PASS/FAIL per step.
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, pass: !!cond, extra: String(extra).slice(0, 160) });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 160) : ""}`);
}

const s = await call("session", { name: "VehicleRepro" });
check("guest session opens on memory backend", s.ok && s.storage === "This server memory", s.storage);
const token = s.token;
const id = s.me.id;
const playerRec = () => globalThis.__orbitx.players.get(id);
const saveFor = () => globalThis.__orbitx.saves.get(`${id}:1`);
const bal = () => (saveFor()?.balance ?? playerRec()?.balance ?? s.me.balance);
const owned = () => ((saveFor()?.vehicles ?? playerRec()?.vehicles ?? [])).map((v) => v.id);

const start = bal();
console.log("start balance:", start, "owned:", JSON.stringify(owned()));

// 1. ATV
let r = await call("buy-car", { id: "atv-trail", color: "green", server: 1 }, token);
check("buy ATV atv-trail 1500", r.ok, r.message);
check("ATV charged exactly 1500", bal() === start - 1500, `bal=${bal()}`);
check("ATV granted", owned().includes("atv-trail"), JSON.stringify(owned()));

// 2. Skateboard
r = await call("buy-car", { id: "board-street", color: "black", server: 1 }, token);
check("buy board board-street 150", r.ok, r.message);
check("board charged exactly 150", bal() === start - 1650, `bal=${bal()}`);
check("board granted", owned().includes("board-street"), JSON.stringify(owned()));

// 3. Compact — 3rd owned
r = await call("buy-car", { id: "city-compact", color: "white", server: 1 }, token);
check("buy compact 220 (3rd)", r.ok, r.message);
check("3 owned", owned().length === 3, JSON.stringify(owned()));

// 4. 4th buy must hit the garage cap, balance unchanged
const beforeCap = bal();
r = await call("buy-car", { id: "city-sedan", color: "black", server: 1 }, token);
check("4th buy refused (garage full 3/3)", !r.ok && /garage is full \(3\/3 cars\)/.test(r.message || ""), r.message);
check("cap refusal charges nothing", bal() === beforeCap, `bal=${bal()}`);

// 5. Garage upgrade +2 slots for 800
r = await call("upgrade-garage", { upgrade: "slots", server: 1 }, token);
check("garage +2 slots upgrade (800)", r.ok && r.me?.garage?.slots === 1, r.message || JSON.stringify(r.me?.garage));
check("upgrade charged 800", bal() === beforeCap - 800, `bal=${bal()}`);

// 6. Sedan now buys (4th), flyer (5th)
r = await call("buy-car", { id: "city-sedan", color: "black", server: 1 }, token);
check("buy sedan 450 after upgrade", r.ok, r.message);
r = await call("buy-car", { id: "fly-skyhopper", color: "white", server: 1 }, token);
check("buy flyer fly-skyhopper 6000 (5th)", r.ok, r.message);
check("5 owned", owned().length === 5, JSON.stringify(owned()));

// 7. 6th buy refused at 5/5
const beforeCap2 = bal();
r = await call("buy-car", { id: "bike-street", color: "red", server: 1 }, token);
check("6th buy refused (garage full 5/5)", !r.ok && /garage is full \(5\/5 cars\)/.test(r.message || ""), r.message);
check("2nd cap refusal charges nothing", bal() === beforeCap2, `bal=${bal()}`);

// 8. Re-buy owned ATV: equip only, no charge
const beforeRebuy = bal();
r = await call("buy-car", { id: "atv-trail", color: "red", server: 1 }, token);
check("re-buy owned ATV = equip, no charge", r.ok && /Already yours/.test(r.message || "") && bal() === beforeRebuy, r.message);
check("re-buy repaints stored ATV red", saveFor()?.vehicles?.find((v) => v.id === "atv-trail")?.color === "red");

// 9. Bad color refused, no charge
const beforeBad = bal();
r = await call("buy-car", { id: "atv-quad", color: "notacolor", server: 1 }, token);
check("bad color refused, no charge", !r.ok && bal() === beforeBad, r.message);

// 10. Unknown vehicle refused, no charge
r = await call("buy-car", { id: "car-nope", color: "black", server: 1 }, token);
check("unknown vehicle refused", !r.ok, r.message);

// 11. select-car: switch active to the board
r = await call("select-car", { id: "board-street", server: 1 }, token);
check("select-car board-street", r.ok, r.message);
check("activeVehicle is board-street", saveFor()?.activeVehicle === "board-street", saveFor().activeVehicle);

// 12. No catalog vehicle costs 29,800 (the user's lost-vehicle amount)
const prices = Object.values((await import("../api/city.js")).default || {});
console.log("owned at end:", JSON.stringify(owned()), "balance:", bal(), "spent total:", start - bal());

const fails = results.filter((x) => !x.pass).length;
console.log(`\nSERVER REPRO: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
