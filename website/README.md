# CCCARE Rep Monitor (instructor website)

A live dashboard for the curl strap. Each participant's strap sends every rep to one screen, so a single instructor can watch a whole class (CCCARE has up to 30 people per instructor). They can see who has hit their target, how many reps were good or bad, and who needs a check-in. When the exercise ends, everyone is coloured **green** (mostly good), **red** (mostly bad) or **yellow** (didn't reach the target).

> Want to understand the code in depth? Read **[HOW_IT_WORKS.md](HOW_IT_WORKS.md)**.

---

## Quick start (one laptop)

1. Install **Node.js** (LTS) from <https://nodejs.org>.
2. In a terminal, from this `website` folder:
   ```
   npm install
   npm start
   ```
3. Open **Google Chrome** or **Microsoft Edge**:
   - Instructor: <http://localhost:3000/instructor>. The PIN is **1234**; change it in `src/config.js`.
   - Participant: <http://localhost:3000/join>, in a second tab.
4. On the join page, type a name and then either:
   - plug in the strap and click **Connect strap**, picking the Arduino in the list, or
   - click **No strap? Use a pretend one** to test without hardware.
5. On the dashboard, set **Target reps**, click **Start exercise**, then click **Start my set** on the join page.

> Close the Arduino IDE's **Serial Monitor** first. Only one program can use the strap's USB port at a time.

Run the tests with `npm test`.

---

## Symposium demo (1 instructor laptop + 2 participant laptops)

```
 Participant laptop 1          Participant laptop 2
 [strap]--USB-->Chrome          [strap]--USB-->Chrome
         \                            /
          \----- same phone hotspot -/
                      |
            Instructor laptop: npm start
            dashboard + server + Demo mode
```

### Before the day
1. **Use a phone hotspot, not eduroam.** Campus WiFi usually blocks laptops from talking to each other. Connect all three laptops to one teammate's hotspot.
2. On the **instructor laptop**, run `npm start`. The terminal prints an address for the other laptops, such as `http://192.168.43.10:3000/join`.
3. When Windows asks about the firewall, **allow Node.js**. Tick both Private and Public, because hotspots often count as "Public".
4. Upload the updated `curl_strap.ino` to both straps. It prints the `DATA,...` lines the website reads.

### Making USB work on the participant laptops
Chrome only lets a page use USB if the page is "trusted": `localhost` or `https`. A page opened from the instructor laptop's address isn't trusted by default. Pick one of these options:

**Option A (easiest): tell Chrome to trust the instructor laptop.** Do this once per participant laptop.
1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (in Edge, `edge://flags/#unsafely-treat-insecure-origin-as-secure`).
2. Type the instructor address **without** `/join`, e.g. `http://192.168.43.10:3000`.
3. Set it to **Enabled**, then click **Relaunch**.
4. Open `http://192.168.43.10:3000/join`.

The hotspot can give the instructor laptop a different address next time. If it does, update the flag.

**Option B (backup): run a copy of the website on the participant laptop.**
1. Copy this `website` folder to the participant laptop, then run `npm install` and `npm start` there.
2. Open `http://localhost:3000/join`. Pages on `localhost` are trusted.
3. Open **Advanced: instructor laptop address**, type the instructor address (e.g. `192.168.43.10:3000`), and click **Use this address**.

Test the whole setup the day before.

### Running the demo
1. Instructor: open the dashboard, set the target (e.g. 8), and turn on **Demo mode** to add 28 pretend participants.
2. Participants: join with their names and connect their straps.
3. Instructor: click **Start exercise**. Participants click **Start my set**, let the arm hang still until **GO**, then curl.
4. Watch the cards and pop-ups ("3 bad reps in a row", "hasn't done a rep in 60 s").
5. Click **End exercise** to show the green/red/yellow results. Click any card to see each rep's numbers.

---

## Project context (for future reference)

**Problem (CCCARE Sub-Problem 2):** one instructor supervises 10–30 participants, so they can't see who completed their dose or whose form is slipping.

**Decisions made with the team (Nov 2026):**

| Topic | Decision |
|---|---|
| Strap → website | USB cable to the participant's laptop. Chrome/Edge reads it with **Web Serial**, and the page forwards reps to the server. Works with the UNO R4 Minima and WiFi. |
| Hosting | A local Node.js server on the instructor laptop, which works offline at the symposium. A real product would be hosted online with HTTPS and proper logins. |
| Arduino output | `curl_strap.ino` prints one `DATA,...` line per event as well as its normal messages. New `n<number>` command so the strap's set length matches the instructor's target. |
| Privacy | The instructor page needs a PIN, and participants only see their own rep count, never good/bad results. |
| Target reps | One target for the whole class, set by the instructor (1–50). |
| Final colours | Green = more than half good. Red = half or more bad. Yellow = didn't reach the target. |
| Demo | Demo mode adds 28 pretend participants with different behaviours, mixed in with the real straps. |
| Style | Neo-brutalism in CCCARE logo colours (deep blue `#1d6fb8`, navy `#0b3a63`, sky `#8ccff0`, lime `#d6e04b`). |

**Settings** (PIN, alert timings, limits) are all in `src/config.js`.

**Limitations:** there's no database, so data disappears when the server stops. The PIN is a demo-level lock, not real security. Each strap needs a laptop. More detail in [HOW_IT_WORKS.md](HOW_IT_WORKS.md#limitations-and-next-steps).
