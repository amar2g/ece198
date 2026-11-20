"""
ECE198 bicep-curl tracker -- ONE-BOX enclosure (CadQuery).  Spec: ../MASTER_PROMPT.md

Holds the Arduino UNO R4 Minima + breadboard, with the BMX160 IMU plugged into the breadboard.
Power path: laptop --USB-C--> Arduino --3V3/5V + GND jumpers on the breadboard--> IMU.
The whole box rides on the forearm (sewn/glued to a sock via the base flange); the USB cable
runs to the laptop.

Run (from the ECE198 folder):   .venv\\Scripts\\python enclosures\\enclosures.py
Outputs -> enclosures/out/ : box_base / box_lid STEP+STL, box_assembly.step, PNGs, report.txt
Units mm.  X = long axis, Y = width, Z = up.  Origin = outside bottom-left corner of the walls.
"""
import math
import os
import shutil

import cadquery as cq

# =====================================================================================
# PARAMETERS   (VERIFY = measure the real part before printing)
# =====================================================================================
# ---- general / print ----
WALL = 2.4                # wall thickness
FLOOR = 1.6               # floor thickness (8 layers)
CORNER_R = 2.0            # outside vertical corner radius
CLR = 0.5                 # clearance per side around every part pocket

# ---- slide lid ----
LID_T = 2.0               # lid thickness
GROOVE_D = 1.2            # groove depth into the long walls
LID_SIDE_CLR = 0.3        # sliding fit: lid edge to groove back / stop end
LID_VERT_CLR = 0.25       # sliding fit above and below the lid (groove height = LID_T + 2x)
LIP_H = 1.0               # wall above the groove (holds the lid down)
GRIP_N, GRIP_W, GRIP_D = 3, 1.2, 0.8      # finger-grip grooves in lid top: count, width, depth
GRIP_PITCH, GRIP_FIRST = 2.4, 3.0          #   spacing, first one in from the entry end
DETENT_H = 0.75           # click bump under the lid (interference = DETENT_H - 2*LID_VERT_CLR).
                          #   too stiff -> 0.6, lid falls out -> 0.9, 0 = off
DETENT_LEN, DETENT_BASE = 10.0, 2.0
LEAD_CHAMFER = 0.8        # chamfer under the lid's leading edge
WINDOW_L, WINDOW_W, WINDOW_R = 74.0, 40.0, 3.0   # big lid window over the breadboard: OLED + LEDs show

# ---- Arduino UNO R4 Minima ----
ARD_L, ARD_W, ARD_PCB_T = 68.85, 53.34, 1.6
ARD_HOLES = [(13.97, 2.54), (15.24, 50.8), (66.04, 7.62), (66.04, 35.56)]   # VERIFY
STANDOFF_H, STANDOFF_OD = 3.5, 6.0   # 3.5 still clears 2-3 mm solder pins
PILOT_D = 2.8             # M3 self-tapping pilot (screws optional)
PILOT_INTO_FLOOR = 0.6
USB_Y = 38.0              # VERIFY: USB-C centre from the PCB's y=0 edge
USB_Z_ABOVE_PCB = 1.6     # VERIFY: USB-C centre above the PCB top
USB_CUT_W, USB_CUT_H, USB_CUT_R = 14.0, 9.0, 1.5
BARREL_RELIEF = 0.0       # VERIFY: barrel-jack overhang past the USB edge + 0.5 (0 = none)

# ---- breadboard + IMU ----
BB_L, BB_W, BB_H = 83.5, 55.0, 8.5        # VERIFY: half-size breadboard w/ power rails (30 rows)
BB_GAP = 5.0              # Arduino <-> breadboard gap
RIB_H, RIB_W = 3.0, 1.2   # locating rib (in gap) and rail (open side of breadboard)
HEADER_H = 8.5            # Arduino female header height
DUPONT_H = 14.0           # Dupont plug housing sticking up out of the headers (tallest part)
BOX_HEIGHT = 35.0         # total outside height of the base (floor to wall top)
INNER_H = BOX_HEIGHT - FLOOR - LID_T - 2 * LID_VERT_CLR - LIP_H   # floor -> lid underside
TOP_CLEARANCE = INNER_H - (STANDOFF_H + ARD_PCB_T + HEADER_H + DUPONT_H)  # room above the Dupont plugs
assert TOP_CLEARANCE >= 2.0, f'only {TOP_CLEARANCE:.1f} mm above the Dupont plugs: raise BOX_HEIGHT'
IMU_L, IMU_W = 20.0, 15.0 # VERIFY: IMU board (preview/fit check only, size from photo)
OLED_L, OLED_W = 27.3, 27.8   # 0.96in I2C OLED module, plugged into the breadboard, display up
OLED_STACK, OLED_T = 2.5, 3.1 # header spacer under it; PCB + glass thickness
IMU_STACK = 2.5           # header plastic spacer between breadboard and IMU board

# ---- forearm mount ----
MOUNT_FLANGE = True       # base flange with stitching holes for the sock. False = table box
FLANGE_W, FLANGE_T, FLANGE_R = 8.0, 2.0, 3.0
STITCH_D, STITCH_PITCH, STITCH_END = 2.0, 6.0, 3.5

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
STL_TOL, STL_ANG = 0.02, 0.1
PLA_DENSITY = 1.24        # g/cm^3, solid


# =====================================================================================
def bx(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def vol(wp):
    try:
        return sum(s.Volume() for s in wp.solids().vals())
    except Exception:
        return 0.0


def inter_vol(a, b):
    try:
        return vol(a.intersect(b))
    except Exception:
        return float("nan")


# =====================================================================================
# BASE
# =====================================================================================
ard_pocket_L = ARD_L + 2 * CLR
bb_pocket_L = BB_L + 2 * CLR
inner_L = ard_pocket_L + BB_GAP + bb_pocket_L
inner_W = max(ARD_W, BB_W) + 2 * CLR
L, W = inner_L + 2 * WALL, inner_W + 2 * WALL
gb = FLOOR + INNER_H                     # groove bottom = lid underside
gt = gb + LID_T + 2 * LID_VERT_CLR
H = gt + LIP_H

base = cq.Workplane("XY").box(L, W, H, centered=False).edges("|Z").fillet(CORNER_R)
if MOUNT_FLANGE:
    base = base.union(bx(0, L, -FLANGE_W, W + FLANGE_W, 0, FLANGE_T).edges("|Z").fillet(FLANGE_R))
base = base.cut(bx(WALL, L - WALL, WALL, W - WALL, FLOOR, H + 1))                        # cavity
base = base.cut(bx(WALL - GROOVE_D, L + 1, WALL - GROOVE_D, W - WALL + GROOVE_D, gb, gt))  # grooves
base = base.cut(bx(L - WALL - 0.01, L + 1, WALL - GROOVE_D, W - WALL + GROOVE_D, gb, H + 1))  # entry

ax0, ay0, az0 = WALL + CLR, WALL + CLR, FLOOR + STANDOFF_H
pcb_top = az0 + ARD_PCB_T
pts = [(ax0 + hx, ay0 + hy) for hx, hy in ARD_HOLES]
base = base.union(cq.Workplane("XY", origin=(0, 0, FLOOR - 0.01)).pushPoints(pts)
                  .circle(STANDOFF_OD / 2).extrude(STANDOFF_H + 0.01))
base = base.cut(cq.Workplane("XY", origin=(0, 0, FLOOR - PILOT_INTO_FLOOR)).pushPoints(pts)
                .circle(PILOT_D / 2).extrude(STANDOFF_H + PILOT_INTO_FLOOR + 1))

usb_yc, usb_zc = ay0 + USB_Y, pcb_top + USB_Z_ABOVE_PCB
base = base.cut(cq.Workplane("YZ", origin=(-1, usb_yc, usb_zc)).rect(USB_CUT_W, USB_CUT_H)
                .extrude(WALL + 1.5).edges("|X").fillet(USB_CUT_R))
if BARREL_RELIEF > 0:
    base = base.cut(bx(WALL - BARREL_RELIEF, WALL + 0.1, ay0 + 2.5, ay0 + 12.5, az0 - 0.5, pcb_top + 11.5))

bb_x0 = WALL + ard_pocket_L + BB_GAP
bb_x1 = bb_x0 + bb_pocket_L
rib_xc = WALL + ard_pocket_L + BB_GAP / 2
base = base.union(bx(rib_xc - RIB_W / 2, rib_xc + RIB_W / 2, WALL - 0.01, W - WALL + 0.01,
                     FLOOR - 0.01, FLOOR + RIB_H))
bb_y1 = WALL + BB_W + 2 * CLR
if W - WALL - bb_y1 >= RIB_W + 0.3:
    base = base.union(bx(bb_x0, bb_x1 + 0.01, bb_y1, bb_y1 + RIB_W, FLOOR - 0.01, FLOOR + RIB_H))

n_st = 0
if MOUNT_FLANGE:
    n_st = int(math.floor((L - 2 * STITCH_END) / STITCH_PITCH)) + 1
    sx0 = (L - (n_st - 1) * STITCH_PITCH) / 2
    st = [(sx0 + i * STITCH_PITCH, y) for i in range(n_st) for y in (-FLANGE_W / 2, W + FLANGE_W / 2)]
    base = base.cut(cq.Workplane("XY", origin=(0, 0, -1)).pushPoints(st).circle(STITCH_D / 2)
                    .extrude(FLANGE_T + 2))


# =====================================================================================
# LID  (base XY coords, z=0 = underside)
# =====================================================================================
def make_lid(detent=True):
    x0 = y0 = WALL - GROOVE_D + LID_SIDE_CLR
    lid = bx(x0, L, y0, W - y0, 0, LID_T)
    c = LEAD_CHAMFER
    lid = lid.cut(cq.Workplane("XZ", origin=(0, W / 2, 0))
                  .polyline([(x0 - 0.1, -0.1), (x0 + c, -0.1), (x0 - 0.1, c + 0.1)]).close()
                  .extrude(W, both=True))
    for i in range(GRIP_N):
        xc = L - GRIP_FIRST - i * GRIP_PITCH
        lid = lid.cut(bx(xc - GRIP_W / 2, xc + GRIP_W / 2, WALL + 1, W - WALL - 1, LID_T - GRIP_D, LID_T + 1))
    lid = lid.cut(cq.Workplane("XY", origin=(win_cx, win_cy, -1)).rect(WINDOW_L, WINDOW_W)
                  .extrude(LID_T + 2).edges("|Z").fillet(WINDOW_R))
    if detent and DETENT_H > 0:
        b, h = DETENT_BASE, DETENT_H
        t = max(b - 2 * h, 0.4)
        xc = L - WALL - 0.3 - b / 2
        lid = lid.union(cq.Workplane("XZ", origin=(0, W / 2, 0))
                        .polyline([(xc - b / 2, 0.01), (xc + b / 2, 0.01), (xc + t / 2, -h), (xc - t / 2, -h)])
                        .close().extrude(DETENT_LEN / 2, both=True))
    return lid


win_cx, win_cy = (bb_x0 + bb_x1) / 2, WALL + (BB_W + 2 * CLR) / 2
grip_edge = L - GRIP_FIRST - (GRIP_N - 1) * GRIP_PITCH - GRIP_W / 2
win_shift = max(0.0, (win_cx + WINDOW_L / 2) - (grip_edge - 1.5))
win_cx -= win_shift
lid = make_lid()
lid_nodetent = make_lid(detent=False)

# =====================================================================================
# GHOST PARTS (previews + checks only)
# =====================================================================================
bb_top = FLOOR + BB_H
oled_cx = bb_x0 + CLR + 18.0                   # OLED near the Arduino end of the breadboard
imu_cx = bb_x0 + CLR + 45.0                    # IMU in the middle
imu_cy = WALL + CLR + BB_W / 2
g = {
    "PCB": bx(ax0, ax0 + ARD_L, ay0, ay0 + ARD_W, az0, pcb_top),
    "USB-C receptacle": bx(ax0 - 0.3, ax0 + 7.35, usb_yc - 4.47, usb_yc + 4.47, pcb_top, pcb_top + 3.26),
    "USB-C plug overmold 12.3x6.5": bx(-25, ax0 - 0.3, usb_yc - 6.15, usb_yc + 6.15, usb_zc - 3.25, usb_zc + 3.25),
    "barrel jack": bx(ax0, ax0 + 14.0, ay0 + 3.0, ay0 + 12.0, pcb_top, pcb_top + 11.0),
    "headers": bx(ax0 + 18, ax0 + 64, ay0 + ARD_W - 3.8, ay0 + ARD_W - 1.3, pcb_top, pcb_top + 8.5)
               .union(bx(ax0 + 27, ax0 + 64, ay0 + 1.3, ay0 + 3.8, pcb_top, pcb_top + 8.5)),
    "Arduino Dupont plugs": bx(ax0 + 30, ax0 + 60, ay0 + 1.3, ay0 + 3.8, pcb_top + HEADER_H, pcb_top + HEADER_H + DUPONT_H)
               .union(bx(ax0 + 40, ax0 + 50, ay0 + ARD_W - 3.8, ay0 + ARD_W - 1.3, pcb_top + HEADER_H, pcb_top + HEADER_H + DUPONT_H)),
    "breadboard": bx(bb_x0 + CLR, bb_x0 + CLR + BB_L, WALL + CLR, WALL + CLR + BB_W, FLOOR, bb_top),
    "IMU board": bx(imu_cx - IMU_L / 2, imu_cx + IMU_L / 2, imu_cy - IMU_W / 2, imu_cy + IMU_W / 2,
                    bb_top + IMU_STACK, bb_top + IMU_STACK + 1.6),
    "OLED": bx(oled_cx - OLED_L / 2, oled_cx + OLED_L / 2, imu_cy - OLED_W / 2, imu_cy + OLED_W / 2,
               bb_top + OLED_STACK, bb_top + OLED_STACK + OLED_T),
    "breadboard jumpers": bx(imu_cx - IMU_L / 2 - 6, imu_cx - IMU_L / 2 - 3, imu_cy - 6, imu_cy + 6, bb_top, bb_top + 14),
    "LEDs": cq.Workplane("XY", origin=(0, 0, bb_top)).pushPoints(
        [(win_cx + 20, win_cy - 4), (win_cx + 28, win_cy - 4)]).circle(2.5).extrude(8.6),
}

# =====================================================================================
# EXPORT
# =====================================================================================
if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)


def to_origin(w):
    b = w.val().BoundingBox()
    return w.translate((-b.xmin, -b.ymin, -b.zmin))


parts = {"box_base": (to_origin(base), to_origin(base)),
         "box_lid": (to_origin(lid), to_origin(lid.rotate((0, 0, 0), (1, 0, 0), 180)))}
for name, (step_wp, stl_wp) in parts.items():
    cq.exporters.export(step_wp, os.path.join(OUT, f"{name}.step"))
    cq.exporters.export(stl_wp, os.path.join(OUT, f"{name}.stl"), tolerance=STL_TOL, angularTolerance=STL_ANG)
assy = cq.Assembly(name="box")
assy.add(base, name="box_base", color=cq.Color(0.72, 0.76, 0.82))
assy.add(lid, name="box_lid", loc=cq.Location(cq.Vector(0, 0, gb)), color=cq.Color(0.95, 0.55, 0.20))
assy.export(os.path.join(OUT, "box_assembly.step"))

# =====================================================================================
# REPORT + CHECKS
# =====================================================================================
lines = []


def rep(s=""):
    print(s)
    lines.append(s)


rep("OUTSIDE DIMENSIONS (as exported to STEP, mm)")
rep(f"{'part':<10}{'X':>9}{'Y':>9}{'Z':>9}{'solid g':>9}")
for name, (step_wp, _) in parts.items():
    b = step_wp.val().BoundingBox()
    rep(f"{name:<10}{b.xlen:9.2f}{b.ylen:9.2f}{b.zlen:9.2f}{vol(step_wp) * PLA_DENSITY / 1000:9.1f}")
rep(f"wall footprint {L:.2f} x {W:.2f}, closed height {H:.2f}")
rep()
lid_closed = lid.translate((0, 0, gb))
rep("FIT CHECKS (intersection volume, mm^3; 0 = no collision)")
checks = [(f"base vs {k}", inter_vol(base, v)) for k, v in g.items()]
checks.append(("base vs closed lid", inter_vol(base, lid_closed)))
allg = list(g.values())
ghost_all = allg[0]
for v in allg[1:]:
    ghost_all = ghost_all.union(v)
checks.append(("closed lid vs all parts", inter_vol(lid_closed, ghost_all)))
for dx in (3.0, 15.0, 40.0, 100.0):
    checks.append((f"lid slid out {dx:g} mm (no detent)", inter_vol(base, lid_nodetent.translate((dx, 0, gb)))))
ok_all = True
for n, v in checks:
    ok = v < 1e-3
    ok_all &= ok
    rep(f"  {'OK  ' if ok else 'FAIL'} {n:<42}{v:10.4f}")
rep()
rep(f"lid underside z={gb:.2f}; tallest part: Dupont top z={pcb_top + HEADER_H + DUPONT_H:.1f}, "
    f"breadboard jumpers z={bb_top + 14:.1f}, IMU top z={bb_top + IMU_STACK + 1.6:.1f}")
rep(f"room above the Arduino Dupont plugs for wires to bend: {TOP_CLEARANCE:.2f} mm")
rep(f"USB cutout centre y={usb_yc:.2f} z={usb_zc:.2f} (on port); margin round 12.3x6.5 plug "
    f"{(USB_CUT_W - 12.3) / 2:.2f} / {(USB_CUT_H - 6.5) / 2:.2f}")
rep(f"detent interference {DETENT_H - 2 * LID_VERT_CLR:.2f}; LED window {WINDOW_L:g}x{WINDOW_W:g} at "
    f"x={win_cx:.2f} y={win_cy:.2f}" + (f" (shifted {win_shift:.2f} to clear grip)" if win_shift else ""))
if MOUNT_FLANGE:
    rep(f"flange {FLANGE_W:g} each long side, {n_st} stitching holes per side @ {STITCH_PITCH:g}")
rep(f"ALL CHECKS {'PASS' if ok_all else 'FAILED'}")
with open(os.path.join(OUT, "report.txt"), "w") as f:
    f.write("\n".join(lines) + "\n")


# =====================================================================================
# PREVIEWS
# =====================================================================================
def render_png(items, path, direction, up=(0, 0, 1), size=(1600, 1100), zoom=1.15):
    import vtk
    ren = vtk.vtkRenderer()
    ren.SetBackground(1, 1, 1)
    for shape, color, opacity in items:
        pd = shape.val().toVtkPolyData(0.03, 0.2, normals=True)
        surf = vtk.vtkPolyData()
        surf.SetPoints(pd.GetPoints())
        surf.SetPolys(pd.GetPolys())
        if pd.GetPointData().GetNormals() is not None:
            surf.GetPointData().SetNormals(pd.GetPointData().GetNormals())
        for poly, col, lw in ((surf, color, 0), (None, (0.1, 0.1, 0.1), 1.2)):
            if poly is None:
                poly = vtk.vtkPolyData()
                poly.SetPoints(pd.GetPoints())
                poly.SetLines(pd.GetLines())
            m = vtk.vtkPolyDataMapper()
            m.SetInputData(poly)
            m.SetResolveCoincidentTopologyToPolygonOffset()
            a = vtk.vtkActor()
            a.SetMapper(m)
            a.GetProperty().SetColor(*col)
            a.GetProperty().SetOpacity(opacity if lw == 0 else min(1.0, opacity + 0.3))
            if lw:
                a.GetProperty().SetLineWidth(lw)
            ren.AddActor(a)
    rw = vtk.vtkRenderWindow()
    rw.SetOffScreenRendering(1)
    rw.AddRenderer(ren)
    rw.SetSize(*size)
    cam = ren.GetActiveCamera()
    cam.ParallelProjectionOn()
    cam.SetFocalPoint(0, 0, 0)
    cam.SetPosition(*direction)
    cam.SetViewUp(*up)
    ren.ResetCamera()
    cam.Zoom(zoom)
    rw.Render()
    w2i = vtk.vtkWindowToImageFilter()
    w2i.SetInput(rw)
    w2i.Update()
    wr = vtk.vtkPNGWriter()
    wr.SetFileName(path)
    wr.SetInputConnection(w2i.GetOutputPort())
    wr.Write()
    rw.Finalize()


def plot_section(items, origin, normal, hv, path, title, xlim=None, ylim=None, notes=()):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.collections import PolyCollection
    h, v = hv
    fig, ax = plt.subplots(figsize=(11, 7.5))
    plane = cq.Face.makePlane(None, None, basePnt=cq.Vector(*origin), dir=cq.Vector(*normal))
    for shape, color, label in items:
        try:
            faces = shape.val().intersect(plane).Faces()
        except Exception:
            continue
        for k, f in enumerate(faces):
            vs, tris = f.tessellate(0.01, 0.1)
            P2 = [(p.toTuple()[h], p.toTuple()[v]) for p in vs]
            ax.add_collection(PolyCollection([[P2[i] for i in t] for t in tris], facecolors=color,
                                             edgecolors=color, linewidths=0.3, label=label if k == 0 else None))
            for e in f.Edges():
                q = [e.positionAt(t).toTuple() for t in np.linspace(0, 1, 2 if e.geomType() == "LINE" else 40)]
                ax.plot([p[h] for p in q], [p[v] for p in q], "k-", lw=0.7)
    ax.set_aspect("equal")
    ax.autoscale_view()
    if xlim:
        ax.set_xlim(*xlim)
    if ylim:
        ax.set_ylim(*ylim)
    ax.grid(True, lw=0.3, alpha=0.5)
    ax.set_xlabel("XYZ"[h] + " (mm)")
    ax.set_ylabel("XYZ"[v] + " (mm)")
    ax.set_title(title, fontsize=11)
    if notes:
        ax.text(0.01, 0.01, "\n".join(notes), transform=ax.transAxes, fontsize=9, va="bottom",
                bbox=dict(fc="white", ec="0.6"))
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


C_BASE, C_LID = (0.70, 0.75, 0.82), (0.95, 0.55, 0.20)
GCOL = {"PCB": (0.2, 0.55, 0.3), "USB-C receptacle": (0.6, 0.6, 0.6), "USB-C plug overmold 12.3x6.5": (0.3, 0.3, 0.3),
        "barrel jack": (0.2, 0.2, 0.2), "headers": (0.15, 0.15, 0.15), "Arduino Dupont plugs": (0.1, 0.1, 0.1),
        "breadboard": (0.93, 0.93, 0.88), "IMU board": (0.1, 0.35, 0.75), "breadboard jumpers": (0.85, 0.2, 0.2),
        "LEDs": (0.1, 0.8, 0.1), "OLED": (0.05, 0.05, 0.25)}
ghosts = [(g[k], GCOL[k], 1) for k in g]
ISO = (1, -1.3, 1.1)
png = lambda n: os.path.join(OUT, n)
render_png([(base, C_BASE, 1), (lid.translate((70, 0, gb)), C_LID, 1)], png("box_iso.png"), ISO)
render_png([(base, C_BASE, 1), (lid_closed, C_LID, 0.3)] + ghosts, png("box_iso_closed_xray.png"), ISO)
render_png([(base, C_BASE, 1)] + ghosts, png("box_top.png"), (0, 0, 1), up=(0, 1, 0))
render_png([(base, C_BASE, 1)], png("box_underside.png"), (1, -1.3, -1.1))
xs = oled_cx
plot_section([(base, C_BASE, "box_base"), (lid_closed, C_LID, "box_lid (closed)"),
              (g["breadboard"], GCOL["breadboard"], "breadboard"), (g["OLED"], (0.3, 0.3, 0.6), "OLED")],
             (xs, 0, 0), (1, 0, 0), (1, 2), png("box_section_grooves.png"),
             f"Section YZ at x={xs:.1f} (grooves, lid window, breadboard + OLED, flange)",
             notes=[f"groove {GROOVE_D} deep x {LID_T + 2 * LID_VERT_CLR:.2f} tall, lid {LID_T}",
                    f"clearance {LID_SIDE_CLR}/side, {LID_VERT_CLR} above/below"])
plot_section([(base, C_BASE, "box_base"), (g["PCB"], GCOL["PCB"], "PCB"),
              (g["USB-C receptacle"], GCOL["USB-C receptacle"], "USB-C receptacle"),
              (g["USB-C plug overmold 12.3x6.5"], (0.3, 0.3, 0.3), "plug overmold"), (lid_closed, C_LID, "lid")],
             (0, usb_yc, 0), (0, 1, 0), (0, 2), png("box_section_usb.png"),
             f"Section XZ at y={usb_yc:.2f} (USB-C centre)", xlim=(-12, 25), ylim=(-1, H + 2),
             notes=[f"cutout {USB_CUT_W} x {USB_CUT_H} centred on port z={usb_zc:.2f}"])
print("done ->", OUT)
