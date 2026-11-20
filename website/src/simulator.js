// Demo mode: pretend participants so a full class can be shown with only a few real straps.
// They record reference reps, do sets with rests, and sometimes ask for help -
// all through the same ClassSession methods as real participants.

import { PHASE } from "./class-session.js";

const NAMES = [
  "Margaret L.", "Robert C.", "Dorothy S.", "James W.", "Linda P.", "George H.",
  "Patricia M.", "Frank D.", "Barbara K.", "Walter B.", "Shirley T.", "Harold N.",
  "Joan R.", "Raymond F.", "Carol A.", "Kenneth G.", "Judith V.", "Donald E.",
  "Beverly O.", "Arthur J.", "Gloria Y.", "Eugene Q.", "Helen Z.", "Ronald I.",
  "Marilyn U.", "Albert X.", "Ruth W.", "Gerald S.", "Evelyn C.", "Howard M.",
];

// goodChance: chance a rep is good. tiresBy: goodChance drop per rep. stopsAfter: quits after ~this many reps.
const PERSONALITIES = [
  { goodChance: 0.92, tiresBy: 0, stopsAfter: null },    // steady
  { goodChance: 0.85, tiresBy: 0, stopsAfter: null },    // steady
  { goodChance: 0.95, tiresBy: 0.06, stopsAfter: null }, // gets tired
  { goodChance: 0.6, tiresBy: 0, stopsAfter: null },     // mixed
  { goodChance: 0.25, tiresBy: 0, stopsAfter: null },    // struggling
  { goodChance: 0.7, tiresBy: 0, stopsAfter: 5 },        // stops partway
];

// Demo timings are shorter than real life so visitors see things happen
const SECONDS_TO_RECORD_REFERENCE = [3, 25];
const SECONDS_BEFORE_FIRST_REP = [2, 10];
const SECONDS_BETWEEN_REPS = [3, 6];
const SECONDS_OF_REST = [6, 15];
const HELP_CHANCE_PER_REP = 0.004; // now and then someone presses "I need help"

const FAULT_CHANCES = { LOWER_FAST: 0.4, SHORT_RANGE: 0.3, SWING: 0.2, LIFT_FAST: 0.1 };
const FAULT_ORDER = ["SHORT_RANGE", "LIFT_FAST", "LOWER_FAST", "SWING"]; // order the strap prints them

export class Simulator {
  constructor(session, { count = 28, random = Math.random } = {}) {
    this.session = session;
    this.count = Math.min(count, NAMES.length);
    this.random = random;
    this.people = []; // { participantId, personality, ...current plan }
    this.timer = null;
    this.planFor = null; // start time of the exercise the current plans are for
  }

  start() {
    if (this.timer) return;
    for (let i = 0; i < this.count; i++) {
      const result = this.session.addParticipant(NAMES[i], { simulated: true });
      if (result.ok) {
        this.people.push({ participantId: result.participant.id, personality: PERSONALITIES[i % PERSONALITIES.length] });
      }
    }
    this.timer = setInterval(() => this.tick(), 500);
    this.session.demoMode = true;
    this.session.emit("change");
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    for (const person of this.people) this.session.removeParticipant(person.participantId);
    this.people = [];
    this.planFor = null;
    this.session.demoMode = false;
    this.session.emit("change");
  }

  // Twice a second: anyone whose turn it is does their next step
  tick() {
    const { session } = this;
    for (const person of this.people) {
      const participant = session.participants.get(person.participantId);
      if (!participant) continue;
      if (session.phase !== PHASE.FINISHED) this.recordReferenceWhenReady(person, participant);
      if (session.phase === PHASE.RUNNING) this.exercise(person, participant);
    }
  }

  // Each pretend person takes a different amount of time to record their reference rep
  recordReferenceWhenReady(person, participant) {
    if (participant.referenceReady) {
      person.referenceAt = null;
      return;
    }
    const now = this.session.now();
    person.referenceAt ??= now + this.between(SECONDS_TO_RECORD_REFERENCE) * 1000;
    if (now >= person.referenceAt) {
      this.session.setReference(participant.id, { peakDeg: 128, liftSec: 0.8, lowerSec: 1.3, swingG: 0.12 });
    }
  }

  exercise(person, participant) {
    const { session } = this;
    if (this.planFor !== session.exerciseStartedAt) { // a new exercise started
      this.planFor = session.exerciseStartedAt;
      this.people.forEach((p) => this.planExercise(p));
    }
    const now = session.now();
    if (now < person.nextActionAt) return;

    const done = participant.reps.length;
    const gaveUp = person.stopsAfter !== null && done >= person.stopsAfter;
    if (done >= session.totalTargetReps || gaveUp) return;

    // Between sets (or before the first): start the next set
    const repsThisSet = participant.reps.filter((r) => r.set === participant.currentSet).length;
    if (participant.currentSet === 0 || repsThisSet >= session.targetReps) {
      session.startSet(participant.id);
      session.setStrapStatus(participant.id, "in-set");
      person.nextActionAt = now + this.between(SECONDS_BETWEEN_REPS) * 1000;
      return;
    }

    session.recordRep(participant.id, this.makeRep(person.goodChance));
    person.goodChance = Math.max(0.05, person.goodChance - person.personality.tiresBy);
    if (this.random() < HELP_CHANCE_PER_REP) session.requestHelp(participant.id);

    if (repsThisSet + 1 >= session.targetReps) { // set finished: rest
      session.setStrapStatus(participant.id, "set-done");
      person.nextActionAt = now + this.between(SECONDS_OF_REST) * 1000;
    } else {
      person.nextActionAt = now + this.between(SECONDS_BETWEEN_REPS) * 1000;
    }
  }

  planExercise(person) {
    const { stopsAfter, goodChance } = person.personality;
    person.goodChance = goodChance;
    person.nextActionAt = this.session.now() + this.between(SECONDS_BEFORE_FIRST_REP) * 1000;
    person.stopsAfter = stopsAfter === null ? null : stopsAfter + Math.floor(this.random() * 3);
    this.session.setStrapStatus(person.participantId, "zeroing");
  }

  // A rep whose numbers match its faults (e.g. SWING -> high swing value)
  makeRep(goodChance) {
    const rep = {
      good: true,
      peakDeg: this.between([115, 142]),
      liftSec: this.between([0.5, 0.95]),
      lowerSec: this.between([0.9, 1.5]),
      swingG: this.between([0.05, 0.3]),
      faults: [],
    };
    if (this.random() >= goodChance) {
      rep.good = false;
      const faultCount = this.random() < 0.25 ? 2 : 1;
      while (rep.faults.length < faultCount) {
        const fault = this.pickFault();
        if (!rep.faults.includes(fault)) rep.faults.push(fault);
      }
      rep.faults.sort((a, b) => FAULT_ORDER.indexOf(a) - FAULT_ORDER.indexOf(b));
      if (rep.faults.includes("SHORT_RANGE")) rep.peakDeg = this.between([55, 95]);
      if (rep.faults.includes("LOWER_FAST")) rep.lowerSec = this.between([0.2, 0.45]);
      if (rep.faults.includes("SWING")) rep.swingG = this.between([0.55, 0.95]);
      if (rep.faults.includes("LIFT_FAST")) rep.liftSec = this.between([0.1, 0.22]);
    }
    // same decimal places as the strap
    rep.peakDeg = Math.round(rep.peakDeg * 10) / 10;
    for (const key of ["liftSec", "lowerSec", "swingG"]) rep[key] = Math.round(rep[key] * 100) / 100;
    return rep;
  }

  between([min, max]) {
    return min + this.random() * (max - min);
  }

  pickFault() {
    let roll = this.random();
    for (const [fault, chance] of Object.entries(FAULT_CHANCES)) {
      roll -= chance;
      if (roll <= 0) return fault;
    }
    return "LOWER_FAST";
  }
}
