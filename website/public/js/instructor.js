// Instructor dashboard: PIN login, exercise controls, live participant cards,
// pop-up alerts, and the green/red/yellow results at the end.

import { LiveConnection, liveUrlFor } from "./live-connection.js";
import { FAULT_LABELS } from "./strap-protocol.js";

const $ = (id) => document.getElementById(id);

const RESULT_TEXT = { good: "GOOD FORM", bad: "NEEDS WORK", incomplete: "DIDN'T FINISH" };
const MAX_TOASTS = 4;

let classState = null;      // latest snapshot from the server
let clockOffset = 0;        // server time minus this laptop's time
let openPersonId = null;    // whose details are open in the dialog

const connection = new LiveConnection(liveUrlFor(), {
  onStatus: showServerStatus,
  onOpen: () => {
    const savedPin = sessionStorage.getItem("pin"); // log back in after a reconnect
    if (savedPin) connection.send({ type: "login", pin: savedPin });
  },
  onMessage: handleServerMessage,
});
connection.start();

function handleServerMessage(message) {
  switch (message.type) {
    case "login-ok":
      sessionStorage.setItem("pin", $("pin-input").value || sessionStorage.getItem("pin"));
      $("login-panel").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
      $("target-input").min = message.minTargetReps;
      $("target-input").max = message.maxTargetReps;
      $("sets-input").min = message.minTargetSets;
      $("sets-input").max = message.maxTargetSets;
      showJoinAddresses(message.joinAddresses);
      break;
    case "login-failed":
      sessionStorage.removeItem("pin");
      $("login-message").textContent = message.reason;
      $("login-message").classList.remove("hidden");
      break;
    case "state":
      classState = message.state;
      clockOffset = classState.serverTime - Date.now();
      render();
      break;
    case "alert":
      showToast(message.alert);
      break;
    case "action-error":
      showToast({ level: "warning", message: message.reason });
      break;
  }
}

// ---------- rendering ----------

function render() {
  if (!classState) return;
  const { phase, targetReps, targetSets, demoMode, participants } = classState;
  const readyCount = participants.filter((p) => p.referenceReady).length;

  $("phase-sign").textContent = { lobby: "LOBBY", running: "● LIVE", finished: "FINISHED" }[phase];
  $("phase-sign").className = `phase-sign phase-${phase}`;
  $("start-button").disabled = phase === "running";
  $("start-button").textContent = phase === "lobby" && participants.length
    ? `▶ Start exercise (${readyCount}/${participants.length} ready)` : "▶ Start exercise";
  $("end-button").disabled = phase !== "running";
  $("reset-button").disabled = phase !== "finished";
  showPlanValue("target-input", targetReps);
  showPlanValue("sets-input", targetSets);
  $("demo-button").textContent = `Demo mode: ${demoMode ? "ON" : "OFF"}`;

  renderResultsBanner();
  renderStats();
  renderCards();
  if (openPersonId) renderDialog();
}

// Shows the server's plan in an input, unless the instructor is typing in it
function showPlanValue(inputId, value) {
  const input = $(inputId);
  input.disabled = classState.phase === "running";
  if (document.activeElement !== input) input.value = value;
}

function renderResultsBanner() {
  const banner = $("results-banner");
  banner.classList.toggle("hidden", classState.phase !== "finished");
  if (classState.phase !== "finished") return;
  const count = (result) => classState.participants.filter((p) => p.result === result).length;
  banner.replaceChildren(
    el("span", {}, "Exercise finished:"),
    el("span", { className: "result-label", style: "background:var(--good-green)" }, `${count("good")} good form`),
    el("span", { className: "result-label", style: "background:var(--bad-red)" }, `${count("bad")} need work`),
    el("span", { className: "result-label", style: "background:var(--warn-yellow)" }, `${count("incomplete")} didn't finish`),
  );
}

function renderStats() {
  const people = classState.participants;
  const allReps = people.flatMap((p) => p.reps);
  const goodPercent = allReps.length ? Math.round((100 * allReps.filter((r) => r.good).length) / allReps.length) : 0;
  const finished = people.filter((p) => p.reps.length >= totalTarget()).length;
  const ready = people.filter((p) => p.referenceReady).length;
  const needCheckIn = people.filter((p) => p.needsCheckIn).length;

  $("stats").replaceChildren(
    stat(people.length, "participants"),
    classState.phase === "lobby"
      ? stat(`${ready}/${people.length}`, "reference rep ready", people.length && ready === people.length ? "stat-good" : "")
      : stat(`${finished}/${people.length}`, `finished all ${classState.targetSets} sets`),
    stat(`${goodPercent}%`, "of all reps were good", goodPercent >= 50 ? "stat-good" : "stat-bad"),
    stat(needCheckIn, "need a check-in", needCheckIn ? "stat-bad" : ""),
  );
}

// Reps needed in total, e.g. 2 sets x 8 reps = 16
function totalTarget() {
  return classState.targetReps * classState.targetSets;
}

function stat(number, label, extraClass = "") {
  return el("div", { className: `stat ${extraClass}` },
    el("div", { className: "stat-number" }, String(number)),
    el("div", { className: "stat-label" }, label));
}

function renderCards() {
  const people = classState.participants;
  if (people.length === 0) {
    $("cards").replaceChildren(el("div", { className: "empty-state" },
      "No one has joined yet. Participants open the join address above, or turn on Demo mode."));
    return;
  }
  // people who need a check-in go first, then in the order they joined
  const sorted = [...people].sort((a, b) => Number(b.needsCheckIn) - Number(a.needsCheckIn));
  $("cards").replaceChildren(...sorted.map(personCard));
}

function personCard(person) {
  const { targetReps, targetSets, phase } = classState;
  const classes = ["person-card"];
  if (person.needsCheckIn) classes.push("check-in");
  if (!person.online) classes.push("offline");
  if (person.result) classes.push(`result-${person.result}`);

  // one row of squares per set: green/red per rep, white for reps still to do
  const setRows = [];
  for (let set = 1; set <= targetSets; set++) {
    const repsInSet = person.reps.filter((rep) => rep.set === set);
    const squares = [];
    for (let i = 0; i < Math.max(targetReps, repsInSet.length); i++) {
      const rep = repsInSet[i];
      squares.push(el("span", { className: `rep-square ${rep ? (rep.good ? "good" : "bad") : ""}` }));
    }
    setRows.push(el("div", { className: "rep-squares" }, ...squares));
  }

  const setText = phase === "lobby" ? "" : person.currentSet === 0 ? "Not started" : `Set ${person.currentSet} of ${targetSets}`;

  const card = el("article", { className: classes.join(" "), tabIndex: 0, role: "button" },
    person.needsCheckIn ? el("span", { className: "check-in-sticker" }, person.helpRequested ? "🙋 HELP" : "CHECK IN") : null,
    el("div", { className: "person-top" },
      el("span", { className: "person-name" }, person.name),
      el("span", { className: `badge ${person.simulated ? "badge-sim" : "badge-real"}` }, person.simulated ? "SIM" : "STRAP")),
    el("div", { className: "row", style: "gap:.4rem" },
      strapPill(person),
      el("span", { className: `badge ${person.referenceReady ? "badge-ref" : "badge-noref"}` },
        person.referenceReady ? "REF ✓" : "NO REF")),
    person.result ? el("span", { className: "result-label" }, RESULT_TEXT[person.result]) : null,
    el("div", { className: "person-count" }, String(person.reps.length), el("small", {}, ` / ${totalTarget()} reps`)),
    setText ? el("div", { className: "person-set" }, setText) : null,
    el("div", { className: "set-rows" }, ...setRows),
    el("div", { className: "person-goodbad" },
      el("span", { className: "text-good" }, `✓ ${person.goodCount} good`),
      el("span", { className: "text-bad" }, `✗ ${person.badCount} bad`)),
    el("div", { className: "person-issue" }, person.checkInReason || person.mainIssue),
    el("div", { className: "person-footer" }, el("span", {}, lastRepText(person))),
  );
  card.addEventListener("click", () => openDialog(person.id));
  card.addEventListener("keydown", (event) => { if (event.key === "Enter") openDialog(person.id); });
  return card;
}

function strapPill(person) {
  if (!person.online) return el("span", { className: "pill pill-bad" }, "Laptop offline");
  const pills = {
    "not-connected": ["No strap", "pill-off"],
    connected: ["Strap ready", "pill-ok"],
    "recording-ref": ["Recording reference", "pill-busy"],
    zeroing: ["Getting ready", "pill-busy"],
    "in-set": ["Exercising", "pill-ok"],
    "set-done": ["Set done", "pill-ok"],
    error: ["Sensor problem", "pill-bad"],
  };
  const [text, colour] = pills[person.strapStatus];
  return el("span", { className: `pill ${colour}`, title: person.strapDetail }, text);
}

function lastRepText(person) {
  if (!person.lastRepAt) return "No reps yet";
  const seconds = Math.round((Date.now() + clockOffset - person.lastRepAt) / 1000);
  return seconds < 60 ? `Last rep ${seconds} s ago` : `Last rep ${Math.floor(seconds / 60)} min ago`;
}

// ---------- detail dialog ----------

function openDialog(personId) {
  openPersonId = personId;
  renderDialog();
  if (!$("person-dialog").open) $("person-dialog").showModal();
}

function renderDialog() {
  const person = classState.participants.find((p) => p.id === openPersonId);
  if (!person) { // removed while open
    $("person-dialog").close();
    return;
  }
  $("dialog-name").textContent = person.name;
  $("dialog-badge").textContent = person.simulated ? "SIMULATED" : "REAL STRAP";
  $("dialog-summary").textContent =
    `${person.reps.length}/${totalTarget()} reps · ${person.goodCount} good · ${person.badCount} bad` +
    (person.mainIssue ? ` · Main issue: ${person.mainIssue}` : "") +
    (person.checkInReason ? ` · Needs check-in: ${person.checkInReason}` : "");
  const ref = person.reference;
  $("dialog-reference").textContent = ref
    ? `Reference rep: peak ${ref.peakDeg.toFixed(0)}°, up ${ref.liftSec.toFixed(2)} s, down ${ref.lowerSec.toFixed(2)} s, swing ${ref.swingG.toFixed(2)} g`
    : "No reference rep yet - reps are judged with the strap's default targets.";
  $("dialog-checked").classList.toggle("hidden", !person.needsCheckIn);

  const rows = person.reps.map((rep, i) => el("tr", { className: rep.good ? "row-good" : "row-bad" },
    el("td", {}, String(rep.set)),
    el("td", {}, String(i + 1)),
    el("td", {}, rep.good ? "GOOD" : "BAD"),
    el("td", {}, rep.peakDeg.toFixed(0)),
    el("td", {}, rep.liftSec.toFixed(2)),
    el("td", {}, rep.lowerSec.toFixed(2)),
    el("td", {}, rep.swingG.toFixed(2)),
    el("td", {}, rep.faults.map((f) => FAULT_LABELS[f]).join(", ") || "-")));
  $("dialog-reps").replaceChildren(...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 8 }, "No reps yet."))]));
}

// Marks the open person as checked (if they needed it) and closes the dialog
function checkAndClose() {
  const person = classState.participants.find((p) => p.id === openPersonId);
  if (person?.needsCheckIn) connection.send({ type: "acknowledge", participantId: person.id });
  $("person-dialog").close();
}

$("person-dialog").addEventListener("close", () => { openPersonId = null; });
$("dialog-close").addEventListener("click", () => $("person-dialog").close());
$("dialog-checked").addEventListener("click", checkAndClose);
// Enter anywhere in the dialog = checked + close (Escape just closes)
$("person-dialog").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault(); // stops Enter from also pressing whichever button has focus
  checkAndClose();
});
$("dialog-remove").addEventListener("click", () => {
  const person = classState.participants.find((p) => p.id === openPersonId);
  if (person && confirm(`Remove ${person.name} from the class?`)) {
    connection.send({ type: "remove-participant", participantId: person.id });
    $("person-dialog").close();
  }
});

// ---------- pop-ups ----------

function showToast(alert) {
  const isWarning = alert.level === "warning";
  const toast = el("div", { className: `toast ${isWarning ? "toast-warning" : ""}`, role: "status" },
    el("span", { className: "toast-icon" }, isWarning ? "⚠️" : "✅"),
    el("span", { className: "toast-body" }, alert.message),
    el("button", { className: "toast-close", type: "button", ariaLabel: "Dismiss" }, "×"));
  toast.querySelector(".toast-close").addEventListener("click", (event) => {
    event.stopPropagation();
    toast.remove();
  });
  if (alert.participantId) toast.addEventListener("click", () => openDialog(alert.participantId));

  const stack = $("toasts");
  stack.append(toast); // newest at the bottom
  while (stack.children.length > MAX_TOASTS) stack.firstChild.remove();
  setTimeout(() => toast.remove(), isWarning ? 12_000 : 6_000);
}

// ---------- controls ----------

$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  connection.send({ type: "login", pin: $("pin-input").value });
});

$("start-button").addEventListener("click", () => {
  const people = classState?.participants ?? [];
  const notReady = people.filter((p) => !p.referenceReady).map((p) => p.name);
  if (people.some((p) => p.reps.length > 0) && !confirm("Start again? This clears everyone's current reps.")) return;
  if (notReady.length && !confirm(
    `${notReady.length} not ready yet (no reference rep): ${notReady.slice(0, 10).join(", ")}${notReady.length > 10 ? "…" : ""}\n\n` +
    "Start anyway? They can record it and begin when they're ready. Until then their reps use the default targets.")) return;
  connection.send({ type: "start-exercise", targetReps: Number($("target-input").value), targetSets: Number($("sets-input").value) });
});

// Changing reps/sets before starting shows the plan on participants' pages
for (const id of ["target-input", "sets-input"]) {
  $(id).addEventListener("change", () => connection.send({
    type: "plan", targetReps: Number($("target-input").value), targetSets: Number($("sets-input").value),
  }));
}
$("end-button").addEventListener("click", () => connection.send({ type: "end-exercise" }));
$("reset-button").addEventListener("click", () => connection.send({ type: "reset" }));
$("demo-button").addEventListener("click", () => connection.send({ type: "demo", on: !classState?.demoMode }));

function showJoinAddresses(addresses) {
  const list = addresses.length ? addresses : [`${location.origin}/join`];
  $("join-addresses").replaceChildren(...list.flatMap((address, i) =>
    [i ? " or " : "", el("span", { className: "join-address" }, address)]));
}

function showServerStatus(status) {
  $("server-status").textContent = { connecting: "Connecting…", connected: "Online", disconnected: "Offline - retrying" }[status];
  $("server-status").className = `pill ${status === "connected" ? "pill-ok" : "pill-warn"}`;
}

setInterval(render, 5000); // keeps "Last rep 12 s ago" up to date

// ---------- helper ----------

// Makes an element. Text is always set with textContent, so names can't inject HTML.
function el(tag, props = {}, ...children) {
  const element = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child !== null && child !== "") element.append(child);
  }
  return element;
}
