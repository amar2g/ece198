# How the website works

This is the long explanation. The code itself only has short comments; this document explains *why* things are done the way they are, so your team can answer questions at the symposium.

**Contents**
1. [The big picture](#1-the-big-picture)
2. [Words you'll see](#2-words-youll-see)
3. [Where everything lives](#3-where-everything-lives)
4. [The life of one rep](#4-the-life-of-one-rep)
5. [Strap ↔ website: the DATA lines](#5-strap--website-the-data-lines)
6. [The server (`server.js`)](#6-the-server-serverjs)
7. [The class logic (`src/class-session.js`)](#7-the-class-logic-srcclass-sessionjs)
8. [Demo mode (`src/simulator.js`)](#8-demo-mode-srcsimulatorjs)
9. [The participant page (`join.js`)](#9-the-participant-page-joinjs)
10. [The instructor dashboard (`instructor.js`)](#10-the-instructor-dashboard-instructorjs)
11. [Errors and edge cases we handle](#11-errors-and-edge-cases-we-handle)
12. [Testing](#12-testing)
13. [Limitations and next steps](#limitations-and-next-steps)
14. [Likely symposium questions](#14-likely-symposium-questions)

---

## 1. The big picture

There are three kinds of program, running on different machines:

```
┌──────────────┐  USB   ┌─────────────────────┐  WiFi (WebSocket)  ┌──────────────────────┐
│ Curl strap   │───────▶│ Participant laptop  │───────────────────▶│ Instructor laptop     │
│ Arduino +    │ text   │ Chrome: join page   │  JSON messages     │ server.js (Node)      │
│ BMX160       │◀───────│ (join.js)           │◀───────────────────│  + dashboard page     │
└──────────────┘ s,e,n8 └─────────────────────┘                    │  (instructor.js)      │
                                                                    └──────────────────────┘
```

1. **The strap** (`curl_strap.ino`) decides if each rep is good or bad. The website does **not** re-judge reps; it trusts the strap's verdict.
2. **The join page** runs in Chrome on the participant's laptop. It reads text from the strap over USB and forwards each rep to the server.
3. **The server** runs on the instructor's laptop. It remembers every participant and rep, and pushes live updates to the dashboard.
4. **The dashboard** is a web page (on the instructor's laptop, or any device that knows the PIN) that draws the cards and pop-ups.

Splitting it this way means the Arduino code barely changed. The strap still works on its own with the Serial Monitor.

---

## 2. Words you'll see

| Word | Meaning |
|---|---|
| **Server** | A program that waits for other programs to connect to it. Ours is `server.js`, run with Node.js. |
| **Node.js** | Lets JavaScript run outside a browser, so the server and the pages use the same language. |
| **localhost** | "This same computer". `http://localhost:3000` means port 3000 on the laptop you're using. |
| **IP address** | A computer's address on the network, e.g. `192.168.43.10`. Other laptops use it to reach the server. |
| **Port** | A numbered door on a computer. Our server listens on door 3000. |
| **WebSocket** | A connection between a page and the server that **stays open**, so either side can send a message at any moment. That's what makes the dashboard update instantly without refreshing. |
| **JSON** | A text format for sending objects, e.g. `{"type":"rep","rep":{"good":true}}`. |
| **Web Serial** | A Chrome/Edge feature that lets a web page read from and write to a USB serial device, like the Arduino. |
| **Secure context** | Chrome's idea of a "trusted page": `localhost` or `https`. Web Serial only works on trusted pages. |
| **Event / EventEmitter** | A way for one part of the code to announce "something happened" so other parts can react. `ClassSession` emits `change`, `alert` and `exercise`. |
| **Snapshot** | A complete copy of the class data at one moment, sent to the dashboard to redraw. |

---

## 3. Where everything lives

```
website/
├── server.js                 the server: pages + WebSocket + timers
├── package.json              lists the two libraries we use (express, ws) and the npm commands
├── src/
│   ├── config.js             every setting (PIN, limits, alert timings)
│   ├── class-session.js      the class data and rules - the "brain"
│   └── simulator.js          demo mode's pretend participants
├── public/                   everything the browser downloads
│   ├── index.html            home page with two buttons
│   ├── join.html             participant page layout
│   ├── instructor.html       dashboard layout
│   ├── css/style.css         the neo-brutalist look
│   └── js/
│       ├── strap-protocol.js reads DATA lines (shared with the server)
│       ├── strap-connection.js  USB strap + pretend strap
│       ├── live-connection.js   WebSocket that reconnects by itself
│       ├── join.js           participant page logic
│       └── instructor.js     dashboard logic
└── test/                     automatic tests (npm test)
```

**Libraries:** `express` serves the files in `public/`, and `ws` does WebSockets on the server. Browsers have WebSockets and Web Serial built in, so the pages need no libraries.

---

## 4. The life of one rep

Follow one bicep curl from the arm to the instructor's screen:

1. **Strap judges the rep.** `CurlTracker.h` detects the rep finishing and scores it. `curl_strap.ino` prints the usual lines, then:
   ```
   DATA,REP,3,BAD,128.0,0.70,0.31,0.18,LOWER_FAST
   ```
   The red LED lights at the same moment.
2. **USB → browser.** In `strap-connection.js`, `UsbStrap.readLoop()` receives raw bytes. Bytes can arrive in random-sized chunks, so it keeps a `partial` string, splits on newline (`\n`), and passes each complete line to `onLine`.
3. **Line → event.** `join.js` `handleStrapLine()` calls `parseStrapLine()` from `strap-protocol.js`, which returns:
   ```js
   { type: "rep", rep: { number: 3, good: false, peakDeg: 128, liftSec: 0.7, lowerSec: 0.31, swingG: 0.18, faults: ["LOWER_FAST"] } }
   ```
   Normal text lines, and damaged lines, return `null` and are ignored.
4. **Browser → server.** `join.js` sends `{type: "rep", rep}` over the WebSocket. If the WiFi is down at that moment, the rep goes into `state.unsentReps` and is sent after reconnecting.
5. **Server checks and stores it.** In `server.js`, `handleParticipantMessage()` calls `session.recordRep(id, rep)`. In `class-session.js`, `cleanRep()` checks every field, because the server never trusts network data blindly. The rep is then added to that participant's list, and the alert rules run (see §7).
6. **Server → participant.** The server replies `{type: "rep-received", repCount: 3}`, so the join page shows "3 reps sent". It never says good or bad.
7. **Server → dashboard.** `recordRep()` emits `"change"`. `server.js` waits 150 ms to group changes together, then sends `{type: "state", state: snapshot}` to every logged-in instructor page.
8. **Dashboard redraws.** `instructor.js` `render()` rebuilds the stats and cards. A red square appears on that person's card, and "✗ 1 bad" goes up.

From the arm to the screen usually takes well under half a second.

---

## 5. Strap ↔ website: the DATA lines

The Arduino prints sentences for people, like `Rep 3/8: NEEDS WORK - Lower slower`. Picking numbers out of sentences is fragile: if someone rewords a message, the website breaks silently. So the strap also prints one **machine-readable** line per event. These are comma-separated, and always start with `DATA`:

| Line | When |
|---|---|
| `DATA,READY` | Sensor found at power-up |
| `DATA,ZEROING` | `s` typed, waiting for the arm to hang still |
| `DATA,SET_START,8` | Arm was still, set started (8 reps per set) |
| `DATA,REF,128.0,0.80,1.30,0.12` | Reference rep saved (peak, up, down, swing) |
| `DATA,REP,3,GOOD,134.0,0.73,1.15,0.10,NONE` | A rep: number, verdict, peak°, up s, down s, swing g, faults |
| `DATA,REP,4,BAD,80.0,0.70,0.30,0.20,SHORT_RANGE\|LOWER_FAST` | Several faults are joined with `\|` |
| `DATA,SET_END,8,6` | Set finished: 8 reps, 6 good |
| `DATA,SET_CANCELLED` | `e` typed before GO |
| `DATA,ERROR,SENSOR_LOST` | A wire came loose mid-set |
| `DATA,ERROR,SENSOR_NOT_FOUND` | No sensor at power-up (repeated every 2 s) |

**Fault codes** come from `CurlTracker.h`: `SHORT_RANGE` → "Curl higher", `LOWER_FAST` → "Lower slower", `SWING` → "Don't swing", `LIFT_FAST` → "Lift slower". The friendly labels are in `FAULT_LABELS` in `strap-protocol.js`.

**Commands the website sends to the strap:**

| Text | Effect |
|---|---|
| `s` | Start a set ("Start my set" button) |
| `r` | Next rep is the reference rep |
| `e` | End the set (also sent automatically when the instructor ends the exercise) |
| `n8` + newline | Reps per set = 8. Sent when the exercise starts, so the strap stops at the instructor's target. |

**How `n8` works on the Arduino:** `handleCommand()` gets one character at a time. After `n`, it sets `readingRepsTarget = true` and builds the number digit by digit (`repsTargetDigits = repsTargetDigits * 10 + digit`). The first non-digit, usually the newline, calls `finishRepsTarget()`, which accepts 1–50.

**Why `parseStrapLine` is strict:** if the cable is pulled mid-line, you can get half a line such as `DATA,REP,3,GOOD,134.0,0.7`. The parser checks the number of fields, that numbers really are numbers, that the verdict is GOOD or BAD, and that every fault name is known. Anything odd returns `null`, so a damaged line never counts as a wrong rep.

---

## 6. The server (`server.js`)

### What it does
- **Serves pages:** `express.static` hands out the files in `public/`. The `extensions: ["html"]` option lets `/join` find `join.html`.
- **Live connections:** a `WebSocketServer` at `/live`. Every open page (join or dashboard) holds one connection.
- **Roles:** each socket starts with `role = null`. Sending `join` makes it a `"participant"`, and a correct `login` PIN makes it an `"instructor"`. `handleMessage()` routes messages by role, so a participant socket simply can't run instructor commands.

### Messages

| From → to | `type` | Meaning |
|---|---|---|
| participant → server | `join` | `{name, previousId}`: join, or rejoin after a drop |
| | `strap-status` | `{status, detail}`: e.g. "in-set", "error" |
| | `rep` | `{rep}`: one rep from the strap |
| | `leave` | "Not you? Leave" button |
| instructor → server | `login` | `{pin}` |
| | `start-exercise` | `{targetReps}` |
| | `end-exercise`, `reset` | End / new round |
| | `demo` | `{on: true/false}` |
| | `acknowledge` | `{participantId}`: "Mark as checked" |
| | `remove-participant` | `{participantId}` |
| server → participant | `joined` / `join-error` | Result of joining |
| | `exercise` | `{phase, targetReps}`: the only class info participants get |
| | `rep-received` / `rep-rejected` | Reply to each rep |
| server → instructor | `login-ok` / `login-failed` | Result of the PIN |
| | `state` | A full snapshot to redraw from |
| | `alert` | A pop-up |
| | `action-error` | e.g. "Target reps must be 1–50" |

### Privacy
Class data (`state` and `alert`) is only sent with `sendToRole("instructor", …)`. Participant sockets get only their own join info, their rep count and the exercise phase/target. Hiding the dashboard *page* isn't what keeps participants out; the server never sends them the data at all.

### Keeping track of who's connected
- **`participantSockets`** maps a participant id to their *current* socket. If someone reloads the page, the new socket replaces the old one. When the old one finally closes, the check `participantSockets.get(id) === socket` stops it from marking the person offline.
- **Heartbeat:** a laptop that closes its lid never says goodbye. Every 10 s the server pings every socket. Any socket that didn't answer the previous ping is terminated, which marks that person offline and raises an alert.
- **Batching:** in demo mode 28 people produce many changes per second. Instead of sending a snapshot for every one, `session.on("change")` starts a 150 ms timer, and one snapshot goes out when it fires.

### Safety nets
- Each message is handled inside `try/catch`, so one bad message can't crash the server for the whole class.
- `maxPayload: 16 KB` rejects giant messages.
- If port 3000 is busy (server already running), it prints a clear message instead of a crash dump.

---

## 7. The class logic (`src/class-session.js`)

This file is the "brain". It has no network code, which makes it easy to test.

### Phases
```
 LOBBY ──Start──▶ RUNNING ──End──▶ FINISHED ──New round──▶ LOBBY
                     ▲                 │
                     └─────Start───────┘   (starting again clears the reps)
```
Reps are only accepted in **RUNNING**. A rep that arrives in another phase is rejected, and the participant is told the exercise hasn't started.

### What's stored per participant
`id`, `name`, `simulated`, `online`, `strapStatus`, `strapDetail`, and the per-exercise fields from `newExerciseFields()`: `reps[]`, `lastRepAt`, `badRepsInARow`, `stalledAlertSent`, `needsCheckIn`, `checkInReason` and `result`. Starting a new exercise resets just these per-exercise fields.

### The rules

**Final colour: `judgeParticipant(reps, targetReps)`**
1. Fewer reps than the target → **yellow** ("didn't finish"), however good they were.
2. Otherwise, good reps > half → **green** ("good form").
3. Otherwise → **red** ("needs work"). A 4-good / 4-bad tie counts as red, because it isn't *mostly* good.

**Alerts (pop-ups):**

| Alert | Rule | Where |
|---|---|---|
| ⚠ "3 bad reps in a row (Lower slower x2). Check in on them." | `badRepsInARow` hits exactly 3. It only fires once per streak, and a good rep resets the count. | `recordRep()` |
| ⚠ "hasn't done a rep in 60 s" / "hasn't started yet" | Checked every 5 s. Only for people still short of the target and online, and only once until their next rep. | `checkForStalledParticipants()` |
| ⚠ "laptop lost connection" | Socket closed while they still had reps to do | `setOnline()` |
| ⚠ "strap has a problem" / "strap was unplugged" | Strap status changed to `error` or `not-connected` during the exercise | `setStrapStatus()` |
| ✅ "finished all 8 reps (6 good)" | Rep count reaches the target | `recordRep()` |

Warning alerts also set `needsCheckIn`, which puts the red **CHECK IN** sticker on the card and moves it to the front. The sticker stays until the instructor clicks **Mark as checked**.

**Names: `cleanName()`** removes invisible control characters, squashes repeated spaces, trims, and limits the length to 30. Matching ignores case, so "sam k." and "Sam K." are the same person.
- If that person is **online**, a second person can't take the name.
- If they're **offline** (WiFi drop) or it's the **same browser** (`previousId` matches), they get their old entry back **with their reps**.

**Rep checking: `cleanRep()`** rejects non-numbers, infinities, negative values, unknown fault names, and contradictions such as "good" with faults or "bad" without any.

**Main issue: `mainIssue()`** counts each fault and returns the most common one, e.g. "Lower slower (x2)". This is shown on each card.

### Fake clock for tests
The constructor takes a `now` function. The server passes the real `Date.now`, while tests pass a fake clock they can move forward by hand. That's how the "60 seconds" rule is tested instantly.

---

## 8. Demo mode (`src/simulator.js`)

Turning on Demo mode adds up to 28 pretend people, with older-adult names to match CCCARE's participants. Twice a second, `tick()` checks whether it's anyone's turn to do a rep.

- **Personalities** make the class look realistic: steady (85–92 % good), gets tired (starts at 95 %, drops 12 % per rep), mixed (60 %), struggling (25 %, triggers check-in alerts) and stops partway (quits after 3–5 reps, triggers the "hasn't done a rep" alert).
- **Believable numbers:** `makeRep()` starts from a good rep, then breaks it to match its faults. A `SHORT_RANGE` rep gets a peak of 55–95°, a `SWING` rep gets a swing above 0.55 g, and so on.
- **Same path as real reps:** pretend reps go through `session.recordRep()`, so alerts and results behave exactly as they would for real people. They're marked `simulated: true` and show a **SIM** badge; real ones show **STRAP**.
- Turning Demo mode off removes only the pretend people.

---

## 9. The participant page (`join.js`)

### Steps on the page
1. **Name:** sends `join`. The id and name are saved in `sessionStorage`, so after a WiFi blip or page reload the page automatically rejoins as the same person.
2. **Strap:**
   - **Connect strap** uses `UsbStrap`. Chrome shows its port picker; if the user closes it, Chrome throws `NotFoundError`, which we ignore quietly.
   - **Use a pretend one** uses `PretendStrap`, which prints the same DATA lines as the Arduino. You can test the full chain, including the three-laptop setup, without hardware.
3. **Exercise:** buttons send `s` / `r` / `e` to the strap. They only enable when they make sense. For example, "Start my set" needs the exercise to be running, a strap connected, and no set already in progress.

### How the USB reading works (`UsbStrap.readLoop`)
- The page opens the port at **115200 baud**, the same speed as `Serial.begin(115200)` on the Arduino.
- `TextDecoder` turns bytes into text, and the `partial` buffer holds an incomplete line until its newline arrives.
- If more than 1000 characters arrive without a newline, that's garbage (usually a wrong baud rate), so it's thrown away.
- When the cable is pulled, `port.readable` becomes `null`. The loop ends, `onDisconnect` fires, the page shows "Strap disconnected", and it tells the server, which alerts the instructor.

### Following the strap's state
The page keeps `state.strapStatus` in step with the strap's DATA lines (`zeroing` → "Hold still…", `set-start` → "GO!", `set-end` → "Set finished", `error` → "Sensor problem"). It reports every change to the server with `strap-status`, which is what the pill on the instructor's card shows.

### When the instructor acts
- **Start exercise:** the page receives `exercise` and sends `n<target>` to the strap.
- **End exercise:** if a set is still running, the page sends `e` to the strap.

### What participants see
Their name, strap status, instructions, and **how many reps were sent**. There's no good/bad, because that's for the instructor. They still get instant feedback from the strap's green/red LED.

---

## 10. The instructor dashboard (`instructor.js`)

- **Login:** sends the PIN. On `login-ok`, the PIN is kept in `sessionStorage` so the page logs itself back in if the connection drops, and is forgotten when the tab closes.
- **Redraw from snapshots:** each `state` message replaces `classState` and calls `render()`, which rebuilds the controls, results banner, stats and cards. With at most 60 cards, rebuilding everything is fast and much simpler than updating pieces.
- **Cards** (`personCard`):
  - name and SIM/STRAP badge
  - strap pill: offline, no strap, getting ready, exercising, set done or sensor problem
  - rep count against the target
  - **one square per rep** (green/red, white for reps still to do)
  - good/bad counts and the main issue
  - "last rep X s ago", updated every 5 s by a timer, using `clockOffset` so the two laptops' clocks don't need to match
  - after the exercise, a background colour **and** a label (GOOD FORM / NEEDS WORK / DIDN'T FINISH), so colour-blind users aren't relying on colour alone
- **Sorting:** cards that need a check-in go first.
- **Pop-ups** (`showToast`): appear bottom-right, at most 4 at a time. Warnings stay 12 s and info 6 s. Clicking one opens that person's details.
- **Details dialog:** a table of every rep (peak angle, up/down time, swing, issues), plus **Mark as checked** and **Remove from class**.
- **`el()` helper:** builds page elements in code and always puts text in with `textContent`. If someone types HTML or a script tag as their name, it shows up as plain text and never runs.

---

## 11. Errors and edge cases we handle

The symposium rubric asks whether the code "handles edge cases, and checks for errors or sensor failures". Here's the list:

| Situation | What happens |
|---|---|
| Sensor not found at power-up | The strap repeats `DATA,ERROR,SENSOR_NOT_FOUND`. The join page shows "Sensor not found - check the wiring", and the instructor gets an alert if the exercise is running. |
| Wire comes loose mid-set | `DATA,ERROR,SENSOR_LOST` → "Sensor problem" pill and a check-in alert. The next rep clears the error. |
| USB cable pulled out | The read loop ends → "Strap disconnected" message and an instructor alert. |
| Serial Monitor still open (port busy) | The connect fails with a clear message telling them to close the Serial Monitor. |
| Half or garbled serial line | `parseStrapLine` returns `null`, so it's ignored and not counted. |
| Wrong baud rate / junk without newlines | The buffer is cleared after 1000 characters. |
| Browser without Web Serial (Firefox/Safari) | Connect button disabled, with "use Chrome or Edge". |
| Page not trusted (opened from another laptop's IP) | Explains Option A/B from the README. |
| Participant WiFi drops | The page reconnects automatically (1 s, 2 s, 4 s … 10 s apart), rejoins as the same person, keeps their reps, and sends any reps done while offline. The instructor sees "Laptop offline" in the meantime. |
| Laptop lid closed (no goodbye) | The heartbeat detects it within about 20 s → offline. |
| Same name twice | Refused with a friendly message. Matching ignores case and extra spaces. |
| Blank or weird name | Refused, or cleaned up. Limited to 30 characters. |
| HTML or script in a name | Shown as plain text (`textContent`), never run. |
| Page reloaded or tab duplicated | The new page takes over the same participant, and any old page still open stops with "You joined from another tab". A brand-new tab with the same name gets the duplicate-name message. |
| Rep sent before the exercise starts | Not counted, and the participant is told why. |
| Invalid or made-up rep data | Rejected by `cleanRep()`. |
| Target reps 0, 2.5, "lots", 99 | Rejected: must be a whole number from 1 to 50. |
| Wrong PIN | "Wrong PIN.", with no data sent. |
| Garbage or non-JSON message to the server | Ignored, and the server keeps running. |
| Server already running | "Port 3000 is busy" message. |
| Class full (60) | "The class is full." |
| Instructor starts a new exercise over old results | Asks for confirmation first. |

---

## 12. Testing

**Automatic tests** (`npm test`, 20 tests in `test/`):
- `strap-protocol.test.js`: good and bad reps, multiple faults, Windows `\r` line endings, ignoring normal messages, and rejecting seven kinds of damaged lines.
- `class-session.test.js`:
  - the green/red/yellow rule, including the 4–4 tie
  - name cleaning, duplicate names, reconnecting with reps kept, and the class size limit
  - reps only counted while running, and bad data rejected
  - target validation
  - the 3-in-a-row alert firing once and resetting
  - the stalled alert using the fake clock
  - results and new rounds
  - simulated reps always being valid

**Browser test:** the whole flow was run in headless Chrome:
- PIN login and joining with a pretend strap
- reps arriving live, the duplicate-name message, demo mode with 29 people
- alerts and results, with no browser console errors

**Arduino:** `curl_strap.ino` was compile-checked on a PC with stand-in Arduino headers (`g++ -Wall -Wextra`, no warnings). It still needs testing on the real board; see the checklist below.

**Real-hardware checklist (do before the symposium):**
1. Upload the sketch and open the Serial Monitor. You should see `DATA,READY` after "BMX160 found".
2. Close the Serial Monitor, then connect from the join page. The strap pill should show "Connected".
3. Start an exercise with target 3. The strap should stop after 3 reps, confirming the `n3` command.
4. Unplug the USB mid-set. The join page and dashboard should both show it.
5. Pull the sensor's SDA wire mid-set. You should see "Sensor problem" and a check-in alert.
6. Do the three-laptop setup on a phone hotspot (README).

---

## Limitations and next steps

**Limitations (worth being honest about):**
- **No database:** everything is in memory, so stopping the server loses the data. CCCARE would want history across sessions.
- **The PIN is demo-level:** it's sent over plain `http`, and there are no individual accounts. That isn't acceptable for real health data.
- **One laptop per strap,** because the strap talks over a USB cable.
- **The website trusts the strap's verdict.** Accuracy depends on `CurlTracker.h`, and the website doesn't re-check it.
- **One exercise type:** bicep curls only, with one target for the whole class.

**What a real product would add:**
1. Hosted online with **HTTPS** and real instructor logins.
2. A **database** of each participant's sessions, replacing CCCARE's paper logs (connects to Sub-Problem 1). Health data in Ontario falls under **PHIPA**.
3. **Wireless straps** (the UNO R4 WiFi or Bluetooth) sending straight to the server, with no laptop per participant.
4. **Per-person targets** from each participant's prescribed "dosage".
5. Other exercises (rows, shoulder press) with their own rules.

---

## 14. Likely symposium questions

**"How does the data get from the strap to the screen?"**
USB to the participant's browser using Web Serial, then a WebSocket over WiFi to our server, then a WebSocket out to the instructor's dashboard. See §4.

**"Why not send it straight from the Arduino over WiFi?"**
Our board might be the Minima, which has no WiFi. Campus WiFi also blocks devices talking to each other. USB is the most reliable for a live demo. Wireless is the obvious next step.

**"Can participants see each other's results?"**
No. The server only sends class data to connections that logged in with the PIN. Participants only get their own rep count.

**"What happens if someone's WiFi drops?"**
The dashboard shows them as offline and alerts the instructor. Their page keeps retrying, rejoins as the same person with their reps kept, and sends any reps done while offline.

**"How do you decide red or green?"**
The strap judges each rep against the person's reference rep. At the end, green means more than half their reps were good, red means half or more were bad, and yellow means they didn't reach the target.

**"How did you test it?"**
20 automatic tests, a scripted browser test of the full flow, a compile check of the Arduino code, plus the hardware checklist and the strap-vs-human comparison from the main README.
