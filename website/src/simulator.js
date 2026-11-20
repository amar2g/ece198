// simulator.js - pretend participants for the symposium demo.
//
// Demo mode fills the class with about 30 pretend people so visitors can see
// what the instructor sees with a full room. Real straps still work alongside them.
//
// Each pretend person gets a "personality" so the class looks realistic:
// some do great reps, some get tired, some struggle, some stop halfway
// (which triggers the "hasn't done a rep" alert). Their reps go through exactly
// the same ClassSession.recordRep() as real straps, so alerts and results work
// the same way.

import { PHASE } from "./class-session.js";

const PRETEND_NAMES = [
  "Margaret L.", "Robert C.", "Dorothy S.", "James W.", "Linda P.", "George H.",
  "Patricia M.", "Frank D.", "Barbara K.", "Walter B.", "Shirley T.", "Harold N.",
  "Joan R.", "Raymond F.", "Carol A.", "Kenneth G.", "Judith V.", "Donald E.",
  "Beverly O.", "Arthur J.", "Gloria Y.", "Eugene Q.", "Helen Z.", "Ronald I.",
  "Marilyn U.", "Albert X.", "Ruth W.", "Gerald S.", "Evelyn C.", "Howard M.",
];

// How each kind of pretend person behaves.
//   goodChance        chance that a rep is good (0 to 1)
//   tiresBy           goodChance drops by this much after every rep
//   stopsAfterReps    stops for good after this many reps (null = never stops)
const PERSONALITIES = [
  { kind: "steady",     goodChance: 0.92, tiresBy: 0,    stopsAfterReps: null },
  { kind: "steady",     goodChance: 0.85, tiresBy: 0,    stopsAfterReps: null },
  { kind: "tiring",     goodChance: 0.95, tiresBy: 0.12, stopsAfterReps: null },
  { kind: "mixed",      goodChance: 0.6,  tiresBy: 0,    stopsAfterReps: null },
  { kind: "struggling", goodChance: 0.25, tiresBy: 0,    stopsAfterReps: null },
  { kind: "stops",      goodChance: 0.7,  tiresBy: 0,    stopsAfterReps: 3 },
];

const SECONDS_PER_REP = { min: 3.5, max: 6.5 };      // time between reps
const SECONDS_TO_GET_READY = { min: 2, max: 12 };    // time before their first rep
const TICK_MS = 500;                                 // how often the simulator runs

// Fault weights: dropping the weight is the most common mistake, etc.
const FAULT_WEIGHTS = { LOWER_FAST: 0.4, SHORT_RANGE: 0.3, SWING: 0.2, LIFT_FAST: 0.1 };

export class Simulator {
  /**
   * @param {ClassSession} session
   * @param {object} options  count = how many pretend people, random = for tests
   */
  constructor(session, { count = 28, random = Math.random } = {}) {
    this.session = session;
    this.count = Math.min(count, PRETEND_NAMES.length);
    this.random = random;
    this.pretendPeople = []; // { participantId, personality, nextRepAt, ... }
    this.timer = null;
    this.exerciseSeen = null; // which exercise (by start time) the plans were made for
  }

  get isRunning() {
    return this.timer !== null;
  }

  /** Adds the pretend people and starts the clock. */
  start() {
    if (this.isRunning) return;
    for (let i = 0; i < this.count; i++) {
      const result = this.session.addParticipant(PRETEND_NAMES[i], { simulated: true });
      if (!result.ok) continue; // e.g. a real person already has this name
      this.pretendPeople.push({
        participantId: result.participant.id,
        personality: PERSONALITIES[i % PERSONALITIES.length],
      });
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.session.demoMode = true;
    this.session.changed();
  }

  /** Removes the pretend people. Real participants are not touched. */
  stop() {
    if (!this.isRunning) return;
    clearInterval(this.timer);
    this.timer = null;
    for (const person of this.pretendPeople) this.session.removeParticipant(person.participantId);
    this.pretendPeople = [];
    this.exerciseSeen = null;
    this.session.demoMode = false;
    this.session.changed();
  }

  /** Runs twice a second: each pretend person does a rep when it's their time. */
  tick() {
    const { session } = this;
    if (session.phase !== PHASE.RUNNING) return;

    // New exercise started: give everyone a fresh plan.
    if (this.exerciseSeen !== session.exerciseStartedAt) {
      this.exerciseSeen = session.exerciseStartedAt;
      for (const person of this.pretendPeople) this.planExercise(person);
    }

    const now = session.now();
    for (const person of this.pretendPeople) {
      const participant = session.participants.get(person.participantId);
      if (!participant || now < person.nextRepAt) continue;

      const repsDone = participant.reps.length;
      const reachedTarget = repsDone >= session.targetReps;
      const gaveUp = person.personality.stopsAfterReps !== null &&
                     repsDone >= person.stopsAfterReps;
      if (reachedTarget || gaveUp) continue;

      if (repsDone === 0) session.setStrapStatus(participant.id, "in-set");
      session.recordRep(participant.id, this.makeRep(person.goodChance));
      person.goodChance = Math.max(0.05, person.goodChance - person.personality.tiresBy);
      person.nextRepAt = now + this.randomBetween(SECONDS_PER_REP) * 1000;
      if (participant.reps.length >= session.targetReps) {
        session.setStrapStatus(participant.id, "set-done");
      }
    }
  }

  planExercise(person) {
    const now = this.session.now();
    person.goodChance = person.personality.goodChance;
    person.nextRepAt = now + this.randomBetween(SECONDS_TO_GET_READY) * 1000;
    // "stops" people quit at a slightly different rep each time, so it's not predictable.
    const stopAt = person.personality.stopsAfterReps;
    person.stopsAfterReps = stopAt === null ? null : stopAt + Math.floor(this.random() * 3);
    this.session.setStrapStatus(person.participantId, "zeroing");
  }

  /** Makes a believable rep with numbers that match its faults. */
  makeRep(goodChance) {
    // Start from a good, controlled rep...
    const rep = {
      good: true,
      peakDeg: this.randomBetween({ min: 115, max: 142 }),
      liftSec: this.randomBetween({ min: 0.5, max: 0.95 }),
      lowerSec: this.randomBetween({ min: 0.9, max: 1.5 }),
      swingG: this.randomBetween({ min: 0.05, max: 0.3 }),
      faults: [],
    };
    if (this.random() < goodChance) return round(rep);

    // ...then break it in one or two ways.
    rep.good = false;
    const faultCount = this.random() < 0.25 ? 2 : 1;
    while (rep.faults.length < faultCount) {
      const fault = this.pickWeighted(FAULT_WEIGHTS);
      if (!rep.faults.includes(fault)) rep.faults.push(fault);
    }
    if (rep.faults.includes("SHORT_RANGE")) rep.peakDeg = this.randomBetween({ min: 55, max: 95 });
    if (rep.faults.includes("LOWER_FAST")) rep.lowerSec = this.randomBetween({ min: 0.2, max: 0.45 });
    if (rep.faults.includes("SWING")) rep.swingG = this.randomBetween({ min: 0.55, max: 0.95 });
    if (rep.faults.includes("LIFT_FAST")) rep.liftSec = this.randomBetween({ min: 0.1, max: 0.22 });
    // Keep the same order the strap uses, so it looks like real data.
    const order = ["SHORT_RANGE", "LIFT_FAST", "LOWER_FAST", "SWING"];
    rep.faults.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return round(rep);
  }

  randomBetween({ min, max }) {
    return min + this.random() * (max - min);
  }

  pickWeighted(weights) {
    let roll = this.random();
    for (const [name, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return name;
    }
    return Object.keys(weights)[0];
  }
}

// Rounds to the same decimal places the strap prints.
function round(rep) {
  return {
    ...rep,
    peakDeg: Math.round(rep.peakDeg * 10) / 10,
    liftSec: Math.round(rep.liftSec * 100) / 100,
    lowerSec: Math.round(rep.lowerSec * 100) / 100,
    swingG: Math.round(rep.swingG * 100) / 100,
  };
}
