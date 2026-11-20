# MASTER PROMPT: ECE198 one-box enclosure (v2)

TASK: Make one 3D-printable enclosure that holds the WHOLE bicep-curl tracker: the Arduino and the breadboard, with the IMU plugged into the breadboard. Output STEP files (for Onshape) and STL files (for WATiMake). Don't ask questions unless truly blocked. Keep replies short. Don't web search.

## Electronics (all inside the one box)
- Arduino UNO R4 Minima: 68.85 x 53.34 PCB, 1.6 thick. USB-C on the x=0 edge, centre y≈38, sitting on the PCB (VERIFY). It is powered by a laptop over USB-C and stays plugged in the whole time.
  Mounting holes Ø3.2 at (13.97,2.54) (15.24,50.8) (66.04,7.62) (66.04,35.56) (VERIFY). Tallest part: barrel jack, 11 mm (not used, so no cutout). Headers 8.5 mm. Solder pins stick out 2-3 mm below the board.
- Breadboard: frameless terminal strip, 81.3 x 50.8 x 8.5 (VERIFY), sticky back.
- IMU (BMX160 breakout, size unknown, about 20x13 up to 27x32): plugged into the breadboard by its header pins. Jumper wires on the breadboard bring it 3.3V/5V and GND from the Arduino's power header, plus SDA and SCL. So the IMU is powered by the Arduino, and the Arduino is powered by USB.
- 2 LEDs (5 mm) plus 470 Ω resistors, also on the breadboard.
- The IMU must move with the forearm, so the whole box is worn on the forearm, sewn or glued onto a cut-up sock. The USB-C cable runs from the box to the laptop. Nothing must rattle: the breadboard is stuck down, and the IMU gets a dab of hot glue at its pins.

## Box
- Arduino and breadboard side by side along the long axis, with a 5 mm gap between them. The Arduino's USB edge sits against one short wall.
- 4 standoffs: 5 tall, 6 OD, 2.8 pilot holes for M3 self-tapping screws. Screws are optional.
- USB-C cutout: 14 x 9, centred on the port.
- Breadboard on the flat floor, with a low locating rib in the gap and a rail on its open side.
- Inner height 38 (tallest part is the Dupont plugs on the Arduino headers, top at about 31).
- Walls 2.4, floor 2, outside corners rounded 2, +0.5 clearance per side around each part, 0.3 per side for sliding fits.
- Slide lid in grooves in the two long walls (groove 1.2 deep; lid 2 thick; 0.25 vertical / 0.3 side clearance). Lid enters from the breadboard end, which is cut down to the groove; the USB end stops it. Finger-grip grooves in the lid top, a small click bump underneath, and a 70 x 15 LED window over the breadboard.
- No cable notch and no zip-tie holes: there are no wires between boxes any more.
- Sock mount: a flat base flange 8 mm wide along both long sides, 2 thick, with Ø2 stitching holes every 6 mm. It is the parameter MOUNT_FLANGE (True by default; set False for a table-only box).
- FDM PLA, 0.2 mm layers, bed ≥ 200 x 200.

## Build
- One CadQuery script (`enclosures/enclosures.py`) with every dimension as a named, commented parameter at the top, VERIFY items flagged. Reuse the existing v1 helper code; delete everything for the pod and the cable notch.
- Parts: box_base and box_lid. Export STEP and STL for each, plus box_assembly.step with the lid closed. The lid STL is flipped top-down for printing.
- Fit checks by intersection volume: PCB, USB-C receptacle and plug overmold, barrel jack, headers and Dupont plugs, breadboard, IMU and its jumpers, LEDs, the closed lid, and the lid slid out at several positions.
- PNGs: iso (lid partly open), iso x-ray with ghost parts, top, a section through the grooves, a section through the USB port. Look at them.
- Print an outside-dimension table. Clear the old v1 outputs from out/.

## Deliver
The file list, a 1-line print tip per part, the Onshape note (Import → STEP, then Move/Offset face), and the VERIFY/assumption list. Short.

## v3 changes
- Breadboard is a half-size one with power rails (30 rows): 83.5 x 55 x 8.5 (VERIFY).
- Add a 0.96" I2C OLED (27.3 x 27.8) plugged into the breadboard with its display facing up. It must sit over the breadboard, not hang off the edge.
- The lid window grows to 74 x 40 over the breadboard so the OLED and the LEDs both show. A screen can't hang under a sliding lid, because it would hit the entry wall.
- Box height 35 mm total (floor 1.6, standoffs 3.5, lip 1.0), leaving about 2.3 mm above the Dupont plugs on the Arduino headers.
- Take the Arduino out of its clear acrylic bumper so it sits on the standoffs.
