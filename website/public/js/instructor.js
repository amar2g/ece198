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
  const { phase, targetReps, demoMode } = classState;

  $("phase-sign").textContent = { lobby: "LOBBY", running: "● LIVE", finished: "FINISHED" }[phase];
  $("phase-sign").className = `phase-sign phase-${phase}`;
  $("start-button").disabled = phase === "running";
  $("end-button").disabled = phase !== "running";
  $("reset-button").disabled = phase !== "finished";
  $("target-input").disabled = phase === "running";
  if (phase === "running") $("target-input").value = targetReps;
  $("demo-button").textContent = `Demo mode: ${demoMode ? "ON" : "OFF"}`;

  renderResultsBanner();
  renderStats();
  renderCards();
  if (openPersonId) renderDialog();
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
  const finished = people.filter((p) => p.reps.length >= classState.targetReps).length;
  const needCheckIn = people.filter((p) => p.needsCheckIn).length;

  $("stats").replaceChildren(
    stat(people.length, "participants"),
    stat(`${finished}/${people.length}`, `reached ${classState.targetReps} reps`),
    stat(`${goodPercent}%`, "of all reps were good", goodPercent >= 50 ? "stat-good" : "stat-bad"),
    stat(needCheckIn, "need a check-in", needCheckIn ? "stat-bad" : ""),
  );
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
  const target = classState.targetReps;
  const classes = ["person-card"];
  if (person.needsCheckIn) classes.push("check-in");
  if (!person.online) classes.push("offline");
  if (person.result) classes.push(`result-${person.result}`);

  // one square per rep (green/red), empty squares for reps still to do
  const squares = [];
  for (let i = 0; i < Math.max(target, person.reps.length); i++) {
    const rep = person.reps[i];
    squares.push(el("span", { className: `rep-square ${rep ? (rep.good ? "good" : "bad") : ""}` }));
  }

  const card = el("article", { className: classes.join(" "), tabIndex: 0, role: "button" },
    person.needsCheckIn ? el("span", { className: "check-in-sticker" }, "CHECK IN") : null,
    el("div", { className: "person-top" },
      el("span", { className: "person-name" }, person.name),
      el("span", { className: `badge ${person.simulated ? "badge-sim" : "badge-real"}` }, person.simulated ? "SIM" : "STRAP")),
    strapPill(person),
    person.result ? el("span", { className: "result-label" }, RESULT_TEXT[person.result]) : null,
    el("div", { className: "person-count" }, String(person.reps.length), el("small", {}, ` / ${target} reps`)),
    el("div", { className: "rep-squares" }, ...squares),
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
    `${person.reps.length}/${classState.targetReps} reps · ${person.goodCount} good · ${person.badCount} bad` +
    (person.mainIssue ? ` · Main issue: ${person.mainIssue}` : "");
  $("dialog-checked").classList.toggle("hidden", !person.needsCheckIn);

  const rows = person.reps.map((rep, i) => el("tr", { className: rep.good ? "row-good" : "row-bad" },
    el("td", {}, String(i + 1)),
    el("td", {}, rep.good ? "GOOD" : "BAD"),
    el("td", {}, rep.peakDeg.toFixed(0)),
    el("td", {}, rep.liftSec.toFixed(2)),
    el("td", {}, rep.lowerSec.toFixed(2)),
    el("td", {}, rep.swingG.toFixed(2)),
    el("td", {}, rep.faults.map((f) => FAULT_LABELS[f]).join(", ") || "-")));
  $("dialog-reps").replaceChildren(...(rows.length ? rows : [el("tr", {}, el("td", { colSpan: 7 }, "No reps yet."))]));
}

$("person-dialog").addEventListener("close", () => { openPersonId = null; });
$("dialog-close").addEventListener("click", () => $("person-dialog").close());
$("dialog-checked").addEventListener("click", () => connection.send({ type: "acknowledge", participantId: openPersonId }));
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
  const hasReps = classState?.participants.some((p) => p.reps.length > 0);
  if (hasReps && !confirm("Start a new exercise? This clears everyone's current reps.")) return;
  connection.send({ type: "start-exercise", targetReps: Number($("target-input").value) });
});
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
