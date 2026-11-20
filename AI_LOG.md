# AI Use Log

ECE 198 allows AI use with disclosure. This log records each task done with an AI assistant: what we asked, what it produced, and which files changed. The git history (`git log`) shows the code as it developed.

**Tool:** Claude Code (Anthropic), model Claude Opus 5.5, run in the terminal on a team member's laptop.

---

## 2026-11-20: Clone the repo
- **Asked:** clone `github.com/amar2g/ece198`.
- **Done:** cloned the repo locally and listed its contents.
- **Files:** none changed.

## 2026-11-20: Plan the instructor website
- **Asked:** build a website for the instructor overseeing ~30 participants. It should show each person's reps against a target (e.g. 8) and how many were good or bad, highlight people red/green when the exercise ends, give participants a way to enter their name and send the Arduino's data to the site, and use a neo-brutalist UI in CCCARE colours. We asked the AI to read the repo and our course documents (project overview, symposium info, dosage and exercise docs) and to ask questions before starting.
- **Done:** the AI read the code and documents, then asked questions. We decided:
  - USB + browser (Web Serial) for strap data, and a local Node.js server
  - a machine-readable `DATA` line from the Arduino
  - a PIN for the instructor, and one class target
  - green/red/yellow results
  - a demo simulator with pop-up alerts
  - one instructor laptop plus two participant laptops for the demo
- **Files:** none changed.

## 2026-11-20: Build the website and Arduino data output
- **Asked:** start building, with readable code and simple comments, and a README for future context. Keep it from looking bloated, and put the detailed explanation in a separate document. Keep the `n<reps>` command and the pretend strap; drop the other extras the AI had added unprompted (PIN lockout, extra Arduino status lines).
- **Done:**
  - Arduino: added `DATA,...` lines for each event (ready, set start, rep, reference rep, set end, errors) and an `n<number>` command to set reps per set. The existing messages are unchanged. Compile-checked on a PC.
  - Server (Node.js, Express, WebSockets): class session with lobby/running/finished phases, rep validation, check-in alerts (3 bad reps in a row, no reps for 60 s, strap or laptop problems), final green/red/yellow results, PIN-protected instructor data, reconnect handling, and a demo simulator with 28 pretend participants.
  - Pages: home page; participant join page (name, USB strap or pretend strap, start/end set); instructor dashboard (controls, live cards, pop-ups, rep details, results). Neo-brutalist CSS in CCCARE colours.
  - Tests: 20 automatic tests (`npm test`), plus a scripted headless-Chrome run of the full flow.
  - Docs: `website/README.md` (setup, three-laptop demo, decisions) and `website/HOW_IT_WORKS.md` (detailed walkthrough).
  - Along the way: on request, the AI trimmed features it had added without being asked and shortened its comments. Browser testing found and fixed two visual bugs (pop-ups covering the top bar, invisible status text) and a confusing duplicate-name message.
- **Files:** `curl_strap/curl_strap.ino`, `website/` (all files), `AI_LOG.md`, `README.md` (link to the website).
- **Commits:** `85c6e21`, `4482853`, `f9addd7`, `8313c47`, `6b23da0` (docs).

## 2026-11-20: Reference rep step, sets, help button, faster check-ins
- **Asked:**
  - make it clearer that the reference rep worked: a prompt to record it, then green "you're ready" text
  - the instructor should see whose reference rep is ready, with a way to hold everyone until they're ready ("or is that bad?")
  - show how many sets there are, with a reference rep once per exercise rather than per set
  - make checking someone off faster (Enter marks them checked and closes the popup)
  - asked the AI to ask questions first. Unsure which options suit CCCARE's older participants, we asked for its reasoning, and also asked about a "something's wrong" button and starting only the people who are ready.
- **Decided (after discussion):**
  - the instructor decides when to start, never automatic, so one broken strap can't block the class
  - anyone ready can begin once started, and latecomers start when ready
  - each participant starts their own next set
  - no reference rep = judged with default targets, with a NO REF badge
  - one big "I need help" button rather than a menu
  - keep the 60 s no-rep alert (not 30 s, to avoid alarm fatigue), and allow 2 min of rest between sets
- **Done:**
  - Join page: guided reference-rep step ending in "✓ Reference saved - you're ready!"; Start locked until the instructor starts; "Set 1 of 2" progress with rest prompts; help button.
  - Dashboard: sets input; plan shown to participants before starting; ready counter; REF ✓/NO REF badges; "not ready" warning with names; "everyone ready" pop-up; one row of rep squares per set; reference numbers in the person popup; Enter = checked + close.
  - Server/logic: sets, reference reps, help requests, rest-aware alerts.
  - Demo mode: references, sets, rests, and occasional help requests.
  - 27 tests pass, and the new flow was verified in headless Chrome. Testing found and fixed two bugs: the pretend strap kept making reps after a reference rep, and "Set done" carried over into the next exercise.
- **Files:** `website/src/class-session.js`, `website/src/config.js`, `website/src/simulator.js`, `website/server.js`, `website/public/join.html`, `website/public/js/join.js`, `website/public/instructor.html`, `website/public/js/instructor.js`, `website/public/js/strap-connection.js`, `website/public/css/style.css`, `website/test/class-session.test.js`, `website/README.md`, `website/HOW_IT_WORKS.md`, `AI_LOG.md`.
- **Commits:** `551315b` (code), `fee514d` (docs).

## 2026-11-20: OLED screen on the strap
- **Asked:** a teammate wired a small OLED screen to SDA/SCL (A4/A5). Show the reps on it. We said it's the 0.96″ OLED and chose the AI's suggested layout. Ignore the LEDs, since they already work.
- **Done:**
  - Added optional SSD1306 128×64 support to `curl_strap.ino` using the Adafruit SSD1306 library. Screens: "Curl Strap starting…", "Ready", "Hold still…", "GO!", "Rep 3/8" with GOOD or the fix needed (e.g. "Lower / slower"), "Reference saved!", "Set done 6/8 good", "Sensor problem!", and "Sensor not found".
  - The screen only redraws after events, never mid-rep, so the ~25 ms redraw doesn't delay sensor readings. I2C stays at 400 kHz for the sensor.
  - The code tries addresses 0x3C and 0x3D, and the strap works normally with no screen.
  - Compile-checked on a PC with a fake screen that verified every line of text fits on the 128×64 display. Not yet tested on the real board.
  - README: library install step, screen wiring, what it shows, and troubleshooting.
- **Files:** `curl_strap/curl_strap.ino`, `README.md`, `AI_LOG.md`.
