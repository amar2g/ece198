# Curl Strap: stacked forearm box v3

v2 with the USB tab removed. The base is a plain box, held on by two 20 mm Velcro straps through tunnels in the floor.

| | v1 low | v2 low | v3 low | v3 tall |
|---|---|---|---|---|
| Wires | Flat or bent | Flat or bent | Flat or bent | Upright Dupont |
| Length | 137.3 mm | 113.3 mm | 97.3 mm | 97.3 mm |
| Width | 61.5 mm | 61.5 mm | 61.5 mm | 61.5 mm |
| Height | 41.1 mm | 45.3 mm | 45.3 mm | 65.3 mm |
| Strap slots | None | Two, 22 x 3 mm | Two, 22 x 3 mm | Two, 22 x 3 mm |

The lid and shelf are the same as v1's and v2's of the same height. If you have printed those, print only `base.stl`.

## Files in `out_low` and `out_tall`
- `assembly.step`: everything in place, with stand-in electronics and straps
- `base`, `shelf`, `lid`: `.step` to edit, `.stl` to print
- `report.txt`: the fit checks

`stacked_box_v3.py` rebuilds it: `python stacked_box_v3.py` or `python stacked_box_v3.py tall`.

## Strap it on
1. Use two straps up to 20 mm wide and about 2 mm thick.
2. Thread each strap through its tunnel before putting the box on.
3. Put the sleeve on, set the box on top, and close each strap around the arm. Snug, not tight, with no Velcro on skin.
4. Stick thin foam along the two long bottom edges so the flat base doesn't rock.
5. Tape or Velcro the USB cable to the sleeve a few centimetres past the plug, with a slack loop at the elbow. Nothing on the box holds the cable.

## Measure first
Change the number at the top of `stacked_box_v3.py` if yours differs.
- Breadboard 83.5 x 55 x 8.5 mm (a smaller 81.3 x 50.8 one also fits)
- USB-C centre: 38 mm from the board's edge, 1.6 mm above the board. The opening is 16 x 11 mm.
- OLED board 27.3 x 27.8 mm
- Sensor board: up to 25 x 32 mm and 5.1 mm above the breadboard
- USB port or barrel jack sticking out past the board edge: up to 2 mm

## Print
PLA, 0.2 mm layers, 3 walls, no supports. The tunnel roofs are 22 mm bridges, so keep the cooling fan on. The lid file is already flipped, top face down.

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
