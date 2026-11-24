# Curl Strap: stacked forearm box

Arduino on the bottom, breadboard on a shelf above it, lid with an OLED window and an LED window. USB-C comes out of one end.

| | Low version (`out_low`) | Tall version (`out_tall`) |
|---|---|---|
| Use with | Solid-core wires, or Dupont pins bent 90 degrees so they lie flat | Upright Dupont wires |
| Body | 97.3 x 61.5 x 41.1 mm | 97.3 x 61.5 x 61.1 mm |
| With end tabs | 137.3 mm long | 137.3 mm long |

Use the low version if you can. In the tall one the screen sits 12.9 mm below the lid (4.4 mm in the low one).

## Files in each folder
- `assembly.step`: everything in place, with stand-in electronics
- `base`, `shelf`, `lid`: `.step` to edit, `.stl` to print
- `report.txt`: the fit checks

`stacked_box.py` rebuilds it: `python stacked_box.py` or `python stacked_box.py tall`.

## Measure first
Change the number at the top of `stacked_box.py` if yours differs.
- Breadboard 83.5 x 55 x 8.5 mm (a smaller 81.3 x 50.8 one also fits)
- USB-C centre: 38 mm from the board's edge, 1.6 mm above the board. The opening is 16 x 11 mm to allow some error.
- OLED board 27.3 x 27.8 mm
- Sensor board: up to 25 x 32 mm and 5.1 mm above the breadboard
- USB port or barrel jack sticking out past the board edge: up to 2 mm

## Print
PLA, 0.2 mm layers, 3 walls, no supports. Print base and shelf as they are. The lid file is already flipped, top face down.

## Put it together
1. Take the Arduino out of its clear plastic holder. Set it on the four standoffs with USB facing the opening. Use M3 x 6 self-tapping screws or a little hot glue. Skip any screw that touches a header.
2. Plug in the six Arduino wires (3.3V, GND, SDA, SCL, D2, D3) and lead them to the far end.
3. Drop the shelf in slightly back from the USB end, then slide it toward the USB end until its tongue is in the slot. Bring the wires up through the gap.
4. Stick the breadboard on the shelf against the USB end.
   - Sensor at the USB end
   - OLED in the middle: pins in columns 14 to 17, row i, with the board reaching over the centre gap
   - LEDs at the far end, bent flat under the small window (around columns 23 to 28)
   - Put hot glue on the sensor's pins so it can't move
5. Drop the lid in the same way, slide it to the USB end, and fit two M3 x 8 screws at the far end. Tape over the lid works if you have no screws.
