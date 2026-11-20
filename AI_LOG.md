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
- **Commits:** `c4bc626`, `4d4c98d`, `8085411`, `4e8fa90`, plus the docs commit.
