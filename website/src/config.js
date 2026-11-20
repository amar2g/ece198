// All the settings in one place.
// PORT and INSTRUCTOR_PIN can also be set when starting, e.g. $env:INSTRUCTOR_PIN = "4321"; npm start

export const SETTINGS = {
  port: Number(process.env.PORT) || 3000,
  instructorPin: process.env.INSTRUCTOR_PIN || "1234",

  defaultTargetReps: 8,
  minTargetReps: 1,
  maxTargetReps: 50, // same limit as MAX_REPS_PER_SET in curl_strap.ino

  maxParticipants: 60,
  maxNameLength: 30,

  badRepsInARowForAlert: 3,
  stalledSeconds: 60, // alert if no rep for this long

  simulatedParticipants: 28, // demo mode
};
