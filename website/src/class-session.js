// The class: participants, their reps, the exercise phase, and alerts.
// Knows nothing about the network. It emits events that server.js listens to:
//   "change"   -> send the instructor a new snapshot
//   "alert"    -> show the instructor a pop-up
//   "exercise" -> tell participants the phase/target changed

import { EventEmitter } from "node:events";
import { FAULT_LABELS } from "../public/js/strap-protocol.js";
import { SETTINGS } from "./config.js";

export const PHASE = { LOBBY: "lobby", RUNNING: "running", FINISHED: "finished" };

// Final colour once the exercise ends
export const RESULT = { GOOD: "good", BAD: "bad", INCOMPLETE: "incomplete" };

export const STRAP_STATUSES = ["not-connected", "connected", "zeroing", "in-set", "set-done", "error"];

// Yellow if short of the target; else green if MORE than half were good; else red.
export function judgeParticipant(reps, targetReps) {
  if (reps.length < targetReps) return RESULT.INCOMPLETE;
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

// Checks a rep that came over the network. Returns a clean copy, or null if invalid.
export function cleanRep(rep) {
  if (!rep || typeof rep.good !== "boolean") return null;
  const numbers = [rep.peakDeg, rep.liftSec, rep.lowerSec, rep.swingG];
  if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000)) return null;
  if (!Array.isArray(rep.faults) || !rep.faults.every((f) => f in FAULT_LABELS)) return null;
  if (rep.good !== (rep.faults.length === 0)) return null; // good reps have no faults
  const { good, peakDeg, liftSec, lowerSec, swingG, faults } = rep;
  return { good, peakDeg, liftSec, lowerSec, swingG, faults: [...faults] };
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
    this.exerciseStartedAt = null;
    this.demoMode = false;
    this.participants = new Map(); // id -> participant
    this.nextId = 1;
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

    if (changed && status === "error" && this.phase === PHASE.RUNNING) {
      this.flagCheckIn(participant, "Strap problem");
      this.alert("warning", participant, `${participant.name}'s strap has a problem: ${participant.strapDetail || "sensor error"}.`);
    }
    if (changed && status === "not-connected" && this.isActive(participant)) {
      this.alert("warning", participant, `${participant.name}'s strap was unplugged.`);
    }
    this.emit("change");
  }

  // ---------- reps ----------

  // Returns { ok, repCount } or { ok: false, reason }
  recordRep(id, rawRep) {
    const participant = this.participants.get(id);
    if (!participant) return { ok: false, reason: "unknown-participant" };
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "not-running" };
    const rep = cleanRep(rawRep);
    if (!rep) return { ok: false, reason: "bad-data" };

    participant.reps.push({ ...rep, at: this.now() });
    participant.lastRepAt = this.now();
    participant.stalledAlertSent = false;
    participant.badRepsInARow = rep.good ? 0 : participant.badRepsInARow + 1;

    const streak = participant.badRepsInARow;
    if (streak === this.settings.badRepsInARowForAlert) { // alert once per streak
      this.flagCheckIn(participant, `${streak} bad reps in a row`);
      const issue = mainIssue(participant.reps.slice(-streak));
      this.alert("warning", participant, `${participant.name}: ${streak} bad reps in a row (${issue}). Check in on them.`);
    }

    if (participant.reps.length === this.targetReps) {
      const goodCount = participant.reps.filter((r) => r.good).length;
      this.alert("info", participant, `${participant.name} finished all ${this.targetReps} reps (${goodCount} good).`);
    }

    this.emit("change");
    return { ok: true, repCount: participant.reps.length };
  }

  // Running, and this person still has reps to do
  isActive(participant) {
    return this.phase === PHASE.RUNNING && participant.reps.length < this.targetReps;
  }

  flagCheckIn(participant, reason) {
    participant.needsCheckIn = true;
    participant.checkInReason = reason;
  }

  // Instructor clicked "Checked"
  acknowledgeCheckIn(id) {
    const participant = this.participants.get(id);
    if (!participant) return;
    participant.needsCheckIn = false;
    participant.checkInReason = "";
    this.emit("change");
  }

  // Called every few seconds: alert once about anyone with no reps for a while
  checkForStalledParticipants() {
    const limitMs = this.settings.stalledSeconds * 1000;
    for (const participant of this.participants.values()) {
      if (!this.isActive(participant) || !participant.online || participant.stalledAlertSent) continue;
      const lastActivity = participant.lastRepAt ?? this.exerciseStartedAt;
      if (this.now() - lastActivity < limitMs) continue;

      participant.stalledAlertSent = true;
      this.flagCheckIn(participant, "No reps lately");
      const done = participant.reps.length;
      const message = done === 0
        ? `${participant.name} hasn't started yet.`
        : `${participant.name} hasn't done a rep in ${this.settings.stalledSeconds} s (${done}/${this.targetReps} done).`;
      this.alert("warning", participant, message);
      this.emit("change");
    }
  }

  // ---------- exercise phases ----------

  startExercise(targetReps) {
    const target = Number(targetReps);
    const { minTargetReps, maxTargetReps } = this.settings;
    if (!Number.isInteger(target) || target < minTargetReps || target > maxTargetReps) {
      return { ok: false, reason: `Target reps must be a whole number from ${minTargetReps} to ${maxTargetReps}.` };
    }
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "An exercise is already running." };

    this.targetReps = target;
    this.phase = PHASE.RUNNING;
    this.exerciseStartedAt = this.now();
    this.clearReps();
    return { ok: true };
  }

  endExercise() {
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "No exercise is running." };
    this.phase = PHASE.FINISHED;
    for (const participant of this.participants.values()) {
      participant.result = judgeParticipant(participant.reps, this.targetReps);
    }
    this.emit("exercise");
    this.emit("change");
    return { ok: true };
  }

  // Back to the lobby for another round (participants stay)
  resetToLobby() {
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "End the exercise first." };
    this.phase = PHASE.LOBBY;
    this.exerciseStartedAt = null;
    this.clearReps();
    return { ok: true };
  }

  clearReps() {
    for (const participant of this.participants.values()) Object.assign(participant, newExerciseFields());
    this.emit("exercise");
    this.emit("change");
  }

  // ---------- output ----------

  alert(level, participant, message) {
    this.emit("alert", { level, participantId: participant.id, message, at: this.now() });
  }

  // The only thing participants are told
  exerciseInfo() {
    return { phase: this.phase, targetReps: this.targetReps };
  }

  // Everything the instructor dashboard shows
  snapshot() {
    return {
      serverTime: this.now(),
      phase: this.phase,
      targetReps: this.targetReps,
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

// Per-exercise data, reset whenever a new exercise starts
function newExerciseFields() {
  return {
    reps: [],
    lastRepAt: null,
    badRepsInARow: 0,
    stalledAlertSent: false,
    needsCheckIn: false,
    checkInReason: "",
    result: null,
  };
}
