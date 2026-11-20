// Participant page: join with a name, connect the strap, record a reference rep,
// then do the sets. Each rep is forwarded to the server.
// Participants never see good/bad results here - only their progress.

import { LiveConnection, liveUrlFor } from "./live-connection.js";
import { parseStrapLine, repsPerSetCommand } from "./strap-protocol.js";
import { UsbStrap, PretendStrap, isWebSerialAvailable } from "./strap-connection.js";

const $ = (id) => document.getElementById(id);

// Strap status -> [pill text, pill colour]
const STRAP_PILLS = {
  "not-connected": ["Not connected", "pill-off"],
  connected: ["Connected", "pill-ok"],
  "recording-ref": ["Recording reference", "pill-busy"],
  zeroing: ["Hold still…", "pill-busy"],
  "in-set": ["Set running", "pill-ok"],
  "set-done": ["Set finished", "pill-ok"],
  error: ["Sensor problem", "pill-bad"],
};

const state = {
  me: JSON.parse(sessionStorage.getItem("me") ?? "null"), // { id, name } after joining
  exercise: { phase: "lobby", targetReps: 8, targetSets: 2 },
  strap: null,               // UsbStrap or PretendStrap
  strapStatus: "not-connected",
  recordingReference: false, // true from "Record my reference rep" until it's saved
  endingReferenceSet: false, // the strap's set-end after a reference rep isn't a real set
  referenceReady: false,
  currentSet: 0,             // 0 = no set started yet
  setRepCount: 0,
  helpRequested: false,
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
      Object.assign(state, message.progress); // currentSet, setRepCount, referenceReady, helpRequested
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
      state.setRepCount = message.setRepCount;
      break;

    case "rep-rejected":
      if (message.reason === "not-running") {
        showMessage("strap-message", "That rep wasn't counted - the instructor hasn't started the exercise.", "info");
      }
      break;

    case "help-answered":
      state.helpRequested = false;
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
  const phaseChanged = exercise.phase !== state.exercise.phase;
  if (phaseChanged && exercise.phase === "running") { // exercise started: fresh sets
    state.currentSet = 0;
    state.setRepCount = 0;
  }
  if (phaseChanged && exercise.phase === "lobby") { // new round = new exercise: new reference rep
    state.referenceReady = false;
    state.currentSet = 0;
    state.setRepCount = 0;
    showMessage("reference-message", "");
  }
  state.exercise = exercise;
  sendToStrap(repsPerSetCommand(exercise.targetReps));
  if (exercise.phase === "finished" && ["zeroing", "in-set"].includes(state.strapStatus)) {
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
  sendToStrap(repsPerSetCommand(state.exercise.targetReps));
}

async function disconnectStrap() {
  await state.strap?.disconnect();
  state.strap = null;
  state.recordingReference = false;
  reportStrapStatus("not-connected");
}

function handleStrapDisconnect(reason) {
  state.strap = null;
  state.recordingReference = false;
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

// Reference rep = the strap's own steps: start a set (s), wait for GO,
// send r so the next rep is saved as the reference, then end that set (e).
function startReferenceRep() {
  state.recordingReference = true;
  showMessage("reference-message", "Let your arm hang straight down and keep it still…", "info");
  sendToStrap("s");
  render();
}

function handleStrapLine(line) {
  addToStrapLog(line);
  const event = parseStrapLine(line);
  if (!event) return; // normal text, or a damaged line

  switch (event.type) {
    case "ready":
      reportStrapStatus("connected");
      break;

    case "set-cancelled":
      if (state.recordingReference) cancelReference("Cancelled - press the button to try again.");
      state.endingReferenceSet = false;
      reportStrapStatus("connected");
      break;

    case "zeroing":
      if (!state.recordingReference) showMessage("strap-message", "Let your arm hang straight down and keep it still…", "info");
      reportStrapStatus(state.recordingReference ? "recording-ref" : "zeroing");
      break;

    case "set-start":
      if (state.recordingReference) {
        sendToStrap("r");
        showMessage("reference-message", "Now do ONE slow, controlled rep, the way you were shown.", "info");
      } else {
        state.endingReferenceSet = false;
        connection.send({ type: "set-start" });
        state.currentSet += 1;
        state.setRepCount = 0;
        showMessage("strap-message", "GO! Start curling.", "ok");
        reportStrapStatus("in-set");
      }
      break;

    case "reference":
      state.recordingReference = false;
      state.endingReferenceSet = true;
      state.referenceReady = true;
      connection.send({ type: "reference", reference: event.reference });
      sendToStrap("e");
      showMessage("reference-message", "✓ Reference saved - you're ready!", "ok");
      break;

    case "rep":
      if (state.recordingReference) break; // shouldn't happen: the strap turns this rep into the reference
      if (state.strapStatus === "error") reportStrapStatus("in-set"); // sensor came back
      state.setRepCount = event.rep.number;
      if (!connection.send({ type: "rep", rep: event.rep })) state.unsentReps.push(event.rep);
      break;

    case "set-end":
      if (state.endingReferenceSet) { // the short set used to record the reference
        state.endingReferenceSet = false;
        reportStrapStatus("connected");
        break;
      }
      showMessage("strap-message", "", "info");
      reportStrapStatus("set-done");
      break;

    case "error": {
      const detail = event.code === "SENSOR_LOST"
        ? "Lost contact with the sensor - a wire may be loose"
        : "Sensor not found - check the wiring and press RESET";
      if (state.recordingReference) cancelReference("Sensor problem - fix it, then try again.");
      showMessage("strap-message", detail, "error");
      reportStrapStatus("error", detail);
      break;
    }
  }
  render();
}

function cancelReference(text) {
  state.recordingReference = false;
  showMessage("reference-message", text, "error");
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

// What the exercise box should say right now
function exerciseText() {
  const { phase, targetReps, targetSets } = state.exercise;
  const plan = `${targetSets} set${targetSets > 1 ? "s" : ""} of ${targetReps} reps`;
  const { currentSet, strapStatus } = state;

  if (!state.me) return "Join the class first.";
  if (phase === "finished") return "The exercise is over. Thanks!";
  if (phase === "lobby") {
    return state.referenceReady
      ? `✓ You're ready! Today: ${plan}. Wait for your instructor to start.`
      : `Today: ${plan}. Record your reference rep (step 3) while you wait.`;
  }
  // running
  if (currentSet === 0) return `Started! Today: ${plan}. Press "Start set 1", then let your arm hang still until it says GO.`;
  if (strapStatus !== "set-done") return `Set ${currentSet} of ${targetSets} - keep going!`;
  if (currentSet >= targetSets) return "All sets done - great work! 🎉";
  return `Set ${currentSet} of ${targetSets} done ✓ Rest, then press "Start set ${currentSet + 1}".`;
}

function render() {
  const joined = Boolean(state.me);
  const hasStrap = Boolean(state.strap);
  const { phase, targetReps, targetSets } = state.exercise;
  const notBusy = ["connected", "set-done"].includes(state.strapStatus) && !state.recordingReference;

  $("join-form").classList.toggle("hidden", joined);
  $("joined-view").classList.toggle("hidden", !joined);
  $("joined-name").textContent = state.me?.name ?? "";

  const [pillText, pillColour] = STRAP_PILLS[state.strapStatus];
  $("strap-status").textContent = pillText;
  $("strap-status").className = `pill ${pillColour}`;
  $("connect-strap-button").classList.toggle("hidden", hasStrap);
  $("pretend-strap-button").classList.toggle("hidden", hasStrap);
  $("disconnect-strap-button").classList.toggle("hidden", !hasStrap);

  // Step 3: reference rep
  $("reference-button").disabled = !(joined && hasStrap && notBusy && phase !== "finished");
  $("reference-button").textContent = state.recordingReference ? "Recording…"
    : state.referenceReady ? "Record a new reference rep" : "● Record my reference rep";

  // Step 4: exercise
  $("exercise-text").textContent = exerciseText();
  $("exercise-text").className = `message-box ${phase === "lobby" && state.referenceReady ? "message-ok" : "message-info"}`;
  $("set-label").textContent = `Set ${Math.max(state.currentSet, 1)} of ${targetSets}`;
  $("set-reps").textContent = state.setRepCount;
  $("set-target").textContent = `/ ${targetReps} reps`;
  $("start-set-button").textContent = `▶ Start set ${state.currentSet + 1}`;
  $("start-set-button").disabled = !(joined && hasStrap && phase === "running" && notBusy && state.currentSet < targetSets);
  $("end-set-button").disabled = !(hasStrap && ["zeroing", "in-set", "recording-ref"].includes(state.strapStatus));

  // Help
  $("help-button").classList.toggle("hidden", !joined);
  $("help-button").disabled = state.helpRequested;
  $("help-button").textContent = state.helpRequested ? "✓ Your instructor has been told - help is coming" : "🙋 I need help";
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
$("reference-button").addEventListener("click", startReferenceRep);
$("start-set-button").addEventListener("click", () => sendToStrap("s"));
$("end-set-button").addEventListener("click", () => {
  if (state.recordingReference) { // stopping halfway through the reference rep
    state.recordingReference = false;
    state.endingReferenceSet = true;
    showMessage("reference-message", "Cancelled - press the button to try again.", "error");
  }
  sendToStrap("e");
});
$("help-button").addEventListener("click", () => {
  if (connection.send({ type: "help" })) state.helpRequested = true;
  render();
});

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
