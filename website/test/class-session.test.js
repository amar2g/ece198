// Tests for the class logic: joining, sets, reps, reference reps, help, alerts and final colours.
// Run with:  npm test

import test from "node:test";
import assert from "node:assert/strict";
import { ClassSession, PHASE, RESULT, judgeParticipant, cleanName, cleanRep, mainIssue } from "../src/class-session.js";
import { Simulator } from "../src/simulator.js";

const TEST_SETTINGS = {
  defaultTargetReps: 8,
  minTargetReps: 1,
  maxTargetReps: 50,
  defaultTargetSets: 2,
  minTargetSets: 1,
  maxTargetSets: 5,
  maxParticipants: 3,
  maxNameLength: 30,
  badRepsInARowForAlert: 3,
  stalledSeconds: 60,
  restBetweenSetsSeconds: 120,
};

const GOOD_REP = { good: true, peakDeg: 130, liftSec: 0.7, lowerSec: 1.2, swingG: 0.1, faults: [] };
const BAD_REP = { good: false, peakDeg: 130, liftSec: 0.7, lowerSec: 0.3, swingG: 0.1, faults: ["LOWER_FAST"] };
const REFERENCE = { peakDeg: 128, liftSec: 0.8, lowerSec: 1.3, swingG: 0.12 };

// A session with a fake clock we can move forward by hand
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
  session.startExercise(8, 2);
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
  session.startExercise(8, 1);
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

test("reps and sets must be sensible whole numbers", () => {
  const { session } = makeSession();
  assert.equal(session.startExercise(0, 2).ok, false);
  assert.equal(session.startExercise(2.5, 2).ok, false);
  assert.equal(session.startExercise("lots", 2).ok, false);
  assert.equal(session.startExercise(51, 2).ok, false);
  assert.equal(session.startExercise(8, 0).ok, false);
  assert.equal(session.startExercise(8, 6).ok, false);
  assert.ok(session.startExercise("10", "3").ok);
  assert.equal(session.totalTargetReps, 30);
});

test("the plan can be changed in the lobby but not during an exercise", () => {
  const { session } = makeSession();
  assert.ok(session.setPlan(10, 1).ok);
  assert.deepEqual(session.exerciseInfo(), { phase: PHASE.LOBBY, targetReps: 10, targetSets: 1 });
  session.startExercise(10, 1);
  assert.equal(session.setPlan(5, 2).ok, false);
});

test("reps are tagged with their set, and you can't start more sets than planned", () => {
  const { session } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(2, 2);

  assert.equal(session.startSet(participant.id).setNumber, 1);
  session.recordRep(participant.id, GOOD_REP);
  session.recordRep(participant.id, BAD_REP);
  assert.equal(session.startSet(participant.id).setNumber, 2);
  const result = session.recordRep(participant.id, GOOD_REP);
  assert.equal(result.setRepCount, 1);
  assert.deepEqual(participant.reps.map((r) => r.set), [1, 1, 2]);
  assert.equal(session.startSet(participant.id).reason, "all-sets-done");
});

test("a rep without a set-start still counts as set 1", () => {
  const { session } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(8, 2);
  session.recordRep(participant.id, GOOD_REP);
  assert.equal(participant.reps[0].set, 1);
});

test("3 bad reps in a row raises ONE check-in alert, and a good rep resets the streak", () => {
  const { session, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(20, 1);

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

test("finishing all sets raises an info alert", () => {
  const { session, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(1, 2);
  session.startSet(participant.id);
  session.recordRep(participant.id, GOOD_REP);
  assert.equal(alerts.length, 0); // only 1 of 2 sets done
  session.startSet(participant.id);
  session.recordRep(participant.id, BAD_REP);
  assert.match(alerts.at(-1).message, /finished all 2 sets \(1\/2 good\)/);
});

test("no rep for 60 s during a set gives one alert", () => {
  const { session, clock, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(8, 1);
  session.startSet(participant.id);
  session.setStrapStatus(participant.id, "in-set");
  session.recordRep(participant.id, GOOD_REP);

  clock.time += 59_000;
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 0);

  clock.time += 2_000;
  session.checkForStalledParticipants();
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /hasn't done a rep in 60 s \(set 1 of 1\)/);
});

test("resting between sets is allowed for 2 minutes before an alert", () => {
  const { session, clock, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(1, 2);
  session.startSet(participant.id);
  session.recordRep(participant.id, GOOD_REP);
  session.setStrapStatus(participant.id, "set-done");

  clock.time += 90_000; // longer than 60 s, but resting
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 0);

  clock.time += 31_000;
  session.checkForStalledParticipants();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /rested over 2 min after set 1 of 2/);
});

test("reference reps: ready count, one 'everyone ready' alert, kept on restart, cleared on new round", () => {
  const { session, alerts } = makeSession();
  const a = session.addParticipant("A").participant;
  const b = session.addParticipant("B").participant;

  assert.equal(session.setReference(a.id, { peakDeg: "x" }).ok, false); // bad data
  session.setReference(a.id, REFERENCE);
  assert.equal(a.referenceReady, true);
  assert.equal(alerts.length, 0); // B isn't ready yet
  session.setReference(b.id, REFERENCE);
  assert.match(alerts.at(-1).message, /Everyone has recorded their reference rep \(2\/2\)/);
  session.setReference(b.id, REFERENCE); // re-recording doesn't repeat the alert
  assert.equal(alerts.length, 1);

  session.startExercise(8, 2);
  session.endExercise();
  session.startExercise(8, 2); // same exercise again: references kept
  assert.equal(a.referenceReady, true);
  session.endExercise();
  session.resetToLobby();      // new round = new exercise: record again
  assert.equal(a.referenceReady, false);
  assert.equal(a.reference, null);
});

test("help requests alert once, survive the exercise starting, and clear when checked", () => {
  const { session, alerts } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.requestHelp(participant.id);
  session.requestHelp(participant.id); // pressing again doesn't spam the instructor
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /Sam needs help/);

  session.startExercise(8, 2);
  assert.equal(participant.helpRequested, true);
  assert.equal(participant.needsCheckIn, true);

  session.acknowledgeCheckIn(participant.id);
  assert.equal(participant.helpRequested, false);
  assert.equal(participant.needsCheckIn, false);
});

test("ending the exercise gives everyone a result based on all sets", () => {
  const { session } = makeSession();
  const a = session.addParticipant("A").participant;
  const b = session.addParticipant("B").participant;
  session.startExercise(1, 2);
  session.recordRep(a.id, GOOD_REP);
  session.startSet(a.id);
  session.recordRep(a.id, GOOD_REP);
  session.recordRep(b.id, GOOD_REP); // only 1 of 2 reps
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

test("a finished set from the last exercise doesn't show as 'set done' in the next one", () => {
  const { session } = makeSession();
  const { participant } = session.addParticipant("Sam");
  session.startExercise(1, 1);
  session.setStrapStatus(participant.id, "set-done");
  session.endExercise();
  session.resetToLobby();
  assert.equal(participant.strapStatus, "connected");
});
