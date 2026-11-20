// Participant page: join with a name, connect the strap, forward each rep to the server.
// Participants never see good/bad results here - only how many reps were sent.

import { LiveConnection, liveUrlFor } from "./live-connection.js";
import { parseStrapLine, repsPerSetCommand } from "./strap-protocol.js";
import { UsbStrap, PretendStrap, isWebSerialAvailable } from "./strap-connection.js";

const $ = (id) => document.getElementById(id);

// Strap status -> [pill text, pill colour]
const STRAP_PILLS = {
  "not-connected": ["Not connected", "pill-off"],
  connected: ["Connected", "pill-ok"],
  zeroing: ["Hold still…", "pill-busy"],
  "in-set": ["Set running", "pill-ok"],
  "set-done": ["Set finished", "pill-ok"],
  error: ["Sensor problem", "pill-bad"],
};

const state = {
  me: JSON.parse(sessionStorage.getItem("me") ?? "null"), // { id, name } after joining
  exercise: { phase: "lobby", targetReps: 8 },
  strap: null,               // UsbStrap or PretendStrap
  strapStatus: "not-connected",
  repsSent: 0,
  unsentReps: [],            // reps done while the server was unreachable
};

const connection = new LiveConnection(liveUrlFor(localStorage.getItem("serverAddress") ?? ""), {
  onStatus: showServerStatus,
  onOpen: () => { if (state.me) sendJoin(state.me.name); }, // rejoin after a reconnect
  onMessage: handleServerMessage,
});
connection.start();

// ---------- server ----------

function sendJoin(name) {
  connection.send({ type: "join", name, previousId: state.me?.id });
}

function handleServerMessage(message) {
  switch (message.type) {
    case "joined":
      state.me = { id: message.id, name: message.name };
      sessionStorage.setItem("me", JSON.stringify(state.me));
      updateExercise(message.exercise);
      state.repsSent = message.repCount;
      showMessage("join-message", "");
      reportStrapStatus(state.strapStatus);
      state.unsentReps.splice(0).forEach((rep) => connection.send({ type: "rep", rep }));
      break;

    case "join-error":
      showMessage("join-message", message.reason, "error");
      forgetMe();
      break;

    case "exercise":
      updateExercise(message.exercise);
      break;

    case "rep-received":
      state.repsSent = message.repCount;
      break;

    case "rep-rejected":
      if (message.reason === "not-running") {
        showMessage("strap-message", "That rep wasn't counted - the instructor hasn't started the exercise.", "info");
      }
      break;

    case "closed-by-server":
      forgetMe();
      showMessage("join-message", message.code === 4001
        ? "The instructor removed you from the class. You can join again."
        : "You joined from another tab, so this one stopped.", "error");
      break;
  }
  render();
}

function updateExercise(exercise) {
  // new exercise or new round: the server cleared everyone's reps
  if (exercise.phase !== state.exercise.phase && exercise.phase !== "finished") state.repsSent = 0;
  state.exercise = exercise;
  if (exercise.phase === "running") {
    sendToStrap(repsPerSetCommand(exercise.targetReps));
  } else if (["zeroing", "in-set"].includes(state.strapStatus)) {
    sendToStrap("e"); // instructor ended the exercise: stop the strap's set too
  }
}

function reportStrapStatus(status, detail = "") {
  state.strapStatus = status;
  connection.send({ type: "strap-status", status, detail });
  render();
}

function forgetMe() {
  state.me = null;
  sessionStorage.removeItem("me");
}

// ---------- strap ----------

async function connectStrap(StrapType) {
  showMessage("strap-message", "");
  const strap = new StrapType({ onLine: handleStrapLine, onDisconnect: handleStrapDisconnect });
  try {
    await strap.connect();
  } catch (error) {
    // NotFoundError = the user closed the port picker without choosing
    if (error.name !== "NotFoundError") {
      showMessage("strap-message", `Couldn't open the strap: ${error.message}. Is the Arduino IDE's Serial Monitor open? Close it and try again.`, "error");
    }
    return;
  }
  state.strap = strap;
  reportStrapStatus("connected");
  if (state.exercise.phase === "running") sendToStrap(repsPerSetCommand(state.exercise.targetReps));
}

async function disconnectStrap() {
  await state.strap?.disconnect();
  state.strap = null;
  reportStrapStatus("not-connected");
}

function handleStrapDisconnect(reason) {
  state.strap = null;
  showMessage("strap-message", `Strap disconnected (${reason}). Check the USB cable and connect again.`, "error");
  reportStrapStatus("not-connected");
}

async function sendToStrap(text) {
  try {
    await state.strap?.send(text);
  } catch (error) {
    showMessage("strap-message", `Couldn't talk to the strap: ${error.message}`, "error");
  }
}

function handleStrapLine(line) {
  addToStrapLog(line);
  const event = parseStrapLine(line);
  if (!event) return; // normal text, or a damaged line

  switch (event.type) {
    case "ready":
    case "set-cancelled":
      reportStrapStatus("connected");
      break;
    case "zeroing":
      showMessage("strap-message", "Let your arm hang straight down and keep it still…", "info");
      reportStrapStatus("zeroing");
      break;
    case "set-start":
      showMessage("strap-message", "GO! Start curling.", "ok");
      reportStrapStatus("in-set");
      break;
    case "reference":
      showMessage("strap-message", "Reference rep saved. Keep going!", "ok");
      break;
    case "rep":
      if (state.strapStatus === "error") reportStrapStatus("in-set"); // sensor came back
      if (!connection.send({ type: "rep", rep: event.rep })) state.unsentReps.push(event.rep);
      break;
    case "set-end":
      showMessage("strap-message", "Set finished. Nice work!", "ok");
      reportStrapStatus("set-done");
      break;
    case "error": {
      const detail = event.code === "SENSOR_LOST"
        ? "Lost contact with the sensor - a wire may be loose"
        : "Sensor not found - check the wiring and press RESET";
      showMessage("strap-message", detail, "error");
      reportStrapStatus("error", detail);
      break;
    }
  }
}

function addToStrapLog(line) {
  const log = $("strap-log");
  log.textContent = (log.textContent + line + "\n").split("\n").slice(-200).join("\n");
  log.scrollTop = log.scrollHeight;
}

// ---------- page ----------

function showServerStatus(status) {
  const text = { connecting: "Connecting…", connected: "Online", disconnected: "Offline - retrying" }[status];
  $("server-status").textContent = text;
  $("server-status").className = `pill ${status === "connected" ? "pill-ok" : "pill-warn"}`;
}

// type: "error" | "ok" | "info"; empty text hides the box
function showMessage(id, text, type = "info") {
  const box = $(id);
  box.textContent = text;
  box.className = `message-box message-${type}`;
  box.classList.toggle("hidden", !text);
}

function render() {
  const joined = Boolean(state.me);
  const hasStrap = Boolean(state.strap);
  const running = state.exercise.phase === "running";

  $("join-form").classList.toggle("hidden", joined);
  $("joined-view").classList.toggle("hidden", !joined);
  $("joined-name").textContent = state.me?.name ?? "";

  const [pillText, pillColour] = STRAP_PILLS[state.strapStatus];
  $("strap-status").textContent = pillText;
  $("strap-status").className = `pill ${pillColour}`;
  $("connect-strap-button").classList.toggle("hidden", hasStrap);
  $("pretend-strap-button").classList.toggle("hidden", hasStrap);
  $("disconnect-strap-button").classList.toggle("hidden", !hasStrap);

  const exerciseText = !joined ? "Join the class first."
    : state.exercise.phase === "lobby" ? "Waiting for the instructor to start the exercise…"
    : running ? `Exercise started: do ${state.exercise.targetReps} reps. Press "Start my set", then let your arm hang still until it says GO.`
    : "The exercise is over. Thanks!";
  $("exercise-text").textContent = exerciseText;

  const canAct = joined && hasStrap && running;
  $("start-set-button").disabled = !(canAct && ["connected", "set-done"].includes(state.strapStatus));
  $("reference-button").disabled = !(canAct && state.strapStatus === "in-set");
  $("end-set-button").disabled = !(canAct && ["zeroing", "in-set"].includes(state.strapStatus));
  $("reps-sent").textContent = state.repsSent;
}

// ---------- buttons ----------

$("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!connection.send({ type: "join", name: $("name-input").value })) {
    showMessage("join-message", "Not connected to the instructor's laptop yet. Check the WiFi and try again.", "error");
  }
});

$("leave-button").addEventListener("click", () => {
  connection.send({ type: "leave" });
  forgetMe();
  render();
});

$("connect-strap-button").addEventListener("click", () => connectStrap(UsbStrap));
$("pretend-strap-button").addEventListener("click", () => connectStrap(PretendStrap));
$("disconnect-strap-button").addEventListener("click", disconnectStrap);
$("start-set-button").addEventListener("click", () => sendToStrap("s"));
$("reference-button").addEventListener("click", () => sendToStrap("r"));
$("end-set-button").addEventListener("click", () => sendToStrap("e"));

$("server-address-input").value = localStorage.getItem("serverAddress") ?? "";
$("server-address-save").addEventListener("click", () => {
  localStorage.setItem("serverAddress", $("server-address-input").value.trim());
  location.reload();
});

// USB needs Chrome/Edge on a trusted page; explain if it's not available
if (!isWebSerialAvailable()) {
  $("connect-strap-button").disabled = true;
  showMessage("strap-message", window.isSecureContext
    ? "This browser can't talk to USB devices. Please use Google Chrome or Microsoft Edge."
    : "Chrome only allows USB on trusted pages. See the README, \"Multi-laptop demo\" (Option A or B).", "error");
}

render();
