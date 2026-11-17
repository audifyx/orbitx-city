// PROFILE (advanced): the spent counter, bio + showcase editing, and
// the new profile-view stats — all driven against the real POST handler
// on the in-memory backend (no Supabase/Neon/Redis env set), so this
// never touches a live database.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Profiler") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

async function viewAs(viewerToken, id) {
  const res = await call("profile-view", { id }, viewerToken);
  assert.equal(res.ok, true, res.message);
  return res.profile;
}

test("profile: spent counts every purchase, net of nothing yet", async () => {
  const { token, id } = await guest("Spender");
  const viewer = await guest("SpenderViewer");

  const home = await call("buy-home", { home: "home-ny-01", server: 1 }, token);
  assert.equal(home.ok, true, home.message);
  assert.equal(home.me.spent, 2300, "home buy banks its price into spent");
  assert.equal(home.me.balance, 60000 - 2300);

  const car = await call("buy-car", { id: "city-compact", color: "black", server: 1 }, token);
  assert.equal(car.ok, true, car.message);
  assert.equal(car.me.spent, 2300 + 220, "car buy adds to spent");

  const shirt = await call("spend", { item: "clothes-tee-red", server: 1 }, token);
  assert.equal(shirt.ok, true, shirt.message);
  assert.equal(shirt.me.spent, 2300 + 220 + 30, "clothes buy adds to spent");

  // The counter survives reload (it lives on the save, not the response).
  assert.equal(saveFor(id, 1).spent, 2550);
  const profile = await viewAs(viewer.token, id);
  assert.equal(profile.spent, 2550, "profile-view reports the same spent total");
  assert.equal(profile.earned, 0, "no income yet, so earned stays 0");
});

test("profile: bio saves, caps at 120 chars, shows in profile-view, email never leaks", async () => {
  const { token, id } = await guest("BioWriter");
  const viewer = await guest("BioViewer");

  const long = "x".repeat(200);
  const saved = await call("profile", { bio: long }, token);
  assert.equal(saved.ok, true, saved.message);
  assert.equal(saved.me.bio.length, 120, "bio is capped at 120 chars");

  const profile = await viewAs(viewer.token, id);
  assert.equal(profile.bio.length, 120);
  assert.equal(profile.bio, "x".repeat(120));
  // Private fields never leave the server on a public profile.
  assert.equal("balance" in profile, false, "balance stays private");
  assert.equal("inbox" in profile, false, "inbox stays private");
  assert.equal("email" in profile, false, "email stays private");
  assert.equal("wallet" in profile, false, "wallet stays private");
  assert.equal("address" in profile, false, "address stays private");
  assert.equal("spent" in profile, true, "spent is a public game stat");
  assert.equal("missionsDone" in profile, true);

  // Newlines collapse to one line; clearing works.
  const oneLine = await call("profile", { bio: "line one\nline two" }, token);
  assert.equal(oneLine.me.bio, "line one line two");
  const cleared = await call("profile", { bio: "   " }, token);
  assert.equal(cleared.me.bio, "");
});

test("profile: showcase only accepts homes and cars the player owns", async () => {
  const { token, id } = await guest("Showcaser");
  const viewer = await guest("ShowcaseViewer");

  const unownedHome = await call("profile", { showcaseHome: "home-ny-01" }, token);
  assert.equal(unownedHome.ok, false, "cannot showcase a home you do not own");
  assert.match(unownedHome.message, /own/);

  const bought = await call("buy-home", { home: "home-ny-01", server: 1 }, token);
  assert.equal(bought.ok, true, bought.message);
  const setHome = await call("profile", { showcaseHome: "home-ny-01" }, token);
  assert.equal(setHome.ok, true, setHome.message);
  assert.equal(setHome.me.showcase.home, "home-ny-01");
  assert.equal(setHome.me.showcase.car, "", "car slot stays empty until set");

  const unownedCar = await call("profile", { showcaseCar: "city-compact" }, token);
  assert.equal(unownedCar.ok, false, "cannot showcase a car you do not own");
  const car = await call("buy-car", { id: "city-compact", color: "black", server: 1 }, token);
  assert.equal(car.ok, true, car.message);
  const setCar = await call("profile", { showcaseCar: "city-compact" }, token);
  assert.equal(setCar.ok, true, setCar.message);
  assert.equal(setCar.me.showcase.car, "city-compact");
  assert.equal(setCar.me.showcase.home, "home-ny-01", "setting the car keeps the home");

  const profile = await viewAs(viewer.token, id);
  assert.deepEqual(profile.showcase, { home: "home-ny-01", car: "city-compact" });

  const cleared = await call("profile", { showcaseHome: "", showcaseCar: "" }, token);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.me.showcase, null, "clearing both slots drops the showcase");
});

test("profile: jobs worked and earned show in profile-view after a shift", async () => {
  const { token, id } = await guest("Worker");
  const viewer = await guest("WorkViewer");

  const started = await call("job-start", { job: "courier", server: 1 }, token);
  assert.equal(started.ok, true, started.message);
  // The 4s shift clock is server-side; the test rewinds it in memory.
  saveFor(id, 1).job.started = Date.now() - 5000;
  const paid = await call("earn", { job: "courier", server: 1 }, token);
  assert.equal(paid.ok, true, paid.message);
  assert.equal(paid.me.jobStreak, 1, "one completed shift");
  // Courier base pay is 45; a fresh save is rested (full crib energy),
  // so the +10% rested bonus lands: 45 * 1.1 = 49.5, rounded to 50.
  assert.equal(paid.me.earned, 50, "courier pay + rested bonus banks into earned");

  const profile = await viewAs(viewer.token, id);
  assert.equal(profile.jobStreak, 1, "profile-view reports jobs worked");
  assert.equal(profile.earned, 50);
  assert.equal(profile.missionsDone, 0, "no missions done yet");
  assert.equal(profile.missionsTotal, 6);
});

test("profile: missions done, NPC friends and items owned are real counts", async () => {
  const { token, id } = await guest("Collector");
  const viewer = await guest("CollectViewer");

  const before = await viewAs(viewer.token, id);
  assert.equal(before.missionsDone, 0);
  assert.equal(before.npcFriends, 0);
  assert.equal(before.itemsOwned, 0);

  // A completed mission-chain entry counts (counted directly from the
  // save's missions map, never via missionProgress, which mutates).
  // The shirt buy mints the server-1 save first — a fresh guest has
  // no save until an op creates one.
  const shirt = await call("spend", { item: "clothes-tee-red", server: 1 }, token);
  assert.equal(shirt.ok, true, shirt.message);
  saveFor(id, 1).missions.welcome = { done: true, step: 1, at: Date.now() };

  // Three talks make Vera a Friend (level 2+) — the 5s cooldown is
  // server-side, so the test rewinds it in memory.
  const rewind = () => {
    const save = saveFor(id, 1);
    if (save.homes.people?.Vera) save.homes.people.Vera.lastTalkAt = 0;
  };
  for (let n = 0; n < 3; n++) {
    const talked = await call("npc-talk", { npc: "Vera", server: 1 }, token);
    assert.equal(talked.ok, true, talked.message);
    rewind();
  }

  const profile = await viewAs(viewer.token, id);
  assert.equal(profile.missionsDone, 1);
  assert.equal(profile.npcFriends, 1, "Vera reached Friend");
  // The shirt counts once; the worn:shirt marker is not an item.
  assert.equal(profile.itemsOwned, 1);
  assert.equal(profile.offices, 0, "no office leases yet");
});
