(() => {
  'use strict';
  const $ = id => document.getElementById(id);

  // ── Stage definitions ──────────────────────────────────────────
  const STAGES = [
    { id: 'school',     num: 1, title: 'LEVEL 1 — SCHOOL DASH',   goal: 'Collect books, lunch & stars',
      primary: '#ff6b9d', secondary: '#4ecdc4', glow: 'rgba(255,107,157,.28)',
      hud: [['⭐','Stars','stars'],['📚','Books','books'],['🍱','Lunch','lunchbox'],['🎀','Ribbon','ribbon']] },
    { id: 'playground', num: 2, title: 'LEVEL 2 — PLAYGROUND FUN', goal: 'Collect hearts, balloons & rides',
      primary: '#51cf66', secondary: '#ffd43b', glow: 'rgba(81,207,102,.28)',
      hud: [['⭐','Stars','stars'],['♡','Hearts','hearts'],['🎈','Balloons','balloons'],['🎠','Rides','rides']] },
    { id: 'zootopia',   num: 3, title: 'LEVEL 3 — ZOOTOPIA CITY', goal: 'Collect animals, buildings & tickets',
      primary: '#da77f2', secondary: '#ffa94d', glow: 'rgba(218,119,242,.28)',
      hud: [['⭐','Stars','stars'],['🦊','Animals','animals'],['🏙','Buildings','buildings'],['🎫','Tickets','tickets']] },
    { id: 'minecraft',  num: 4, title: 'LEVEL 4 — BLOCK WORLD',   goal: 'Collect diamonds, wood & food',
      primary: '#8bc34a', secondary: '#ff8f00', glow: 'rgba(139,195,74,.28)',
      hud: [['⭐','Stars','stars'],['💎','Diamonds','diamonds'],['🪵','Wood','wood'],['🍎','Food','food']] },
    { id: 'space',      num: 5, title: 'LEVEL 5 — COSMIC VOYAGE', goal: 'Collect rockets, planets & comets',
      primary: '#339af0', secondary: '#9c36b5', glow: 'rgba(51,154,240,.28)',
      hud: [['⭐','Stars','stars'],['🚀','Rockets','rockets'],['🪐','Planets','planets'],['☄','Comets','comets']] },
  ];
  const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.id, s]));
  const STAGE_IDS = STAGES.map(s => s.id);

  // ── Sprite sheet layout ────────────────────────────────────────
  // All values are proportions (0–1) of the image's natural width/height.
  // Toggle SHEET.debug = true (press D in browser) to draw red bounding boxes
  // over each region so you can tune these values visually.
  //
  // Asset sheet expected at: /static/maprang-assets.png
  // Estimated layout assumes the "MAPRANG DASHBOARD ASSET SHEET" image
  // with 5 character sprites in a row (top) and 5 stage backgrounds below.
  const SHEET = {
    debug: false,
    // Maprang animation frames: [left, top, width, height] as 0–1 fractions
    frames: {
      idle:  [0.008, 0.042, 0.093, 0.128],
      run:   [0.109, 0.042, 0.093, 0.128],
      jump:  [0.210, 0.042, 0.093, 0.128],
      happy: [0.311, 0.042, 0.093, 0.128],
      wave:  [0.410, 0.042, 0.093, 0.128],
    },
    // Stage background scenes: [left, top, width, height] as 0–1 fractions
    bg: {
      school:     [0.008, 0.187, 0.445, 0.103],
      playground: [0.008, 0.340, 0.445, 0.103],
      zootopia:   [0.008, 0.493, 0.445, 0.103],
      minecraft:  [0.008, 0.646, 0.445, 0.103],
      space:      [0.008, 0.799, 0.445, 0.103],
    },
    // Ground level within each background (0=top, 1=bottom of bg region)
    ground: {
      school: 0.84, playground: 0.83, zootopia: 0.84, minecraft: 0.79, space: 0.80,
    },
  };

  // Convert SHEET fractions → pixel rects once image is loaded
  let sheetPixels = null;
  function calcSheetPixels(img) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const cvt = ([l, t, w, h]) => [Math.round(l*iw), Math.round(t*ih), Math.round(w*iw), Math.round(h*ih)];
    sheetPixels = {
      frames: Object.fromEntries(Object.entries(SHEET.frames).map(([k,v]) => [k, cvt(v)])),
      bg:     Object.fromEntries(Object.entries(SHEET.bg).map(([k,v])     => [k, cvt(v)])),
    };
  }

  const AUTO_MS  = 25000;
  const PAUSE_MS = 60000;

  // ── Global state ──────────────────────────────────────────────
  const state = {
    stageId: 'school',
    status: null,
    score: 0,
    lastReqCount: 0,
    rewards: {},
    avgHistory: [],
    filter: 'all',
    pulse: 0,
    mood: 'smile',     // smile | wave | jump | angry
    moodMs: 0,
    rotateTs: performance.now(),
    pauseUntil: 0,
  };
  STAGES.forEach(s => s.hud.forEach(([,, k]) => { state.rewards[k] = 0; }));

  // ── Stage switching ───────────────────────────────────────────
  const getStage = () => STAGE_MAP[state.stageId];

  function applyStageCSS(stg) {
    const r = document.documentElement.style;
    r.setProperty('--sc',    stg.primary);
    r.setProperty('--sc2',   stg.secondary);
    r.setProperty('--sglow', stg.glow);
  }

  function updateHUD() {
    const stg = getStage();
    $('gameFooter').innerHTML = stg.hud.map(([icon, label, key]) =>
      `<div class="hud-item">
        <span class="hud-icon">${icon}</span>
        <div><span class="hud-label">${label}</span><span class="hud-value" id="hud-${key}">${state.rewards[key]}</span></div>
      </div>`
    ).join('');
  }

  function setStage(id, manual = false) {
    state.stageId = id;
    if (manual) state.pauseUntil = performance.now() + PAUSE_MS;
    state.rotateTs = performance.now();
    document.querySelectorAll('.stage-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.stage === id));
    const stg = getStage();
    $('stageTitle').textContent = stg.title;
    $('stageGoal').textContent  = stg.goal;
    applyStageCSS(stg);
    updateHUD();
    if (window._scene) window._scene.setStage(id);
  }

  function nextStage() {
    const i = STAGE_IDS.indexOf(state.stageId);
    setStage(STAGE_IDS[(i + 1) % STAGE_IDS.length]);
  }

  // ── Auto-rotate progress bar ──────────────────────────────────
  function tickRotate(now) {
    const fill = $('autoRotateFill');
    if (!fill) return;
    if (now < state.pauseUntil) {
      const pct = Math.min(100, ((now - (state.pauseUntil - PAUSE_MS)) / PAUSE_MS) * 100);
      fill.style.width = pct + '%';
      fill.dataset.paused = 'true';
      state.rotateTs = now;
      return;
    }
    if (fill.dataset.paused === 'true') {
      fill.dataset.paused = 'false';
      fill.style.width = '0%';
      state.rotateTs = now;
      return;
    }
    const elapsed = now - state.rotateTs;
    fill.style.width = Math.min(100, (elapsed / AUTO_MS) * 100) + '%';
    if (elapsed >= AUTO_MS) { state.rotateTs = now; nextStage(); }
  }

  // ── Rewards ───────────────────────────────────────────────────
  function applyRewards(delta) {
    const keys = getStage().hud.map(([,, k]) => k);
    const prev = state.score;
    for (let i = 0; i < delta; i++) {
      const k = keys[(state.lastReqCount + i) % keys.length];
      state.rewards[k] = (state.rewards[k] || 0) + 1;
    }
    state.score += delta * 10;
    $('score').textContent = state.score;
    getStage().hud.forEach(([,, key]) => {
      const el = $('hud-' + key); if (el) el.textContent = state.rewards[key];
    });
    if (Math.floor(state.score / 50) > Math.floor(prev / 50)) {
      state.mood = 'jump'; state.moodMs = 1400;
    }
  }

  // ── API polling ───────────────────────────────────────────────
  async function poll() {
    try {
      const data = await fetch('/api/server-status', { cache: 'no-store' }).then(r => r.json());
      state.status = data;
      const cnt = Number(data.requestCount || 0);
      if (cnt > state.lastReqCount) {
        const d = cnt - state.lastReqCount;
        applyRewards(d);
        state.pulse = Math.min(30, state.pulse + d * 5);
        state.lastReqCount = cnt;
        if (state.mood !== 'jump' && state.mood !== 'angry') {
          state.mood = 'wave'; state.moodMs = 3000;
        }
        if (window._scene) window._scene.pulse(d);
      }
      state.avgHistory.push(Number(data.avgResponseMs || 0));
      state.avgHistory = state.avgHistory.slice(-42);
      const errCnt = (data.recent || []).filter(r => !String(r.status || '').startsWith('2')).length;
      if (errCnt > 2 && state.mood !== 'jump') { state.mood = 'angry'; state.moodMs = 6000; }
      renderStatus(data);
    } catch (e) {
      state.mood = 'angry'; state.moodMs = 10000;
      $('onlineBadge').textContent = 'ERROR';
      $('onlineBadge').className = 'badge error';
      $('miniScene').textContent = 'Server offline: ' + (e.message || e);
    } finally {
      setTimeout(poll, 4000);
    }
  }

  function renderStatus(data) {
    const ok = !!data.ok;
    $('serverUrl').textContent  = data.url || location.origin;
    $('uptime').textContent     = fmtUp(data.uptimeSec);
    $('reqCount').textContent   = (data.requestCount || 0) + ' reqs';
    const rec = data.recent || [];
    $('lastRequest').textContent = rec.length ? rec[rec.length-1].method + ' ' + rec[rec.length-1].path : '—';
    $('onlineBadge').textContent = ok ? 'ONLINE' : 'ERROR';
    $('onlineBadge').className   = 'badge ' + (ok ? 'online' : 'error');
    $('endpointList').innerHTML = Object.entries(data.endpoints || {}).map(([p, i]) =>
      `<div class="endpoint-row"><span>${p}</span><i class="dot ${i.ok?'ok':''}"></i><b class="code ${i.ok?'ok':''}">${i.status||'—'}</b></div>`
    ).join('');
    $('moduleList').innerHTML = Object.entries(data.modules || {}).slice(0, 8).map(([n, c]) =>
      `<div class="module-row"><span>${n}</span><b>${c}</b></div>`
    ).join('');
    const load = Math.min(100, Number(data.requestsPerMin || 0) * 10);
    $('apiLoad').style.width      = load + '%';
    $('apiLoadText').textContent  = Math.round(load) + '%';
    $('dataHealth').style.width   = (data.dataWritable ? 100 : 5) + '%';
    $('dataHealthText').textContent = data.dataWritable ? 'OK' : 'ERR';
    const thr = Number(data.activeThreads || 0);
    $('threadsMeter').style.width = Math.min(100, thr / 12 * 100) + '%';
    $('threadsText').textContent  = thr;
    $('rpmText').textContent      = data.requestsPerMin || 0;
    $('avgText').textContent      = (data.avgResponseMs || 0) + 'ms';
    drawSparkline();
    renderRequests(rec);
    if (ok && state.mood === 'smile') $('miniScene').textContent = 'Running smoothly! Keep going!';
    else if (!ok)                     $('miniScene').textContent = 'Server degraded — check Endpoint Health!';
  }

  function drawSparkline() {
    const c = $('sparkline'); if (!c) return;
    const ctx = c.getContext('2d');
    c.width = c.offsetWidth * devicePixelRatio || 280;
    c.height = c.offsetHeight * devicePixelRatio || 40;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = getStage().secondary; ctx.lineWidth = 1.5 * devicePixelRatio;
    const vals = state.avgHistory.length > 1 ? state.avgHistory : [0, 1];
    const max  = Math.max(...vals, 1);
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * c.width;
      const y = c.height - (v / max * (c.height - 4)) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderRequests(rows) {
    let shown = (rows || []).slice();
    if (state.filter === 'errors') shown = shown.filter(r => !String(r.status||'').startsWith('2'));
    shown = shown.slice(-14);
    const head = `<div class="request-head"><span>TIME</span><span>METHOD</span><span>PATH</span><span>STATUS</span><span class="rsize">SIZE</span></div>`;
    const body = shown.map(r => {
      const ok = String(r.status||'').startsWith('2');
      return `<div class="request-row${ok?'':' err-row'}">
        <span>[${r.time||''}]</span><span>${r.method||''}</span>
        <span class="path" title="${r.path||''}">${r.path||''}</span>
        <b class="status ${ok?'ok':'err'}">${r.status||'—'}</b>
        <span class="rsize">${fmtSz(r.size)}</span>
      </div>`;
    }).join('') || '<div class="request-row"><span>No requests yet</span></div>';
    $('requestTable').innerHTML = head + `<div class="request-body">${body}</div>`;
  }

  const fmtUp = s => {
    s = Math.max(0, Math.floor(s || 0));
    return String(Math.floor(s/3600)).padStart(2,'0')+':'+String(Math.floor((s%3600)/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  };
  const fmtSz = n => {
    n = Number(n||0);
    if (n >= 1048576) return (n/1048576).toFixed(1)+' MB';
    if (n >= 1024)    return (n/1024).toFixed(1)+' KB';
    return n+' B';
  };

  // ── Sprite Scene (Canvas 2D, no external library) ─────────────
  class SpriteScene {
    constructor(el) {
      this.el      = el;
      this.stageId = 'school';
      this.charX   = 0.5;
      this.charDir = 1;
      this.img     = null;
      this.ready   = false;

      // Create canvas
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated';
      el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      // Load sprite sheet
      const img = new Image();
      img.onload = () => {
        this.img   = img;
        this.ready = true;
        calcSheetPixels(img);
      };
      img.onerror = () => console.warn('[Dashboard] maprang-assets.png not found — place it in pharmacy_server/www/static/');
      img.src = '/static/maprang-assets.png';

      this._loop();
    }

    setStage(id) { this.stageId = id; }
    pulse(d)     { state.pulse = Math.min(30, state.pulse + d * 6); }

    _loop() {
      const now = performance.now();
      const el  = this.el;
      const cw  = el.offsetWidth  || 600;
      const ch  = el.offsetHeight || 240;
      this.canvas.width  = cw;
      this.canvas.height = ch;

      tickRotate(now);

      // mood timer
      if (state.moodMs > 0) {
        state.moodMs -= 16.67;
        if (state.moodMs <= 0) { state.moodMs = 0; state.mood = 'smile'; }
      }

      const ctx = this.ctx;
      ctx.clearRect(0, 0, cw, ch);

      if (this.ready && sheetPixels) {
        this._drawBackground(ctx, cw, ch);
        this._drawMaprang(ctx, cw, ch, now);
        if (SHEET.debug) this._drawDebug(ctx, cw, ch);
      } else {
        // Placeholder while image loads
        ctx.fillStyle = '#02040a';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = getStage().primary;
        ctx.font = '10px "Courier New"';
        ctx.textAlign = 'center';
        ctx.fillText('Place maprang-assets.png in www/static/', cw / 2, ch / 2);
      }

      state.pulse = Math.max(0, state.pulse - 0.07);
      requestAnimationFrame(() => this._loop());
    }

    // Draw stage background — scales to fill canvas width, centered vertically
    _drawBackground(ctx, cw, ch) {
      const sp = sheetPixels.bg[this.stageId];
      if (!sp) return;
      const [sx, sy, sw, sh] = sp;
      // Scale to fill width while keeping aspect ratio
      const scale = cw / sw;
      const dh    = sh * scale;
      const dy    = (ch - dh) / 2;   // center vertically
      ctx.drawImage(this.img, sx, sy, sw, sh, 0, dy, cw, dh);
      // If canvas is taller than background, fill gaps with edge pixels
      if (dy > 0) {
        ctx.drawImage(this.img, sx, sy, sw, 1, 0, 0, cw, dy);              // top strip
        ctx.drawImage(this.img, sx, sy+sh-1, sw, 1, 0, dy+dh, cw, ch-dy-dh); // bottom strip
      }
    }

    // Ground Y in canvas pixels (relative to background render area)
    _groundY(cw, ch) {
      const sp = sheetPixels.bg[this.stageId];
      if (!sp) return ch * 0.82;
      const [,, sw, sh] = sp;
      const scale = cw / sw;
      const dh    = sh * scale;
      const dy    = (ch - dh) / 2;
      const gFrac = SHEET.ground[this.stageId] ?? 0.82;
      return dy + dh * gFrac;
    }

    // Draw Maprang character sprite
    _drawMaprang(ctx, cw, ch, now) {
      // Walking movement
      const speed = 0.0025 + state.pulse * 0.0003;
      this.charX += speed * this.charDir;
      if (this.charX > 0.87 || this.charX < 0.13) this.charDir *= -1;

      // Frame selection
      const walkFrame = Math.floor(now / 280) % 2 === 0 ? 'idle' : 'run';
      let frameName;
      if      (state.mood === 'jump')  frameName = 'jump';
      else if (state.mood === 'wave')  frameName = 'wave';
      else if (state.mood === 'happy') frameName = 'happy';
      else                             frameName = walkFrame;

      const sp = sheetPixels.frames[frameName];
      if (!sp) return;
      const [sx, sy, sw, sh] = sp;

      // Scale: character height = ~40% of canvas height
      const sprH = ch * 0.40;
      const sprW = sprH * (sw / sh);

      // Position
      const groundY = this._groundY(cw, ch);
      let extraY = 0;
      if (state.mood === 'jump') {
        extraY = -Math.abs(Math.sin(now / 420)) * ch * 0.18;
      } else {
        extraY = Math.sin(now / 500) * (ch * 0.012);  // gentle bob
      }

      const drawX = this.charX * cw;
      const drawY = groundY + extraY;

      ctx.save();
      ctx.translate(drawX, drawY);
      if (this.charDir < 0) ctx.scale(-1, 1);   // flip when walking left

      // Angry tint: red overlay via globalCompositeOperation
      ctx.drawImage(this.img, sx, sy, sw, sh, -sprW / 2, -sprH, sprW, sprH);

      if (state.mood === 'angry') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ff2020';
        ctx.fillRect(-sprW / 2, -sprH, sprW, sprH);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    // Debug overlay: press D to toggle — draws labelled boxes for all SHEET regions
    _drawDebug(ctx, cw, ch) {
      if (!this.img) return;
      const iw = this.img.naturalWidth, ih = this.img.naturalHeight;

      const drawBox = ([sl, st, sw, sh], label, color) => {
        // Convert fractions back to canvas coords for display
        const px = sl * iw, py = st * ih, pw = sw * iw, ph = sh * ih;
        // Display at top of canvas as a miniature
        const scale = Math.min(cw / iw, ch / ih) * 0.9;
        const ox = (cw - iw * scale) / 2;
        const oy = (ch - ih * scale) / 2;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(ox + px*scale, oy + py*scale, pw*scale, ph*scale);
        ctx.fillStyle = color; ctx.font = '9px monospace';
        ctx.fillText(label, ox + px*scale + 2, oy + py*scale + 10);
      };

      // Dim the game background
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, cw, ch);

      // Draw entire sprite sheet scaled to fit
      const scale = Math.min(cw / iw, ch / ih) * 0.9;
      const ox = (cw - iw * scale) / 2;
      const oy = (ch - ih * scale) / 2;
      ctx.drawImage(this.img, ox, oy, iw * scale, ih * scale);

      // Draw frame boxes
      Object.entries(SHEET.frames).forEach(([k, v]) => drawBox(v, k, '#ff6b9d'));
      // Draw bg boxes
      Object.entries(SHEET.bg).forEach(([k, v]) => drawBox(v, k, '#4ecdc4'));

      ctx.fillStyle = '#ffff00'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('DEBUG MODE — Press D to toggle. Adjust SHEET values in dashboard.js.', cw/2, 16);
    }
  }

  // ── Keyboard: D = toggle debug ─────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'd' || e.key === 'D') SHEET.debug = !SHEET.debug;
  });

  // ── Event listeners ───────────────────────────────────────────
  document.querySelectorAll('.stage-tab').forEach(btn =>
    btn.addEventListener('click', () => setStage(btn.dataset.stage, true)));

  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (state.status) renderRequests(state.status.recent || []);
    }));

  $('openServer').addEventListener('click',  () => window.open(location.origin, '_blank'));
  $('copyUrl').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin); $('miniScene').textContent = 'Server URL copied!'; }
    catch { $('miniScene').textContent = location.origin; }
  });
  $('healthJson').addEventListener('click',  () => window.open('/api/server-status', '_blank'));
  $('adminPortal').addEventListener('click', () => window.open('/index', '_blank'));

  // ── Boot ──────────────────────────────────────────────────────
  window._scene = new SpriteScene($('pixiStage'));
  setStage('school');
  poll();
})();
