// PEOPLE: roommates + guests, house parties, property empire, meet people.
// Drives the real POST handler against the in-memory backend (no
// Supabase/Neon/Redis env set), so this never touches a live database.
// All City Sol, all state in the save's homes JSON (no new DB column).
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "./city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "People") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

async function buyTwoHomes(token) {
  const first = await call("buy-home", { home: "home-ny-01", server: 1 }, token);
  assert.equal(first.ok, true, first.message);
  assert.equal(first.me.balance, 60000 - 2300);
  const second = await call("buy-home", { home: "home-ny-02", server: 1 }, token);
  assert.equal(second.ok, true, second.message);
  assert.equal(second.me.balance, 60000 - 2300 - 2090);
}

test("people: npc-talk builds a relationship, Friend visits your home", async () => {
  const { token, id } = await guest("Talker");
  await buyTwoHomes(token);

  const unknown = await call("npc-talk", { npc: "Nobody", server: 1 }, token);
  assert.equal(unknown.ok, false);

  // The 5s talk cooldown is server-side; the test rewinds it in memory.
  const rewind = () => {
    const save = saveFor(id, 1);
    if (save.homes.people?.Vera) save.homes.people.Vera.lastTalkAt = 0;
  };
  const first = await call("npc-talk", { npc: "Vera", server: 1 }, token);
  assert.equal(first.ok, true, first.message);
  assert.equal(first.relationship.talks, 1);
  assert.equal(first.relationship.label, "Acquaintance");
  assert.equal(first.visited, false);

  rewind();
  const second = await call("npc-talk", { npc: "Vera", server: 1 }, token);
  assert.equal(second.relationship.talks, 2);
  assert.equal(second.relationship.label, "Acquaintance");

  rewind();
  const third = await call("npc-talk", { npc: "Vera", server: 1 }, token);
  assert.equal(third.relationship.talks, 3);
  assert.equal(third.relationship.label, "Friend");
  assert.equal(third.relationship.canVisit, true);
  // Reaching Friend sends Vera over to the first owned home, 10 minutes.
  assert.equal(third.visited, true, third.message);
  assert.equal(third.guests.some((g) => g.name === "Vera" && g.homeId === "home-ny-01"), true);

  const status = await call("people-status", { server: 1 }, token);
  assert.equal(status.ok, true);
  const vera = status.relationships.find((r) => r.npc === "Vera");
  assert.equal(vera.label, "Friend");
  assert.equal(vera.level, 2);
  assert.equal(status.relationships.length, 14, "all 14 talkable NPCs listed");

  // The relationship survives as JSON in the homes column (what
  // rowFromSave stores) — no new column.
  const raw = saveFor(id, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(raw.homes.people.Vera)), raw.homes.people.Vera);
  assert.equal(raw.homes.people.Vera.talks, 3);
});

test("people: invite is gated on Friend, then the guest shows up", async () => {
  const { token } = await guest("Host");

  const noHome = await call("people-invite", { npc: "Otis", server: 1 }, token);
  assert.equal(noHome.ok, false);
  assert.match(noHome.message, /Buy a home/);

  await call("buy-home", { home: "home-ny-01", server: 1 }, token);

  const stranger = await call("people-invite", { npc: "Otis", server: 1 }, token);
  assert.equal(stranger.ok, false);
  assert.match(stranger.message, /become Friends first/);

  // Chat Otis up to Friend (3 talks, 5s cooldown rewound in memory).
  for (let i = 0; i < 3; i++) {
    const talked = await call("npc-talk", { npc: "Otis", server: 1 }, token);
    assert.equal(talked.ok, true, talked.message);
    // Rewind the 5s cooldown so the next talk counts.
    const saves = [...globalThis.__orbitx.saves.values()].filter((s) => s.homes?.people?.Otis);
    for (const s of saves) s.homes.people.Otis.lastTalkAt = 0;
  }
  const invited = await call("people-invite", { npc: "Otis", home: "home-ny-01", server: 1 }, token);
  assert.equal(invited.ok, true, invited.message);
  assert.equal(invited.guests.some((g) => g.name === "Otis" && g.homeId === "home-ny-01"), true);

  const rented = await call("people-invite", { npc: "Nadia", server: 1 }, token);
  assert.equal(rented.ok, false, "a Stranger cannot be invited");
});

test("people: party costs 50 City Sol, Friends show up, then it ends", async () => {
  const { token, id } = await guest("Party");
  await buyTwoHomes(token);

  const rewindVera = () => {
    const save = saveFor(id, 1);
    if (save.homes.people?.Vera) save.homes.people.Vera.lastTalkAt = 0;
  };
  for (let i = 0; i < 3; i++) {
    await call("npc-talk", { npc: "Vera", server: 1 }, token);
    rewindVera();
  }
  // Vera's Friend visit from the 3rd talk is still running; end it by
  // expiring it in memory so the party guest list is the party's own.
  saveFor(id, 1).homes.guests = {};

  const before = 60000 - 2300 - 2090;
  const started = await call("people-party-start", { home: "home-ny-01", server: 1 }, token);
  assert.equal(started.ok, true, started.message);
  assert.equal(started.me.balance, before - 50, "party costs 50 City Sol");
  assert.equal(started.party.homeId, "home-ny-01");
  assert.deepEqual(started.party.guests, ["Vera"], "Friends come to the party");
  assert.equal(started.guests.some((g) => g.name === "Vera"), true);

  const again = await call("people-party-start", { home: "home-ny-01", server: 1 }, token);
  assert.equal(again.ok, false, "no second party while one is going");

  const ended = await call("people-party-end", { server: 1 }, token);
  assert.equal(ended.ok, true, ended.message);
  assert.equal(ended.party, null);
  assert.equal(ended.guests.length, 0, "party guests leave with the party");
  assert.equal(ended.me.balance, before - 50, "ending a party is free");
});

test("people: rent out a home, collect weekly rent, end the lease", async () => {
  const { token, id } = await guest("Landlord");
  await buyTwoHomes(token);

  const rented = await call("people-rent-out", { home: "home-ny-02", server: 1 }, token);
  assert.equal(rented.ok, true, rented.message);
  // 5% of 2090 = 104.5, rounded to the nearest 10 = 100 City Sol/week.
  assert.equal(rented.rentals[0].weeklyRent, 100);
  assert.equal(rented.rentals[0].weeksDue, 0, "first payout is 7 days out");
  assert.equal(rented.rentals[0].tenant.length > 0, true);

  const again = await call("people-rent-out", { home: "home-ny-02", server: 1 }, token);
  assert.equal(again.ok, false, "already rented out");

  // A rented home cannot host guests or a party.
  const noGuest = await call("people-invite", { npc: "Vera", home: "home-ny-02", server: 1 }, token);
  assert.equal(noGuest.ok, false);

  const early = await call("people-collect-rent", { server: 1 }, token);
  assert.equal(early.ok, true);
  assert.equal(early.collected, 0, "nothing due yet");

  // Age the lease 15 days: floor(15/7)+1 = 3 weeks due.
  const save = saveFor(id, 1);
  save.homes.rentals["home-ny-02"].nextRentAt = Date.now() - 15 * 86400000;
  const before = save.balance;
  const collected = await call("people-collect-rent", { server: 1 }, token);
  assert.equal(collected.ok, true, collected.message);
  assert.equal(collected.collected, 300, "3 weeks x 100 City Sol");
  assert.equal(collected.me.balance, before + 300);
  assert.equal(collected.rentals[0].collected, 300);
  assert.equal(collected.rentals[0].weeksDue, 0, "next payout pushed out");

  // End the lease with 8 days owed: 2 weeks x 100 — the regression test
  // for the first draft, which paid the week COUNT (2 City Sol) instead.
  const save2 = saveFor(id, 1);
  save2.homes.rentals["home-ny-02"].nextRentAt = Date.now() - 8 * 86400000;
  const beforeEnd = save2.balance;
  const ended = await call("people-end-rent", { home: "home-ny-02", server: 1 }, token);
  assert.equal(ended.ok, true, ended.message);
  assert.equal(ended.collected, 200, "2 weeks owed, paid in full on move-out");
  assert.equal(ended.me.balance, beforeEnd + 200);
  assert.equal(ended.rentals.length, 0, "lease gone");

  // The home is liveable again: rent it out a second time.
  const againRented = await call("people-rent-out", { home: "home-ny-02", server: 1 }, token);
  assert.equal(againRented.ok, true, againRented.message);

  // my-properties carries the empire fields the panel reads.
  const props = await call("my-properties", { server: 1 }, token);
  assert.equal(props.ok, true);
  assert.equal(props.rentals.length, 1);
  assert.equal(props.rentals[0].homeId, "home-ny-02");
  assert.equal(Array.isArray(props.relationships), true);
});
