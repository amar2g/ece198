"""Curl Strap: stacked forearm box v4 (Arduino below, breadboard above).

v4: v3 without the LED window. The only lid opening is the OLED window (plus two
screw holes). Plain box, no tabs, held on by two 20 mm Velcro straps.

Three printed parts: base, shelf, lid. Run with CadQuery:
    python stacked_box_v4.py         -> low version (flat or bent wires), in out_low/
    python stacked_box_v4.py tall       -> tall version (upright Dupont wires), in out_tall/

All sizes in mm. VERIFY = measure your real part before printing.

Axes: X along the forearm, x=0 is the inside face of the USB end wall.
      Y across the forearm, y=0 is the centre line.  Z up, z=0 is the sock side.
"""
import os
import sys

import cadquery as cq

STYLE = "tall" if "tall" in sys.argv[1:] else "low"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out_" + STYLE)

# ------------------------------------------------------------------ parts
ARD_L, ARD_W, ARD_T = 68.85, 53.34, 1.6
ARD_HOLES = [(13.97, 2.54), (15.24, 50.80), (66.04, 7.62), (66.04, 35.56)]  # VERIFY
HEADER_H = 8.5          # female headers above the board
JACK_H = 11.0           # barrel jack (tallest fixed part, not used)
EDGE_OVERHANG = 2.0     # VERIFY: most that the USB port / jack sticks out past the PCB edge
USB_Y = 38.0            # VERIFY: USB-C centre from the PCB's y=0 edge
USB_Z = 1.6             # VERIFY: USB-C centre above the PCB top
BB_L, BB_W, BB_H = 83.5, 55.0, 8.5   # VERIFY: half-size breadboard with rails
OLED_L, OLED_W = 27.3, 27.8          # VERIFY: 0.96" OLED board
OLED_STACK, OLED_T = 2.5, 3.1        # header plastic under it; board + glass
GLASS_L, GLASS_W = 26.7, 19.26
IMU_L, IMU_W, IMU_H = 25.0, 32.0, 5.1  # VERIFY: allowance for the BMX160 board, plugged in

# ------------------------------------------------------------------ space for wires
LOW_WIRE = 5.0 if STYLE == "low" else 16.5   # above the Arduino headers
UP_WIRE = 8.0 if STYLE == "low" else 16.5    # above the breadboard (OLED needs 5.6)

# ------------------------------------------------------------------ box
WALL = 2.4
# strap tunnels run across the box, through the thickness of the floor
STRAP_W, STRAP_T = 20.0, 2.0      # strap the tunnels are made for
TUN_W, TUN_H, TUN_R = 22.0, 3.0, 1.2
TUN_SKIN, TUN_ROOF = 1.6, 1.6     # plastic below / above the tunnel
TUN_X = (14.0, 78.5)              # tunnel centres along the box
TUN_FLARE = 0.8                   # mouths flare so the strap isn't cut
FLOOR = TUN_SKIN + TUN_H + TUN_ROOF
SHELF_T, LID_T = 2.0, 2.0
CLR = 0.5               # per side around each part
USB_GAP = 2.5           # PCB edge to the USB end wall (must exceed EDGE_OVERHANG)
RISER = 8.0             # open strip at the far end where wires climb between decks
LEDGE = 1.2             # shelf rests on a ledge this wide along both long walls
CORNER_R = 4.0
STANDOFF_H, STANDOFF_OD, PILOT = 3.5, 6.0, 2.8  # M3 self-tapping, optional
PILOT_INTO_FLOOR = 1.0                          # deep enough for M3 x 6
USB_CUT_W, USB_CUT_H, USB_CUT_R = 16.0, 11.0, 2.0  # 12.3 x 6.5 plug + room for error
TONGUE, SLOT_DEPTH = 1.1, 1.4   # shelf tongue and lid hook engage slots in the USB wall
SLIDE = 1.25                    # shelf and lid drop in this far back, then slide to the USB wall
POST_OD = 7.0                   # lid screw posts in the far corners (2x M3 x 8)
LIP_T, LIP_D, LIP_CLR = 1.2, 2.0, 0.25
FINGER_Y, FINGER_W = 15.5, 7.0  # shelf fingers that the lid legs press on

# window in the lid
OLED_DX, OLED_DY = 0.0, -0.5    # OLED centre from the breadboard centre
OLED_WIN_L, OLED_WIN_W = 28.5, 21.0

# ------------------------------------------------------------------ derived
IN_L = CLR + BB_L + CLR + RISER
LO_W = ARD_W + 2 * CLR                 # lower cavity (Arduino)
UP_W = max(BB_W + 2 * CLR, LO_W + 2 * LEDGE)
OUT_L, OUT_W = IN_L + 2 * WALL, UP_W + 2 * WALL
Z_PCB = FLOOR + STANDOFF_H
Z_PCB_TOP = Z_PCB + ARD_T
Z_HDR = Z_PCB_TOP + HEADER_H
Z_SHELF = max(Z_HDR + LOW_WIRE, Z_PCB_TOP + JACK_H + 1.0)
Z_BB = Z_SHELF + SHELF_T
Z_BB_TOP = Z_BB + BB_H
Z_LID = Z_BB_TOP + UP_WIRE             # underside of lid = top of walls
HEIGHT = Z_LID + LID_T
ARD_X, ARD_Y = USB_GAP, -ARD_W / 2
BB_X = CLR
BB_CX = BB_X + BB_L / 2
SHELF_END = CLR + BB_L + CLR           # main shelf stops here; riser strip beyond
POST_X, POST_Y = IN_L - 3.5, UP_W / 2 - 3.5
USB_CY, USB_CZ = ARD_Y + USB_Y, Z_PCB_TOP + USB_Z
HOOK_Z0 = Z_LID - 3.0                  # slot for the lid hook
HOOK_W = 30.0
SLOT_W = 40.0


def box(x0, y0, z0, dx, dy, dz):
    return cq.Workplane("XY").box(dx, dy, dz, centered=False).translate((x0, y0, z0))


def cbox(cx, cy, z0, dx, dy, dz):
    return box(cx - dx / 2, cy - dy / 2, z0, dx, dy, dz)


def cyl(x, y, z0, d, h):
    return cq.Workplane("XY").circle(d / 2).extrude(h).translate((x, y, z0))


def rbox(x0, y0, z0, dx, dy, dz, r):
    return box(x0, y0, z0, dx, dy, dz).edges("|Z").fillet(r)


def rslot(w, h, r, length):
    """Rounded bar along Y, starting at y=0, centred on x=0, z=0."""
    return (cq.Workplane("XZ").rect(w, h).extrude(-length).edges("|Y").fillet(r))


def tunnel(x):
    z = TUN_SKIN + TUN_H / 2
    t = rslot(TUN_W, TUN_H, TUN_R, OUT_W + 2).translate((x, -OUT_W / 2 - 1, z))
    for k in (1, -1):   # flared mouths
        f = (cq.Workplane("XZ", origin=(x, k * (OUT_W / 2 + 0.01), z))
             .rect(TUN_W + 2 * TUN_FLARE, TUN_H + 2 * TUN_FLARE)
             .workplane(offset=k * 1.6).rect(TUN_W, TUN_H).loft())
        t = t.union(f)
    return t


# ------------------------------------------------------------------ base
def make_base():
    b = rbox(-WALL, -OUT_W / 2, 0, OUT_L, OUT_W, Z_LID, CORNER_R)
    b = b.cut(box(0, -LO_W / 2, FLOOR, IN_L, LO_W, Z_LID))            # lower deck
    b = b.cut(box(0, -UP_W / 2, Z_SHELF, IN_L, UP_W, Z_LID))          # upper deck (wider: ledge)
    for hx, hy in ARD_HOLES:
        x, y = ARD_X + hx, ARD_Y + hy
        b = b.union(cyl(x, y, FLOOR - 0.1, STANDOFF_OD, STANDOFF_H + 0.1))
        b = b.cut(cyl(x, y, FLOOR - PILOT_INTO_FLOOR, PILOT, STANDOFF_H + PILOT_INTO_FLOOR + 0.5))
    inside = box(0, -UP_W / 2, FLOOR, IN_L, UP_W, Z_LID)
    for s in (1, -1):                                                  # lid screw posts
        post = cyl(POST_X, s * POST_Y, FLOOR - 0.1, POST_OD, Z_LID - FLOOR + 0.1)
        fill = cbox(POST_X + 1.75, s * (POST_Y + 1.75), FLOOR - 0.1, 3.5, 3.5, Z_LID - FLOOR + 0.1)
        b = b.union(post.union(fill).intersect(inside.union(box(0, -UP_W / 2, 0, IN_L, UP_W, Z_LID))))
        b = b.cut(cyl(POST_X, s * POST_Y, Z_LID - 12, PILOT, 13))
    usb = (cq.Workplane("YZ").rect(USB_CUT_W, USB_CUT_H).extrude(WALL + 2)
           .edges("|X").fillet(USB_CUT_R).translate((-WALL - 1, USB_CY, USB_CZ)))
    b = b.cut(usb)
    b = b.cut(box(-SLOT_DEPTH, -SLOT_W / 2, Z_SHELF - 0.25, SLOT_DEPTH + 0.1, SLOT_W, SHELF_T + 0.5))
    b = b.cut(box(-SLOT_DEPTH, -HOOK_W / 2 - 0.5, HOOK_Z0 - 0.2, SLOT_DEPTH + 0.1, HOOK_W + 1, 2.0))
    for x in TUN_X:
        b = b.cut(tunnel(x))
    return b


# ------------------------------------------------------------------ shelf
def make_shelf():
    c = 0.25
    s = box(c, -UP_W / 2 + c, Z_SHELF, SHELF_END - 2 * c - 0.2, UP_W - 2 * c, SHELF_T)
    s = s.union(box(-TONGUE, -SLOT_W / 2 + 0.5, Z_SHELF, TONGUE + 1, SLOT_W - 1, SHELF_T))
    for k in (1, -1):
        s = s.union(box(SHELF_END - 1, k * FINGER_Y - FINGER_W / 2, Z_SHELF,
                        IN_L - SHELF_END + 1 - SLIDE - 0.2, FINGER_W, SHELF_T))
    return s


# ------------------------------------------------------------------ lid
def make_lid():
    lid = rbox(-WALL, -OUT_W / 2, Z_LID, OUT_L, OUT_W, LID_T, CORNER_R)
    lid = lid.faces(">Z").edges().chamfer(0.8)
    o = LIP_CLR
    lip = box(o, -UP_W / 2 + o, Z_LID - LIP_D, IN_L - 2 * o - SLIDE, UP_W - 2 * o, LIP_D + 0.1)
    lip = lip.cut(box(o + LIP_T, -UP_W / 2 + o + LIP_T, Z_LID - LIP_D - 1,
                      IN_L - 2 * o - SLIDE - 2 * LIP_T, UP_W - 2 * o - 2 * LIP_T, LIP_D + 1))
    for k in (1, -1):  # clear the screw posts
        lip = lip.cut(cbox(POST_X + 1, k * (POST_Y + 1), Z_LID - 5, POST_OD + 7, POST_OD + 3, 5))
    lid = lid.union(lip)
    # hook that tucks into the slot in the USB end wall
    lid = lid.union(box(o, -HOOK_W / 2, HOOK_Z0, LIP_T, HOOK_W, Z_LID - HOOK_Z0 + 0.1))
    lid = lid.union(box(-TONGUE, -HOOK_W / 2, HOOK_Z0, TONGUE + o + 0.1, HOOK_W, 1.4))
    for k in (1, -1):
        # legs that hold the shelf down
        lid = lid.union(cbox(SHELF_END + 4.2, k * FINGER_Y, Z_BB + 0.2, 4.0, 5.0, Z_LID - Z_BB))
        lid = lid.cut(cyl(POST_X, k * POST_Y, Z_LID - 1, 3.4, LID_T + 2))
    # OLED window, flared at the top so the screen reads from an angle
    ox, oy = BB_CX + OLED_DX, OLED_DY
    win = cbox(ox, oy, Z_LID - 1, OLED_WIN_L, OLED_WIN_W, LID_T + 2)
    flare = (cq.Workplane("XY").rect(OLED_WIN_L, OLED_WIN_W)
             .workplane(offset=1.3).rect(OLED_WIN_L + 2.6, OLED_WIN_W + 2.6).loft()
             .translate((ox, oy, Z_LID + LID_T - 1.2)))
    lid = lid.cut(win).cut(flare)
    return lid


# ------------------------------------------------------------------ stand-in electronics
def make_parts():
    p = {}
    pcb = box(ARD_X, ARD_Y, Z_PCB, ARD_L, ARD_W, ARD_T)
    for hx, hy in ARD_HOLES:
        pcb = pcb.cut(cyl(ARD_X + hx, ARD_Y + hy, Z_PCB - 1, 3.2, ARD_T + 2))
    p["arduino_pcb"] = pcb
    p["usb_port"] = cbox(ARD_X - EDGE_OVERHANG + 3.7, USB_CY, Z_PCB_TOP, 7.4, 9.0, 3.2)
    p["barrel_jack"] = box(ARD_X - EDGE_OVERHANG, ARD_Y + 3.1, Z_PCB_TOP, 13.7, 9.0, JACK_H)
    p["headers_back"] = box(ARD_X + 17.5, ARD_Y + 49.5, Z_PCB_TOP, 48.5, 2.54, HEADER_H)
    p["headers_front"] = box(ARD_X + 26.6, ARD_Y + 1.3, Z_PCB_TOP, 38.5, 2.54, HEADER_H)
    h = 4.0 if STYLE == "low" else 14.0
    p["wires_back"] = box(ARD_X + 17.5, ARD_Y + 37.0, Z_HDR, 48.5, 15.0, h)
    p["wires_front"] = box(ARD_X + 26.6, ARD_Y + 1.3, Z_HDR, 38.5, 15.0, h)
    p["usb_plug"] = box(-32.0, USB_CY - 6.15, USB_CZ - 3.25, 32.0 + ARD_X - EDGE_OVERHANG, 12.3, 6.5)
    p["breadboard"] = box(BB_X, -BB_W / 2, Z_BB, BB_L, BB_W, BB_H)
    p["oled"] = cbox(BB_CX + OLED_DX, OLED_DY, Z_BB_TOP + OLED_STACK, OLED_L, OLED_W, OLED_T - 1.5)
    p["oled_glass"] = cbox(BB_CX + OLED_DX, OLED_DY, Z_BB_TOP + OLED_STACK + OLED_T - 1.5,
                           GLASS_L, GLASS_W, 1.5)
    p["imu"] = box(BB_X + 2.5, -IMU_W / 2, Z_BB_TOP, IMU_L, IMU_W, IMU_H)
    for i, x in enumerate(TUN_X):
        # strap pulled straight through, running well past both sides
        p[f"strap_{i}"] = cbox(x, 0, TUN_SKIN + (TUN_H - STRAP_T) / 2, STRAP_W, OUT_W + 40, STRAP_T)
    p["riser_wires"] = box(SHELF_END + 1.0, -10.0, FLOOR + 3, 5.0, 20.0, Z_BB_TOP - FLOOR)
    return p


# ------------------------------------------------------------------ checks + export
def vol(a, b):
    return a.val().intersect(b.val()).Volume()


def main():
    os.makedirs(OUT, exist_ok=True)
    base, shelf, lid, parts = make_base(), make_shelf(), make_lid(), make_parts()
    printed = {"base": base, "shelf": shelf, "lid": lid}
    lines, bad = [], 0

    def check(label, v, limit=0.01):
        nonlocal bad
        ok = v <= limit
        bad += not ok
        lines.append(f"  {'OK  ' if ok else 'FAIL'} {label:<44} {v:9.3f} mm^3")

    for n, w in printed.items():
        s = w.val()
        solids = len(w.solids().vals())
        bb = s.BoundingBox()
        lines.append(f"{n:6} {bb.xlen:7.2f} x {bb.ylen:6.2f} x {bb.zlen:6.2f} mm  "
                     f"{s.Volume() / 1000 * 1.24:5.1f} g solid PLA  solids={solids} valid={s.isValid()}")
        bad += (solids != 1) + (not s.isValid())
    lines.append(f"outside {OUT_L:.1f} x {OUT_W:.1f} x {HEIGHT:.1f} mm")
    bx = base.val().BoundingBox()
    ok = abs(bx.xlen - OUT_L) < 0.01 and abs(bx.ylen - OUT_W) < 0.01
    bad += not ok
    lines.append(f"  {'OK  ' if ok else 'FAIL'} nothing sticks out past the box walls")
    lines.append("fit checks (overlap, 0 = none):")
    for n, w in printed.items():
        for k, q in parts.items():
            check(f"{n} vs {k}", vol(w, q))
    names = list(printed)
    for i in range(3):
        for j in range(i + 1, 3):
            check(f"{names[i]} vs {names[j]}", vol(printed[names[i]], printed[names[j]]))
    pk = list(parts)
    allowed = {("usb_port", "usb_plug")}
    for i in range(len(pk)):
        for j in range(i + 1, len(pk)):
            if (pk[i], pk[j]) in allowed:
                continue
            check(f"{pk[i]} vs {pk[j]}", vol(parts[pk[i]], parts[pk[j]]))
    lines.append("assembly checks:")
    ard = [parts[k] for k in ("arduino_pcb", "usb_port", "barrel_jack", "headers_back", "headers_front")]
    for dz in (1, 5, 10, 20, 30, Z_LID):
        check(f"Arduino lifted {dz:.0f} mm vs base",
              sum(vol(base, a.translate((0, 0, dz))) for a in ard))
    up = ("breadboard", "oled", "oled_glass", "imu", "riser_wires")
    low = ("arduino_pcb", "usb_port", "barrel_jack", "headers_back", "headers_front",
           "wires_back", "wires_front", "riser_wires")
    moves = [(SLIDE, dz) for dz in (25, 15, 8, 4, 2, 1, 0)] + [(SLIDE * f, 0) for f in (0.75, 0.5, 0.25, 0)]
    closed = base.union(shelf)
    for dx, dz in moves:
        t = shelf.translate((dx, 0, dz))
        check(f"shelf at +{dx:.2f} x, +{dz} z", vol(base, t) + sum(vol(t, parts[k]) for k in low))
    for dx, dz in moves:
        t = lid.translate((dx, 0, dz))
        check(f"lid at +{dx:.2f} x, +{dz} z", vol(closed, t) + sum(vol(t, parts[k]) for k in up))
    # once slid home, the shelf and lid must not be able to lift out
    for n, w in (("shelf", shelf), ("lid", lid)):
        v = vol(base, w.translate((0, 0, 1.0)))
        ok = v > 1.0
        bad += not ok
        lines.append(f"  {'OK  ' if ok else 'FAIL'} {n} is hooked at the USB end (blocked if lifted)")
    # the lid must be solid everywhere except the OLED window and the two screw holes
    plate = rbox(-WALL + 1, -OUT_W / 2 + 1, Z_LID + 0.4, OUT_L - 2, OUT_W - 2, 0.2, CORNER_R - 1)
    plate = plate.cut(cbox(BB_CX + OLED_DX, OLED_DY, Z_LID, OLED_WIN_L + 3, OLED_WIN_W + 3, 2))
    for k in (1, -1):
        plate = plate.cut(cyl(POST_X, k * POST_Y, Z_LID, 3.4, 2))
    full = vol(lid, plate) / plate.val().Volume()
    ok = full > 0.9999
    bad += not ok
    lines.append(f"  {'OK  ' if ok else 'FAIL'} lid has no opening besides the OLED window and screw holes")
    # each tunnel must be closed all round (strap trapped) and stay sealed from the electronics
    for i, x in enumerate(TUN_X):
        for label, z0, dz in (("skin under", 0.1, TUN_SKIN - 0.2), ("roof over", TUN_SKIN + TUN_H + 0.1, 0.4)):
            probe = cbox(x, 0, z0, TUN_W, OUT_W - 6, dz)
            full = vol(base, probe) / probe.val().Volume()
            ok = full > 0.999
            bad += not ok
            lines.append(f"  {'OK  ' if ok else 'FAIL'} strap tunnel {i}: {label} is {full * 100:.1f}% solid")
    # the glass must show through the window, the board must not fall through it
    lines.append(f"OLED glass {GLASS_L} x {GLASS_W} behind window {OLED_WIN_L} x {OLED_WIN_W}; "
                 f"glass is {Z_LID + LID_T - (Z_BB_TOP + OLED_STACK + OLED_T):.1f} mm below the lid top")
    lines.append("RESULT: " + ("ALL CHECKS PASS" if not bad else f"{bad} PROBLEM(S)"))
    text = "\n".join(lines)
    print(text if bad else "\n".join(l for l in lines if not l.startswith("  OK")))
    with open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8") as f:
        f.write(text + "\n")

    cq.exporters.export(base, os.path.join(OUT, "base.step"))
    cq.exporters.export(shelf, os.path.join(OUT, "shelf.step"))
    cq.exporters.export(lid, os.path.join(OUT, "lid.step"))
    kw = dict(tolerance=0.03, angularTolerance=0.15)
    cq.exporters.export(base, os.path.join(OUT, "base.stl"), **kw)
    cq.exporters.export(shelf.translate((0, 0, -Z_SHELF)), os.path.join(OUT, "shelf.stl"), **kw)
    cq.exporters.export(lid.rotate((0, 0, 0), (1, 0, 0), 180).translate((0, 0, HEIGHT)),
                        os.path.join(OUT, "lid.stl"), **kw)
    a = cq.Assembly(name="curl_strap_stacked")
    for n, w, col in (("base", base, (0.45, 0.5, 0.58)), ("shelf", shelf, (0.85, 0.65, 0.2)),
                      ("lid", lid, (0.75, 0.4, 0.15))):
        a.add(w, name=n, color=cq.Color(*col))
    for k, q in parts.items():
        a.add(q, name=k, color=cq.Color(0.2, 0.5, 0.35))
    (a.export if hasattr(a, "export") else a.save)(os.path.join(OUT, "assembly.step"))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
