// strap-protocol.js - turns one line of text from the curl strap into an event.
//
// The Arduino sketch (curl_strap/curl_strap.ino) prints normal sentences for
// people, plus one "DATA,..." line per event for this website. This file is
// the ONLY place that knows the format of those lines, so if the Arduino
// format changes, this is the only file to update.
//
// This file is used in two places:
//   - the participant's browser (join page), to read the strap over USB
//   - the server, to share the fault names and their friendly labels
// That's why it's in public/ and has no browser- or Node-only code.

// Fault codes the strap can report, and how we describe them to people.
// Order = importance (same order the strap uses for its own feedback).
export const FAULT_LABELS = {
  SHORT_RANGE: "Curl higher",
  LOWER_FAST: "Lower slower",
  SWING: "Don't swing",
  LIFT_FAST: "Lift slower",
};

/**
 * Reads one line from the strap.
 *
 * @param {string} line  one line of serial text, e.g. "DATA,REP,3,GOOD,134.0,0.73,1.15,0.10,NONE"
 * @returns {object|null} an event such as { type: "rep", rep: {...} },
 *          or null if the line isn't a DATA line (normal messages are ignored)
 *          or is damaged (e.g. half a line after unplugging the cable).
 */
export function parseStrapLine(line) {
  if (typeof line !== "string") return null;

  const fields = line.trim().split(",");
  if (fields[0] !== "DATA" || fields.length < 2) return null;

  const eventName = fields[1];
  const values = fields.slice(2); // everything after "DATA,<event>"

  switch (eventName) {
    case "READY":
      return { type: "ready" };

    case "STATUS": {
      // DATA,STATUS,<IDLE|ZEROING|SET>,<repsPerSet>
      const mode = values[0];
      const repsPerSet = toWholeNumber(values[1]);
      if (!["IDLE", "ZEROING", "SET"].includes(mode) || repsPerSet === null) return null;
      return { type: "status", mode, repsPerSet };
    }

    case "ZEROING":
      return { type: "zeroing" };

    case "SET_START": {
      // DATA,SET_START,<repsPerSet>
      const repsPerSet = toWholeNumber(values[0]);
      if (repsPerSet === null) return null;
      return { type: "set-start", repsPerSet };
    }

    case "REF": {
      // DATA,REF,<peak>,<up>,<down>,<swing>
      const numbers = parseRepNumbers(values.slice(0, 4));
      if (!numbers) return null;
      return { type: "reference", reference: numbers };
    }

    case "REP": {
      // DATA,REP,<n>,<GOOD|BAD>,<peak>,<up>,<down>,<swing>,<faults>
      if (values.length !== 7) return null;
      const number = toWholeNumber(values[0]);
      const verdict = values[1];
      const numbers = parseRepNumbers(values.slice(2, 6));
      const faults = parseFaults(values[6]);
      if (number === null || number < 1) return null;
      if (verdict !== "GOOD" && verdict !== "BAD") return null;
      if (!numbers || !faults) return null;
      return {
        type: "rep",
        rep: { number, good: verdict === "GOOD", ...numbers, faults },
      };
    }

    case "SET_END": {
      // DATA,SET_END,<reps>,<good>
      const reps = toWholeNumber(values[0]);
      const good = toWholeNumber(values[1]);
      if (reps === null || good === null) return null;
      return { type: "set-end", reps, good };
    }

    case "SET_CANCELLED":
      return { type: "set-cancelled" };

    case "REPS_PER_SET": {
      const repsPerSet = toWholeNumber(values[0]);
      if (repsPerSet === null) return null;
      return { type: "reps-per-set", repsPerSet };
    }

    case "ERROR":
      // DATA,ERROR,<SENSOR_NOT_FOUND|SENSOR_LOST|BAD_REPS_PER_SET>
      if (!values[0]) return null;
      return { type: "error", code: values[0] };

    case "SENSOR_OK":
      return { type: "sensor-ok" };

    default:
      return null; // an event this website doesn't know about yet
  }
}

/** Builds the text to send to the strap to set how many reps make a set. */
export function repsPerSetCommand(targetReps) {
  return `n${targetReps}\n`;
}

// ---------- small helpers ----------

// "8" -> 8.  Anything that isn't a plain whole number -> null.
function toWholeNumber(text) {
  if (!/^\d+$/.test(text ?? "")) return null;
  return Number(text);
}

// ["134.0","0.73","1.15","0.10"] -> { peakDeg, liftSec, lowerSec, swingG }
function parseRepNumbers(texts) {
  if (texts.length !== 4) return null;
  const numbers = texts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [peakDeg, liftSec, lowerSec, swingG] = numbers;
  return { peakDeg, liftSec, lowerSec, swingG };
}

// "NONE" -> []    "SHORT_RANGE|SWING" -> ["SHORT_RANGE", "SWING"]
// Unknown fault names mean the line is damaged -> null.
function parseFaults(text) {
  if (text === "NONE") return [];
  const faults = (text ?? "").split("|");
  if (faults.some((f) => !(f in FAULT_LABELS))) return null;
  return faults;
}
