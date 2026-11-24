"""Wiring for the v4 stacked box (no LEDs): checks the netlist, then draws
wiring_schematic.svg (electrical) and wiring_breadboard.svg (where each wire goes)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TOP = "fghij"
ROWY = {r: 13.97 - 2.54 * i for i, r in enumerate("jihgf")}
ROWY.update({r: -3.81 - 2.54 * i for i, r in enumerate("edcba")})
RAILY = {"T+": 23.0, "T-": 20.5, "B-": -20.5, "B+": -23.0}
NETS = {"3.3V": {"Arduino.3.3V", "BMX160.VCC", "BMX160.CSB", "OLED.VCC"},
        "GND": {"Arduino.GND", "BMX160.GND", "BMX160.SDO", "OLED.GND"},
        "SDA": {"Arduino.A4", "BMX160.SDA", "OLED.SDA"},
        "SCL": {"Arduino.A5", "BMX160.SCL", "OLED.SCL"},
        "nc1": {"BMX160.INT1"}, "nc2": {"BMX160.INT2"}}
COL = {"3.3V": "#d62728", "GND": "#222222", "SDA": "#1f6fd1", "SCL": "#c98a00"}

PARTS = {"BMX160": {p: (c, "i") for c, p in enumerate(
            ["VCC", "GND", "SCL", "SDA", "CSB", "SDO", "INT1", "INT2"], start=2)},
         "OLED": {p: (c, "i") for c, p in enumerate(["GND", "VCC", "SCL", "SDA"], start=14)}}
UP = [("3.3V", ("T+", 29)), ("GND", ("T-", 28)), ("A4", (22, "h")), ("A5", (23, "h"))]
JUMP = [((2, "j"), ("T+", 2)), ((3, "j"), ("T-", 3)), ((6, "j"), ("T+", 6)), ((7, "j"), ("T-", 7)),
        ((14, "j"), ("T-", 14)), ((15, "j"), ("T+", 15)),
        ((4, "j"), (23, "j")), ((5, "j"), (22, "j")), ((16, "j"), (23, "i")), ((17, "j"), (22, "i"))]


def node(h):
    return h[0] if isinstance(h[0], str) else (h[0], "top" if h[1] in TOP else "bot")


# ------------------------------------------------------------------ check the breadboard layout
used, parent = {}, {}
for owner, holes in ([(f"{p}.{n}", [h]) for p, d in PARTS.items() for n, h in d.items()]
                     + [(f"Arduino.{n}", [h]) for n, h in UP]
                     + [(f"jumper {a}-{b}", [a, b]) for a, b in JUMP]):
    for h in holes:
        assert h not in used, f"hole {h} used twice: {used[h]} and {owner}"
        used[h] = owner


def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        x = parent[x]
    return x


def join(a, b):
    parent[find(a)] = find(b)


for n, h in UP:
    join(f"Arduino.{n}", node(h))
for p, d in PARTS.items():
    for n, h in d.items():
        join(f"{p}.{n}", node(h))
for a, b in JUMP:
    join(node(a), node(b))
got = {}
for x in list(parent):
    if isinstance(x, str) and "." in x:
        got.setdefault(find(x), set()).add(x)
assert sorted(map(sorted, got.values())) == sorted(map(sorted, NETS.values())), got
hidden = [h for h in used if not isinstance(h[0], str) and used[h].split(".")[0] not in PARTS
          and ((10.2 <= h[0] <= 20.8 and -14.4 < ROWY[h[1]] < 13.4)
               or (1.6 <= h[0] <= 9.5 and -1.7 < ROWY[h[1]] < 13.4))]
assert not hidden, hidden
print(f"netlist matches: {len(UP)} wires up, {len(JUMP)} jumpers, {len(used)} holes, none reused or hidden")


class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.o = w, h, []

    def text(self, x, y, s, z=18, f="#222", a="start", w="normal"):
        self.o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{z}" fill="{f}" '
                      f'text-anchor="{a}" font-weight="{w}">{s}</text>')

    def raw(self, s):
        self.o.append(s)

    def wire(self, pts, c, w=4.5, ends=True):
        d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
        self.o.append(f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{w + 6}" opacity=".95"/>')
        self.o.append(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" '
                      'stroke-linejoin="round" stroke-linecap="round"/>')
        if ends:
            for x, y in (pts[0], pts[-1]):
                self.dot(x, y, c, 5.5)

    def dot(self, x, y, c, r=8):
        self.o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{c}"/>')

    def save(self, name):
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" '
                    f'height="{self.h}" font-family="Arial, Helvetica, sans-serif">'
                    '<rect width="100%" height="100%" fill="#fff"/>' + "\n".join(self.o) + "</svg>")


# ------------------------------------------------------------------ 1. schematic
g = Svg(1400, 900)
g.text(40, 46, "Curl Strap v4: wiring schematic", 30, "#111", w="bold")
g.text(40, 78, "A dot means connected. Wires that cross without a dot are not connected.", 18, "#555")
AX, BX = 380, 930
BUS = {"3.3V": 520, "GND": 600, "SDA": 680, "SCL": 760}
ard = {"3.3V": ("3.3V", 290), "GND": ("GND", 390), "A4": ("SDA", 490), "A5": ("SCL", 590)}
mods = {"BMX160": [("VCC", 190, "3.3V"), ("CSB", 240, "3.3V"), ("GND", 290, "GND"), ("SDO", 340, "GND"),
                   ("SDA", 390, "SDA"), ("SCL", 440, "SCL"), ("INT1", 490, None), ("INT2", 530, None)],
        "OLED": [("VCC", 650, "3.3V"), ("GND", 700, "GND"), ("SDA", 750, "SDA"), ("SCL", 800, "SCL")]}
# the drawing must contain exactly the same nets
drawn = {n: set() for n in COL}
for p, (n, _) in ard.items():
    drawn[n].add(f"Arduino.{p}")
for m, pins in mods.items():
    for p, _, n in pins:
        if n:
            drawn[n].add(f"{m}.{p}")
assert drawn == {n: NETS[n] for n in COL}, drawn
for n, x in BUS.items():
    ys = [y for k, (q, y) in ard.items() if q == n] + [y for v in mods.values() for _, y, q in v if q == n]
    g.wire([(x, min(ys)), (x, max(ys))], COL[n], 5, False)
for p, (n, y) in ard.items():
    g.wire([(AX, y), (BUS[n], y)], COL[n], 5, False)
for v in mods.values():
    for p, y, n in v:
        if n:
            g.wire([(BUS[n], y), (BX, y)], COL[n], 5, False)
for n, x in BUS.items():
    for y in [y for k, (q, y) in ard.items() if q == n] + [y for v in mods.values() for _, y, q in v if q == n]:
        g.dot(x, y, COL[n])
g.raw(f'<rect x="90" y="200" width="{AX - 90}" height="470" rx="14" fill="#00818a"/>')
g.text((90 + AX) / 2 - 24, 420, "Arduino", 30, "#fff", "middle", "bold")
g.text((90 + AX) / 2 - 24, 454, "UNO R4 Minima", 22, "#e6fbfc", "middle")
g.text((90 + AX) / 2 - 24, 486, "lower level", 18, "#bfeef1", "middle")
for p, (n, y) in ard.items():
    g.raw(f'<rect x="{AX - 8}" y="{y - 9}" width="18" height="18" fill="#e8c766" stroke="#7a5c00"/>')
    g.text(AX - 18, y + 7, p, 20, "#fff", "end", "bold")
g.raw('<path d="M235 670 V760" stroke="#777" stroke-width="8" fill="none"/>')
g.raw('<rect x="150" y="760" width="170" height="64" rx="8" fill="#e9eef3" stroke="#555" stroke-width="2"/>')
g.text(235, 799, "Laptop", 20, "#333", "middle", "bold")
g.text(252, 722, "USB-C: power and data", 17, "#555")
for m, (y0, y1, fill, sub) in {"BMX160": (150, 570, "#5b2d82", "motion sensor"), "OLED": (610, 840, "#17407f", "SSD1306 screen")}.items():
    g.raw(f'<rect x="{BX}" y="{y0}" width="350" height="{y1 - y0}" rx="14" fill="{fill}"/>')
    g.text(BX + 225, (y0 + y1) / 2, m, 30, "#fff", "middle", "bold")
    g.text(BX + 225, (y0 + y1) / 2 + 32, sub, 20, "#dcd6f5", "middle")
    for p, y, n in mods[m]:
        g.raw(f'<rect x="{BX - 9}" y="{y - 8}" width="18" height="16" fill="{"#e8c766" if n else "#b9b4c4"}" stroke="#555"/>')
        g.text(BX + 20, y + 7, p + ("" if n else "  (not connected)"), 19, "#fff" if n else "#cbbfe0", w="bold" if n else "normal")
for n, x in BUS.items():
    g.text(x, 138, {"3.3V": "3.3 V"}.get(n, n), 20, COL[n], "middle", "bold")
    ys = [y for k, (q, y) in ard.items() if q == n] + [y for v in mods.values() for _, y, q in v if q == n]
    g.raw(f'<line x1="{x}" x2="{x}" y1="148" y2="{min(ys) - 8}" stroke="{COL[n]}" stroke-width="1.5" stroke-dasharray="4 5"/>')
g.text(640, 872, "four wires run between the levels", 18, "#4a6076", "middle", "bold")
g.save("wiring_schematic.svg")

# ------------------------------------------------------------------ 2. breadboard
S, OX, OY = 15.5, 70, 560
g = Svg(1520, 1010)


def X(c):
    return OX + (4.92 + 2.54 * (c - 1)) * S


def Y(y):
    return OY - y * S


def xy(h):
    return (X(h[1]), Y(RAILY[h[0]])) if isinstance(h[0], str) else (X(h[0]), Y(ROWY[h[1]]))


g.text(40, 44, "Curl Strap v4: breadboard from above", 28, "#111", w="bold")
g.text(40, 74, "Four wires come up from the Arduino through the gap at the far end. Match the LABELS on your boards; pin order can differ.", 18, "#555")
x0, x1 = OX, OX + 83.5 * S
g.raw(f'<rect x="{x0}" y="{Y(27.5)}" width="{x1 - x0}" height="{55 * S}" rx="10" fill="#f4f2ec" stroke="#bbb" stroke-width="2"/>')
g.raw(f'<rect x="{x0}" y="{Y(1.2)}" width="{x1 - x0}" height="{2.4 * S}" fill="#dcd8cd"/>')
for r, y in RAILY.items():
    c = "#d62728" if "+" in r else "#1f4fbf"
    off = 17 if y in (23.0, -20.5) else -17
    g.raw(f'<line x1="{X(1) - 10}" x2="{X(30) + 10}" y1="{Y(y) - off}" y2="{Y(y) - off}" stroke="{c}" stroke-width="1.5" opacity=".45"/>')
    g.text(x0 + 14, Y(y) + 7, r[1].replace("-", "−"), 22, c, w="bold")
for c in range(1, 31):
    for y in list(ROWY.values()) + list(RAILY.values()):
        g.raw(f'<circle cx="{X(c):.1f}" cy="{Y(y):.1f}" r="3.4" fill="#8d897f"/>')
    if c in (1, 5, 10, 15, 20, 22, 23, 25, 30):
        g.text(X(c), Y(-16.2) + 5, str(c), 14, "#777", "middle", "bold" if c in (22, 23) else "normal")
for r, y in ROWY.items():
    g.text(x0 + 44, Y(y) + 5, r, 14, "#777", "middle")
for xa, xb, ya, yb, fill, label, sub in (
        (X(1.6), X(9.5), Y(13.4), Y(-1.6), "#5b2d82", "BMX160", "USB end, glue the pins"),
        (X(10.3), X(20.7), Y(13.4), Y(-14.4), "#17407f", "OLED", "under the lid window")):
    g.raw(f'<rect x="{xa:.1f}" y="{ya:.1f}" width="{xb - xa:.1f}" height="{yb - ya:.1f}" rx="8" fill="{fill}" opacity=".93"/>')
    g.text((xa + xb) / 2, (ya + yb) / 2 + 22, label, 22, "#fff", "middle", "bold")
    g.text((xa + xb) / 2, (ya + yb) / 2 + 48, sub, 15, "#e8e8ff", "middle")
    for n, h in PARTS[label].items():
        x, y = xy(h)
        g.raw(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#e8c766" stroke="#7a5c00"/>')
        g.raw(f'<text transform="translate({x + 5:.1f} {y + 14:.1f}) rotate(90)" font-size="14" fill="#fff">{n}</text>')
lane = {(4, "j"): 16.0, (5, "j"): 16.9, (16, "j"): 17.8, (17, "j"): 18.6}
for a, b in JUMP:
    pa, pb = xy(a), xy(b)
    if isinstance(b[0], int):
        c = COL["SCL"] if b[0] == 23 else COL["SDA"]
        ly, xb = Y(lane[a]), pb[0] + (13 if a[0] > 10 else 0)
        g.wire([pa, (pa[0], ly), (xb, ly), (xb, pb[1]), pb], c, 3.5)
    else:
        g.wire([pa, pb], COL["3.3V"] if b[0] == "T+" else COL["GND"])
gapx = x1 + 12
g.raw(f'<rect x="{gapx}" y="{Y(12)}" width="110" height="{24 * S}" rx="8" fill="#eef3f8" stroke="#8aa0b5" stroke-width="2" stroke-dasharray="7 5"/>')
g.text(gapx + 55, Y(13.2), "wire gap", 16, "#4a6076", "middle", "bold")
for i, (n, h) in enumerate(UP):
    net = {"A4": "SDA", "A5": "SCL"}.get(n, n)
    px, py = xy(h)
    gy, sx = Y(9 - 6 * i), gapx + 14
    if n in ("3.3V", "GND"):
        bend = X(30) + (48 if n == "3.3V" else 36)
        pts = [(sx, gy), (bend, gy), (bend, py), (px, py)]
    else:
        ly = Y(ROWY["h"]) if n == "A5" else Y(ROWY["h"] + 1.27)
        bend = X(30) + (16 if n == "A5" else 26)
        pts = [(sx, gy), (bend, gy), (bend, ly), (px, ly), (px, py)]
    g.wire(pts, COL[net])
    g.text(gapx + 26, gy + 6, n, 17, COL[net], "start", "bold")
    if n in ("A4", "A5"):
        g.text(gapx + 60, gy + 6, f"({net})", 15, COL[net])
g.text(X(22.5), Y(ROWY["f"]) + 34, "22 = SDA   23 = SCL", 15, "#555", "middle")
g.text(x0, 1010 - 22, "◄ USB end", 18, "#333", w="bold")
g.text(x1, 1010 - 22, "far end ►", 18, "#333", "end", "bold")
g.save("wiring_breadboard.svg")
