# Curl Strap: step-by-step guide

A strap on the forearm that counts bicep curls and tells you whether each rep was good.

- **Hardware:** Arduino UNO R4 and a BMX160 motion sensor.
- **Control:** you type single letters on your laptop.
- **Results:** they appear on screen, and the Arduino's small built-in LED flashes for each rep.

---

## 0. What you need

| Item | Notes |
|---|---|
| Arduino UNO R4 (Minima or WiFi) | |
| BMX160 sensor board | |
| USB-C cable | The UNO R4 uses USB-C. It must be a data cable, not a charge-only one. |
| 4 jumper wires, male to female | Male end into the Arduino, female end onto the sensor's pins. Use the longest you have (20–30 cm or more), because the sensor goes on the arm and the Arduino stays on the table. |
| Strap material | Velcro strap, elastic band, sweatband, or tape |
| Laptop | Must have the Arduino IDE |

**Which UNO R4 do you have?** Look at the board.
- **UNO R4 WiFi:** has a grid of tiny red LEDs (a 12×8 matrix) and a metal-shielded WiFi module.
- **UNO R4 Minima:** has neither.

You'll pick the matching name in step 4.

---

## 1. Get the files onto your computer

1. Save **`CurlStrap.zip`** to your computer, for example in **Downloads**.
2. Open File Explorer, **right-click `CurlStrap.zip` → Extract All… → Extract**. This creates a normal folder called `CurlStrap`.
   - Opening the zip by double-clicking isn't enough. The Arduino IDE can't open files from inside a zip.
3. Optionally, move the `CurlStrap` folder somewhere easy to find, such as **Documents**. Every teammate can do the same on their own laptop.

Inside you'll find:

| File | What it is |
|---|---|
| `hardware_setup.svg` | **Wiring diagram.** Double-click to open it in your web browser. |
| `README.md` | This guide. |
| `curl_strap/curl_strap.ino` | **The program you upload.** It talks to the sensor, reads your typed commands, prints results and flashes the LED. |
| `curl_strap/CurlTracker.h` | **The rep logic.** It works out the angle, decides when a rep starts and ends, and judges it. It must stay in the same folder as `curl_strap.ino`. |
| `test/test_curl.cpp` | Optional PC test with simulated curls (see step 11). Not uploaded to the Arduino. |

> **Folder rule:** the Arduino IDE requires a sketch's folder to have the same name as its `.ino` file. Keep the folder named `curl_strap`, with `curl_strap.ino` and `CurlTracker.h` inside it.

---

## 2. Install the Arduino IDE (skip if already done)

On this laptop, **Arduino IDE 2 and the UNO R4 board package are already installed**, so you can skip to step 3.

On another computer:
1. Download the Arduino IDE from <https://www.arduino.cc/en/software> and install it.
2. Open it and click the **Boards Manager** icon on the left (second from the top, it looks like a circuit board).
3. Search for **UNO R4** and install **"Arduino UNO R4 Boards"**.

No extra libraries are needed. The code talks to the BMX160 directly.

---

## 3. Wire the sensor (with the USB cable unplugged)

**Open `hardware_setup.svg`** (double-click it). It shows every wire, where each pin is on the Arduino, and how the strap is worn. The details are below.

The BMX160 uses **I2C**, which needs only 4 wires: power, ground, a clock line (SCL) and a data line (SDA).

### Where the pins are on the Arduino
- **5V, 3.3V and GND** are on the power header, the bottom-left row when the USB port faces left.
- **SDA and SCL** are on the top header, on the far end past pin 13, GND and AREF. They are labelled **SDA** and **SCL** on the board.
- **A4 and A5** are the same signals (A4 = SDA, A5 = SCL), so you can use those pins instead.

### Connections

| BMX160 pin (label may vary) | Arduino UNO R4 pin |
|---|---|
| **VCC / VIN / +** | **5V** or **3.3V**, see the power note below |
| **GND / −** | **GND** (any GND pin) |
| **SCL / C** | **SCL** (or A5) |
| **SDA / D** | **SDA** (or A4) |

Leave any other pins on the sensor (INT, SDO, CS and so on) unconnected.

### Power: which pin?
Check the sensor's label or the shop page.
- **Says "3.3V–5V"** (DFRobot "Gravity" boards do): connect VCC to **5V**.
- **Says "3.3V" only:** connect VCC to **3.3V**. Never connect a 3.3V-only board to 5V; that can destroy it.
  - Some 3.3V boards don't talk reliably to the UNO R4, which runs at 5V. If the program later says *"BMX160 not found"* and the wiring is correct, this is the likely cause.
  - Fix with an R4 WiFi: use its small **Qwiic** connector, which runs at 3.3V. In `curl_strap.ino`, change `#define SENSOR_WIRE Wire` to `#define SENSOR_WIRE Wire1`.
  - Fix with a Minima: put an I2C level shifter between the board and the sensor.

### The I2C address select switch or pad
Every I2C device has an address. The BMX160 can be **0x68** or **0x69**, and the address select switch or solder pad picks between them.

**Leave it however it is.** The program tries both addresses and tells you which one it found. The setting only matters if another sensor on the same wires uses the same address.

---

## 4. Upload the program to the Arduino

1. Plug the Arduino into the laptop with the USB-C cable. The green power LED (ON) lights up.
2. Open the Arduino IDE. Go to **File → Open…** and select `curl_strap.ino` inside the `curl_strap` folder.
   - Two tabs appear at the top: `curl_strap.ino` and `CurlTracker.h`.
3. Choose the board: **Tools → Board → Arduino UNO R4 Boards →** pick **Arduino UNO R4 Minima** or **Arduino UNO R4 WiFi**.
4. Choose the port: **Tools → Port →** pick the COM port that mentions the UNO R4, for example `COM5 (Arduino UNO R4 Minima)`.
   - **Nothing listed?** Try another USB cable (some only charge) or another USB port.
5. Click **Upload**, the round button with a **→** arrow at the top-left.
   - The IDE first compiles (turns the code into machine instructions), then sends it to the board.
   - The bottom panel ends with something like *"Done uploading"* or *"Verify successful"*. The board then restarts and runs the program by itself.

> **If the upload fails:** double-press the small **RESET** button on the Arduino quickly. The orange "L" LED should start fading in and out, which is upload mode. Then click Upload again. The COM port number may change, so re-check **Tools → Port**.

---

## 5. Open the Serial Monitor (your control screen)

The Serial Monitor is a text window that shows what the Arduino prints and lets you type commands to it.

1. Click the **magnifying glass** icon at the top-right of the IDE, or go to **Tools → Serial Monitor**. A panel opens at the bottom.
2. In that panel's right-hand dropdowns, set the speed to **115200 baud**. Leave the line ending at the default ("New Line").
3. Press the **RESET** button on the Arduino once, so you see the start-up messages from the beginning.

You should see:
```
=== Curl Strap ===
BMX160 found at address 0x68

Commands (type a letter, then press Enter):
  s = start a set (let the arm hang straight down and still)
  r = record the NEXT rep as this patient's reference rep
  e = end the set
  p = live angle graph on/off (open Tools > Serial Plotter)
  i = show current targets
  h = show this help

Type s and press Enter to start a set.
```

- **Garbled symbols?** The speed isn't 115200.
- **"BMX160 not found" or a fast-blinking orange LED?** See **Troubleshooting** below. The message also lists every device it *did* find on the wires, which helps narrow down the problem.

**To send a command:** click the text box at the top of the Serial Monitor panel ("Message (Enter to send…)"), type the letter, and press **Enter**.

---

## 6. Put the strap on

- **Where:** on the **forearm, about a hand-width below the elbow**, on the top or outer side, wherever it sits flat and doesn't press into the bend of the elbow.
  - Near the elbow is better than near the wrist, because the sensor gets thrown around less during the movement.
- **Which way up:** it doesn't matter. The program measures everything relative to the arm's own starting position.
- **Tightness:** snug, so it can't wobble or slide. A loose sensor gives jumpy readings.
- **Wires:** run them up the arm and to the table so they don't tug on the sensor during a curl. Tape them to the upper arm if needed.

---

## 7. Do a set

1. **Type `s` and press Enter.** You'll see:
   ```
   GET READY: let the arm hang straight down and keep it still...
   ```
2. **Let the arm hang straight down by your side, relaxed, and keep still.** Holding the dumbbell is fine.
   - After about half a second of stillness it prints `GO!`, plus the targets for this set.
   - While the arm is still, the program records where "straight down" is for this person and how this sensor drifts at rest.
   - If it keeps saying *"still moving"*, relax the arm and keep it fully still.
3. **Curl.** After each rep (up, then back down) you'll see a result like this:
   ```
   Rep 1: GOOD
      peak 134 deg | up 0.73 s | down 1.15 s | swing 0.10 g
   Rep 2: NEEDS WORK - Lower slower
      peak 134 deg | up 0.73 s | down 0.24 s | swing 0.75 g
   ```
   (These numbers are from the simulation; yours will differ.)
   - **LED feedback:** after a good rep the orange **L** LED stays on for 1 second. After a rep that needs work it blinks 3 times quickly.
4. **Type `e` and press Enter** to end the set:
   ```
   SET FINISHED: 10 reps, 8 good (80%)
   ```
5. Type `s` to start the next set. Remember to let the arm hang still again first.

### What the numbers mean

| Field | Meaning |
|---|---|
| **peak** | The highest forearm angle in the rep. 0° = hanging straight down, ~90° = forearm horizontal, ~140° = a full curl. |
| **up** | Seconds from the bottom until the forearm reached the top. |
| **down** | Seconds from leaving the top until back at the bottom. Holding at the top doesn't count as lowering. |
| **swing** | How much extra acceleration there was beyond gravity, in g. Slow, controlled reps are about 0.1; heaving the weight up with momentum is 0.5 or more. |

### How a rep is judged

| Check | Default target | Message if it fails |
|---|---|---|
| Curled high enough | peak ≥ 110° | **Curl higher** |
| Lowered with control | down ≥ 1.0 s | **Lower slower** |
| No momentum or swinging | swing ≤ 0.35 g | **Don't swing** |
| Lifted with control | up ≥ 0.5 s | **Lift slower** |

A rep is **GOOD** only if it passes all four checks. If several fail, the most important one is shown, in the order above.

**When a rep counts:**
- A rep starts when the forearm rises past 30° and ends when it comes back below 20°.
- Movements that don't go past 45° are ignored, so scratching your nose or shifting the weight isn't counted.

**Type `i`** at any time to see the current targets.

---

## 8. Record a reference rep (personal targets)

Everyone's "good rep" is different. A stroke patient may only manage 90°, and that's correct for them. Use the reference rep to set targets for each person.

1. Start a set (`s`, arm still, wait for `GO!`).
2. **Type `r` and press Enter.**
3. The patient does **one rep the way the kinesiologist wants it.** It's not counted in the set; it prints `REFERENCE REP SAVED` and the new targets:

   | Target | Set to |
   |---|---|
   | Peak angle | at least the reference peak minus 15° |
   | Up time | at least half of the reference |
   | Down time | at least 60% of the reference |

4. Carry on with the set. Every rep is now judged against this person's own reference.

The reference is kept until you record a new one or the Arduino is reset or unplugged.

---

## 9. Watch the angle live (optional, good for demos)

1. While a set is running, type **`p`** and press Enter.
2. Open **Tools → Serial Plotter**. It shows a live graph:
   - `angle`: the forearm angle, going up and down with each curl.
   - `target`: a flat line at the target height. Good reps go above it.
3. Type **`p`** again to turn the graph off. While it's on, the number stream also fills the Serial Monitor.

---

## 10. Troubleshooting

| Problem | What to do |
|---|---|
| No COM port in Tools → Port | Use a different USB-C cable (data, not charge-only) or USB port. Double-press RESET and look again. |
| Upload fails | Check Tools → Board matches your board (Minima vs WiFi). Double-press RESET (L LED fades in and out), re-pick the port, upload again. |
| Serial Monitor shows nothing | Set 115200 baud, then press the RESET button on the Arduino. |
| `BMX160 not found` and fast-blinking L LED | Unplug USB. Check all 4 wires: VCC→5V/3.3V, GND→GND, SDA→SDA, SCL→SCL, not swapped. Make sure the female ends are fully on the sensor pins. Plug back in. |
| Device list says `(none)` | No power or no connection. Check VCC and GND first. |
| A device is listed, but it's not 0x68/0x69 | You may have something else wired, or a different sensor. Tell us the address shown. |
| 3.3V-only sensor never found | See the power note in step 3: R4 WiFi Qwiic connector or a level shifter. |
| `ERROR: lost contact with the BMX160` | A wire came loose during movement. Use longer wires and tape them down so they don't pull. |
| Stuck at "still moving" | Let the arm hang fully relaxed. Make sure the strap isn't wobbling. Resting the hand against the thigh helps. |
| Reps not counted | The curl must go above 45° and come back below 20°. Type `p` and look at the plotter to see what angle you're reaching. Restart the set with the arm hanging straight. |
| Good reps marked "Curl higher" | Record a reference rep (`r`), or lower the default `targetPeak` (step 12). |

---

## 11. Optional: run the simulation tests on a PC

`test/test_curl.cpp` feeds realistic fake sensor data through the rep logic. That data includes:
- the forearm's physics
- the strap mounted at an odd angle
- the wrist twisting
- sensor noise and gyro drift

It checks 10 situations: good reps, half reps, dropping the weight, holding then dropping, swinging, fidgeting, a patient with limited range plus a reference rep, a 24-second slow rep, and the strap worn at the wrist.

With a C++ compiler such as g++, run these from the project folder (the one with `curl_strap` and `test` inside):
```bash
g++ -O2 -std=c++17 test/test_curl.cpp -o test_curl
./test_curl
```
It should end with `ALL TESTS PASSED`. This tests the logic only; it doesn't need the Arduino.

---

## 12. Changing the targets and settings

The default targets are in `CurlTracker.h`, in the `Settings` block near the top:
```cpp
float targetPeak = 110.0f;  // deg: must reach this for full range
float minLiftSec = 0.5f;    // s
float minLowerSec = 1.0f;   // s
float maxSwingG = 0.35f;    // g
```
Change a number, save, and **Upload** again. These are starting guesses; tune them after trying real curls.

---

## 13. How it works (for your presentation)

1. **Sensor:** the BMX160 has an **accelerometer**, which feels gravity and movement, and a **gyroscope**, which measures how fast it's rotating. The program reads both 100 times a second.
2. **Starting position:** when the arm hangs still, the program records which direction "down" (gravity) is from the sensor's point of view. That's 0°.
3. **Tracking the angle:** as the arm curls, the gyroscope tracks how the sensor rotates, which stays accurate even during quick movement.
   - The gyroscope slowly drifts on its own, so the accelerometer gently corrects it whenever the arm isn't accelerating much.
   - Combining the two like this is called a **complementary filter**.
   - The forearm angle is the angle between "down" now and "down" at the start.
4. **Strap orientation and wrist twist:** because everything is relative to the person's own starting position, it doesn't matter how the strap is put on. Turning the palm up during the curl doesn't affect the reading either.
5. **Counting and judging:** each rep is detected from the angle and judged on range, lifting speed, lowering speed and swinging, against default or personal targets.

**What one strap can't see:** the rest of the body. It can't tell whether the back arches or the elbow drifts forward. Say this honestly in your presentation, and mention a second strap on the upper arm as a next step.

---

## 14. Before the symposium: prove it works

1. Each teammate does about 20 curls with the strap on. Do some properly and some wrong on purpose (half reps, dropping the weight, swinging).
2. A teammate writes down, without looking at the screen, whether each rep was good or bad.
3. Compare their notes with the strap's results, and report the agreement, for example "the strap agreed with a human observer on 92% of 60 reps."

That one number is the strongest evidence you can show.
