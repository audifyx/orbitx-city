// The gate's kill switch: EARLY_ACCESS_OFF hides the gate (status
// reports inactive, everyone enters) without deleting any gate code.
// The env var must flip the answer even before the Dec 5 end date,
// and removing it must restore the date-based behavior exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { earlyAccessGateActive, EARLY_ACCESS_GATE_END_MS } from "../api/ads.js";

const BEFORE_END = EARLY_ACCESS_GATE_END_MS - 60_000;
const AFTER_END = EARLY_ACCESS_GATE_END_MS + 60_000;

test("gate is active before Dec 5 with no kill switch", () => {
  delete process.env.EARLY_ACCESS_OFF;
  assert.equal(earlyAccessGateActive(BEFORE_END), true);
  assert.equal(earlyAccessGateActive(AFTER_END), false);
});

test("EARLY_ACCESS_OFF forces the gate inactive at any date", () => {
  process.env.EARLY_ACCESS_OFF = "1";
  try {
    assert.equal(earlyAccessGateActive(BEFORE_END), false);
    assert.equal(earlyAccessGateActive(AFTER_END), false);
  } finally {
    delete process.env.EARLY_ACCESS_OFF;
  }
  // And the switch is fully reversible.
  assert.equal(earlyAccessGateActive(BEFORE_END), true);
});
