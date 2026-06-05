#!/usr/bin/env python3
"""
maprang_app.py — BKN Pharmacy Server desktop dashboard.

Milestone 4 UX upgrade:
  * neon terminal / arcade visual inspired by the reference dashboard
  * real server status from bkn_ks_server.dashboard_status()
  * health, recent requests, request rate, response time and data-module counts
  * optimized low-CPU rendering with a cleaner cute Maprang sprite

Run:
    python maprang_app.py
    python maprang_app.py --port 9000

No external dependencies — Python stdlib + tkinter only.
"""

import sys
import time
import math
import os
import subprocess
import threading
import webbrowser
import tkinter as tk
import tkinter.font as tkfont

import bkn_ks_server as srv


# ── Neon terminal palette ───────────────────────────────────────────────────
BG      = "#02040a"
PANEL   = "#030812"
BORDER  = "#006dff"
BORDER2 = "#00b8ff"
CYAN    = "#00e5ff"
GREEN   = "#00ff2f"
DIMGRN  = "#007a21"
YELLOW  = "#fff23a"
MAGENTA = "#ff2fcf"
ORANGE  = "#ffb000"
WHITE   = "#f2f5ff"
GRAY    = "#a0a7b7"
DARK    = "#0b1020"
RED     = "#ff4040"


ENDPOINTS = ["/api/vdos", "/api/faqs", "/api/items", "/api/users", "/api/health", "/api/server-status"]
ITEM_KEYS = ["burger", "teddy", "ribbon", "star", "heart"]
ITEM_GLYPHS = {
    "burger": ("☰", ORANGE),
    "teddy": ("♙", ORANGE),
    "ribbon": ("⌘", MAGENTA),
    "star": ("☆", YELLOW),
    "heart": ("♡", MAGENTA),
}


def fmt_uptime(sec):
    sec = max(0, int(sec or 0))
    return f"{sec//3600:02}:{(sec%3600)//60:02}:{sec%60:02}"


def fmt_size(n):
    n = int(n or 0)
    if n >= 1024 * 1024:
        return f"{n / (1024*1024):.2f} MB"
    if n >= 1024:
        return f"{n / 1024:.2f} KB"
    return f"{n} B"


class MaprangApp:
    def __init__(self, root, port=None):
        self.root = root
        self.frame = 0
        self.frame_ms = 90        # responsive animation, but still low CPU
        self.star_seed = [(i * 83, i * 53, i % 6 == 0) for i in range(16)]
        self.mx = 0.08
        self.dir = 1
        self.pose = 0
        self.last_count = 0
        self.status = {
            "ok": False, "uptimeSec": 0, "requestCount": 0,
            "requestsPerMin": 0, "avgResponseMs": 0, "activeThreads": 0,
            "dataWritable": False, "endpoints": {}, "recent": [], "modules": {},
        }
        self.server = None
        self.server_ok = False
        self.server_err = ""
        self.score = 0
        self.collected = {k: 0 for k in ITEM_KEYS}
        self.activity_pulse = 0
        self.trend = []
        self.click_zones = []
        self.recent_filter = "all"
        self.toast = ""
        self.toast_until = 0

        # Start the embedded server. If it fails, keep the dashboard open and show the error.
        try:
            self.server, self.ip, self.port = srv.start_server_background(port)
            self.server_ok = True
        except Exception as e:
            self.ip, self.port = "127.0.0.1", port or getattr(srv, "DEFAULT_PORT", 8765)
            self.server_err = str(e)

        root.title("BKN Pharmacy Server — Maprang Neon Dashboard")
        root.configure(bg=BG)
        root.minsize(780, 520)
        try:
            root.state("zoomed")
        except Exception:
            pass

        self.mono = tkfont.Font(family="Consolas", size=11)
        self.monoS = tkfont.Font(family="Consolas", size=10)
        self.monoB = tkfont.Font(family="Consolas", size=11, weight="bold")
        self.big = tkfont.Font(family="Consolas", size=20, weight="bold")
        self.h2 = tkfont.Font(family="Consolas", size=12, weight="bold")
        self.title_font = tkfont.Font(family="Consolas", size=24, weight="bold")

        self.canvas = tk.Canvas(root, bg=BG, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Button-1>", self._click)

        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.bind("<Escape>", lambda e: self._on_close())
        root.bind("<Control-b>", lambda e: webbrowser.open(f"http://{self.ip}:{self.port}"))

        self._refresh_status()
        self._tick()

    # ── drawing helpers ────────────────────────────────────────────────────
    def panel(self, x, y, w, h, title=None):
        c = self.canvas
        c.create_rectangle(x, y, x + w, y + h, fill=PANEL, outline=BORDER, width=2)
        c.create_rectangle(x + 5, y + 5, x + w - 5, y + h - 5, outline="#003a8f", width=1)
        if title:
            c.create_text(x + 18, y + 20, text=title, fill=CYAN, font=self.h2, anchor="w")
            c.create_line(x + 12, y + 34, x + w - 12, y + 34, fill="#073c76")
            return x + 18, y + 48, w - 36, h - 60
        return x + 18, y + 14, w - 36, h - 28

    def text(self, x, y, s, fill=WHITE, font=None, anchor="w"):
        self.canvas.create_text(x, y, text=s, fill=fill, font=font or self.mono, anchor=anchor)

    def bar(self, x, y, w, pct, color):
        pct = max(0, min(100, float(pct or 0)))
        blocks = 8
        bw = w / blocks
        for i in range(blocks):
            bx = x + i * bw
            filled = (i + 1) <= int(round(pct / 100 * blocks))
            self.canvas.create_rectangle(bx, y, bx + bw - 3, y + 12,
                                         outline="#16304a", fill=color if filled else DARK)

    def sparkline(self, x, y, w, h, vals, color=GREEN):
        if len(vals) < 2:
            return
        mx = max(max(vals), 1)
        pts = []
        for i, v in enumerate(vals):
            pts.extend([x + (w * i / (len(vals) - 1)), y + h - (h * v / mx)])
        self.canvas.create_line(*pts, fill=color, width=2, smooth=True)

    def neon_text(self, x, y, s, fill, font=None, anchor="w"):
        # Single text draw: faster than glow shadows during continuous animation.
        self.canvas.create_text(x, y, text=s, fill=fill, font=font or self.mono, anchor=anchor)

    def button(self, x, y, w, h, label, action, color=CYAN):
        """Canvas button used for safe operator actions. Stores click zones."""
        self.canvas.create_rectangle(x, y, x + w, y + h, outline=color, fill=BG, width=1)
        self.text(x + w / 2, y + h / 2, label, color, self.monoS, "center")
        self.click_zones.append((x, y, x + w, y + h, action))

    def _toast(self, msg, seconds=2.5):
        self.toast = msg
        self.toast_until = time.time() + seconds

    # ── Maprang line-art sprite ────────────────────────────────────────────
    def draw_maprang_ascii(self, cx, cy, scale=1.0, mini=False):
        """Cleaner cute Maprang sprite.
        Vector shapes instead of dense ASCII arcs: fewer canvas objects, clearer face,
        and better performance on older Windows PCs.
        cy is the ground/feet baseline.
        """
        c = self.canvas
        s = float(scale)
        lw = max(1, int(2 * s))
        skin = "#ffe0c2"
        hair_col = "#39ff4d"
        dress = "#123f8c"
        dress_edge = CYAN
        flower = MAGENTA
        # soft neon shadow kept minimal
        if not mini:
            c.create_oval(cx - 34*s, cy - 8*s, cx + 34*s, cy + 5*s, outline="", fill="#031c0d")

        # running pose
        swing = math.sin(self.frame * 0.42) * 7 * s
        hop = math.sin(self.frame * 0.22) * 1.5 * s
        cy = cy + hop

        # legs behind skirt
        c.create_line(cx - 8*s, cy - 24*s, cx - 17*s - swing*.35, cy - 2*s, fill=skin, width=lw+1)
        c.create_line(cx + 8*s, cy - 24*s, cx + 17*s + swing*.35, cy - 2*s, fill=skin, width=lw+1)
        c.create_line(cx - 21*s - swing*.35, cy - 2*s, cx - 8*s - swing*.35, cy - 2*s, fill=GREEN, width=lw)
        c.create_line(cx + 13*s + swing*.35, cy - 2*s, cx + 25*s + swing*.35, cy - 2*s, fill=GREEN, width=lw)

        # dress / body
        shoulder_y = cy - 64*s
        waist_y = cy - 38*s
        hem_y = cy - 20*s
        c.create_polygon(cx, shoulder_y, cx - 24*s, hem_y, cx + 24*s, hem_y,
                         outline=dress_edge, fill=dress, width=lw)
        c.create_line(cx - 17*s, waist_y, cx + 17*s, waist_y, fill=dress_edge, width=lw)
        c.create_text(cx, waist_y + 3*s, text="♥", fill=MAGENTA, font=self.monoB)

        # arms
        c.create_line(cx - 14*s, shoulder_y + 8*s, cx - 30*s, cy - 44*s + swing, fill=skin, width=lw+1)
        c.create_line(cx + 14*s, shoulder_y + 8*s, cx + 30*s, cy - 44*s - swing, fill=skin, width=lw+1)
        c.create_oval(cx - 33*s, cy - 47*s + swing, cx - 27*s, cy - 41*s + swing, outline="", fill=skin)
        c.create_oval(cx + 27*s, cy - 47*s - swing, cx + 33*s, cy - 41*s - swing, outline="", fill=skin)

        # hair silhouette (cute bob)
        head_y = cy - 88*s
        c.create_oval(cx - 34*s, head_y - 28*s, cx + 34*s, head_y + 38*s,
                      outline=hair_col, fill="#07120a", width=lw+1)
        c.create_oval(cx - 42*s, head_y - 8*s, cx - 16*s, head_y + 36*s,
                      outline=hair_col, fill="#07120a", width=lw)
        c.create_oval(cx + 16*s, head_y - 8*s, cx + 42*s, head_y + 36*s,
                      outline=hair_col, fill="#07120a", width=lw)

        # face
        c.create_oval(cx - 26*s, head_y - 18*s, cx + 26*s, head_y + 34*s,
                      outline=GREEN, fill=skin, width=lw)
        # bangs
        for dx in (-18, -8, 3, 14):
            c.create_arc(cx + (dx-10)*s, head_y - 23*s, cx + (dx+12)*s, head_y + 10*s,
                         start=200, extent=120, outline=hair_col, width=lw, style="arc")
        # flower accessory
        fx, fy = cx + 25*s, head_y - 19*s
        for ox, oy in ((0,-7),(7,0),(0,7),(-7,0)):
            c.create_oval(fx + (ox-5)*s, fy + (oy-5)*s, fx + (ox+5)*s, fy + (oy+5)*s,
                          outline=flower, fill="#220018", width=lw)
        c.create_oval(fx - 4*s, fy - 4*s, fx + 4*s, fy + 4*s, outline=YELLOW, fill=YELLOW, width=1)

        # face details: clearer and cuter
        c.create_oval(cx - 12*s, head_y + 1*s, cx - 7*s, head_y + 8*s, outline="", fill="#111111")
        c.create_oval(cx + 7*s, head_y + 1*s, cx + 12*s, head_y + 8*s, outline="", fill="#111111")
        c.create_oval(cx - 10*s, head_y + 2*s, cx - 8*s, head_y + 4*s, outline="", fill=WHITE)
        c.create_oval(cx + 9*s, head_y + 2*s, cx + 11*s, head_y + 4*s, outline="", fill=WHITE)
        c.create_arc(cx - 10*s, head_y + 10*s, cx + 10*s, head_y + 23*s,
                     start=205, extent=130, outline="#c42c66", width=lw, style="arc")
        c.create_oval(cx - 21*s, head_y + 11*s, cx - 15*s, head_y + 17*s, outline="", fill="#ff9fc0")
        c.create_oval(cx + 15*s, head_y + 11*s, cx + 21*s, head_y + 17*s, outline="", fill="#ff9fc0")

        # small motion lines, not too many
        if not mini:
            c.create_line(cx - 46*s, cy - 12*s, cx - 60*s, cy - 12*s, fill=YELLOW, width=lw)
            c.create_line(cx - 42*s, cy - 2*s, cx - 54*s, cy + 2*s, fill=YELLOW, width=lw)

    def draw_collectible(self, x, y, key, big=False):
        glyph, color = ITEM_GLYPHS[key]
        font = self.big if big else self.h2
        if key == "burger":
            self.canvas.create_arc(x-17, y-10, x+17, y+16, start=0, extent=180, outline=color, width=2)
            self.canvas.create_line(x-14, y+3, x+14, y+3, fill=color, width=2)
            self.canvas.create_line(x-10, y+10, x+10, y+10, fill=color, width=2)
        elif key == "teddy":
            self.canvas.create_text(x, y, text="♙", fill=color, font=font)
        elif key == "ribbon":
            self.canvas.create_text(x, y, text="⋈", fill=color, font=font)
        elif key == "star":
            self.canvas.create_text(x, y, text="☆", fill=color, font=font)
        else:
            self.canvas.create_text(x, y, text="♡", fill=color, font=font)

    # ── render ──────────────────────────────────────────────────────────────
    def render(self):
        c = self.canvas
        c.delete("all")
        self.click_zones = []
        W = max(1, self.canvas.winfo_width() or 1280)
        H = max(1, self.canvas.winfo_height() or 800)
        pad = 8 if W < 980 else 10

        header_h = 50 if H < 650 else 58
        title_h = 54 if H < 650 else 66
        self.render_header(pad, pad, W - pad * 2, header_h)
        self.render_title(pad, pad + header_h + 6, W - pad * 2, title_h)

        top_y = pad + header_h + title_h + 16
        footer_h = 28
        usable_h = max(260, H - top_y - footer_h - pad)

        if W >= 1080:
            # Wide desktop layout: game + sidebar, then recent + live.
            rightW = min(330, max(285, int(W * 0.24)))
            leftW = W - rightW - pad * 3
            bottomH = max(145, min(205, int(usable_h * 0.30)))
            gameH = max(250, usable_h - bottomH - pad)
            self.render_game(pad, top_y, leftW, gameH)
            self.render_sidebar(pad * 2 + leftW, top_y, rightW, gameH)
            bottom_y = top_y + gameH + pad
            self.render_recent(pad, bottom_y, leftW, bottomH)
            self.render_live(pad * 2 + leftW, bottom_y, rightW, bottomH)
        elif W >= 860:
            # Medium layout: game full width, operational panels in two columns.
            gameH = max(210, int(usable_h * 0.48))
            self.render_game(pad, top_y, W - pad * 2, gameH)
            lower_y = top_y + gameH + pad
            lower_h = max(145, H - lower_y - footer_h - pad)
            colW = (W - pad * 3) / 2
            self.render_sidebar_compact(pad, lower_y, colW, lower_h)
            self.render_recent(pad * 2 + colW, lower_y, colW, lower_h)
        else:
            # Small window layout: prioritized operational view, no overflow.
            gameH = max(180, int(usable_h * 0.43))
            self.render_game(pad, top_y, W - pad * 2, gameH)
            lower_y = top_y + gameH + pad
            lower_h = max(130, H - lower_y - footer_h - pad)
            colW = (W - pad * 3) / 2
            if colW >= 250:
                self.render_health(pad, lower_y, colW, lower_h)
                self.render_stats(pad * 2 + colW, lower_y, colW, lower_h)
            else:
                self.render_health(pad, lower_y, W - pad * 2, lower_h)

        # footer note
        self.canvas.create_rectangle(pad, H - footer_h, W - pad, H - 6, outline=BORDER, fill=BG)
        footer = "Esc: stop server | Ctrl+B: open web | status refresh 5s | module scan 12s"
        if self.toast and time.time() < self.toast_until:
            footer = self.toast
        self.text(pad + 14, H - footer_h/2 - 3, footer, YELLOW if self.toast and time.time() < self.toast_until else GRAY, self.monoS if W < 980 else self.mono)

    def render_header(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h)
        st = self.status
        last = "—"
        if st.get("recent"):
            r = st["recent"][-1]
            last = f"{r.get('method','')} {r.get('path','')}"[:50]
        items = [
            ("◎", f"http://{self.ip}:{self.port}", CYAN, WHITE),
            ("◴", f"Uptime: {fmt_uptime(st.get('uptimeSec', 0))}", ORANGE, CYAN),
            ("▥", f"Requests: {st.get('requestCount', 0)}", MAGENTA, WHITE),
            ("⚡", f"Last: {last}", YELLOW, WHITE),
        ]
        xx = ix + 4
        for idx, (ico, val, ic, vc) in enumerate(items):
            self.neon_text(xx, y + h/2, ico, ic, self.h2, "w")
            xx += 32
            self.neon_text(xx, y + h/2, val, vc, self.monoB, "w")
            xx += self.monoB.measure(val) + 28
            if idx < len(items) - 1:
                self.text(xx - 14, y + h/2, "│", BORDER2, self.h2)

    def render_title(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h)
        reqs = int(self.status.get("requestCount", 0) or 0)
        ok_window = int(self.status.get("okCountWindow", 0) or 0)
        self.score = reqs * 7 + ok_window * 3
        self.neon_text(ix + 8, y + h/2, "✿  Maprang  Plays!  ✿", MAGENTA, self.title_font)
        self.neon_text(ix + iw/2 + 70, y + h/2, f"☆ Score: {self.score} ☆", YELLOW, self.title_font)
        badge = "ONLINE" if self.status.get("ok") and self.server_ok else "DEGRADED" if self.server_ok else "ERROR"
        col = GREEN if badge == "ONLINE" else YELLOW if badge == "DEGRADED" else RED
        self.canvas.create_rectangle(x + w - 158, y + 18, x + w - 24, y + 48, outline=col, fill=BG, width=2)
        self.text(x + w - 91, y + 33, badge, col, self.monoB, "center")

    def render_game(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "LEVEL 1 — RUN, COLLECT, AND SCORE!")
        self.text(ix + iw - 18, y + 22, "Use your APIs. Collect joy. 🐾", CYAN, self.monoB, "e")
        # stars — reduced object count for smoother redraw on older PCs
        for i, (sx0, sy0, hi) in enumerate(self.star_seed):
            sx = ix + ((sx0 + self.frame * 2) % max(1, int(iw)))
            sy = iy + 16 + (sy0 % max(1, int(ih * 0.52)))
            glyph = "*" if (i + self.frame // 7) % 6 else "✦"
            self.text(sx, sy, glyph, YELLOW if hi else WHITE, self.monoS, "center")
        # moon and clouds line-art
        mx = ix + iw - 80
        my = iy + 54
        self.canvas.create_arc(mx - 20, my - 24, mx + 22, my + 24, start=-80, extent=250, outline=YELLOW, width=2, style="arc")
        self.canvas.create_arc(mx - 5, my - 24, mx + 34, my + 24, start=80, extent=-250, outline=YELLOW, width=2, style="arc")
        for cx, cy in [(ix + 130 + (self.frame % 80), iy + 55), (ix + iw * .62, iy + 34)]:
            self.canvas.create_arc(cx-42, cy-18, cx-14, cy+10, start=20, extent=160, outline=CYAN, width=2, style="arc")
            self.canvas.create_arc(cx-20, cy-28, cx+18, cy+12, start=10, extent=170, outline=CYAN, width=2, style="arc")
            self.canvas.create_arc(cx+8, cy-18, cx+50, cy+10, start=0, extent=170, outline=CYAN, width=2, style="arc")
            self.canvas.create_line(cx-42, cy+10, cx+50, cy+10, fill=CYAN, width=2, dash=(5,3))

        ground = iy + ih - 46
        # platforms as green dashed line blocks
        platforms = [(0.04, 0.88, .18), (0.28, 0.78, .12), (0.45, 0.70, .22), (0.62, 0.55, .14), (0.78, 0.84, .17), (0.88, 0.72, .13)]
        for px, py, pw in platforms:
            bx, by = ix + iw * px, iy + ih * py
            self.canvas.create_line(bx, by, bx + iw * pw, by, fill=GREEN, width=2)
            self.canvas.create_line(bx, by + 12, bx + iw * pw, by + 12, fill=DIMGRN, width=2, dash=(6,3))
            self.canvas.create_line(bx, by, bx, by + 12, fill=GREEN, width=1)
            self.canvas.create_line(bx + iw * pw, by, bx + iw * pw, by + 12, fill=GREEN, width=1)
        self.canvas.create_line(ix, ground, ix + iw, ground, fill=GREEN, width=2)
        self.canvas.create_line(ix, ground + 12, ix + iw, ground + 12, fill=DIMGRN, width=2, dash=(6,3))

        # hills / jump arcs
        for start in (ix + iw * .28, ix + iw * .58):
            pts = []
            for a in range(18):
                px = start + a * 14
                py = ground - 62 * math.sin(a / 17 * math.pi) - (a % 2) * 2
                pts.extend([px, py])
            self.canvas.create_line(*pts, fill=GREEN, width=2, dash=(2,6), smooth=True)

        # collectibles
        objs = [(0.36, .76, "burger"), (.49, .67, "teddy"), (.63, .61, "ribbon"), (.76, .49, "star"), (.95, .67, "heart")]
        for px, py, key in objs:
            bob = math.sin(self.frame * .15 + px * 7) * 4
            self.draw_collectible(ix + iw * px, iy + ih * py + bob, key, True)

        # Maprang position, with pulse when new requests arrive
        self.mx += (0.010 + min(0.012, self.activity_pulse * 0.0012)) * self.dir
        if self.mx > .96:
            self.mx, self.dir = .96, -1
        elif self.mx < .05:
            self.mx, self.dir = .05, 1
        jump = abs(math.sin(self.frame * 0.30)) * (22 + min(18, self.activity_pulse))
        self.draw_maprang_ascii(ix + iw * self.mx, ground - jump, max(0.78, min(1.10, iw / 980)))
        # little grass
        for gx in range(0, int(iw), 180):
            bx = ix + gx + (self.frame % 8)
            self.canvas.create_line(bx, ground, bx + 8, ground - 10, fill=GREEN)
            self.canvas.create_line(bx + 8, ground, bx + 16, ground - 9, fill=GREEN)

    def render_sidebar(self, x, y, w, h):
        ph1 = 170
        ph2 = 178
        ph3 = 170
        ph4 = max(130, h - ph1 - ph2 - ph3 - 24)
        self.render_health(x, y, w, ph1)
        self.render_stats(x, y + ph1 + 8, w, ph2)
        self.render_modules(x, y + ph1 + ph2 + 16, w, ph3)
        self.render_actions_items(x, y + ph1 + ph2 + ph3 + 24, w, ph4)

    def render_sidebar_compact(self, x, y, w, h):
        """Responsive compact operator area for medium windows."""
        h = max(130, h)
        top_h = max(120, int(h * 0.50))
        self.render_health(x, y, w, top_h)
        self.render_stats(x, y + top_h + 8, w, max(110, h - top_h - 8))

    def render_modules(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "MODULE STATUS")
        modules = self.status.get("modulesDetail") or []
        # Show the most operational modules first; counts come from /api/server-status.
        preferred = ["KPI days", "Medication DB", "Med images", "Patients", "Schedule", "Logs"]
        ordered = []
        for name in preferred:
            ordered.extend([m for m in modules if m.get("name") == name])
        for m in modules:
            if m not in ordered:
                ordered.append(m)
        row = iy + 2
        for m in ordered[:6]:
            ok = bool(m.get("ok"))
            col = GREEN if ok else RED
            self.canvas.create_oval(ix, row - 7, ix + 10, row + 3, outline="", fill=col)
            self.text(ix + 18, row, str(m.get("name", ""))[:19], WHITE, self.monoS)
            self.text(ix + iw - 4, row, str(m.get("count", 0)), YELLOW, self.monoB, "e")
            row += 21
        if not modules:
            self.text(ix, row, "Waiting for module data...", GRAY, self.monoS)

    def render_actions_items(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "TOOLS + ITEMS")
        bw = (iw - 8) / 2
        self.button(ix, iy, bw, 24, "Open Web", "open_browser", CYAN)
        self.button(ix + bw + 8, iy, bw, 24, "Copy URL", "copy_url", CYAN)
        self.button(ix, iy + 30, bw, 24, "Data Folder", "open_data", YELLOW)
        self.button(ix + bw + 8, iy + 30, bw, 24, "Logs", "open_logs", YELLOW)
        self.button(ix, iy + 60, iw, 24, "Health JSON", "open_health", GREEN if self.status.get("ok") else RED)
        # compact collectible counters
        gap = iw / 5
        y0 = iy + 112
        for i, key in enumerate(ITEM_KEYS):
            cx = ix + gap * i + gap / 2
            self.draw_collectible(cx, y0, key, False)
            self.text(cx, y0 + 24, f"{self.collected[key]:02d}", ITEM_GLYPHS[key][1], self.monoS, "center")

    def render_health(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "ENDPOINT HEALTH")
        endpoints = self.status.get("endpoints") or {}
        row = iy + 4
        for ep in ENDPOINTS:
            info = endpoints.get(ep, {})
            ok = bool(info.get("ok")) if info else False
            col = GREEN if ok else RED
            code = info.get("status", "—") if info else "—"
            self.text(ix, row, ep, WHITE, self.monoB)
            self.canvas.create_oval(ix + iw - 86, row - 7, ix + iw - 74, row + 5, outline="", fill=col)
            self.text(ix + iw - 8, row, str(code), col, self.monoB, "e")
            row += 22

    def render_stats(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "SERVER STATS")
        rpm = float(self.status.get("requestsPerMin", 0) or 0)
        avg = int(self.status.get("avgResponseMs", 0) or 0)
        threads = int(self.status.get("activeThreads", 0) or 0)
        data_ok = bool(self.status.get("dataWritable"))
        load_pct = min(100, rpm * 4)
        resp_pct = min(100, avg / 5) if avg else 5
        data_pct = 100 if data_ok else 20
        row = iy + 4
        self.text(ix, row, "API Load", WHITE); self.bar(ix + 122, row - 7, 88, load_pct, GREEN if load_pct < 70 else YELLOW)
        self.text(ix + iw - 5, row, f"{load_pct:.0f}%", CYAN, self.monoB, "e"); row += 26
        self.text(ix, row, "Data Health", WHITE); self.bar(ix + 122, row - 7, 88, data_pct, GREEN if data_ok else RED)
        self.text(ix + iw - 5, row, "OK" if data_ok else "FAIL", GREEN if data_ok else RED, self.monoB, "e"); row += 26
        self.text(ix, row, "Active Threads", WHITE); self.bar(ix + 122, row - 7, 88, min(100, threads * 8), GREEN)
        self.text(ix + iw - 5, row, str(threads), YELLOW, self.monoB, "e"); row += 26
        self.text(ix, row, "Req / Min", WHITE); self.text(ix + iw - 5, row, f"{rpm:.1f}", YELLOW, self.monoB, "e"); row += 24
        self.text(ix, row, "Avg Resp Time", WHITE); self.text(ix + iw - 5, row, f"{avg}ms", YELLOW, self.monoB, "e"); row += 20
        self.sparkline(ix, row, iw, 36, self.trend)

    def render_items(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "ITEMS COLLECTED")
        gap = iw / 5
        for i, key in enumerate(ITEM_KEYS):
            cx = ix + gap * i + gap / 2
            self.draw_collectible(cx, iy + 26, key, True)
            self.text(cx, iy + 62, f"× {self.collected[key]:02d}", ITEM_GLYPHS[key][1], self.monoB, "center")

    def _fit_text(self, text, max_px, font=None):
        """Return text shortened to fit a Canvas column width.
        Prevents long API paths from overlapping STATUS / SIZE columns on
        narrow dashboard windows. Uses Tk font measurement, not character count.
        """
        text = str(text or "")
        font = font or self.mono
        if max_px <= 0:
            return ""
        if font.measure(text) <= max_px:
            return text
        ell = "…"
        # Binary search keeps this cheap even for very long URLs/paths.
        lo, hi = 0, len(text)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if font.measure(text[:mid] + ell) <= max_px:
                lo = mid
            else:
                hi = mid - 1
        return (text[:lo] + ell) if lo > 0 else ell

    def render_recent(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "RECENT REQUESTS")
        # quick filters for troubleshooting API / extension issues
        self.button(ix + iw - 160, y + 14, 72, 22, "All", "filter_all", GREEN if self.recent_filter == "all" else CYAN)
        self.button(ix + iw - 82, y + 14, 72, 22, "Errors", "filter_errors", RED if self.recent_filter == "errors" else CYAN)

        # Responsive columns. The previous fixed layout let long /api/patients/...
        # paths draw into STATUS/SIZE. Keep STATUS and SIZE pinned to the right,
        # then dynamically calculate the remaining path width and ellipsize it.
        compact = iw < 560
        time_x = ix
        method_x = ix + (118 if compact else 132)
        path_x = ix + (172 if compact else 220)
        status_x = ix + iw - (86 if compact else 112)
        size_x = ix + iw - 6
        path_w = max(40, status_x - path_x - 12)
        show_size = iw >= 430

        headers = [("TIME", time_x), ("METHOD", method_x), ("PATH", path_x), ("STATUS", status_x)]
        if show_size:
            headers.append(("SIZE", size_x))
        for name, cx in headers:
            self.text(cx, iy, name, GRAY, self.monoB, "e" if name == "SIZE" else "w")
        self.canvas.create_line(ix, iy + 20, ix + iw, iy + 20, fill=GRAY, dash=(5, 4))

        recent_all = (self.status.get("recent") or [])
        if self.recent_filter == "errors":
            recent_all = [r for r in recent_all if not str(r.get("status", "")).startswith("2") and str(r.get("status", "")) != "ok"]
        # Keep row count responsive so the bottom of the table does not collide
        # with lower panels when the window is short.
        max_rows = max(3, min(8, int((ih - 44) // 23)))
        recent = recent_all[-max_rows:]
        row = iy + 42
        for r in recent:
            st = str(r.get("status", ""))
            col = GREEN if st.startswith("2") or st == "ok" else YELLOW if st.startswith("3") else RED
            time_txt = self._fit_text(f"[{r.get('time','--:--:--')}]", method_x - time_x - 8)
            method_txt = self._fit_text(r.get("method", ""), path_x - method_x - 8)
            path_txt = self._fit_text(r.get("path", ""), path_w)
            self.text(time_x, row, time_txt, GRAY)
            self.text(method_x, row, method_txt, WHITE)
            self.text(path_x, row, path_txt, WHITE)
            self.text(status_x, row, st, col, self.monoB)
            if show_size:
                self.text(size_x, row, fmt_size(r.get("size", 0)), GRAY, self.mono, "e")
            row += 23
        if not recent:
            msg = self.server_err if not self.server_ok else ("No errors in recent requests." if self.recent_filter == "errors" else "Waiting for API activity...")
            self.text(ix, row, self._fit_text(msg, iw - 8, self.monoB), RED if not self.server_ok else GRAY, self.monoB)

    def render_live(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "LIVE ACTIVITY")
        base = iy + ih - 46
        self.draw_maprang_ascii(ix + 58, base, 0.66, mini=True)
        for a in range(12):
            ax = ix + 104 + a * 13
            ay = base - 16 - 22 * math.sin(a / 11 * math.pi) + math.sin(self.frame * .18) * 2
            self.text(ax, ay, "·", GREEN, self.monoS, "center")
        self.draw_collectible(ix + iw - 76, base - 54, "teddy", True)
        # tiny sunrise / signal
        self.canvas.create_arc(ix + iw - 58, base - 20, ix + iw - 18, base + 20, start=0, extent=180, outline=GREEN, width=2)
        for i in range(7):
            a = math.pi * i / 6
            self.canvas.create_line(ix + iw - 38 + math.cos(a)*28, base + math.sin(a)*28,
                                    ix + iw - 38 + math.cos(a)*36, base + math.sin(a)*36,
                                    fill=GREEN, width=2)
        # progress ground
        for i in range(18):
            self.canvas.create_rectangle(ix + i * 13, base + 22, ix + i * 13 + 8, base + 30, outline=GREEN)
        if not self.server_ok:
            msg, col = "Server failed to start — check port or file path.", RED
        elif self.status.get("errorCountWindow", 0):
            msg, col = "Some requests need attention. Check recent list.", YELLOW
        elif self.status.get("ok"):
            msg, col = "Running smoothly! Keep going! 🚀", GREEN
        else:
            msg, col = "Server is running, but data health is degraded.", YELLOW
        self.text(ix, iy + ih - 12, msg, col, self.monoB)

    # ── status and animation loop ──────────────────────────────────────────
    def _refresh_status(self):
        try:
            if hasattr(srv, "dashboard_status"):
                self.status = srv.dashboard_status()
            else:
                self.status = {
                    "ok": self.server_ok, "uptimeSec": int(time.time() - (srv._SERVER_START or time.time())),
                    "requestCount": getattr(srv, "_req_count", 0), "endpoints": {}, "recent": [],
                    "modules": {}, "requestsPerMin": 0, "avgResponseMs": 0,
                    "activeThreads": threading.active_count(), "dataWritable": True,
                }
        except Exception as e:
            self.status = dict(self.status or {})
            self.status.update({"ok": False, "lastStatusError": str(e)})
        self.root.after(5000, self._refresh_status)

    def _update_activity(self):
        count = int(self.status.get("requestCount", 0) or 0)
        if count > self.last_count:
            delta = count - self.last_count
            self.activity_pulse = min(24, self.activity_pulse + delta * 3)
            for i in range(delta):
                key = ITEM_KEYS[(count + i) % len(ITEM_KEYS)]
                self.collected[key] += 1
        self.last_count = count
        self.activity_pulse = max(0, self.activity_pulse - 0.9)
        self.trend.append(float(self.status.get("requestsPerMin", 0) or 0) + (self.activity_pulse / 8.0))
        if len(self.trend) > 42:
            self.trend.pop(0)

    def _tick(self):
        self.frame += 1
        self.pose = self.frame % 3
        self._update_activity()
        try:
            self.render()
        except Exception as e:
            # keep the dashboard alive even if a glyph/font issue happens
            try:
                self.canvas.delete("all")
                self.text(20, 20, f"Dashboard render error: {e}", RED, self.monoB)
            except Exception:
                pass
        self.root.after(self.frame_ms, self._tick)

    def _click(self, event):
        for x1, y1, x2, y2, action in list(self.click_zones):
            if x1 <= event.x <= x2 and y1 <= event.y <= y2:
                self._do_action(action)
                return
        # Header URL area opens the server in a browser.
        if event.y < 75:
            self._do_action("open_browser")

    def _open_folder(self, path):
        try:
            if os.name == "nt":
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            self._toast(f"Opened: {path}")
        except Exception as e:
            self._toast(f"Cannot open folder: {e}")

    def _do_action(self, action):
        url = f"http://{self.ip}:{self.port}"
        if action == "open_browser":
            webbrowser.open(url)
            self._toast("Opened server in browser")
        elif action == "open_health":
            webbrowser.open(url + "/api/server-status")
            self._toast("Opened health JSON")
        elif action == "copy_url":
            try:
                self.root.clipboard_clear()
                self.root.clipboard_append(url)
                self._toast("Server URL copied")
            except Exception as e:
                self._toast(f"Copy failed: {e}")
        elif action == "open_data":
            self._open_folder(str(getattr(srv, "DATA_DIR", "data")))
        elif action == "open_logs":
            self._open_folder(str(getattr(srv, "LOGS_DIR", "data/logs")))
        elif action == "filter_all":
            self.recent_filter = "all"
            self._toast("Showing all recent requests")
        elif action == "filter_errors":
            self.recent_filter = "errors"
            self._toast("Showing errors only")


    def _on_close(self):
        try:
            if self.server:
                self.server.shutdown()
                self.server.server_close()
        except Exception:
            pass
        self.root.destroy()


def main():
    port = None
    if "--port" in sys.argv:
        try:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        except Exception:
            pass
    root = tk.Tk()
    MaprangApp(root, port)
    root.mainloop()


if __name__ == "__main__":
    main()
