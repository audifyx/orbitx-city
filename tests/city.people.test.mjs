// PEOPLE: roommates + guests, house parties, property empire, meet people.
// Drives the real POST handler against the in-memory backend (no
// Supabase/Neon/Redis env set), so this never touches a live database.
// All City Sol, all state in the save's homes JSON (no new DB column).
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

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
  // Friends (level 2+) come to house parties — Close Friends just rank first.
  assert.equal(third.relationship.canParty, true);
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

test("people: party invite needs Accept, then leave, then decline", async () => {
  const host = await guest("PartyHost");
  const guestPlayer = await guest("PartyGuest");

  // The invite lands in the guest's inbox (kind "party") — nobody joins
  // until they answer it.
  const invited = await call("party-invite", { id: guestPlayer.id }, host.token);
  assert.equal(invited.ok, true, invited.message);
  assert.match(invited.message, /Invite sent/);
  const inbox = await call("me", {}, guestPlayer.token);
  assert.equal(inbox.me.inbox.length, 1, "one party invite in the inbox");
  assert.equal(inbox.me.inbox[0].kind, "party");
  assert.equal(inbox.me.inbox[0].id, host.id);
  // The invite alone does not put anyone in a party.
  assert.equal(inbox.me.party, "");

  // Accepting joins the same party as the host, and clears the invite.
  const joined = await call("party-accept", { id: host.id }, guestPlayer.token);
  assert.equal(joined.ok, true, joined.message);
  assert.equal(joined.party.members.length, 2, "host + guest in the party");
  assert.deepEqual(joined.party.members.map((m) => m.id).sort(), [host.id, guestPlayer.id].sort());
  const afterJoin = await call("me", {}, guestPlayer.token);
  assert.equal(afterJoin.me.inbox.length, 0, "invite cleared on accept");
  assert.equal(afterJoin.me.party, joined.party.id);

  // Leaving drops the guest; the host stays in the party.
  const left = await call("party-leave", {}, guestPlayer.token);
  assert.equal(left.ok, true, left.message);
  assert.equal(left.party, null);
  const hostMe = await call("me", {}, host.token);
  assert.equal(hostMe.me.party, joined.party.id, "host is still in the party");

  // A second invite can be declined instead — the inbox clears and
  // nobody joins.
  const invitedAgain = await call("party-invite", { id: guestPlayer.id }, host.token);
  assert.equal(invitedAgain.ok, true, invitedAgain.message);
  const declined = await call("decline-request", { id: host.id, kind: "party" }, guestPlayer.token);
  assert.equal(declined.ok, true, declined.message);
  const afterDecline = await call("me", {}, guestPlayer.token);
  assert.equal(afterDecline.me.inbox.length, 0, "declined invite leaves the inbox");
  assert.equal(afterDecline.me.party, "", "declining never joins the party");

  // Accepting an invite that is gone (already declined) fails cleanly.
  const stale = await call("party-accept", { id: host.id }, guestPlayer.token);
  assert.equal(stale.ok, false);
});

test("people: accepting a friend request keeps a party invite from the same player", async () => {
  const host = await guest("DualHost");
  const guestPlayer = await guest("DualGuest");

  // One player sends BOTH a friend request and a party invite.
  const asked = await call("friend-ask", { id: guestPlayer.id }, host.token);
  assert.equal(asked.ok, true, asked.message);
  const invited = await call("party-invite", { id: guestPlayer.id }, host.token);
  assert.equal(invited.ok, true, invited.message);
  const before = await call("me", {}, guestPlayer.token);
  assert.equal(before.me.inbox.length, 2, "friend request + party invite in the inbox");

  // Accepting the friend request drops ONLY the friend request — the
  // party invite stays until it is answered. (First draft dropped both.)
  const accepted = await call("friend-accept", { id: host.id }, guestPlayer.token);
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(accepted.me.friends.some((f) => f.id === host.id), true, "they are friends now");
  assert.equal(accepted.me.inbox.length, 1, "party invite survives the friend accept");
  assert.equal(accepted.me.inbox[0].kind, "party");

  // And the party invite can still be accepted afterwards.
  const joined = await call("party-accept", { id: host.id }, guestPlayer.token);
  assert.equal(joined.ok, true, joined.message);
  assert.equal(joined.party.members.length, 2);

  // Declining a friend request drops only that request, never a party
  // invite from the same player.
  const host2 = await guest("DualHost2");
  await call("friend-ask", { id: guestPlayer.id }, host2.token);
  await call("party-invite", { id: guestPlayer.id }, host2.token);
  const declined = await call("decline-request", { id: host2.id, kind: "friend" }, guestPlayer.token);
  assert.equal(declined.ok, true, declined.message);
  assert.equal(declined.me.inbox.length, 1, "declining the friend request keeps the party invite");
  assert.equal(declined.me.inbox[0].kind, "party");
});

test("people: friend-ask lands in the inbox, accept makes both friends", async () => {
  const asker = await guest("Asker");
  const asked = await guest("Asked");

  const sent = await call("friend-ask", { id: asked.id }, asker.token);
  assert.equal(sent.ok, true, sent.message);
  const inbox = await call("me", {}, asked.token);
  assert.equal(inbox.me.inbox.length, 1, "the request shows in the other player's inbox");
  assert.equal(inbox.me.inbox[0].id, asker.id);
  assert.equal(inbox.me.inbox[0].kind, undefined, "friend requests carry no kind");

  const accepted = await call("friend-accept", { id: asker.id }, asked.token);
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(accepted.me.friends.some((f) => f.id === asker.id), true, "they are friends now");
  const askerMe = await call("me", {}, asker.token);
  assert.equal(askerMe.me.friends.some((f) => f.id === asked.id), true, "both sides list the friend");
});

test("people: the old party op with an invite SENDS an invite, never force-adds", async () => {
  const host = await guest("OldHost");
  const guestPlayer = await guest("OldGuest");

  // The live bug: "party" with invite pushed the other player straight
  // into the party and set their party id, with no inbox entry and no
  // notification — the invitee never knew, so the button looked dead.
  const res = await call("party", { invite: guestPlayer.id }, host.token);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message || "", /Invite sent/);
  const guestMe = await call("me", {}, guestPlayer.token);
  assert.equal(guestMe.me.party, "", "the invitee is NOT in the party until they accept");
  assert.equal(guestMe.me.inbox.length, 1, "the invitee gets an inbox invite instead");
  assert.equal(guestMe.me.inbox[0].kind, "party");
  assert.equal(res.party.members.length, 1, "only the host is in the party so far");

  // And the invite can still be accepted afterwards.
  const joined = await call("party-accept", { id: host.id }, guestPlayer.token);
  assert.equal(joined.ok, true, joined.message);
  assert.equal(joined.party.members.length, 2);
});
