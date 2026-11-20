// config.js - every setting you might want to change, in one place.
//
// You can also override the first two when starting the server, e.g. in PowerShell:
//   $env:INSTRUCTOR_PIN = "4321"; npm start

export const SETTINGS = {
  // Web address port: the site is at http://<this laptop>:<port>
  port: Number(process.env.PORT) || 3000,

  // PIN the instructor types to open the dashboard. Change it before a real session!
  instructorPin: process.env.INSTRUCTOR_PIN || "1234",

  // Wrong-PIN protection: after this many wrong tries, wait this long.
  pinAttemptsBeforeLockout: 5,
  pinLockoutSeconds: 30,

  // Target reps the dashboard starts with, and the allowed range.
  // (The Arduino accepts 1-50 too, see MAX_REPS_PER_SET in curl_strap.ino.)
  defaultTargetReps: 8,
  minTargetReps: 1,
  maxTargetReps: 50,

  // Participant limits.
  maxParticipants: 60,
  maxNameLength: 30,

  // Pop-up alert rules for the instructor.
  badRepsInARowForAlert: 3, // "3 bad reps in a row - check in on them"
  stalledSeconds: 60,       // "hasn't done a rep in 60 s"

  // Demo mode: how many pretend participants to add.
  simulatedParticipants: 28,
};
