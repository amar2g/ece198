// Tests for reading the strap's DATA lines.  Run with:  npm test

import test from "node:test";
import assert from "node:assert/strict";
import { parseStrapLine, repsPerSetCommand } from "../public/js/strap-protocol.js";

test("reads a good rep", () => {
  assert.deepEqual(parseStrapLine("DATA,REP,3,GOOD,134.0,0.73,1.15,0.10,NONE"), {
    type: "rep",
    rep: { number: 3, good: true, peakDeg: 134, liftSec: 0.73, lowerSec: 1.15, swingG: 0.1, faults: [] },
  });
});

test("reads a bad rep with two faults, ignoring the Windows \\r line ending", () => {
  const event = parseStrapLine("DATA,REP,2,BAD,80.5,0.73,0.24,0.75,SHORT_RANGE|LOWER_FAST\r");
  assert.equal(event.type, "rep");
  assert.equal(event.rep.good, false);
  assert.deepEqual(event.rep.faults, ["SHORT_RANGE", "LOWER_FAST"]);
});

test("reads set start, set end and errors", () => {
  assert.deepEqual(parseStrapLine("DATA,SET_START,8"), { type: "set-start", repsPerSet: 8 });
  assert.deepEqual(parseStrapLine("DATA,SET_END,8,6"), { type: "set-end", reps: 8, good: 6 });
  assert.deepEqual(parseStrapLine("DATA,ERROR,SENSOR_LOST"), { type: "error", code: "SENSOR_LOST" });
  assert.deepEqual(parseStrapLine("DATA,READY"), { type: "ready" });
});

test("ignores the normal human-readable messages", () => {
  assert.equal(parseStrapLine("Rep 1/8: GOOD"), null);
  assert.equal(parseStrapLine("   peak 134 deg | up 0.73 s | down 1.15 s | swing 0.10 g"), null);
  assert.equal(parseStrapLine("angle:45.2,target:110"), null); // Serial Plotter output
  assert.equal(parseStrapLine(""), null);
});

test("rejects damaged lines instead of counting a wrong rep", () => {
  assert.equal(parseStrapLine("DATA,REP,3,GOOD,134.0,0.7"), null);            // cut off mid-line
  assert.equal(parseStrapLine("DATA,REP,3,MAYBE,134,0.7,1.1,0.1,NONE"), null); // unknown verdict
  assert.equal(parseStrapLine("DATA,REP,3,BAD,134,0.7,1.1,0.1,WOBBLE"), null); // unknown fault
  assert.equal(parseStrapLine("DATA,REP,x,GOOD,134,0.7,1.1,0.1,NONE"), null);  // rep number not a number
  assert.equal(parseStrapLine("DATA,REP,3,GOOD,abc,0.7,1.1,0.1,NONE"), null);  // angle not a number
  assert.equal(parseStrapLine("DATA,SET_START,"), null);
  assert.equal(parseStrapLine("DATA,SOMETHING_NEW,1"), null);
});

test("builds the reps-per-set command", () => {
  assert.equal(repsPerSetCommand(10), "n10\n");
});
