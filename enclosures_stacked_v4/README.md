# Curl Strap: stacked forearm box v4

v3 without the LED window. The lid's only opening is the OLED window, plus two screw holes. No tabs, overhangs or stitching holes. Two 20 mm Velcro straps pass through tunnels in the floor.

| | v4 low | v4 tall |
|---|---|---|
| Wires | Flat or bent | Upright Dupont |
| Size | 97.3 x 61.5 x 45.3 mm | 97.3 x 61.5 x 65.3 mm |

The base and shelf are identical to v3's. If you have printed those, print only `lid.stl`.

## Files
- `out_low`, `out_tall`: `assembly.step`, then `base`, `shelf` and `lid` as `.step` (edit) and `.stl` (print), and `report.txt` (fit checks)
- `wiring_schematic` (`.png`, `.svg`): what connects to what
- `wiring_breadboard` (`.png`, `.svg`): which hole each wire goes in
- `stacked_box_v4.py`: rebuilds the CAD (`python stacked_box_v4.py` or `... tall`)
- `wiring_v4.py`: checks the wiring for shorts and redraws it

## Wiring (no LEDs)
Four wires come up from the Arduino:

| Arduino | Breadboard |
|---|---|
| 3.3V | Top + rail |
| GND | Top - rail |
| A4 (SDA) | Column 22, row h |
| A5 (SCL) | Column 23, row h |

Then on the breadboard, using row j for the sensor and OLED:

| From | To |
|---|---|
| BMX160 VCC, CSB | Top + rail |
| BMX160 GND, SDO | Top - rail |
| BMX160 SDA / SCL | Column 22 / column 23 |
| OLED VCC / GND | Top + rail / top - rail |
| OLED SDA / SCL | Column 22 / column 23 |

Leave INT1 and INT2 empty. Match the labels on your boards, because pin order varies. Power the OLED from 3.3V, not 5V: it shares its data wires with the sensor. The firmware doesn't need changing.

## Strap it on
1. Use two straps up to 20 mm wide and about 2 mm thick. Thread them through the tunnels first.
2. Put the sleeve on, set the box on top, and close each strap. Snug, not tight, with no Velcro on skin.
3. Stick thin foam along the two long bottom edges so the flat base doesn't rock.
4. Tape or Velcro the USB cable to the sleeve a few centimetres past the plug, with a slack loop at the elbow.

## Measure first
Change the number at the top of `stacked_box_v4.py` if yours differs.
- Breadboard 83.5 x 55 x 8.5 mm (a smaller 81.3 x 50.8 one also fits, but check it has power rails)
- USB-C centre: 38 mm from the board's edge, 1.6 mm above the board. The opening is 16 x 11 mm.
- OLED board 27.3 x 27.8 mm
- Sensor board: up to 25 x 32 mm and 5.1 mm above the breadboard
- USB port or barrel jack sticking out past the board edge: up to 2 mm

## Print
PLA, 0.2 mm layers, 3 walls, no supports. The tunnel roofs are 22 mm bridges, so keep the cooling fan on. The lid file is already flipped, top face down.

## Put it together
1. Wire it and test it outside the box first.
2. Take the Arduino out of its clear plastic holder. Set it on the four standoffs with USB facing the opening. Use M3 x 6 self-tapping screws or a little hot glue. Skip any screw that touches a header.
3. Plug in the four Arduino wires and lead them to the far end.
4. Drop the shelf in slightly back from the USB end, then slide it toward the USB end until its tongue is in the slot. Bring the wires up through the middle of the gap.
5. Stick the breadboard on the shelf with column 1 at the USB end, then connect the wires. Hot-glue the sensor's pins.
6. Test again, then drop the lid in, slide it to the USB end, and fit two M3 x 8 screws at the far end. Tape works if you have no screws.
