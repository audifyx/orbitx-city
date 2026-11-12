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

test("signup, login, spend, and a second login keep the same balance", async () => {
  const email = `ada-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  assert.equal(signed.data.ok, true);
  const token = signed.data.token;
  const session = await call("session", {}, token);
  assert.equal(session.data.me.account, true);
  assert.equal(session.data.me.balance, 250);
  const spent = await call("spend", { item: "color-white" }, token);
  assert.equal(spent.data.ok, true);
  assert.equal(spent.data.me.balance, 230);
  const again = await call("auth-login", { email, password: "correct-horse" });
  const loaded = await call("me", {}, again.data.token);
  assert.equal(loaded.data.me.balance, 230);
  assert.equal(loaded.data.me.id, session.data.me.id);
  const tampered = await call("me", {}, `${token}x`);
  assert.equal(tampered.status, 401);
  const injected = await call("profile", { name: "Ada", balance: 999999 }, token);
  assert.equal(injected.data.me.balance, 230);
});

test("a guest city moves onto a new account", async () => {
  const guest = await call("session", { name: "Guest One" });
  const guestToken = guest.data.token;
  const spent = await call("spend", { item: "hat-cap" }, guestToken);
  assert.equal(spent.data.me.balance, 235);
  const email = `bea-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const moved = await call("session", { guestToken }, signed.data.token);
  assert.equal(moved.data.upgraded, true);
  assert.equal(moved.data.me.balance, 235);
  assert.equal(moved.data.me.account, true);
  const stale = await call("me", {}, guestToken);
  assert.equal(stale.status, 401);
});

test("magic link dev login issues an account token", async () => {
  const email = `magic-${Date.now()}@example.com`;
  const sent = await call("auth-magic", { email });
  assert.match(sent.data.devLink, /magic=/);
  const code = sent.data.devLink.split("magic=")[1];
  const done = await call("auth-magic-finish", { code });
  assert.equal(done.data.ok, true);
});
