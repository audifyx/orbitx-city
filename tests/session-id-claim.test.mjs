// Regression test for audit 2026-11-23 A2 (CRITICAL): the guest
// `session` op used to overwrite any existing player row when the
// presented token was absent/wrong, and returned the attacker a
// working token for the victim's id. Now an existing row is resumed
// only with its exact issued token; unproven callers get a brand-new
// guest under a server-generated id and the victim's row is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

function req(op, body = {}, token = "") {
  return new Request("http://local/api/city", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ op, ...body }),
  });
}

async function call(op, body, token) {
  const res = await POST(req(op, body, token));
  const data = await res.json();
  return { status: res.status, data };
}

test("session with a victim id and a wrong/absent token cannot claim or wipe the row", async () => {
  const victim = await call("session", { name: "Victim" });
  assert.equal(victim.data.ok, true);
  const victimId = victim.data.me.id;
  const victimToken = victim.data.token;
  const spent = await call("spend", { item: "hat-cap" }, victimToken);
  assert.equal(spent.data.ok, true);
  const victimBalance = spent.data.me.balance;

  for (const body of [
    { id: victimId, token: "wrong-token", name: "Attacker" },
    { id: victimId, name: "Attacker" },
    { id: victimId, token: "", name: "Attacker" },
  ]) {
    const attack = await call("session", body);
    assert.equal(attack.data.ok, true);
    // The attacker is a fresh guest under a NEW id — never the victim's
    // id, never the victim's token.
    assert.notEqual(attack.data.me.id, victimId);
    assert.notEqual(attack.data.token, victimToken);
    assert.equal(attack.data.me.balance, 60000);
  }

  // The victim's row is untouched: same token still resumes it, with
  // the post-spend balance and the original name.
  const resumed = await call("session", { id: victimId, token: victimToken });
  assert.equal(resumed.data.ok, true);
  assert.equal(resumed.data.me.id, victimId);
  assert.equal(resumed.data.me.balance, victimBalance);
  assert.equal(resumed.data.me.name, "Victim");
});

test("a first visit may still create a guest under a fresh client-chosen id", async () => {
  const id = `guest-${Date.now()}-new`;
  const created = await call("session", { id, name: "Newcomer" });
  assert.equal(created.data.ok, true);
  assert.equal(created.data.me.id, id);
  const resumed = await call("session", { id, token: created.data.token });
  assert.equal(resumed.data.me.id, id);
});
