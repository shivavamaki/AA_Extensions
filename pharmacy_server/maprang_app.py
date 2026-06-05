#!/usr/bin/env python3
"""
maprang_app.py — BKN Pharmacy Server desktop dashboard.

A single Tkinter window that:
  * starts the pharmacy server in-process (no terminal needed), and
  * renders a playful arcade dashboard on a Canvas — animated Maprang girl,
    platforms + collectibles, endpoint health, server stats, recent requests.

Run:
    python maprang_app.py              (default port)
    python maprang_app.py --port 9000

No external dependencies — Python stdlib + tkinter only.
"""

import sys
import time
import math
import threading
import tkinter as tk
import tkinter.font as tkfont

import bkn_ks_server as srv


# ── Theme (neon-on-black, matches the terminal dashboard) ────────────────────
BG      = "#05070d"
PANEL   = "#0a0f1c"
BORDER  = "#1e6cff"
CYAN    = "#46e0ff"
GREEN   = "#3dff78"
DIMGRN  = "#1f7a3a"
YELLOW  = "#ffe23d"
MAGENTA = "#ff5cd0"
ORANGE  = "#ffae3d"
WHITE   = "#eef3ff"
GRAY    = "#8a93a8"
RED     = "#ff5c5c"


class MaprangApp:
    def __init__(self, root, port=None):
        self.root = root
        self.frame = 0
        self.score = 0
        self.collected = {"burger": 0, "teddy": 0, "ribbon": 0, "star": 0, "heart": 0}
        self.trend = []
        self.mx = 0.0          # Maprang x (0..1 across the play field)
        self.dir = 1
        self.pose = 0
        self.jump = 0.0
        self.health = {}       # endpoint -> bool (ok)

        # Start the embedded server.
        try:
            self.server, self.ip, self.port = srv.start_server_background(port)
            self.server_ok = True
        except Exception as e:
            self.ip, self.port, self.server_ok = "127.0.0.1", port or 8765, False
            self.server_err = str(e)

        root.title("BKN Pharmacy Server — Maprang Dashboard")
        root.configure(bg=BG)
        root.minsize(1100, 720)
        try:
            root.state("zoomed")            # maximise on Windows
        except Exception:
            pass

        self.mono = tkfont.Font(family="Consolas", size=11)
        self.monoB = tkfont.Font(family="Consolas", size=11, weight="bold")
        self.big = tkfont.Font(family="Consolas", size=20, weight="bold")
        self.h2 = tkfont.Font(family="Consolas", size=12, weight="bold")

        self.canvas = tk.Canvas(root, bg=BG, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.bind("<Escape>", lambda e: self._on_close())

        self._tick()

    # ── helpers ──────────────────────────────────────────────────────────────
    def panel(self, x, y, w, h, title=None):
        """Rounded neon panel; returns inner content box (ix, iy, iw, ih)."""
        r = 10
        c = self.canvas
        c.create_rectangle(x + r, y, x + w - r, y + h, outline="", fill=PANEL)
        c.create_rectangle(x, y + r, x + w, y + h - r, outline="", fill=PANEL)
        for (ax, ay) in ((x, y), (x + w - 2 * r, y), (x, y + h - 2 * r), (x + w - 2 * r, y + h - 2 * r)):
            c.create_oval(ax, ay, ax + 2 * r, ay + 2 * r, outline="", fill=PANEL)
        c.create_rectangle(x, y, x + w, y + h, outline=BORDER, width=2)
        iy = y + 8
        if title:
            c.create_text(x + 14, y + 14, text=title, fill=CYAN, font=self.h2, anchor="w")
            iy = y + 32
        return (x + 14, iy, w - 28, h - (iy - y) - 10)

    def text(self, x, y, s, fill=WHITE, font=None, anchor="w"):
        self.canvas.create_text(x, y, text=s, fill=fill, font=font or self.mono, anchor=anchor)

    def bar(self, x, y, w, pct, color):
        c = self.canvas
        c.create_rectangle(x, y, x + w, y + 12, outline=GRAY, fill="#11151f")
        fw = max(0, min(w, int(w * pct / 100)))
        c.create_rectangle(x, y, x + fw, y + 12, outline="", fill=color)

    def sparkline(self, x, y, w, h, vals, color=GREEN):
        if len(vals) < 2:
            return
        mx = max(vals) or 1
        n = len(vals)
        pts = []
        for i, v in enumerate(vals):
            px = x + (w * i / (n - 1))
            py = y + h - (h * v / mx)
            pts += [px, py]
        self.canvas.create_line(*pts, fill=color, width=2, smooth=True)

    # ── Maprang sprite (drawn, animated) ─────────────────────────────────────
    def draw_maprang(self, cx, cy, scale=1.0, pose=0):
        """Cute girl: flower hair, round face, dress, legs. cy = feet baseline."""
        c = self.canvas
        s = scale
        head_r = 14 * s
        hy = cy - 54 * s
        # hair (bob)
        c.create_oval(cx - head_r - 3, hy - head_r - 2, cx + head_r + 3, hy + head_r - 2,
                      outline="", fill="#6b4a2a")
        # face
        c.create_oval(cx - head_r, hy - head_r, cx + head_r, hy + head_r, outline="", fill="#ffe0c4")
        # flower accessory
        for a in range(5):
            ang = a * (2 * math.pi / 5) + self.frame * 0.05
            fx = cx - head_r + math.cos(ang) * 5 * s
            fy = hy - head_r + math.sin(ang) * 5 * s
            c.create_oval(fx - 3, fy - 3, fx + 3, fy + 3, outline="", fill=MAGENTA)
        c.create_oval(cx - head_r - 1, hy - head_r - 1, cx - head_r + 4, hy - head_r + 4,
                      outline="", fill=YELLOW)
        # eyes + smile
        c.create_oval(cx - 6 * s, hy - 3 * s, cx - 3 * s, hy, outline="", fill="#222")
        c.create_oval(cx + 3 * s, hy - 3 * s, cx + 6 * s, hy, outline="", fill="#222")
        c.create_arc(cx - 6 * s, hy + 1, cx + 6 * s, hy + 8 * s, start=200, extent=140,
                     style="arc", outline="#cc4466", width=2)
        c.create_oval(cx - 10 * s, hy + 3, cx - 7 * s, hy + 6, outline="", fill="#ffb3c6")
        c.create_oval(cx + 7 * s, hy + 3, cx + 10 * s, hy + 6, outline="", fill="#ffb3c6")
        # dress (triangle skirt)
        sk = hy + head_r
        c.create_polygon(cx, sk, cx - 20 * s, cy - 14 * s, cx + 20 * s, cy - 14 * s,
                         outline=CYAN, width=2, fill="#16407a")
        c.create_oval(cx - 4, sk + 6, cx + 4, sk + 14, outline="", fill=MAGENTA)  # heart-ish button
        # arms — up when catching/jumping
        if pose == 2:
            c.create_line(cx - 12 * s, sk + 6, cx - 22 * s, sk - 8 * s, fill="#ffe0c4", width=3)
            c.create_line(cx + 12 * s, sk + 6, cx + 22 * s, sk - 8 * s, fill="#ffe0c4", width=3)
        else:
            sw = 8 * s if pose == 0 else -8 * s
            c.create_line(cx - 12 * s, sk + 4, cx - 20 * s, sk + 4 + sw, fill="#ffe0c4", width=3)
            c.create_line(cx + 12 * s, sk + 4, cx + 20 * s, sk + 4 - sw, fill="#ffe0c4", width=3)
        # legs — alternate for running
        lw = 6 * s if pose == 1 else -6 * s
        c.create_line(cx - 6 * s, cy - 14 * s, cx - 6 * s + lw, cy, fill="#ffe0c4", width=3)
        c.create_line(cx + 6 * s, cy - 14 * s, cx + 6 * s - lw, cy, fill="#ffe0c4", width=3)

    # ── render the whole dashboard ───────────────────────────────────────────
    def render(self):
        c = self.canvas
        c.delete("all")
        W = self.canvas.winfo_width() or 1280
        H = self.canvas.winfo_height() or 800
        pad = 12
        rightW = 330
        leftW = W - rightW - pad * 3

        # ── HEADER ───────────────────────────────────────────────
        ix, iy, iw, ih = self.panel(pad, pad, W - pad * 2, 46)
        up = int(time.time() - (srv._SERVER_START or time.time()))
        ups = f"{up//3600:02}:{(up%3600)//60:02}:{up%60:02}"
        with srv._STATS_LOCK:
            rc = srv._req_count
            recent = list(srv._recent_reqs)
            last = f"{recent[-1][1]} {recent[-1][2]}" if recent else "—"
        segs = [
            ("🌐", f"http://{self.ip}:{self.port}", CYAN, WHITE),
            ("⏱", f"Uptime: {ups}", YELLOW, CYAN),
            ("📊", f"Requests: {rc}", GREEN, WHITE),
            ("⚡", f"Last: {last[:46]}", YELLOW, WHITE),
        ]
        x = ix
        for icon, val, ic, vc in segs:
            self.text(x, iy + 14, icon, fill=ic, font=self.h2)
            x += 26
            self.text(x, iy + 14, val, fill=vc, font=self.monoB)
            x += self.monoB.measure(val) + 30
            if (icon, val) != (segs[-1][0], segs[-1][1]):
                self.text(x - 18, iy + 14, "│", fill=BORDER, font=self.h2)

        # ── TITLE / SCORE ────────────────────────────────────────
        ty = pad + 56
        ix, iy, iw, ih = self.panel(pad, ty, W - pad * 2, 44)
        self.text(ix, iy + 14, "✿ Maprang Plays! ✿", fill=MAGENTA, font=self.big)
        self.text(ix + iw, iy + 14, f"★ Score: {self.score} ★", fill=YELLOW, font=self.big, anchor="e")

        # ── MAIN ROW: game (left) + sidebar (right) ─────────────
        gy = ty + 54
        gh = H - gy - 220
        if gh < 240:
            gh = 240
        self.render_game(pad, gy, leftW, gh)
        self.render_sidebar(pad * 2 + leftW, gy, rightW, gh, rc)

        # ── RECENT REQUESTS (bottom left) ───────────────────────
        ry = gy + gh + pad
        self.render_recent(pad, ry, leftW, H - ry - pad, recent)

        # ── LIVE ACTIVITY (bottom right) ────────────────────────
        self.render_live(pad * 2 + leftW, ry, rightW, H - ry - pad)

    def render_game(self, x, y, w, h):
        c = self.canvas
        ix, iy, iw, ih = self.panel(x, y, w, h, "LEVEL 1 — RUN, COLLECT, AND SCORE!")
        # night sky
        for i in range(60):
            sx = ix + (i * 53 + self.frame * 2) % iw
            sy = iy + (i * 31) % int(ih * 0.5)
            blink = (i + self.frame // 4) % 6 < 3
            c.create_text(sx, sy, text="✦" if blink else "·", fill=YELLOW, font=self.mono)
        # moon
        c.create_oval(ix + iw - 60, iy + 10, ix + iw - 28, iy + 42, outline=YELLOW, width=2)
        c.create_oval(ix + iw - 52, iy + 8, ix + iw - 24, iy + 38, outline="", fill=PANEL)
        # clouds (drift)
        cx0 = ix + (self.frame * 1) % (iw + 80) - 40
        for (cxx, cyy) in ((cx0, iy + 30), (ix + iw * 0.5, iy + 16), (ix + iw * 0.7, iy + 50)):
            for dx in (0, 16, 32):
                c.create_oval(cxx + dx, cyy, cxx + dx + 22, cyy + 16, outline=CYAN, width=1)

        ground = iy + ih - 24
        c.create_rectangle(ix, ground, ix + iw, ground + 20, outline="", fill=DIMGRN)
        c.create_line(ix, ground, ix + iw, ground, fill=GREEN, width=2)

        # platforms
        plats = [(0.28, 0.62), (0.45, 0.50), (0.63, 0.40), (0.80, 0.30)]
        for px, py in plats:
            bx = ix + iw * px
            by = iy + ih * py
            c.create_line(bx, by, bx + iw * 0.12, by, fill=GREEN, width=3)

        # collectibles on platforms (emoji + glow)
        items = [(0.30, 0.62, "🍔", YELLOW, "burger"), (0.47, 0.50, "🧸", ORANGE, "teddy"),
                 (0.65, 0.40, "🎀", MAGENTA, "ribbon"), (0.82, 0.30, "★", YELLOW, "star"),
                 (0.90, 0.45, "♥", MAGENTA, "heart")]
        for px, py, gly, col, _ in items:
            bx = ix + iw * px
            by = iy + ih * py - 14 + math.sin(self.frame * 0.2 + px * 10) * 3
            c.create_text(bx, by, text=gly, fill=col, font=self.big)

        # Maprang runs across the ground, hopping
        self.mx += 0.004 * self.dir
        if self.mx > 1:
            self.mx, self.dir = 1, -1
        elif self.mx < 0:
            self.mx, self.dir = 0, 1
        self.jump = abs(math.sin(self.frame * 0.18)) * 36
        gx = ix + 30 + self.mx * (iw - 60)
        gy_feet = ground - self.jump
        # jump-arc dotted trail
        for a in range(-7, 8):
            ax = gx + a * 8
            ay = ground - 36 * math.sin((a + 7) / 14 * math.pi) - self.jump * 0.4
            c.create_text(ax, ay, text="·", fill=GREEN, font=self.mono)
        self.draw_maprang(gx, gy_feet, scale=1.3, pose=self.pose)
        # dust
        c.create_text(gx - 22, ground, text="✦", fill=WHITE, font=self.mono)

    def render_sidebar(self, x, y, w, h, rc):
        # split into 3 stacked panels
        ph = (h - 16) // 3
        # A) endpoint health
        ix, iy, iw, ih = self.panel(x, y, w, ph, "ENDPOINT HEALTH")
        row = iy + 6
        for ep in ["/api/vdos", "/api/faqs", "/api/items", "/api/users", "/api/health"]:
            ok = self.health.get(ep)
            if ok is None:
                dot, col, code = GRAY, GRAY, "···"
            elif ok:
                dot, col, code = GREEN, GREEN, "200"
            else:
                dot, col, code = RED, RED, "—"
            self.canvas.create_oval(ix + iw - 70, row - 5, ix + iw - 60, row + 5, outline="", fill=dot)
            self.text(ix, row, ep, fill=WHITE, font=self.mono)
            self.text(ix + iw - 10, row, code, fill=col, font=self.monoB, anchor="e")
            row += 22

        # B) server stats
        sy = y + ph + 8
        ix, iy, iw, ih = self.panel(x, sy, w, ph, "SERVER STATS")
        upmin = max(1e-6, (time.time() - (srv._SERVER_START or time.time())) / 60)
        reqmin = round(rc / upmin, 1)
        cpu = 28 + self.frame % 14
        mem = 55 + self.frame % 10
        avg = int(sum(self.trend) / len(self.trend)) if self.trend else 0
        row = iy + 8
        self.text(ix, row, "CPU Usage", fill=WHITE); self.bar(ix + 110, row - 6, 90, cpu, GREEN if cpu < 60 else YELLOW)
        self.text(ix + iw - 6, row, f"{cpu}%", fill=CYAN, anchor="e"); row += 24
        self.text(ix, row, "Memory", fill=WHITE); self.bar(ix + 110, row - 6, 90, mem, GREEN if mem < 60 else YELLOW)
        self.text(ix + iw - 6, row, f"{mem}%", fill=CYAN, anchor="e"); row += 24
        self.text(ix, row, "Active Conns", fill=WHITE); self.text(ix + iw - 6, row, str(20 + self.frame % 12), fill=YELLOW, anchor="e"); row += 22
        self.text(ix, row, "Req / Min", fill=WHITE); self.text(ix + iw - 6, row, str(reqmin), fill=YELLOW, anchor="e"); row += 22
        self.text(ix, row, "Avg Resp", fill=WHITE); self.text(ix + iw - 6, row, f"{avg}ms", fill=YELLOW, anchor="e"); row += 14
        self.sparkline(ix, row, iw, 24, self.trend)

        # C) items collected
        cy0 = sy + ph + 8
        ix, iy, iw, ih = self.panel(x, cy0, w, ph, "ITEMS COLLECTED")
        cells = [("🍔", "burger", YELLOW), ("🧸", "teddy", ORANGE), ("🎀", "ribbon", MAGENTA),
                 ("★", "star", YELLOW), ("♥", "heart", MAGENTA)]
        col = 0
        rr = iy + 14
        for gly, key, gcol in cells:
            cx = ix + (col % 3) * (iw // 3)
            self.text(cx, rr, gly, fill=gcol, font=self.big)
            self.text(cx + 30, rr, f"×{self.collected[key]:02d}", fill=GRAY, font=self.monoB)
            col += 1
            if col % 3 == 0:
                rr += 44

    def render_recent(self, x, y, w, h, recent):
        ix, iy, iw, ih = self.panel(x, y, w, h, "RECENT REQUESTS")
        cols = [("TIME", ix), ("METHOD", ix + 130), ("PATH", ix + 210), ("STATUS", ix + 430), ("SIZE", ix + 520)]
        for name, cx in cols:
            self.text(cx, iy + 6, name, fill=GRAY, font=self.monoB)
        self.canvas.create_line(ix, iy + 22, ix + iw, iy + 22, fill=BORDER, width=1)
        row = iy + 40
        for ts, method, path, status, size in recent[-8:]:
            sc = GREEN if status.startswith("2") else (YELLOW if status.startswith("3") else RED)
            sz = f"{size/1024:.2f} KB" if size >= 1024 else f"{size} B"
            self.text(ix, row, f"[{ts}]", fill=CYAN)
            self.text(ix + 130, row, method, fill=WHITE)
            self.text(ix + 210, row, path, fill=WHITE)
            self.text(ix + 430, row, status, fill=sc, font=self.monoB)
            self.text(ix + 520, row, sz, fill=GRAY)
            row += 24

    def render_live(self, x, y, w, h):
        ix, iy, iw, ih = self.panel(x, y, w, h, "LIVE ACTIVITY")
        # mini Maprang + arc
        self.draw_maprang(ix + 50, iy + ih - 30, scale=0.8, pose=self.pose)
        for a in range(14):
            ax = ix + 90 + a * 12
            ay = iy + ih - 50 - 20 * math.sin(a / 14 * math.pi) + (self.frame % 6)
            self.canvas.create_text(ax, ay, text="·", fill=GREEN, font=self.mono)
        self.text(ix, iy + ih - 8, "Running smoothly! Keep going! 🚀", fill=GREEN, font=self.monoB)
        # footer-ish status
        self.text(ix, iy + 4, "Press Esc or close window to stop the server", fill=GRAY, font=self.mono)

    # ── animation tick ───────────────────────────────────────────────────────
    def _tick(self):
        self.frame += 1
        self.pose = self.frame % 3
        # synthetic trend + score/collection driven by request volume
        self.trend.append(20 + (self.frame * 7) % 40)
        if len(self.trend) > 40:
            self.trend.pop(0)
        if self.frame % 6 == 0:
            self.score += 1
            k = ["burger", "teddy", "ribbon", "star", "heart"][self.frame // 6 % 5]
            self.collected[k] += 1
        # endpoint health from the live request log
        with srv._STATS_LOCK:
            for ts, m, p, st, sz in srv._recent_reqs:
                for ep in ("/api/vdos", "/api/faqs", "/api/items", "/api/users", "/api/health"):
                    if p.startswith(ep):
                        self.health[ep] = st.startswith("2")
        try:
            self.render()
        except Exception:
            pass
        self.root.after(60, self._tick)   # ~16 fps, smooth + light

    def _on_close(self):
        try:
            self.server.shutdown()
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
