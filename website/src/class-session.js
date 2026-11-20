// class-session.js - everything the server remembers about the class.
//
// One ClassSession = one instructor's class. It holds:
//   - the participants (real people with straps, and pretend ones in demo mode)
//   - every rep each participant has done in the current exercise
//   - the exercise phase: lobby -> running -> finished
//   - the alerts shown to the instructor ("check in on Sam")
//
// It does NOT know about the network. server.js passes messages in, and
// listens for these events to send updates out:
//   "change"   something changed: send the instructor a fresh snapshot
//   "alert"    a new alert: show it as a pop-up
//   "exercise" the phase or target changed: tell the participants' pages

import { EventEmitter } from "node:events";
import { FAULT_LABELS } from "../public/js/strap-protocol.js";
import { SETTINGS } from "./config.js";

export const PHASE = {
  LOBBY: "lobby",       // people are joining, no exercise yet
  RUNNING: "running",   // exercise in progress, reps are being counted
  FINISHED: "finished", // instructor ended it, results are shown
};

// Final result for each participant after the exercise ends.
export const RESULT = {
  GOOD: "good",             // green: more than half of their reps were good
  BAD: "bad",               // red: half or more of their reps were bad
  INCOMPLETE: "incomplete", // yellow: didn't reach the target number of reps
};

// What the participant's strap is doing (sent by their page).
export const STRAP_STATUSES = [
  "not-connected", // no strap plugged in / not connected yet
  "connected",     // strap connected and ready
  "zeroing",       // waiting for the arm to hang still before a set
  "in-set",        // set running, reps being counted
  "set-done",      // set finished
  "error",         // sensor problem (loose wire etc.)
];

const MAX_ALERTS_KEPT = 100;

/**
 * Decides the colour for one participant once the exercise is over.
 * Didn't reach the target -> yellow, no matter how good the reps were.
 * Otherwise green if MORE than half were good, red if half or more were bad.
 */
export function judgeParticipant(reps, targetReps) {
  const goodCount = reps.filter((rep) => rep.good).length;
  if (reps.length < targetReps) return RESULT.INCOMPLETE;
  return goodCount > reps.length / 2 ? RESULT.GOOD : RESULT.BAD;
}

/**
 * Tidies a name typed by a participant. Returns null if nothing usable is left.
 * Removes invisible control characters, squashes repeated spaces, limits length.
 */
export function cleanName(rawName, maxLength = SETTINGS.maxNameLength) {
  if (typeof rawName !== "string") return null;
  const name = rawName
    .replace(/[\u0000-\u001f\u007f]/g, "") // control characters
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return name.length > 0 ? name : null;
}

/**
 * Checks a rep sent by a participant's page. The server never trusts data from
 * the network blindly. Returns a clean copy, or null if anything is wrong.
 */
export function cleanRep(rep) {
  if (!rep || typeof rep !== "object") return null;
  const numbers = [rep.peakDeg, rep.liftSec, rep.lowerSec, rep.swingG];
  if (typeof rep.good !== "boolean") return null;
  if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000)) {
    return null;
  }
  if (!Array.isArray(rep.faults) || rep.faults.some((f) => !(f in FAULT_LABELS))) return null;
  // A good rep has no faults and a bad rep has at least one.
  if (rep.good !== (rep.faults.length === 0)) return null;
  return {
    good: rep.good,
    peakDeg: rep.peakDeg,
    liftSec: rep.liftSec,
    lowerSec: rep.lowerSec,
    swingG: rep.swingG,
    faults: [...rep.faults],
  };
}

/** Counts how often each fault happened, e.g. { LOWER_FAST: 2, SWING: 1 }. */
export function countFaults(reps) {
  const counts = {};
  for (const rep of reps) {
    for (const fault of rep.faults) counts[fault] = (counts[fault] ?? 0) + 1;
  }
  return counts;
}

/** The most common fault as friendly text, e.g. "Lower slower (x2)", or "" if none. */
export function mainIssue(reps) {
  const counts = countFaults(reps);
  let worstFault = null;
  for (const fault of Object.keys(FAULT_LABELS)) { // in order of importance
    if ((counts[fault] ?? 0) > (counts[worstFault] ?? 0)) worstFault = fault;
  }
  return worstFault ? `${FAULT_LABELS[worstFault]} (x${counts[worstFault]})` : "";
}

export class ClassSession extends EventEmitter {
  /**
   * @param {object} settings  usually SETTINGS from config.js (tests pass their own)
   * @param {function} now     returns the time in ms; tests replace it with a fake clock
   */
  constructor(settings = SETTINGS, now = () => Date.now()) {
    super();
    this.settings = settings;
    this.now = now;

    this.phase = PHASE.LOBBY;
    this.targetReps = settings.defaultTargetReps;
    this.exerciseStartedAt = null;
    this.exerciseEndedAt = null;
    this.demoMode = false;

    this.participants = new Map(); // id -> participant object
    this.alerts = [];              // newest first
    this.nextParticipantId = 1;
    this.nextAlertId = 1;
  }

  // ---------------------------------------------------------------- joining

  /**
   * Adds a participant, or reconnects one who dropped off (e.g. WiFi blip).
   * @returns {{ok: true, participant} | {ok: false, reason: string}}
   */
  addParticipant(rawName, { simulated = false, previousId = null } = {}) {
    const name = cleanName(rawName, this.settings.maxNameLength);
    if (!name) return { ok: false, reason: "Please type your name." };

    const sameName = this.findByName(name);
    if (sameName) {
      // Same person coming back after losing connection: give them their reps back.
      const isReturning = !sameName.online && !sameName.simulated;
      const isSameBrowser = previousId !== null && previousId === sameName.id;
      if (isReturning || (isSameBrowser && !sameName.simulated)) {
        sameName.online = true;
        this.changed();
        return { ok: true, participant: sameName, reconnected: true };
      }
      return {
        ok: false,
        reason: `Someone called "${name}" has already joined. Add your last initial, e.g. "${name} K."`,
      };
    }

    if (this.participants.size >= this.settings.maxParticipants) {
      return { ok: false, reason: "The class is full. Please ask the instructor." };
    }

    const participant = {
      id: String(this.nextParticipantId++),
      name,
      simulated,
      online: true,
      joinedAt: this.now(),
      strapStatus: simulated ? "connected" : "not-connected",
      strapDetail: "",
      ...this.freshExerciseFields(),
    };
    this.participants.set(participant.id, participant);
    this.changed();
    return { ok: true, participant };
  }

  // Everything about the current exercise; cleared when a new one starts.
  freshExerciseFields() {
    return {
      reps: [],
      lastRepAt: null,
      badRepsInARow: 0,
      finishedAt: null,
      result: null,
      needsCheckIn: false,
      checkInReason: "",
      stalledAlertSent: false,
    };
  }

  findByName(name) {
    const wanted = name.toLowerCase();
    for (const participant of this.participants.values()) {
      if (participant.name.toLowerCase() === wanted) return participant;
    }
    return null;
  }

  removeParticipant(id) {
    if (this.participants.delete(id)) this.changed();
  }

  /** Called when a participant's laptop connects or disconnects. */
  setOnline(id, online) {
    const participant = this.participants.get(id);
    if (!participant || participant.online === online) return;
    participant.online = online;
    if (!online && this.phase === PHASE.RUNNING && !this.hasFinished(participant)) {
      this.raiseAlert("warning", participant, `${participant.name}'s laptop lost connection to the dashboard.`);
    }
    this.changed();
  }

  /** Called when a participant's page reports a change in their strap. */
  setStrapStatus(id, status, detail = "") {
    const participant = this.participants.get(id);
    if (!participant || !STRAP_STATUSES.includes(status)) return;
    const previous = participant.strapStatus;
    participant.strapStatus = status;
    participant.strapDetail = typeof detail === "string" ? detail.slice(0, 120) : "";

    if (this.phase === PHASE.RUNNING && status !== previous) {
      if (status === "error") {
        this.flagForCheckIn(participant, "Strap problem");
        this.raiseAlert("warning", participant,
          `${participant.name}'s strap has a problem: ${participant.strapDetail || "sensor error"}.`);
      } else if (status === "not-connected" && !this.hasFinished(participant)) {
        this.raiseAlert("warning", participant, `${participant.name}'s strap was unplugged.`);
      }
    }
    this.changed();
  }

  // ---------------------------------------------------------------- reps

  /**
   * Stores one rep for a participant and raises any alerts it causes.
   * @returns {{ok: true, repCount: number} | {ok: false, reason: string}}
   */
  recordRep(id, rawRep) {
    const participant = this.participants.get(id);
    if (!participant) return { ok: false, reason: "unknown-participant" };
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "not-running" };
    const rep = cleanRep(rawRep);
    if (!rep) return { ok: false, reason: "bad-data" };

    const now = this.now();
    participant.reps.push({ ...rep, index: participant.reps.length + 1, at: now });
    participant.lastRepAt = now;
    participant.stalledAlertSent = false;
    participant.badRepsInARow = rep.good ? 0 : participant.badRepsInARow + 1;

    // Alert: several bad reps in a row (only once per streak).
    if (participant.badRepsInARow === this.settings.badRepsInARowForAlert) {
      const issue = mainIssue(participant.reps.slice(-participant.badRepsInARow));
      this.flagForCheckIn(participant, `${participant.badRepsInARow} bad reps in a row`);
      this.raiseAlert("warning", participant,
        `${participant.name}: ${participant.badRepsInARow} bad reps in a row (${issue}). Check in on them.`);
    }

    // Info: reached the target.
    if (participant.reps.length === this.targetReps) {
      participant.finishedAt = now;
      const goodCount = participant.reps.filter((r) => r.good).length;
      this.raiseAlert("info", participant,
        `${participant.name} finished all ${this.targetReps} reps (${goodCount} good).`);
    }

    this.changed();
    return { ok: true, repCount: participant.reps.length };
  }

  hasFinished(participant) {
    return participant.reps.length >= this.targetReps;
  }

  flagForCheckIn(participant, reason) {
    participant.needsCheckIn = true;
    participant.checkInReason = reason;
  }

  /** The instructor clicked "Checked" on a participant's card. */
  acknowledgeCheckIn(id) {
    const participant = this.participants.get(id);
    if (!participant) return;
    participant.needsCheckIn = false;
    participant.checkInReason = "";
    this.changed();
  }

  /**
   * Called every few seconds by the server. Warns the instructor about anyone
   * who hasn't done a rep for a while (or hasn't started at all).
   */
  checkForStalledParticipants() {
    if (this.phase !== PHASE.RUNNING) return;
    const now = this.now();
    const limitMs = this.settings.stalledSeconds * 1000;

    for (const participant of this.participants.values()) {
      if (participant.stalledAlertSent || this.hasFinished(participant)) continue;
      if (!participant.online) continue; // already warned when they went offline
      const lastActivity = participant.lastRepAt ?? this.exerciseStartedAt;
      if (now - lastActivity < limitMs) continue;

      participant.stalledAlertSent = true;
      const message = participant.reps.length === 0
        ? `${participant.name} hasn't started yet (${this.settings.stalledSeconds} s).`
        : `${participant.name} hasn't done a rep in ${this.settings.stalledSeconds} s ` +
          `(${participant.reps.length}/${this.targetReps} done).`;
      this.flagForCheckIn(participant, "No reps lately");
      this.raiseAlert("warning", participant, message);
      this.changed();
    }
  }

  // ---------------------------------------------------------------- exercise phases

  /** Starts counting reps. Clears the reps from any previous exercise. */
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
    this.exerciseEndedAt = null;
    this.alerts = [];
    for (const participant of this.participants.values()) {
      Object.assign(participant, this.freshExerciseFields());
    }
    this.emit("exercise");
    this.changed();
    return { ok: true };
  }

  /** Stops counting and gives everyone their green / red / yellow result. */
  endExercise() {
    if (this.phase !== PHASE.RUNNING) return { ok: false, reason: "No exercise is running." };
    this.phase = PHASE.FINISHED;
    this.exerciseEndedAt = this.now();
    for (const participant of this.participants.values()) {
      participant.result = judgeParticipant(participant.reps, this.targetReps);
    }
    this.emit("exercise");
    this.changed();
    return { ok: true };
  }

  /** Back to the lobby for another round; participants stay, reps are cleared. */
  resetToLobby() {
    if (this.phase === PHASE.RUNNING) return { ok: false, reason: "End the exercise first." };
    this.phase = PHASE.LOBBY;
    this.exerciseStartedAt = null;
    this.exerciseEndedAt = null;
    this.alerts = [];
    for (const participant of this.participants.values()) {
      Object.assign(participant, this.freshExerciseFields());
    }
    this.emit("exercise");
    this.changed();
    return { ok: true };
  }

  // ---------------------------------------------------------------- alerts & output

  raiseAlert(level, participant, message) {
    const alert = {
      id: this.nextAlertId++,
      at: this.now(),
      level, // "warning" (red pop-up) or "info" (blue pop-up)
      participantId: participant?.id ?? null,
      message,
    };
    this.alerts.unshift(alert);
    this.alerts.length = Math.min(this.alerts.length, MAX_ALERTS_KEPT);
    this.emit("alert", alert);
  }

  changed() {
    this.emit("change");
  }

  /** What participants' pages are allowed to know: only the phase and target. */
  exerciseInfo() {
    return { phase: this.phase, targetReps: this.targetReps };
  }

  /** Everything the instructor dashboard shows. */
  snapshot() {
    const participants = [...this.participants.values()].map((p) => {
      const goodCount = p.reps.filter((rep) => rep.good).length;
      return {
        id: p.id,
        name: p.name,
        simulated: p.simulated,
        online: p.online,
        joinedAt: p.joinedAt,
        strapStatus: p.strapStatus,
        strapDetail: p.strapDetail,
        reps: p.reps,
        repCount: p.reps.length,
        goodCount,
        badCount: p.reps.length - goodCount,
        mainIssue: mainIssue(p.reps),
        lastRepAt: p.lastRepAt,
        finishedAt: p.finishedAt,
        needsCheckIn: p.needsCheckIn,
        checkInReason: p.checkInReason,
        result: p.result,
      };
    });

    return {
      serverTime: this.now(),
      phase: this.phase,
      targetReps: this.targetReps,
      exerciseStartedAt: this.exerciseStartedAt,
      exerciseEndedAt: this.exerciseEndedAt,
      demoMode: this.demoMode,
      participants,
      alerts: this.alerts.slice(0, 50),
    };
  }
}
