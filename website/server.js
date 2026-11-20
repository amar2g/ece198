// server.js - the website's server. Run it on the instructor's laptop:  npm start
//
// It does three jobs:
//   1. Serves the web pages in public/ (home, participant join page, instructor dashboard).
//   2. Keeps a live two-way connection (a "WebSocket") with every open page, at /live.
//      Participant pages send reps in; the instructor dashboard gets updates out.
//   3. Keeps the class data in a ClassSession (src/class-session.js).
//
// Privacy: participant pages only ever receive their own join info and the
// exercise phase/target. Class data is only sent to sockets that logged in
// with the instructor PIN.
//
// Message format (JSON) - every message has a "type":
//   participant -> server: join, strap-status, rep, leave
//   instructor  -> server: login, start-exercise, end-exercise, reset,
//                          demo, acknowledge, remove-participant
//   server -> participant: joined, join-error, exercise, rep-received, rep-rejected
//   server -> instructor:  login-ok, login-failed, state, alert, action-error

import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { SETTINGS } from "./src/config.js";
import { ClassSession } from "./src/class-session.js";
import { Simulator } from "./src/simulator.js";

const PUBLIC_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const HEARTBEAT_MS = 10_000;      // check every 10 s that each page is still there
const STALL_CHECK_MS = 5_000;     // how often to look for participants who stopped
const STATE_SEND_DELAY_MS = 150;  // group quick changes into one dashboard update
const MAX_MESSAGE_BYTES = 16 * 1024;

const session = new ClassSession(SETTINGS);
const simulator = new Simulator(session, { count: SETTINGS.simulatedParticipants });

// ---------------------------------------------------------------- web pages

const app = express();
// "extensions" lets /join open public/join.html
app.use(express.static(PUBLIC_FOLDER, { extensions: ["html"] }));
const server = http.createServer(app);

// ---------------------------------------------------------------- live connections

const wss = new WebSocketServer({ server, path: "/live", maxPayload: MAX_MESSAGE_BYTES });

// Which socket currently belongs to each participant (participant id -> socket).
// Used so an old, dying connection can't mark a reconnected person as offline.
const participantSockets = new Map();

// Wrong-PIN tracking per laptop address: ip -> { failures, lockedUntil }
const pinAttempts = new Map();

wss.on("connection", (socket, request) => {
  socket.role = null;           // becomes "participant" or "instructor"
  socket.participantId = null;
  socket.ip = request.socket.remoteAddress;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return; // not JSON: ignore it
    }
    if (!message || typeof message.type !== "string") return;
    try {
      handleMessage(socket, message);
    } catch (error) {
      // One bad message must never crash the server for the whole class.
      console.error("Error handling message", message.type, error);
    }
  });

  socket.on("close", () => {
    const id = socket.participantId;
    if (id && participantSockets.get(id) === socket) {
      participantSockets.delete(id);
      session.setOnline(id, false);
    }
  });
});

function handleMessage(socket, message) {
  // Messages anyone can send.
  if (message.type === "join") return handleJoin(socket, message);
  if (message.type === "login") return handleLogin(socket, message);

  if (socket.role === "participant") return handleParticipantMessage(socket, message);
  if (socket.role === "instructor") return handleInstructorMessage(socket, message);
  // Not joined or logged in yet: ignore everything else.
}

// ---------------------------------------------------------------- participants

function handleJoin(socket, { name, previousId }) {
  if (socket.role === "instructor") return;
  const result = session.addParticipant(name, {
    previousId: typeof previousId === "string" ? previousId : null,
  });
  if (!result.ok) return send(socket, { type: "join-error", reason: result.reason });

  const { participant } = result;
  // If this person had another connection open (e.g. an old tab), close it.
  const oldSocket = participantSockets.get(participant.id);
  if (oldSocket && oldSocket !== socket) {
    oldSocket.participantId = null;
    oldSocket.close(4000, "Joined from another page");
  }
  socket.role = "participant";
  socket.participantId = participant.id;
  participantSockets.set(participant.id, socket);

  send(socket, {
    type: "joined",
    id: participant.id,
    name: participant.name,
    reconnected: Boolean(result.reconnected),
    repCount: participant.reps.length,
    exercise: session.exerciseInfo(),
  });
}

function handleParticipantMessage(socket, message) {
  const id = socket.participantId;
  if (!id || !session.participants.has(id)) return;

  switch (message.type) {
    case "strap-status":
      session.setStrapStatus(id, message.status, message.detail);
      break;

    case "rep": {
      const result = session.recordRep(id, message.rep);
      if (result.ok) send(socket, { type: "rep-received", repCount: result.repCount });
      else send(socket, { type: "rep-rejected", reason: result.reason });
      break;
    }

    case "leave":
      participantSockets.delete(id);
      socket.participantId = null;
      socket.role = null;
      session.removeParticipant(id);
      break;
  }
}

// ---------------------------------------------------------------- instructor

function handleLogin(socket, { pin }) {
  const now = Date.now();
  const attempts = pinAttempts.get(socket.ip) ?? { failures: 0, lockedUntil: 0 };

  if (attempts.lockedUntil > now) {
    const retryInSeconds = Math.ceil((attempts.lockedUntil - now) / 1000);
    return send(socket, { type: "login-failed", reason: `Too many tries. Wait ${retryInSeconds} s.` });
  }

  if (String(pin ?? "") !== SETTINGS.instructorPin) {
    attempts.failures += 1;
    if (attempts.failures >= SETTINGS.pinAttemptsBeforeLockout) {
      attempts.failures = 0;
      attempts.lockedUntil = now + SETTINGS.pinLockoutSeconds * 1000;
    }
    pinAttempts.set(socket.ip, attempts);
    return send(socket, { type: "login-failed", reason: "Wrong PIN." });
  }

  pinAttempts.delete(socket.ip);
  socket.role = "instructor";
  send(socket, {
    type: "login-ok",
    settings: {
      minTargetReps: SETTINGS.minTargetReps,
      maxTargetReps: SETTINGS.maxTargetReps,
      joinAddresses: joinAddresses(),
    },
  });
  send(socket, { type: "state", state: session.snapshot() });
}

function handleInstructorMessage(socket, message) {
  let result = { ok: true };

  switch (message.type) {
    case "start-exercise":
      result = session.startExercise(message.targetReps);
      break;
    case "end-exercise":
      result = session.endExercise();
      break;
    case "reset":
      result = session.resetToLobby();
      break;
    case "demo":
      if (message.on) simulator.start();
      else simulator.stop();
      break;
    case "acknowledge":
      session.acknowledgeCheckIn(String(message.participantId));
      break;
    case "remove-participant": {
      const id = String(message.participantId);
      const participantSocket = participantSockets.get(id);
      if (participantSocket) {
        participantSockets.delete(id);
        participantSocket.participantId = null;
        participantSocket.close(4001, "Removed by instructor");
      }
      session.removeParticipant(id);
      break;
    }
  }

  if (!result.ok) send(socket, { type: "action-error", reason: result.reason });
}

// ---------------------------------------------------------------- sending updates

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function sendToRole(role, message) {
  for (const socket of wss.clients) {
    if (socket.role === role) send(socket, message);
  }
}

// With 30 pretend people, many changes happen at once. Wait a moment and
// send the dashboard one combined update instead of dozens.
let stateSendTimer = null;
session.on("change", () => {
  if (stateSendTimer) return;
  stateSendTimer = setTimeout(() => {
    stateSendTimer = null;
    sendToRole("instructor", { type: "state", state: session.snapshot() });
  }, STATE_SEND_DELAY_MS);
});

session.on("alert", (alert) => sendToRole("instructor", { type: "alert", alert }));

session.on("exercise", () => sendToRole("participant", { type: "exercise", exercise: session.exerciseInfo() }));

// ---------------------------------------------------------------- timers

// Heartbeat: a laptop that closed its lid or lost WiFi never says goodbye.
// Ping every page; any that didn't answer the last ping is disconnected.
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate(); // triggers "close" above, which marks them offline
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);

setInterval(() => session.checkForStalledParticipants(), STALL_CHECK_MS);

// ---------------------------------------------------------------- start

// The addresses other laptops on the same WiFi/hotspot can use to reach this one.
function joinAddresses() {
  const addresses = [];
  for (const network of Object.values(os.networkInterfaces())) {
    for (const info of network ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        addresses.push(`http://${info.address}:${SETTINGS.port}/join`);
      }
    }
  }
  return addresses;
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\nPort ${SETTINGS.port} is already in use - is the server already running in another window?`);
    console.error(`Close it, or start on another port:  $env:PORT = "3001"; npm start\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(SETTINGS.port, () => {
  console.log("\n=== CCCARE Rep Monitor is running ===\n");
  console.log(`Instructor dashboard (this laptop): http://localhost:${SETTINGS.port}/instructor`);
  console.log(`Participant page (this laptop):     http://localhost:${SETTINGS.port}/join`);
  const others = joinAddresses();
  if (others.length > 0) {
    console.log("\nParticipant page for OTHER laptops on the same WiFi/hotspot:");
    for (const address of others) console.log(`  ${address}`);
  }
  if (SETTINGS.instructorPin === "1234") {
    console.log('\nInstructor PIN is the default "1234". Change it in src/config.js for real use.');
  }
  console.log("\nPress Ctrl+C to stop.\n");
});
