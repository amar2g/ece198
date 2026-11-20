# ECE198 one-box enclosure

The spec is in [../MASTER_PROMPT.md](../MASTER_PROMPT.md). To rebuild, change any number at the top of `enclosures.py`, then from `ECE198\` run:

```
.venv\Scripts\python enclosures\enclosures.py
```

**How the IMU gets power:** laptop → USB-C → Arduino. Jumper wires on the breadboard then carry 3.3V/5V and GND from the Arduino to the IMU, plus SDA and SCL.

The IMU has to move with the arm, so the whole box goes on the forearm, sewn to a sock through the holes in the base flange. For a table-only box, set `MOUNT_FLANGE = False`.

## Print
| file | how to print |
|---|---|
| out/box_base.stl | Upright, flange flat on the bed, no supports. 162 mm long, so a brim helps. |
| out/box_lid.stl | Flat, top face down (the STL is already flipped), no supports. |

For Onshape, use Import → STEP (`box_base.step`, `box_lid.step`, `box_assembly.step`), then edit with Move face / Offset face.

## Measure before printing (VERIFY)
1. Arduino mounting holes are at the standard UNO positions. Check them → `ARD_HOLES`.
2. The USB-C port centre is assumed to be 38 mm from the PCB's y=0 edge and 1.6 mm above the PCB top → `USB_Y`, `USB_Z_ABOVE_PCB`.
3. The barrel jack and USB-C port may stick out up to 0.5 mm past the PCB's USB edge. If they stick out more → `BARREL_RELIEF`.
4. Breadboard size is assumed to be 81.3 x 50.8 x 8.5 → `BB_*`.
5. Your USB-C plug body must be 12.3 x 6.5 mm or smaller, since the cutout is 14 x 9.
