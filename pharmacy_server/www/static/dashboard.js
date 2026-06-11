(() => {
  const $ = (id) => document.getElementById(id);
  const STAGES = {
    school: { title: 'LEVEL 1 — SCHOOL DASH', goal: 'Goal: collect books, lunch, stars' },
    playground: { title: 'LEVEL 2 — PLAYGROUND FUN', goal: 'Goal: collect ribbon, heart, stars' },
  };

  const state = {
    stage: 'school',
    status: null,
    score: 60,
    lastRequestCount: 0,
    rewards: { stars: 0, lunchbox: 0, ribbon: 0, books: 0, heart: 0 },
    avgHistory: [],
    filter: 'all',
    activityPulse: 0,
    lastTs: performance.now(),
  };

  const fmtUptime = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };
  const fmtSize = (n) => {
    n = Number(n || 0);
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${n} B`;
  };

  function setStage(stage) {
    state.stage = stage;
    document.querySelectorAll('.stage-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.stage === stage));
    $('stageTitle').textContent = STAGES[stage].title;
    $('stageGoal').textContent = STAGES[stage].goal;
    if (window.maprangScene) window.maprangScene.setStage(stage);
  }

  function applyRewards(delta) {
    const seq = ['stars', 'books', 'lunchbox', 'ribbon', 'heart'];
    for (let i = 0; i < delta; i++) {
      const key = seq[(state.lastRequestCount + i) % seq.length];
      state.rewards[key] += 1;
    }
    state.score += delta * 10;
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/server-status', { cache: 'no-store' });
      const data = await res.json();
      state.status = data;
      const count = Number(data.requestCount || 0);
      if (count > state.lastRequestCount) {
        const delta = count - state.lastRequestCount;
        applyRewards(delta);
        state.activityPulse = Math.min(30, state.activityPulse + delta * 5);
        state.lastRequestCount = count;
        if (window.maprangScene) window.maprangScene.pulse(delta);
      }
      state.avgHistory.push(Number(data.avgResponseMs || 0));
      state.avgHistory = state.avgHistory.slice(-42);
      renderStatus(data);
    } catch (err) {
      renderOffline(err);
    } finally {
      setTimeout(refreshStatus, 4000);
    }
  }

  function renderOffline(err) {
    $('onlineBadge').textContent = 'ERROR';
    $('onlineBadge').classList.add('error');
    $('miniScene').textContent = `Dashboard cannot read server status: ${err?.message || err}`;
  }

  function renderStatus(data) {
    const ok = !!data.ok;
    $('serverUrl').textContent = data.url || location.origin;
    $('uptime').textContent = `Uptime: ${fmtUptime(data.uptimeSec)}`;
    $('reqCount').textContent = `Requests: ${data.requestCount || 0}`;
    const recent = data.recent || [];
    const last = recent.length ? `${recent[recent.length - 1].method} ${recent[recent.length - 1].path}` : '—';
    $('lastRequest').textContent = `Last: ${last}`;
    $('score').textContent = state.score;
    $('onlineBadge').textContent = ok ? 'ONLINE' : 'ERROR';
    $('onlineBadge').classList.toggle('error', !ok);

    $('starsCount').textContent = state.rewards.stars;
    $('lunchCount').textContent = state.rewards.lunchbox;
    $('ribbonCount').textContent = state.rewards.ribbon;
    $('booksCount').textContent = state.rewards.books;

    const endpoints = data.endpoints || {};
    $('endpointList').innerHTML = Object.entries(endpoints).map(([path, info]) => {
      const good = !!info.ok;
      return `<div class="endpoint-row"><span>${path}</span><i class="dot ${good ? 'ok' : ''}"></i><b class="code ${good ? '' : 'err'}">${info.status || '—'}</b></div>`;
    }).join('');

    const modules = data.modules || {};
    $('moduleList').innerHTML = Object.entries(modules).slice(0, 8).map(([name, count]) => (
      `<div class="module-row"><span>${name}</span><b>${count}</b></div>`
    )).join('');

    const apiLoad = Math.min(100, Number(data.requestsPerMin || 0) * 10);
    $('apiLoad').value = apiLoad;
    $('apiLoadText').textContent = `${Math.round(apiLoad)}%`;
    $('dataHealth').value = data.dataWritable ? 100 : 0;
    $('dataHealthText').textContent = data.dataWritable ? 'OK' : 'ERR';
    const threads = Number(data.activeThreads || 0);
    $('threadsMeter').value = Math.min(100, threads / 12 * 100);
    $('threadsText').textContent = threads;
    $('rpmText').textContent = data.requestsPerMin || 0;
    $('avgText').textContent = `${data.avgResponseMs || 0}ms`;
    drawSparkline();
    renderRequests(recent);
    $('miniScene').textContent = ok ? 'Running smoothly! Keep going! 🚀' : 'Server degraded — check Endpoint Health.';
  }

  function drawSparkline() {
    const c = $('sparkline');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#00ff43';
    ctx.lineWidth = 2;
    const vals = state.avgHistory.length > 1 ? state.avgHistory : [0, 1];
    const max = Math.max(...vals, 1);
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = i / (vals.length - 1) * c.width;
      const y = c.height - (v / max * (c.height - 4)) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderRequests(rows) {
    const table = $('requestTable');
    let shown = rows || [];
    if (state.filter === 'errors') shown = shown.filter(r => !String(r.status || '').startsWith('2'));
    shown = shown.slice(-12);
    const head = `<div class="request-head"><span>TIME</span><span>METHOD</span><span>PATH</span><span class="status">STATUS</span><span class="size">SIZE</span></div>`;
    const body = shown.map(r => {
      const ok = String(r.status || '').startsWith('2');
      return `<div class="request-row"><span>[${r.time || ''}]</span><span>${r.method || ''}</span><span class="path" title="${r.path || ''}">${r.path || ''}</span><b class="status ${ok ? 'ok' : 'err'}">${r.status || '—'}</b><span class="size">${fmtSize(r.size)}</span></div>`;
    }).join('') || `<div class="request-row"><span>No requests</span><span></span><span></span><span></span><span></span></div>`;
    table.innerHTML = head + `<div>${body}</div>`;
  }

  class CanvasFallbackScene {
    constructor(el) {
      this.el = el;
      this.canvas = document.createElement('canvas');
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.stage = 'school';
      this.x = 0.55;
      this.dir = 1;
      this.resize();
      addEventListener('resize', () => this.resize());
      requestAnimationFrame(() => this.loop());
    }
    setStage(stage) { this.stage = stage; }
    pulse(delta) { state.activityPulse += delta * 5; }
    resize() {
      const r = this.el.getBoundingClientRect();
      this.canvas.width = Math.max(320, Math.floor(r.width * devicePixelRatio));
      this.canvas.height = Math.max(200, Math.floor(r.height * devicePixelRatio));
    }
    loop() {
      const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
      c.clearRect(0, 0, w, h);
      c.lineWidth = 2 * devicePixelRatio;
      const green = '#00ff43', cyan = '#00e5ff', yellow = '#fff23a', magenta = '#ff2fcf';
      const gy = h - 64 * devicePixelRatio;
      c.strokeStyle = green; c.beginPath(); c.moveTo(18, gy); c.lineTo(w - 18, gy); c.stroke();
      c.setLineDash([2, 6]); c.beginPath(); c.moveTo(18, gy + 12); c.lineTo(w - 18, gy + 12); c.stroke(); c.setLineDash([]);
      c.font = `${18 * devicePixelRatio}px Consolas`; c.fillStyle = yellow;
      for (let i = 0; i < 18; i++) c.fillText(i % 3 ? '*' : '✦', 30 + (i * 97) % (w - 60), 28 + (i * 53) % Math.max(80, h - 150));
      if (this.stage === 'school') this.drawSchool(c, w, h, gy, green, cyan, yellow, magenta);
      else this.drawPlayground(c, w, h, gy, green, cyan, yellow, magenta);
      const speed = 0.004 + state.activityPulse * 0.0002;
      this.x += speed * this.dir;
      if (this.x > .88 || this.x < .14) this.dir *= -1;
      this.drawMaprang(c, w * this.x, gy - 4, devicePixelRatio);
      state.activityPulse = Math.max(0, state.activityPulse - .08);
      requestAnimationFrame(() => this.loop());
    }
    drawSchool(c, w, h, gy, green, cyan, yellow, magenta) {
      c.strokeStyle = green; c.strokeRect(w * .08, gy - 150, w * .22, 150);
      c.beginPath(); c.moveTo(w*.08, gy-150); c.lineTo(w*.19, gy-205); c.lineTo(w*.30, gy-150); c.stroke();
      c.fillStyle = cyan; c.fillText('MAPRANG SCHOOL', w*.34, gy - 72);
      c.strokeStyle = magenta; c.strokeRect(w*.33, gy - 118, w*.16, 76);
      c.strokeStyle = green; c.strokeRect(w*.58, gy - 142, w*.12, 18); c.strokeRect(w*.76, gy - 82, w*.14, 18);
      c.fillStyle = yellow; c.fillText('☆', w*.62, gy - 154); c.fillStyle = magenta; c.fillText('▭', w*.80, gy - 96);
    }
    drawPlayground(c, w, h, gy, green, cyan, yellow, magenta) {
      c.strokeStyle = green; c.beginPath(); c.moveTo(w*.12, gy); c.lineTo(w*.22, gy-92); c.lineTo(w*.30, gy-92); c.stroke();
      c.beginPath(); c.moveTo(w*.72, gy); c.lineTo(w*.80, gy-130); c.lineTo(w*.88, gy); c.moveTo(w*.76, gy-120); c.lineTo(w*.84, gy-120); c.stroke();
      c.strokeRect(w*.46, gy - 140, w*.12, 18); c.strokeRect(w*.60, gy - 80, w*.12, 18);
      c.fillStyle = yellow; c.fillText('☆', w*.50, gy - 156); c.fillStyle = magenta; c.fillText('♡', w*.64, gy - 95);
    }
    drawMaprang(c, x, y, dpr) {
      const s = 1.0 * dpr;
      c.fillStyle = '#111'; c.strokeStyle = '#fff';
      c.beginPath(); c.ellipse(x - 34*s, y - 78*s, 20*s, 24*s, 0, 0, Math.PI*2); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(x + 34*s, y - 78*s, 20*s, 24*s, 0, 0, Math.PI*2); c.fill(); c.stroke();
      c.fillStyle = '#ffe0c4'; c.beginPath(); c.ellipse(x, y - 82*s, 30*s, 30*s, 0, 0, Math.PI*2); c.fill(); c.stroke();
      c.fillStyle = '#111'; c.fillRect(x - 26*s, y - 112*s, 52*s, 26*s);
      c.fillStyle = '#ff2fcf'; c.font = `${22*s}px Consolas`; c.fillText('✿', x + 18*s, y - 102*s);
      c.fillStyle = '#111'; c.fillText('● ●', x - 18*s, y - 78*s);
      c.fillStyle = '#ff99c8'; c.fillText('⌣', x - 8*s, y - 62*s);
      c.strokeStyle = '#00e5ff'; c.fillStyle = '#163d86';
      c.beginPath(); c.moveTo(x, y - 52*s); c.lineTo(x - 26*s, y - 10*s); c.lineTo(x + 26*s, y - 10*s); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = '#ffe0c4'; c.beginPath(); c.moveTo(x-16*s,y-40*s); c.lineTo(x-34*s,y-24*s); c.moveTo(x+16*s,y-40*s); c.lineTo(x+34*s,y-24*s); c.moveTo(x-8*s,y-10*s); c.lineTo(x-22*s,y+14*s); c.moveTo(x+8*s,y-10*s); c.lineTo(x+24*s,y+14*s); c.stroke();
    }
  }

  class PixiMaprangScene {
    constructor(el) {
      this.el = el;
      this.stageName = state.stage;
      this.app = new PIXI.Application({ resizeTo: el, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
      el.appendChild(this.app.view);
      this.scene = new PIXI.Container();
      this.app.stage.addChild(this.scene);
      this.maprang = new PIXI.Container();
      this.scene.addChild(this.maprang);
      this.xPos = .55;
      this.dir = 1;
      this.lastW = 0; this.lastH = 0;
      this.app.ticker.add((delta) => this.tick(delta));
    }
    setStage(stage) { this.stageName = stage; this.lastW = 0; }
    pulse(delta) { state.activityPulse = Math.min(30, state.activityPulse + delta * 6); }
    tick(delta) {
      const w = this.app.renderer.width / this.app.renderer.resolution;
      const h = this.app.renderer.height / this.app.renderer.resolution;
      if (Math.abs(w - this.lastW) > 2 || Math.abs(h - this.lastH) > 2) this.rebuild(w, h);
      const speed = (0.006 + state.activityPulse * 0.00055) * delta;
      this.xPos += speed * this.dir;
      if (this.xPos > .88 || this.xPos < .14) this.dir *= -1;
      const gy = h - 58;
      this.maprang.x = w * this.xPos;
      this.maprang.y = gy - Math.abs(Math.sin(performance.now() / 160)) * 9;
      this.maprang.scale.x = this.dir > 0 ? 1 : -1;
      this.maprang.rotation = Math.sin(performance.now() / 120) * 0.025;
      state.activityPulse = Math.max(0, state.activityPulse - 0.08);
    }
    rebuild(w, h) {
      this.lastW = w; this.lastH = h;
      this.scene.removeChildren();
      const bg = new PIXI.Graphics();
      bg.beginFill(0x02040a); bg.drawRect(0, 0, w, h); bg.endFill();
      this.scene.addChild(bg);
      this.drawSky(w, h);
      const gy = h - 58;
      this.drawGround(w, gy);
      if (this.stageName === 'school') this.drawSchool(w, h, gy); else this.drawPlayground(w, h, gy);
      this.maprang = new PIXI.Container();
      this.drawMaprang(this.maprang);
      this.scene.addChild(this.maprang);
    }
    line(g, color = 0x00ff43, width = 2, alpha = 1) { g.lineStyle(width, color, alpha); }
    drawSky(w, h) {
      const g = new PIXI.Graphics();
      const stars = [[.06,.18,0xffffff,'✦'],[.14,.32,0xfff23a,'*'],[.23,.43,0xffffff,'✦'],[.34,.18,0xffffff,'*'],[.46,.30,0xfff23a,'*'],[.58,.16,0xffffff,'✦'],[.70,.31,0xffffff,'*'],[.83,.22,0xffffff,'✦'],[.94,.28,0xfff23a,'*']];
      stars.forEach(([x,y,c,t]) => this.text(t, w*x, h*y, c, 16));
      this.cloud(w*.16, h*.13, .9); this.cloud(w*.68, h*.10, 1.0);
      g.lineStyle(3, 0xfff23a); g.arc(w*.92, h*.14, 24, .3, Math.PI*1.55); g.arc(w*.925, h*.14, 24, .5, Math.PI*1.7); this.scene.addChild(g);
    }
    text(s, x, y, color, size = 16, anchor = .5) { const t = new PIXI.Text(s, { fontFamily: 'Consolas', fontSize: size, fill: color, fontWeight: 'bold' }); t.anchor.set(anchor); t.x = x; t.y = y; this.scene.addChild(t); return t; }
    cloud(x, y, scale) { const g = new PIXI.Graphics(); g.lineStyle(2, 0x00e5ff); g.arc(x-28*scale,y+18*scale,20*scale,Math.PI,Math.PI*2); g.arc(x,y+8*scale,28*scale,Math.PI,Math.PI*2); g.arc(x+30*scale,y+18*scale,22*scale,Math.PI,Math.PI*2); g.moveTo(x-52*scale,y+20*scale); g.lineTo(x+56*scale,y+20*scale); this.scene.addChild(g); }
    drawGround(w, gy) { const g = new PIXI.Graphics(); g.lineStyle(2, 0x00ff43); g.moveTo(18, gy); g.lineTo(w-18, gy); g.lineStyle(1, 0x00ff43, .65); for (let x=18; x<w-18; x+=8) { g.moveTo(x, gy+11); g.lineTo(x+2, gy+11); } this.scene.addChild(g); }
    platform(x, y, width) { const g = new PIXI.Graphics(); g.lineStyle(2,0x00ff43); g.drawRect(x, y, width, 18); this.scene.addChild(g); }
    drawSchool(w, h, gy) {
      const g = new PIXI.Graphics(); g.lineStyle(3,0x00ff43); const x=w*.08, y=gy-170, bw=w*.22, bh=150; g.drawRect(x,y+38,bw,bh); g.moveTo(x+bw*.25,y+38); g.lineTo(x+bw*.5,y-16); g.lineTo(x+bw*.75,y+38); g.lineTo(x+bw*.25,y+38); g.drawRect(x+bw*.43,y+bh-38,bw*.14,56); g.lineStyle(2,0x00e5ff); for (const rx of [.12,.68]) for (const ry of [.58,.82]) g.drawRect(x+bw*rx,y+bh*ry,30,30); this.scene.addChild(g);
      this.text('MAPRANG', w*.41, gy-102, 0x00e5ff, 18); this.text('PRIMARY SCHOOL', w*.41, gy-78, 0x00e5ff, 14);
      const sign = new PIXI.Graphics(); sign.lineStyle(2,0xff2fcf); sign.drawRect(w*.34, gy-132, w*.14, 82); this.scene.addChild(sign);
      this.platform(w*.56, gy-142, 120); this.platform(w*.75, gy-86, 140); this.platform(w*.63, gy-62, 110);
      this.text('☆', w*.60, gy-158, 0xfff23a, 44); this.text('⌂', w*.80, gy-112, 0xff2fcf, 34); this.text('▭', w*.66, gy-88, 0x00e5ff, 32); this.text('✿', w*.90, gy-74, 0xff2fcf, 34);
    }
    drawPlayground(w, h, gy) {
      const g = new PIXI.Graphics(); g.lineStyle(3,0x00ff43); g.moveTo(w*.12,gy); g.lineTo(w*.23,gy-100); g.lineTo(w*.31,gy-100); g.moveTo(w*.75,gy); g.lineTo(w*.82,gy-140); g.lineTo(w*.89,gy); g.moveTo(w*.78,gy-125); g.lineTo(w*.86,gy-125); g.lineStyle(2,0x00e5ff); g.moveTo(w*.79,gy-125); g.lineTo(w*.79,gy-54); g.moveTo(w*.85,gy-125); g.lineTo(w*.85,gy-54); g.lineStyle(3,0xff2fcf); g.moveTo(w*.785,gy-54); g.lineTo(w*.855,gy-54); this.scene.addChild(g);
      this.platform(w*.44, gy-150, 130); this.platform(w*.61, gy-92, 120); this.platform(w*.84, gy-52, 120);
      this.text('☆', w*.49, gy-168, 0xfff23a, 44); this.text('♡', w*.66, gy-112, 0xff2fcf, 40); this.text('✿', w*.88, gy-72, 0xff2fcf, 36); this.text('▭', w*.75, gy-118, 0x00e5ff, 32);
    }
    drawMaprang(c) {
      const g = new PIXI.Graphics();
      g.beginFill(0x111111); g.lineStyle(1,0xffffff); g.drawEllipse(-34,-78,20,24); g.drawEllipse(34,-78,20,24); g.endFill();
      g.beginFill(0xffe0c4); g.lineStyle(1,0xffffff); g.drawCircle(0,-82,31); g.endFill();
      g.beginFill(0x111111); g.drawRect(-28,-114,56,28); g.moveTo(-26,-86); g.lineTo(-14,-104); g.lineTo(-2,-86); g.lineTo(9,-104); g.lineTo(22,-86); g.endFill();
      g.beginFill(0x163d86); g.lineStyle(2,0x00e5ff); g.moveTo(0,-52); g.lineTo(-28,-12); g.lineTo(28,-12); g.lineTo(0,-52); g.endFill();
      g.lineStyle(4,0xffe0c4); g.moveTo(-16,-42); g.lineTo(-36,-28); g.moveTo(16,-42); g.lineTo(36,-28); g.moveTo(-8,-12); g.lineTo(-24,14); g.moveTo(8,-12); g.lineTo(24,14);
      c.addChild(g);
      const texts = [['✿',24,-104,0xff2fcf,26],['●',-12,-85,0x111111,13],['●',12,-85,0x111111,13],['⌣',0,-67,0xcc3366,22],['♡',0,-33,0xff2fcf,18]];
      texts.forEach(([s,x,y,col,size]) => { const t = new PIXI.Text(s,{fontFamily:'Consolas',fontSize:size,fill:col,fontWeight:'bold'}); t.anchor.set(.5); t.x=x; t.y=y; c.addChild(t); });
    }
  }

  function initScene() {
    const el = $('pixiStage');
    if (window.PIXI) window.maprangScene = new PixiMaprangScene(el);
    else window.maprangScene = new CanvasFallbackScene(el);
  }

  document.querySelectorAll('.stage-tab').forEach(btn => btn.addEventListener('click', () => setStage(btn.dataset.stage)));
  document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === btn));
    if (state.status) renderRequests(state.status.recent || []);
  }));
  $('openServer').addEventListener('click', () => window.open(location.origin, '_blank'));
  $('copyUrl').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.origin); $('miniScene').textContent = 'Copied server URL.'; } catch { $('miniScene').textContent = location.origin; } });
  $('healthJson').addEventListener('click', () => window.open('/api/server-status', '_blank'));
  $('adminPortal').addEventListener('click', () => window.open('/index', '_blank'));

  initScene();
  setStage('school');
  refreshStatus();
})();
