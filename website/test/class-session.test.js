// Tests for the class logic: joining, counting reps, alerts and final colours.
// Run with:  npm test

import test from "node:test";
import assert from "node:assert/strict";
import { ClassSession, PHASE, RESULT, judgeParticipant, cleanName, cleanRep, mainIssue } from "../src/class-session.js";
import { Simulator } from "../src/simulator.js";

const TEST_SETTINGS = {
  defaultTargetReps: 8,
  minTargetReps: 1,
  maxTargetReps: 50,
  maxParticipants: 3,
  maxNameLength: 30,
  badRepsInARowForAlert: 3,
  stalledSeconds: 60,
};

const GOOD_REP = { good: true, peakDeg: 130, liftSec: 0.7, lowerSec: 1.2, swingG: 0.1, faults: [] };
const BAD_REP = { good: false, peakDeg: 130, liftSec: 0.7, lowerSec: 0.3, swingG: 0.1, faults: ["LOWER_FAST"] };

// A session with a fake clock we can move forward by hand.
function makeSession() {
  const clock = { time: 1_000_000 };
  const session = new ClassSession(TEST_SETTINGS, () => clock.time);
  const alerts = [];
  session.on("alert", (alert) => alerts.push(alert));
  return { session, clock, alerts };
}

test("final colour: green / red / yellow rules", () => {
  const reps = (good, bad) => [...Array(good).fill(GOOD_REP), ...Array(bad).fill(BAD_REP)];
  assert.equal(judgeParticipant(reps(6, 2), 8), RESULT.GOOD);       // mostly good
  assert.equal(judgeParticipant(reps(2, 6), 8), RESULT.BAD);        // mostly bad
  assert.equal(judgeParticipant(reps(4, 4), 8), RESULT.BAD);        // a tie is NOT "mostly good"
  assert.equal(judgeParticipant(reps(5, 0), 8), RESULT.INCOMPLETE); // short of the target
  assert.equal(judgeParticipant([], 8), RESULT.INCOMPLETE);         // did nothing
});

test("names are tidied, and empty names are refused", () => {
  assert.equal(cleanName("  Sam   K.  "), "Sam K.");
  assert.equal(cleanName("Sam\u0000\u0007"), "Sam");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName(42), null);
  assert.equal(cleanName("x".repeat(50)).length, 30);
});

test("a duplicate name is refused while that person is online", () => {
  const { session } = makeSession();
  assert.ok(session.addParticipant("Sam").ok);
  const second = session.addParticipant("sam"); // case doesn't matter
  assert.equal(second.ok, false);
  assert.match(second.reason, /already joined/);
});

test("someone who lost connection can rejoin with the same name and keeps their reps", () => {
  const { session } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(8);
  session.recordRep(participant.id, GOOD_REP);
  session.setOnline(participant.id, false);

  const again = session.addParticipant("Sam");
  assert.ok(again.ok);
  assert.equal(again.reconnected, true);
  assert.equal(again.participant.reps.length, 1);
  assert.equal(again.participant.online, true);
});

test("the class has a size limit", () => {
  const { session } = makeSession();
  session.addParticipant("A");
  session.addParticipant("B");
  session.addParticipant("C");
  assert.equal(session.addParticipant("D").ok, false);
});

test("reps only count while the exercise is running", () => {
  const { session } = makeSession();
  const { participant } = session.addParticipant("Sam");
  assert.equal(session.recordRep(participant.id, GOOD_REP).reason, "not-running");
  session.startExercise(8);
  assert.ok(session.recordRep(participant.id, GOOD_REP).ok);
  session.endExercise();
  assert.equal(session.recordRep(participant.id, GOOD_REP).reason, "not-running");
});

test("broken or made-up rep data is rejected", () => {
  assert.equal(cleanRep(null), null);
  assert.equal(cleanRep({ ...GOOD_REP, peakDeg: "lots" }), null);
  assert.equal(cleanRep({ ...GOOD_REP, peakDeg: Infinity }), null);
  assert.equal(cleanRep({ ...GOOD_REP, faults: ["HACKED"] }), null);
  assert.equal(cleanRep({ ...GOOD_REP, faults: ["SWING"] }), null); // "good" but has a fault
  assert.equal(cleanRep({ ...BAD_REP, faults: [] }), null);         // "bad" with no fault
  assert.deepEqual(cleanRep(GOOD_REP), GOOD_REP);
});

test("target reps must be a sensible whole number", () => {
  const { session } = makeSession();
  assert.equal(session.startExercise(0).ok, false);
  assert.equal(session.startExercise(2.5).ok, false);
  assert.equal(session.startExercise("lots").ok, false);
  assert.equal(session.startExercise(51).ok, false);
  assert.ok(session.startExercise("10").ok);
  assert.equal(session.targetReps, 10);
});

test("3 bad reps in a row raises ONE check-in alert, and a good rep resets the streak", () => {
  const { session, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(20);

  session.recordRep(participant.id, BAD_REP);
  session.recordRep(participant.id, BAD_REP);
  assert.equal(alerts.length, 0);
  session.recordRep(participant.id, BAD_REP);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, "warning");
  assert.match(alerts[0].message, /3 bad reps in a row \(Lower slower \(x3\)\)/);
  assert.equal(participant.needsCheckIn, true);

  session.recordRep(participant.id, BAD_REP); // 4th in a row: no repeat alert
  assert.equal(alerts.length, 1);

  session.acknowledgeCheckIn(participant.id);
  assert.equal(participant.needsCheckIn, false);
  session.recordRep(participant.id, GOOD_REP);
  session.recordRep(participant.id, BAD_REP);
  session.recordRep(participant.id, BAD_REP);
  session.recordRep(participant.id, BAD_REP);
  assert.equal(alerts.length, 2); // new streak, new alert
});

test("reaching the target raises an info alert", () => {
  const { session, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(2);
  session.recordRep(participant.id, GOOD_REP);
  session.recordRep(participant.id, BAD_REP);
  assert.equal(alerts.at(-1).level, "info");
  assert.match(alerts.at(-1).message, /finished all 2 reps \(1 good\)/);
});

test("stalled participants get one alert after the time limit", () => {
  const { session, clock, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(8);
  session.recordRep(participant.id, GOOD_REP);

  clock.time += 59_000;
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 0);

  clock.time += 2_000;
  session.checkForStalledParticipants();
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /hasn't done a rep in 60 s \(1\/8 done\)/);
});

test("ending the exercise gives everyone a result; a new round clears it", () => {
  const { session } = makeSession();
  const a = session.addParticipant("A").participant;
  const b = session.addParticipant("B").participant;
  session.startExercise(2);
  session.recordRep(a.id, GOOD_REP);
  session.recordRep(a.id, GOOD_REP);
  session.recordRep(b.id, BAD_REP);
  session.endExercise();

  assert.equal(session.phase, PHASE.FINISHED);
  assert.equal(a.result, RESULT.GOOD);
  assert.equal(b.result, RESULT.INCOMPLETE);

  session.resetToLobby();
  assert.equal(session.phase, PHASE.LOBBY);
  assert.equal(a.reps.length, 0);
  assert.equal(a.result, null);
});

test("mainIssue names the most common fault", () => {
  const swing = { ...BAD_REP, faults: ["SWING"] };
  assert.equal(mainIssue([BAD_REP, swing, swing]), "Don't swing (x2)");
  assert.equal(mainIssue([GOOD_REP]), "");
});

test("simulated reps are always valid and match their faults", () => {
  const { session } = makeSession();
  const simulator = new Simulator(session, { count: 0 });
  for (let i = 0; i < 500; i++) {
    const rep = simulator.makeRep(0.5);
    assert.deepEqual(cleanRep(rep), rep);
    if (rep.faults.includes("SHORT_RANGE")) assert.ok(rep.peakDeg < 100);
    if (rep.faults.includes("SWING")) assert.ok(rep.swingG > 0.5);
  }
});
