// Reads the "DATA,..." lines the strap prints (see curl_strap.ino).
// Shared by the browser and the server, so no browser- or Node-only code here.

// Fault codes from the strap -> what we show people. Ordered by importance.
export const FAULT_LABELS = {
  SHORT_RANGE: "Curl higher",
  LOWER_FAST: "Lower slower",
  SWING: "Don't swing",
  LIFT_FAST: "Lift slower",
};

// Turns one line into an event object, or null if it isn't a valid DATA line.
export function parseStrapLine(line) {
  if (typeof line !== "string") return null;
  const fields = line.trim().split(",");
  if (fields[0] !== "DATA") return null;
  const [, eventName, ...values] = fields;

  switch (eventName) {
    case "READY":
      return { type: "ready" };

    case "ZEROING":
      return { type: "zeroing" };

    case "SET_START": {
      const repsPerSet = toWholeNumber(values[0]);
      return repsPerSet === null ? null : { type: "set-start", repsPerSet };
    }

    case "REF": {
      const numbers = parseRepNumbers(values);
      return numbers ? { type: "reference", reference: numbers } : null;
    }

    case "REP": {
      // REP,<n>,<GOOD|BAD>,<peak>,<up>,<down>,<swing>,<faults>
      if (values.length !== 7) return null;
      const number = toWholeNumber(values[0]);
      const verdict = values[1];
      const numbers = parseRepNumbers(values.slice(2, 6));
      const faults = parseFaults(values[6]);
      if (!number || (verdict !== "GOOD" && verdict !== "BAD") || !numbers || !faults) return null;
      return { type: "rep", rep: { number, good: verdict === "GOOD", ...numbers, faults } };
    }

    case "SET_END": {
      const reps = toWholeNumber(values[0]);
      const good = toWholeNumber(values[1]);
      return reps === null || good === null ? null : { type: "set-end", reps, good };
    }

    case "SET_CANCELLED":
      return { type: "set-cancelled" };

    case "ERROR":
      return values[0] ? { type: "error", code: values[0] } : null;

    default:
      return null;
  }
}

// Text that tells the strap how many reps make a set, e.g. "n10\n".
export function repsPerSetCommand(targetReps) {
  return `n${targetReps}\n`;
}

// "8" -> 8, anything else -> null
function toWholeNumber(text) {
  return /^\d+$/.test(text ?? "") ? Number(text) : null;
}

// ["134.0","0.73","1.15","0.10"] -> { peakDeg, liftSec, lowerSec, swingG }
function parseRepNumbers(texts) {
  if (texts.length !== 4) return null;
  const numbers = texts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [peakDeg, liftSec, lowerSec, swingG] = numbers;
  return { peakDeg, liftSec, lowerSec, swingG };
}

// "NONE" -> [], "SHORT_RANGE|SWING" -> ["SHORT_RANGE", "SWING"], unknown name -> null
function parseFaults(text) {
  if (text === "NONE") return [];
  const faults = (text ?? "").split("|");
  return faults.every((f) => f in FAULT_LABELS) ? faults : null;
}
