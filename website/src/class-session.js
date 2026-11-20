// The class: participants, their reps, the exercise phase, and alerts.
// Knows nothing about the network. It emits events that server.js listens to:
//   "change"   -> send the instructor a new snapshot
//   "alert"    -> show the instructor a pop-up
//   "exercise" -> tell participants the phase/plan changed

import { EventEmitter } from "node:events";
import { FAULT_LABELS } from "../public/js/strap-protocol.js";
import { SETTINGS } from "./config.js";

export const PHASE = { LOBBY: "lobby", RUNNING: "running", FINISHED: "finished" };

// Final colour once the exercise ends
export const RESULT = { GOOD: "good", BAD: "bad", INCOMPLETE: "incomplete" };

export const STRAP_STATUSES = ["not-connected", "connected", "recording-ref", "zeroing", "in-set", "set-done", "error"];

// Yellow if short of the target; else green if MORE than half were good; else red.
export function judgeParticipant(reps, totalTargetReps) {
  if (reps.length < totalTargetReps) return RESULT.INCOMPLETE;
  const goodCount = reps.filter((rep) => rep.good).length;
  return goodCount > reps.length / 2 ? RESULT.GOOD : RESULT.BAD;
}

// Trims spaces and removes invisible characters. Returns null if nothing is left.
export function cleanName(rawName, maxLength = SETTINGS.maxNameLength) {
  if (typeof rawName !== "string") return null;
  const name = rawName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return name || null;
}

// true if all four rep measurements are sensible numbers
function validNumbers(r) {
  const numbers = [r.peakDeg, r.liftSec, r.lowerSec, r.swingG];
  return numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000);
}

// Checks a rep that came over the network. Returns a clean copy, or null if invalid.
export function cleanRep(rep) {
  if (!rep || typeof rep.good !== "boolean" || !validNumbers(rep)) return null;
  if (!Array.isArray(rep.faults) || !rep.faults.every((f) => f in FAULT_LABELS)) return null;
  if (rep.good !== (rep.faults.length === 0)) return null; // good reps have no faults
  const { good, peakDeg, liftSec, lowerSec, swingG, faults } = rep;
  return { good, peakDeg, liftSec, lowerSec, swingG, faults: [...faults] };
}

// Same idea for a reference rep (just the four numbers)
export function cleanReference(ref) {
  if (!ref || !validNumbers(ref)) return null;
  const { peakDeg, liftSec, lowerSec, swingG } = ref;
  return { peakDeg, liftSec, lowerSec, swingG };
}

// Most common fault as text, e.g. "Lower slower (x2)". Empty if none.
export function mainIssue(reps) {
  const counts = {};
  for (const rep of reps) {
    for (const fault of rep.faults) counts[fault] = (counts[fault] ?? 0) + 1;
  }
  let worst = null;
  for (const fault of Object.keys(FAULT_LABELS)) {
    if ((counts[fault] ?? 0) > (counts[worst] ?? 0)) worst = fault;
  }
  return worst ? `${FAULT_LABELS[worst]} (x${counts[worst]})` : "";
}

export class ClassSession extends EventEmitter {
  // `now` is replaceable so tests can use a fake clock
  constructor(settings = SETTINGS, now = () => Date.now()) {
    super();
    this.settings = settings;
    this.now = now;
    this.phase = PHASE.LOBBY;
    this.targetReps = settings.defaultTargetReps;
    this.targetSets = settings.defaultTargetSets;
    this.exerciseStartedAt = null;
    this.demoMode = false;
    this.participants = new Map(); // id -> participant
    this.nextId = 1;
  }

  // Reps needed in total, e.g. 2 sets x 8 reps = 16
  get totalTargetReps() {
    return this.targetReps * this.targetSets;
  }

  // ---------- joining ----------

  // Returns { ok, participant, reconnected } or { ok: false, reason }
  addParticipant(rawName, { simulated = false, previousId = null } = {}) {
    const name = cleanName(rawName, this.settings.maxNameLength);
    if (!name) return { ok: false, reason: "Please type your name." };

    const existing = this.findByName(name);
    if (existing) {
      // Same real person coming back (WiFi drop or page reload): keep their reps
      const canReclaim = !existing.simulated && (!existing.online || previousId === existing.id);
      if (canReclaim) {
        existing.online = true;
        this.emit("change");
        return { ok: true, participant: existing, reconnected: true };
      }
      return { ok: false, reason: `"${existing.name}" has already joined. Add something to tell you apart, like your last initial.` };
    }

    if (this.participants.size >= this.settings.maxParticipants) {
      return { ok: false, reason: "The class is full. Please ask the instructor." };
    }

    const participant = {
      id: String(this.nextId++),
      name,
      simulated,
      online: true,
      strapStatus: simulated ? "connected" : "not-connected",
      strapDetail: "",
      ...newReferenceFields(),
      ...newExerciseFields(),
    };
    this.participants.set(participant.id, participant);
    this.emit("change");
    return { ok: true, participant };
  }

  findByName(name) {
    const wanted = name.toLowerCase();
    return [...this.participants.values()].find((p) => p.name.toLowerCase() === wanted) ?? null;
  }

  removeParticipant(id) {
    if (this.participants.delete(id)) this.emit("change");
  }

  setOnline(id, online) {
    const participant = this.participants.get(id);
    if (!participant || participant.online === online) return;
    participant.online = online;
    if (!online && this.isActive(participant)) {
      this.alert("warning", participant, `${participant.name}'s laptop lost connection.`);
    }
    this.emit("change");
  }

  setStrapStatus(id, status, detail = "") {
    const participant = this.participants.get(id);
    if (!participant || !STRAP_STATUSES.includes(status)) return;
    const changed = participant.strapStatus !== status;
    participant.strapStatus = status;
    participant.strapDetail = String(detail).slice(0, 120);

    if (changed && status === "set-done") participant.setEndedAt = this.now(); // rest starts now
    if (changed && status === "error" && this.phase === PHASE.RUNNING) {
      this.flagCheckIn(participant, "Strap problem");
      this.alert("warning", participant, `${participant.name}'s strap has a problem: ${participant.strapDetail || "sensor error"}.`);
    }
    if (changed && status === "not-connected" && this.isActive(participant)) {
      this.alert("warning", participant, `${participant.name}'s strap was unplugged.`);
    }
    this.emit("change");
  }

  // ---------- reference rep & help ----------

  // A participant recorded their reference rep (their personal "good rep")
  setReference(id, rawReference) {
    const participant = this.participants.get(id);
    const reference = cleanReference(rawReference);
    if (!participant || !reference) return { ok: false };

    const wasReady = participant.referenceReady;
    participant.referenceReady = true;
    participant.reference = reference;

    // Tell the instructor once, when the last person becomes ready
    const everyone = [...this.participants.values()];
    if (!wasReady && this.phase === PHASE.LOBBY && everyone.every((p) => p.referenceReady)) {
      this.alert("info", participant, `Everyone has recorded their reference rep (${everyone.length}/${everyone.length}). Ready to start!`);
    }
    this.emit("change");
    return { ok: true };
  }

  // The participant pressed "I need help"
  requestHelp(id) {
    const participant = this.participants.get(id);
    if (!participant || participant.helpRequested) return; // already asked, don't repeat the alert
    participant.helpRequested = true;
    this.flagCheckIn(participant, "Asked for help");
    this.alert("warning", participant, `🙋 ${participant.name} needs help.`);
    this.emit("change");
  }

  // ---------- sets & reps ----------

  // The participant's strap started a new set. Returns { ok, setNumber } or { ok: false, reason }
  startSet(id) {
    const participant = this.participants.get(id);
    if (!participant) return { ok: false, reason: "unknown-participant" };
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "not-running" };
    if (participant.currentSet >= this.targetSets) return { ok: false, reason: "all-sets-done" };
    participant.currentSet += 1;
    participant.setStartedAt = this.now();
    participant.stalledAlertSent = false;
    this.emit("change");
    return { ok: true, setNumber: participant.currentSet };
  }

  // Returns { ok, repCount, setRepCount } or { ok: false, reason }
  recordRep(id, rawRep) {
    const participant = this.participants.get(id);
    if (!participant) return { ok: false, reason: "unknown-participant" };
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "not-running" };
    const rep = cleanRep(rawRep);
    if (!rep) return { ok: false, reason: "bad-data" };

    if (participant.currentSet === 0) participant.currentSet = 1; // set-start message was lost
    participant.reps.push({ ...rep, set: participant.currentSet, at: this.now() });
    participant.lastRepAt = this.now();
    participant.stalledAlertSent = false;
    participant.badRepsInARow = rep.good ? 0 : participant.badRepsInARow + 1;

    const streak = participant.badRepsInARow;
    if (streak === this.settings.badRepsInARowForAlert) { // alert once per streak
      this.flagCheckIn(participant, `${streak} bad reps in a row`);
      const issue = mainIssue(participant.reps.slice(-streak));
      this.alert("warning", participant, `${participant.name}: ${streak} bad reps in a row (${issue}). Check in on them.`);
    }

    if (participant.reps.length === this.totalTargetReps) {
      const goodCount = participant.reps.filter((r) => r.good).length;
      const what = this.targetSets === 1 ? `${this.targetReps} reps` : `${this.targetSets} sets`;
      this.alert("info", participant, `${participant.name} finished all ${what} (${goodCount}/${this.totalTargetReps} good).`);
    }

    this.emit("change");
    const setRepCount = participant.reps.filter((r) => r.set === participant.currentSet).length;
    return { ok: true, repCount: participant.reps.length, setRepCount };
  }

  // Running, and this person still has reps to do
  isActive(participant) {
    return this.phase === PHASE.RUNNING && participant.reps.length < this.totalTargetReps;
  }

  flagCheckIn(participant, reason) {
    participant.needsCheckIn = true;
    participant.checkInReason = reason;
  }

  // Instructor marked the person as checked (also answers a help request)
  acknowledgeCheckIn(id) {
    const participant = this.participants.get(id);
    if (!participant) return;
    participant.needsCheckIn = false;
    participant.checkInReason = "";
    participant.helpRequested = false;
    this.emit("change");
  }

  // Called every few seconds. Alerts once about anyone stuck for too long:
  // 60 s with no rep during a set, or 2 min of rest between sets.
  checkForStalledParticipants() {
    for (const participant of this.participants.values()) {
      if (!this.isActive(participant) || !participant.online || participant.stalledAlertSent) continue;

      const resting = participant.strapStatus === "set-done" && participant.currentSet > 0;
      const limitSeconds = resting ? this.settings.restBetweenSetsSeconds : this.settings.stalledSeconds;
      const lastActivity = resting
        ? participant.setEndedAt
        : Math.max(participant.lastRepAt ?? 0, participant.setStartedAt ?? 0, this.exerciseStartedAt);
      if (this.now() - lastActivity < limitSeconds * 1000) continue;

      participant.stalledAlertSent = true;
      this.flagCheckIn(participant, resting ? "Long rest" : "No reps lately");
      const { name, currentSet, reps } = participant;
      const message = resting
        ? `${name} has rested over ${limitSeconds / 60} min after set ${currentSet} of ${this.targetSets}.`
        : reps.length === 0
          ? `${name} hasn't started yet.`
          : `${name} hasn't done a rep in ${limitSeconds} s (set ${currentSet} of ${this.targetSets}).`;
      this.alert("warning", participant, message);
      this.emit("change");
    }
  }

  // ---------- exercise phases ----------

  // Checks a reps/sets plan. Returns an error message, or null if it's fine.
  planProblem(targetReps, targetSets) {
    const s = this.settings;
    if (!Number.isInteger(targetReps) || targetReps < s.minTargetReps || targetReps > s.maxTargetReps) {
      return `Target reps must be a whole number from ${s.minTargetReps} to ${s.maxTargetReps}.`;
    }
    if (!Number.isInteger(targetSets) || targetSets < s.minTargetSets || targetSets > s.maxTargetSets) {
      return `Sets must be a whole number from ${s.minTargetSets} to ${s.maxTargetSets}.`;
    }
    return null;
  }

  // Instructor changed reps/sets before starting, so participants can see the plan
  setPlan(targetReps, targetSets) {
    const reps = Number(targetReps);
    const sets = Number(targetSets);
    const problem = this.planProblem(reps, sets);
    if (problem) return { ok: false, reason: problem };
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "Can't change the plan during an exercise." };
    this.targetReps = reps;
    this.targetSets = sets;
    this.emit("exercise");
    this.emit("change");
    return { ok: true };
  }

  // Starts counting. Clears old reps but keeps reference reps (same exercise).
  startExercise(targetReps, targetSets) {
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "An exercise is already running." };
    const planResult = this.setPlan(targetReps, targetSets);
    if (!planResult.ok) return planResult;
    this.phase = PHASE.RUNNING;
    this.exerciseStartedAt = this.now();
    this.clearReps();
    return { ok: true };
  }

  endExercise() {
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "No exercise is running." };
    this.phase = PHASE.FINISHED;
    for (const participant of this.participants.values()) {
      participant.result = judgeParticipant(participant.reps, this.totalTargetReps);
    }
    this.emit("exercise");
    this.emit("change");
    return { ok: true };
  }

  // New round = new exercise: everyone records a fresh reference rep
  resetToLobby() {
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "End the exercise first." };
    this.phase = PHASE.LOBBY;
    this.exerciseStartedAt = null;
    for (const participant of this.participants.values()) Object.assign(participant, newReferenceFields());
    this.clearReps();
    return { ok: true };
  }

  clearReps() {
    for (const participant of this.participants.values()) {
      const stillNeedsHelp = participant.helpRequested; // don't drop an unanswered help request
      Object.assign(participant, newExerciseFields());
      if (participant.strapStatus === "set-done") participant.strapStatus = "connected"; // last exercise's set
      if (stillNeedsHelp) {
        participant.helpRequested = true;
        this.flagCheckIn(participant, "Asked for help");
      }
    }
    this.emit("exercise");
    this.emit("change");
  }

  // ---------- output ----------

  alert(level, participant, message) {
    this.emit("alert", { level, participantId: participant.id, message, at: this.now() });
  }

  // The only thing participants are told about the class
  exerciseInfo() {
    return { phase: this.phase, targetReps: this.targetReps, targetSets: this.targetSets };
  }

  // Everything the instructor dashboard shows
  snapshot() {
    return {
      serverTime: this.now(),
      phase: this.phase,
      targetReps: this.targetReps,
      targetSets: this.targetSets,
      demoMode: this.demoMode,
      participants: [...this.participants.values()].map((p) => {
        const goodCount = p.reps.filter((rep) => rep.good).length;
        return {
          id: p.id,
          name: p.name,
          simulated: p.simulated,
          online: p.online,
          strapStatus: p.strapStatus,
          strapDetail: p.strapDetail,
          referenceReady: p.referenceReady,
          reference: p.reference,
          helpRequested: p.helpRequested,
          currentSet: p.currentSet,
          reps: p.reps,
          goodCount,
          badCount: p.reps.length - goodCount,
          mainIssue: mainIssue(p.reps),
          lastRepAt: p.lastRepAt,
          needsCheckIn: p.needsCheckIn,
          checkInReason: p.checkInReason,
          result: p.result,
        };
      }),
    };
  }
}

// Reference rep: recorded once per exercise, reset on "New round"
function newReferenceFields() {
  return { referenceReady: false, reference: null };
}

// Per-exercise data, reset whenever an exercise starts
function newExerciseFields() {
  return {
    reps: [],
    currentSet: 0,
    setStartedAt: null,
    setEndedAt: null,
    lastRepAt: null,
    badRepsInARow: 0,
    stalledAlertSent: false,
    needsCheckIn: false,
    checkInReason: "",
    helpRequested: false,
    result: null,
  };
}
