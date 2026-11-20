// The server. Run on the instructor's laptop with:  npm start
// Serves the pages in public/ and keeps a live WebSocket link (/live) with every open page.
// Class data is only sent to pages that logged in with the instructor PIN.

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

const session = new ClassSession(SETTINGS);
const simulator = new Simulator(session, { count: SETTINGS.simulatedParticipants });

const app = express();
app.use(express.static(PUBLIC_FOLDER, { extensions: ["html"] })); // /join -> join.html
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live", maxPayload: 16 * 1024 });

// participant id -> their current socket (so an old dead socket can't mark them offline)
const participantSockets = new Map();

wss.on("connection", (socket) => {
  socket.role = null; // "participant" or "instructor" once they join / log in
  socket.participantId = null;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
      handleMessage(socket, message);
    } catch (error) {
      // a bad message must never crash the server for everyone
      console.error("Ignored bad message:", error.message);
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
  if (message.type === "join") return handleJoin(socket, message);
  if (message.type === "login") return handleLogin(socket, message);
  if (socket.role === "participant") return handleParticipantMessage(socket, message);
  if (socket.role === "instructor") return handleInstructorMessage(socket, message);
}

// ---------- participants ----------

function handleJoin(socket, { name, previousId }) {
  if (socket.role === "instructor") return;
  const result = session.addParticipant(name, { previousId: String(previousId ?? "") });
  if (!result.ok) return send(socket, { type: "join-error", reason: result.reason });

  const { participant } = result;
  const oldSocket = participantSockets.get(participant.id);
  if (oldSocket && oldSocket !== socket) { // same person open in another tab
    oldSocket.participantId = null;
    oldSocket.close(4000, "Joined from another page");
  }
  socket.role = "participant";
  socket.participantId = participant.id;
  participantSockets.set(participant.id, socket);

  // everything the page needs to pick up where it left off after a reload
  send(socket, {
    type: "joined",
    id: participant.id,
    name: participant.name,
    exercise: session.exerciseInfo(),
    progress: participantProgress(participant),
  });
}

function participantProgress(participant) {
  return {
    currentSet: participant.currentSet,
    setRepCount: participant.reps.filter((r) => r.set === participant.currentSet).length,
    referenceReady: participant.referenceReady,
    helpRequested: participant.helpRequested,
  };
}

function handleParticipantMessage(socket, message) {
  const id = socket.participantId;
  if (!session.participants.has(id)) return;

  if (message.type === "strap-status") {
    session.setStrapStatus(id, message.status, message.detail);
  } else if (message.type === "set-start") {
    session.startSet(id);
  } else if (message.type === "rep") {
    const result = session.recordRep(id, message.rep);
    send(socket, result.ok
      ? { type: "rep-received", setRepCount: result.setRepCount }
      : { type: "rep-rejected", reason: result.reason });
  } else if (message.type === "reference") {
    session.setReference(id, message.reference);
  } else if (message.type === "help") {
    session.requestHelp(id);
  } else if (message.type === "leave") {
    participantSockets.delete(id);
    socket.participantId = null;
    socket.role = null;
    session.removeParticipant(id);
  }
}

// ---------- instructor ----------

function handleLogin(socket, { pin }) {
  if (String(pin) !== SETTINGS.instructorPin) return send(socket, { type: "login-failed", reason: "Wrong PIN." });
  socket.role = "instructor";
  send(socket, {
    type: "login-ok",
    minTargetReps: SETTINGS.minTargetReps,
    maxTargetReps: SETTINGS.maxTargetReps,
    minTargetSets: SETTINGS.minTargetSets,
    maxTargetSets: SETTINGS.maxTargetSets,
    joinAddresses: joinAddresses(),
  });
  send(socket, { type: "state", state: session.snapshot() });
}

function handleInstructorMessage(socket, message) {
  let result = { ok: true };
  const id = String(message.participantId);

  switch (message.type) {
    case "plan": result = session.setPlan(message.targetReps, message.targetSets); break;
    case "start-exercise": result = session.startExercise(message.targetReps, message.targetSets); break;
    case "end-exercise": result = session.endExercise(); break;
    case "reset": result = session.resetToLobby(); break;
    case "demo": message.on ? simulator.start() : simulator.stop(); break;
    case "acknowledge":
      session.acknowledgeCheckIn(id);
      if (participantSockets.has(id)) send(participantSockets.get(id), { type: "help-answered" });
      break;
    case "remove-participant":
      participantSockets.get(id)?.close(4001, "Removed by instructor");
      participantSockets.delete(id);
      session.removeParticipant(id);
      break;
  }
  if (!result.ok) send(socket, { type: "action-error", reason: result.reason });
}

// ---------- sending ----------

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function sendToRole(role, message) {
  for (const socket of wss.clients) if (socket.role === role) send(socket, message);
}

// Many changes can happen at once (demo mode), so send one combined update every 150 ms at most
let stateTimer = null;
session.on("change", () => {
  stateTimer ??= setTimeout(() => {
    stateTimer = null;
    sendToRole("instructor", { type: "state", state: session.snapshot() });
  }, 150);
});
session.on("alert", (alert) => sendToRole("instructor", { type: "alert", alert }));
session.on("exercise", () => sendToRole("participant", { type: "exercise", exercise: session.exerciseInfo() }));

// ---------- timers ----------

// Every 10 s: drop pages that didn't answer the last ping (closed lid, lost WiFi)
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 10_000);

setInterval(() => session.checkForStalledParticipants(), 5_000);

// ---------- start ----------

// Addresses other laptops on the same WiFi can use to reach this one
function joinAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info) => info?.family === "IPv4" && !info.internal)
    .map((info) => `http://${info.address}:${SETTINGS.port}/join`);
}

server.on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(`Port ${SETTINGS.port} is busy - is the server already running in another window?`);
  process.exit(1);
});

server.listen(SETTINGS.port, () => {
  console.log("\n=== CCCARE Rep Monitor ===");
  console.log(`Instructor dashboard: http://localhost:${SETTINGS.port}/instructor   (PIN ${SETTINGS.instructorPin})`);
  console.log(`Participant page:     http://localhost:${SETTINGS.port}/join`);
  for (const address of joinAddresses()) console.log(`Other laptops:        ${address}`);
  console.log("Press Ctrl+C to stop.\n");
});
