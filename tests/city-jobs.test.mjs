// JOBS — clock in, per-task pay, clock out, and the earn remainder.
// Drives the real POST handler against the in-memory backend (no
// Supabase/Neon/Redis env set), so this never touches a live database.
// All pay is City Sol, the in-game money — never real SOL.
import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/city.js";

async function call(op, body = {}, token = "") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await POST(new Request("http://localhost/api/city", { method: "POST", headers, body: JSON.stringify({ op, ...body }) }));
  return { status: res.status, ...(await res.json()) };
}

async function guest(name = "Jobber") {
  const session = await call("session", { name });
  assert.equal(session.ok, true, "guest session should open");
  assert.equal(session.storage, "This server memory", "test must run on the memory backend, never live Supabase");
  return { token: session.token, id: session.me.id, balance: session.me.balance };
}

function saveFor(playerId, server = 1) {
  return globalThis.__orbitx.saves.get(`${playerId}:${server}`);
}

// A shift's clock has run: move the stored start back so the JOB_MS
// floor in `earn` is satisfied without waiting in real time.
function ageShift(playerId, ms = 5000) {
  const raw = saveFor(playerId, 1);
  raw.job.started = Date.now() - ms;
}

test("jobs: clock in records the hourly rate and the task count", async () => {
  const { token, id, balance } = await guest();
  assert.equal(balance, 60000);
  const started = await call("job-start", { job: "courier" }, token);
  assert.equal(started.ok, true, started.message);
  const raw = saveFor(id, 1);
  assert.equal(raw.job.id, "courier");
  assert.equal(raw.job.hourlyRate, 45, "hourly rate is the scaled pay at streak 0");
  assert.equal(raw.job.tasks, 2, "courier has 2 tasks");
  assert.equal(raw.job.tasksDone, 0);
  assert.equal(raw.job.taskPaid, 0);
  // Unknown job never clocks in.
  const bad = await call("job-start", { job: "astronaut" }, token);
  assert.equal(bad.ok, false);
});

test("jobs: task pay lands per task, in order, and earn pays only the remainder", async () => {
  const { token, id } = await guest();
  await call("job-start", { job: "courier" }, token);
  // Out of order pays nothing.
  const skipped = await call("job-task", { job: "courier", task: 1 }, token);
  assert.equal(skipped.ok, false);
  assert.equal(saveFor(id, 1).job.tasksDone, 0);
  // Task 1 of 2: floor(45 / 2) = 22.
  const first = await call("job-task", { job: "courier", task: 0 }, token);
  assert.equal(first.ok, true, first.message);
  assert.equal(first.taskPay, 22);
  assert.equal(first.tasksDone, 1);
  assert.equal(first.me.balance, 60022);
  // Replaying the same task pays nothing.
  const replay = await call("job-task", { job: "courier", task: 0 }, token);
  assert.equal(replay.ok, false);
  // Task 2 of 2 takes the remainder: 45 - 22 = 23.
  const second = await call("job-task", { job: "courier", task: 1 }, token);
  assert.equal(second.ok, true, second.message);
  assert.equal(second.taskPay, 23);
  assert.equal(second.me.balance, 60045);
  // A third task does not exist.
  const extra = await call("job-task", { job: "courier", task: 2 }, token);
  assert.equal(extra.ok, false);
  // Finishing the shift settles the remainder — 0, already paid in full.
  ageShift(id);
  const earned = await call("earn", { job: "courier" }, token);
  assert.equal(earned.ok, true, earned.message);
  assert.equal(earned.me.balance, 60045, "no double pay: shift total is exactly the rate");
  assert.equal(earned.me.jobStreak, 1, "a finished shift bumps the streak");
  assert.equal(saveFor(id, 1).job, null);
});

test("jobs: earn still pays in full when no task pay landed (mini-games, old clients)", async () => {
  const { token, id } = await guest();
  await call("job-start", { job: "coinhunt" }, token);
  // The 4s clock floor still applies.
  const early = await call("earn", { job: "coinhunt" }, token);
  assert.equal(early.ok, false);
  ageShift(id);
  const earned = await call("earn", { job: "coinhunt" }, token);
  assert.equal(earned.ok, true, earned.message);
  assert.equal(earned.me.balance, 60040);
  assert.equal(earned.me.jobStreak, 1);
});

test("jobs: clocking out early keeps the task pay earned and does not bump the streak", async () => {
  const { token, id } = await guest();
  await call("job-start", { job: "taxi" }, token);
  // Taxi: 6 tasks, 90 / 6 = 15 each.
  const first = await call("job-task", { job: "taxi", task: 0 }, token);
  assert.equal(first.taskPay, 15);
  const second = await call("job-task", { job: "taxi", task: 1 }, token);
  assert.equal(second.taskPay, 15);
  const out = await call("job-clockout", {}, token);
  assert.equal(out.ok, true, out.message);
  assert.equal(out.complete, false);
  assert.equal(out.earned, 30);
  assert.equal(out.tasksDone, 2);
  assert.equal(out.tasks, 6);
  assert.equal(out.me.balance, 60030);
  assert.equal(out.me.jobStreak, 0, "an early clock-out does not bump the streak");
  assert.equal(saveFor(id, 1).job, null);
  // No job, no task pay, no clock-out.
  const noTask = await call("job-task", { job: "taxi", task: 0 }, token);
  assert.equal(noTask.ok, false);
  const noOut = await call("job-clockout", {}, token);
  assert.equal(noOut.ok, false);
});

test("jobs: clocking out after all tasks completes the shift and bumps the streak", async () => {
  const { token, id } = await guest();
  await call("job-start", { job: "barista" }, token);
  // Barista is a single task: the whole 45 lands on it.
  const task = await call("job-task", { job: "barista", task: 0 }, token);
  assert.equal(task.taskPay, 45);
  const out = await call("job-clockout", {}, token);
  assert.equal(out.ok, true, out.message);
  assert.equal(out.complete, true);
  assert.equal(out.earned, 45);
  assert.equal(out.me.balance, 60045);
  assert.equal(out.me.jobStreak, 1);
  assert.equal(saveFor(id, 1).job, null);
});

test("jobs: the hourly rate scales with the streak", async () => {
  const { token, id } = await guest();
  await call("job-start", { job: "courier" }, token);
  await call("job-task", { job: "courier", task: 0 }, token);
  await call("job-task", { job: "courier", task: 1 }, token);
  ageShift(id);
  const earned = await call("earn", { job: "courier" }, token);
  assert.equal(earned.me.jobStreak, 1);
  // Streak 1: 45 * 1.05 = 47.25 -> 47.
  const next = await call("job-start", { job: "courier" }, token);
  assert.equal(next.ok, true);
  assert.equal(saveFor(id, 1).job.hourlyRate, 47);
  // Task split at the new rate: floor(47 / 2) = 23, then 24.
  const first = await call("job-task", { job: "courier", task: 0 }, token);
  assert.equal(first.taskPay, 23);
  const second = await call("job-task", { job: "courier", task: 1 }, token);
  assert.equal(second.taskPay, 24);
  assert.equal(second.me.balance, 60045 + 47);
});
