(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // ── Stage definitions ──────────────────────────────────────────
  const STAGES = [
    {
      id: 'school',
      num: 1,
      title: 'STAGE 1 — SCHOOL',
      goal: 'Collect stars, books, lunch & ribbon',
      primary: '#27bff4',
      secondary: '#5ed5fd',
      glow: 'rgba(94, 213, 253, 0.28)',
      hud: [
        ['⭐', 'Stars', 'stars'],
        ['📚', 'Books', 'books'],
        ['🍱', 'Lunch', 'lunchbox'],
        ['🎀', 'Ribbon', 'ribbon'],
      ],
    },
    {
      id: 'playground',
      num: 2,
      title: 'STAGE 2 — PLAYGROUND',
      goal: 'Collect stars, hearts, rides & balloons',
      primary: '#f98b2c',
      secondary: '#fca736',
      glow: 'rgba(252, 167, 54, 0.28)',
      hud: [
        ['⭐', 'Stars', 'stars'],
        ['♥', 'Hearts', 'hearts'],
        ['🎠', 'Rides', 'rides'],
        ['🎈', 'Balloons', 'balloons'],
      ],
    },
    {
      id: 'zootopia',
      num: 3,
      title: 'STAGE 3 — ZOOTOPIA',
      goal: 'Collect stars, animals, buildings & tickets',
      primary: '#a659ef',
      secondary: '#a85df0',
      glow: 'rgba(168, 93, 240, 0.28)',
      hud: [
        ['⭐', 'Stars', 'stars'],
        ['🦊', 'Animals', 'animals'],
        ['🏙️', 'Buildings', 'buildings'],
        ['🎫', 'Tickets', 'tickets'],
      ],
    },
    {
      id: 'minecraft',
      num: 4,
      title: 'STAGE 4 — MINECRAFT',
      goal: 'Collect stars, diamonds, wood & food',
      primary: '#46a13b',
      secondary: '#65da57',
      glow: 'rgba(101, 218, 87, 0.28)',
      hud: [
        ['⭐', 'Stars', 'stars'],
        ['💎', 'Diamonds', 'diamonds'],
        ['🪵', 'Wood', 'wood'],
        ['🍎', 'Food', 'food'],
      ],
    },
    {
      id: 'space',
      num: 5,
      title: 'STAGE 5 — SPACE',
      goal: 'Collect stars, rockets, planets & comets',
      primary: '#317bf7',
      secondary: '#51a5fc',
      glow: 'rgba(81, 165, 252, 0.28)',
      hud: [
        ['⭐', 'Stars', 'stars'],
        ['🚀', 'Rockets', 'rockets'],
        ['🪐', 'Planets', 'planets'],
        ['☄️', 'Comets', 'comets'],
      ],
    },
  ];

  const STAGE_MAP = Object.fromEntries(
    STAGES.map(stage => [stage.id, stage])
  );

  const STAGE_IDS = STAGES.map(stage => stage.id);

  // ── Sprite sheet layout ────────────────────────────────────────
  // Natural size of maprang-assets.png: 1122 × 1402 pixels.
  // Press D in the browser to display the debug crop overlay.
  const SHEET_WIDTH = 1122;
  const SHEET_HEIGHT = 1402;

  const spriteRect = (x, y, width, height) => [
    x / SHEET_WIDTH,
    y / SHEET_HEIGHT,
    width / SHEET_WIDTH,
    height / SHEET_HEIGHT,
  ];

  const SHEET = {
    debug: false,

    // Character cells: x, y, width, height in source pixels.
    frames: {
      idle: spriteRect(22, 123, 114, 134),
      run: spriteRect(141, 123, 115, 134),
      jump: spriteRect(260, 123, 114, 134),
      happy: spriteRect(378, 123, 115, 134),
      wave: spriteRect(497, 123, 114, 134),
    },

    // Stage scene areas excluding the stage labels and right-side panels.
    bg: {
      school: spriteRect(18, 348, 535, 159),
      playground: spriteRect(18, 564, 535, 145),
      zootopia: spriteRect(18, 772, 535, 136),
      minecraft: spriteRect(18, 973, 535, 116),
      space: spriteRect(18, 1153, 535, 130),
    },

    // Ground level inside each background crop.
    // 0 = top, 1 = bottom.
    ground: {
      school: 0.90,
      playground: 0.87,
      zootopia: 0.90,
      minecraft: 0.77,
      space: 0.84,
    },
  };

  // ── Convert normalized regions into source-image pixels ────────
  let sheetPixels = null;

  function calcSheetPixels(img) {
    const imageWidth = img.naturalWidth;
    const imageHeight = img.naturalHeight;

    const convert = ([left, top, width, height]) => [
      Math.round(left * imageWidth),
      Math.round(top * imageHeight),
      Math.round(width * imageWidth),
      Math.round(height * imageHeight),
    ];

    sheetPixels = {
      frames: Object.fromEntries(
        Object.entries(SHEET.frames).map(([key, value]) => [
          key,
          convert(value),
        ])
      ),
      bg: Object.fromEntries(
        Object.entries(SHEET.bg).map(([key, value]) => [
          key,
          convert(value),
        ])
      ),
    };
  }

  const AUTO_MS = 25000;
  const PAUSE_MS = 60000;

  // ── Global state ───────────────────────────────────────────────
  const state = {
    stageId: 'school',
    status: null,
    score: 0,
    lastReqCount: 0,
    rewards: {},
    avgHistory: [],
    filter: 'all',
    pulse: 0,
    mood: 'smile',
    moodMs: 0,
    rotateTs: performance.now(),
    pauseUntil: 0,
  };

  STAGES.forEach(stage => {
    stage.hud.forEach(([, , key]) => {
      state.rewards[key] = 0;
    });
  });

  // ── Utility helpers ────────────────────────────────────────────
  const getStage = () => STAGE_MAP[state.stageId];

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = value;
    }
  }

  function setHTML(id, value) {
    const element = $(id);

    if (element) {
      element.innerHTML = value;
    }
  }

  function applyStageCSS(stage) {
    const root = document.documentElement.style;

    root.setProperty('--sc', stage.primary);
    root.setProperty('--sc2', stage.secondary);
    root.setProperty('--sglow', stage.glow);
  }

  // ── HUD ────────────────────────────────────────────────────────
  function updateHUD() {
    const footer = $('gameFooter');

    if (!footer) {
      return;
    }

    const stage = getStage();

    footer.innerHTML = stage.hud
      .map(
        ([icon, label, key]) => `
          <div class="hud-item">
            <span class="hud-icon">${icon}</span>
            <div>
              <span class="hud-label">${label}</span>
              <span class="hud-value" id="hud-${key}">
                ${state.rewards[key]}
              </span>
            </div>
          </div>
        `
      )
      .join('');
  }

  // ── Stage switching ────────────────────────────────────────────
  function setStage(id, manual = false) {
    if (!STAGE_MAP[id]) {
      console.warn('[Dashboard] Unknown stage:', id);
      return;
    }

    state.stageId = id;

    if (manual) {
      state.pauseUntil = performance.now() + PAUSE_MS;
    }

    state.rotateTs = performance.now();

    document.querySelectorAll('.stage-tab').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.stage === id
      );
    });

    const stage = getStage();

    setText('stageTitle', stage.title);
    setText('stageGoal', stage.goal);

    applyStageCSS(stage);
    updateHUD();

    if (window._scene) {
      window._scene.setStage(id);
    }
  }

  function nextStage() {
    const currentIndex = STAGE_IDS.indexOf(state.stageId);
    const nextIndex = (currentIndex + 1) % STAGE_IDS.length;

    setStage(STAGE_IDS[nextIndex]);
  }

  // ── Auto-rotate progress bar ───────────────────────────────────
  function tickRotate(now) {
    const fill = $('autoRotateFill');

    if (!fill) {
      return;
    }

    if (now < state.pauseUntil) {
      const pauseStarted = state.pauseUntil - PAUSE_MS;
      const elapsedPause = now - pauseStarted;
      const percent = Math.min(
        100,
        (elapsedPause / PAUSE_MS) * 100
      );

      fill.style.width = `${percent}%`;
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
    const percent = Math.min(
      100,
      (elapsed / AUTO_MS) * 100
    );

    fill.style.width = `${percent}%`;

    if (elapsed >= AUTO_MS) {
      state.rotateTs = now;
      nextStage();
    }
  }

  // ── Rewards ────────────────────────────────────────────────────
  function applyRewards(delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }

    const keys = getStage().hud.map(([, , key]) => key);
    const previousScore = state.score;

    for (let index = 0; index < delta; index += 1) {
      const key =
        keys[(state.lastReqCount + index) % keys.length];

      state.rewards[key] =
        (state.rewards[key] || 0) + 1;
    }

    state.score += delta * 10;

    setText('score', state.score);

    getStage().hud.forEach(([, , key]) => {
      const element = $(`hud-${key}`);

      if (element) {
        element.textContent = state.rewards[key];
      }
    });

    const previousLevel = Math.floor(previousScore / 50);
    const currentLevel = Math.floor(state.score / 50);

    if (currentLevel > previousLevel) {
      state.mood = 'jump';
      state.moodMs = 1400;
    }
  }

  // ── API polling ────────────────────────────────────────────────
  async function poll() {
    try {
      const response = await fetch('/api/server-status', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(
          `Server returned HTTP ${response.status}`
        );
      }

      const data = await response.json();

      state.status = data;

      const requestCount = Number(data.requestCount || 0);

      if (requestCount > state.lastReqCount) {
        const delta =
          requestCount - state.lastReqCount;

        applyRewards(delta);

        state.pulse = Math.min(
          30,
          state.pulse + delta * 5
        );

        state.lastReqCount = requestCount;

        if (
          state.mood !== 'jump' &&
          state.mood !== 'angry'
        ) {
          state.mood = 'wave';
          state.moodMs = 3000;
        }

        if (window._scene) {
          window._scene.pulse(delta);
        }
      }

      state.avgHistory.push(
        Number(data.avgResponseMs || 0)
      );

      state.avgHistory =
        state.avgHistory.slice(-42);

      const errorCount = (data.recent || []).filter(
        request =>
          !String(request.status || '').startsWith('2')
      ).length;

      if (
        errorCount > 2 &&
        state.mood !== 'jump'
      ) {
        state.mood = 'angry';
        state.moodMs = 6000;
      }

      renderStatus(data);
    } catch (error) {
      state.mood = 'angry';
      state.moodMs = 10000;

      setText('onlineBadge', 'ERROR');

      const badge = $('onlineBadge');

      if (badge) {
        badge.className = 'badge error';
      }

      setText(
        'miniScene',
        `Server offline: ${
          error.message || error
        }`
      );
    } finally {
      window.setTimeout(poll, 4000);
    }
  }

  // ── Status rendering ───────────────────────────────────────────
  function renderStatus(data) {
    const ok = Boolean(data.ok);
    const recent = data.recent || [];

    setText(
      'serverUrl',
      data.url || location.origin
    );

    setText(
      'uptime',
      fmtUp(data.uptimeSec)
    );

    setText(
      'reqCount',
      `${data.requestCount || 0} reqs`
    );

    const lastRequest = recent.length
      ? `${recent[recent.length - 1].method} ${
          recent[recent.length - 1].path
        }`
      : '—';

    setText('lastRequest', lastRequest);
    setText(
      'onlineBadge',
      ok ? 'ONLINE' : 'ERROR'
    );

    const onlineBadge = $('onlineBadge');

    if (onlineBadge) {
      onlineBadge.className =
        `badge ${ok ? 'online' : 'error'}`;
    }

    const endpointHTML = Object.entries(
      data.endpoints || {}
    )
      .map(
        ([path, information]) => `
          <div class="endpoint-row">
            <span>${path}</span>
            <i class="dot ${
              information.ok ? 'ok' : ''
            }"></i>
            <b class="code ${
              information.ok ? 'ok' : ''
            }">
              ${information.status || '—'}
            </b>
          </div>
        `
      )
      .join('');

    setHTML('endpointList', endpointHTML);

    const moduleHTML = Object.entries(
      data.modules || {}
    )
      .slice(0, 8)
      .map(
        ([name, count]) => `
          <div class="module-row">
            <span>${name}</span>
            <b>${count}</b>
          </div>
        `
      )
      .join('');

    setHTML('moduleList', moduleHTML);

    const load = Math.min(
      100,
      Number(data.requestsPerMin || 0) * 10
    );

    const apiLoad = $('apiLoad');

    if (apiLoad) {
      apiLoad.style.width = `${load}%`;
    }

    setText(
      'apiLoadText',
      `${Math.round(load)}%`
    );

    const dataHealth = $('dataHealth');

    if (dataHealth) {
      dataHealth.style.width =
        data.dataWritable ? '100%' : '5%';
    }

    setText(
      'dataHealthText',
      data.dataWritable ? 'OK' : 'ERR'
    );

    const activeThreads = Number(
      data.activeThreads || 0
    );

    const threadsMeter = $('threadsMeter');

    if (threadsMeter) {
      threadsMeter.style.width =
        `${Math.min(
          100,
          (activeThreads / 12) * 100
        )}%`;
    }

    setText('threadsText', activeThreads);
    setText(
      'rpmText',
      data.requestsPerMin || 0
    );

    setText(
      'avgText',
      `${data.avgResponseMs || 0}ms`
    );

    drawSparkline();
    renderRequests(recent);

    if (ok && state.mood === 'smile') {
      setText(
        'miniScene',
        'Running smoothly! Keep going!'
      );
    } else if (!ok) {
      setText(
        'miniScene',
        'Server degraded — check Endpoint Health!'
      );
    }
  }

  // ── Sparkline ──────────────────────────────────────────────────
  function drawSparkline() {
    const canvas = $('sparkline');

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;

    canvas.width =
      (canvas.offsetWidth || 280) * ratio;

    canvas.height =
      (canvas.offsetHeight || 40) * ratio;

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    context.strokeStyle =
      getStage().secondary;

    context.lineWidth = 1.5 * ratio;

    const values =
      state.avgHistory.length > 1
        ? state.avgHistory
        : [0, 1];

    const maximum = Math.max(
      ...values,
      1
    );

    context.beginPath();

    values.forEach((value, index) => {
      const x =
        (index / (values.length - 1)) *
        canvas.width;

      const y =
        canvas.height -
        (value / maximum) *
          (canvas.height - 4) -
        2;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });

    context.stroke();
  }

  // ── Recent requests ────────────────────────────────────────────
  function renderRequests(rows) {
    const requestTable = $('requestTable');

    if (!requestTable) {
      return;
    }

    let shown = (rows || []).slice();

    if (state.filter === 'errors') {
      shown = shown.filter(
        request =>
          !String(
            request.status || ''
          ).startsWith('2')
      );
    }

    shown = shown.slice(-14);

    const header = `
      <div class="request-head">
        <span>TIME</span>
        <span>METHOD</span>
        <span>PATH</span>
        <span>STATUS</span>
        <span class="rsize">SIZE</span>
      </div>
    `;

    const body =
      shown
        .map(request => {
          const ok = String(
            request.status || ''
          ).startsWith('2');

          return `
            <div class="request-row${
              ok ? '' : ' err-row'
            }">
              <span>[${request.time || ''}]</span>
              <span>${request.method || ''}</span>
              <span
                class="path"
                title="${request.path || ''}"
              >
                ${request.path || ''}
              </span>
              <b class="status ${
                ok ? 'ok' : 'err'
              }">
                ${request.status || '—'}
              </b>
              <span class="rsize">
                ${fmtSz(request.size)}
              </span>
            </div>
          `;
        })
        .join('') ||
      `
        <div class="request-row">
          <span>No requests yet</span>
        </div>
      `;

    requestTable.innerHTML =
      header +
      `<div class="request-body">${body}</div>`;
  }

  // ── Formatting helpers ─────────────────────────────────────────
  const fmtUp = seconds => {
    const totalSeconds = Math.max(
      0,
      Math.floor(seconds || 0)
    );

    const hours = Math.floor(
      totalSeconds / 3600
    );

    const minutes = Math.floor(
      (totalSeconds % 3600) / 60
    );

    const remainingSeconds =
      totalSeconds % 60;

    return [
      hours,
      minutes,
      remainingSeconds,
    ]
      .map(value =>
        String(value).padStart(2, '0')
      )
      .join(':');
  };

  const fmtSz = value => {
    const bytes = Number(value || 0);

    if (bytes >= 1048576) {
      return `${(
        bytes / 1048576
      ).toFixed(1)} MB`;
    }

    if (bytes >= 1024) {
      return `${(
        bytes / 1024
      ).toFixed(1)} KB`;
    }

    return `${bytes} B`;
  };

  // ── Sprite Scene ───────────────────────────────────────────────
  class SpriteScene {
    constructor(element) {
      if (!element) {
        throw new Error(
          'Dashboard element #pixiStage was not found.'
        );
      }

      this.el = element;
      this.stageId = 'school';
      this.charX = 0.5;
      this.charDir = 1;
      this.img = null;
      this.ready = false;
      this.loadError = false;

      this.canvas =
        document.createElement('canvas');

      this.canvas.style.cssText = [
        'display:block',
        'width:100%',
        'height:100%',
        'image-rendering:pixelated',
      ].join(';');

      element.appendChild(this.canvas);

      this.ctx =
        this.canvas.getContext('2d');

      if (!this.ctx) {
        throw new Error(
          'Canvas 2D is not supported by this browser.'
        );
      }

      // Try several common asset paths.
      this._loadSpriteSheet([
        '/static/maprang-assets.png',
        './static/maprang-assets.png',
        'static/maprang-assets.png',
        './maprang-assets.png',
        'maprang-assets.png',
      ]);

      this._loop();
    }

    _loadSpriteSheet(paths, index = 0) {
      if (index >= paths.length) {
        this.ready = false;
        this.loadError = true;

        console.error(
          '[Dashboard] maprang-assets.png could not be loaded. ' +
          'Place it in the page directory or in a static folder.'
        );

        return;
      }

      const image = new Image();

      image.onload = () => {
        this.img = image;
        this.ready = true;
        this.loadError = false;

        calcSheetPixels(image);

        console.info(
          '[Dashboard] Loaded sprite sheet:',
          paths[index],
          `${image.naturalWidth}×${image.naturalHeight}`
        );

        if (
          image.naturalWidth !== SHEET_WIDTH ||
          image.naturalHeight !== SHEET_HEIGHT
        ) {
          console.warn(
            '[Dashboard] Unexpected image dimensions. ' +
            `Expected ${SHEET_WIDTH}×${SHEET_HEIGHT}, ` +
            `received ${image.naturalWidth}×${image.naturalHeight}.`
          );
        }
      };

      image.onerror = () => {
        this._loadSpriteSheet(
          paths,
          index + 1
        );
      };

      image.src = paths[index];
    }

    setStage(id) {
      if (STAGE_MAP[id]) {
        this.stageId = id;
      }
    }

    pulse(delta) {
      state.pulse = Math.min(
        30,
        state.pulse + delta * 6
      );
    }

    _loop() {
      const now = performance.now();

      const canvasWidth =
        this.el.offsetWidth || 600;

      const canvasHeight =
        this.el.offsetHeight || 240;

      const pixelRatio =
        window.devicePixelRatio || 1;

      const targetWidth = Math.max(
        1,
        Math.round(
          canvasWidth * pixelRatio
        )
      );

      const targetHeight = Math.max(
        1,
        Math.round(
          canvasHeight * pixelRatio
        )
      );

      if (
        this.canvas.width !== targetWidth ||
        this.canvas.height !== targetHeight
      ) {
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
      }

      this.ctx.setTransform(
        pixelRatio,
        0,
        0,
        pixelRatio,
        0,
        0
      );

      tickRotate(now);

      if (state.moodMs > 0) {
        state.moodMs -= 16.67;

        if (state.moodMs <= 0) {
          state.moodMs = 0;
          state.mood = 'smile';
        }
      }

      this.ctx.clearRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      if (
        this.ready &&
        this.img &&
        sheetPixels
      ) {
        this._drawBackground(
          this.ctx,
          canvasWidth,
          canvasHeight
        );

        this._drawMaprang(
          this.ctx,
          canvasWidth,
          canvasHeight,
          now
        );

        if (SHEET.debug) {
          this._drawDebug(
            this.ctx,
            canvasWidth,
            canvasHeight
          );
        }
      } else {
        this._drawLoadingState(
          this.ctx,
          canvasWidth,
          canvasHeight
        );
      }

      state.pulse = Math.max(
        0,
        state.pulse - 0.07
      );

      window.requestAnimationFrame(
        () => this._loop()
      );
    }

    _drawLoadingState(
      context,
      canvasWidth,
      canvasHeight
    ) {
      context.fillStyle = '#02040a';

      context.fillRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      context.fillStyle =
        getStage().primary;

      context.font =
        '11px "Courier New", monospace';

      context.textAlign = 'center';
      context.textBaseline = 'middle';

      const message = this.loadError
        ? 'maprang-assets.png not found'
        : 'Loading maprang-assets.png...';

      context.fillText(
        message,
        canvasWidth / 2,
        canvasHeight / 2 - 10
      );

      if (this.loadError) {
        context.fillStyle = '#ffffff';

        context.font =
          '9px "Courier New", monospace';

        context.fillText(
          'Place it in /static/ or beside the dashboard page',
          canvasWidth / 2,
          canvasHeight / 2 + 12
        );
      }
    }

    // Draw the active stage background.
    _drawBackground(
      context,
      canvasWidth,
      canvasHeight
    ) {
      const source =
        sheetPixels.bg[this.stageId];

      if (!source) {
        return;
      }

      const [
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
      ] = source;

      const scale =
        canvasWidth / sourceWidth;

      const destinationHeight =
        sourceHeight * scale;

      const destinationY =
        (canvasHeight - destinationHeight) / 2;

      context.imageSmoothingEnabled = false;

      context.drawImage(
        this.img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        destinationY,
        canvasWidth,
        destinationHeight
      );

      // Extend the upper and lower edge pixels when the container is taller
      // than the scaled background.
      if (destinationY > 0) {
        context.drawImage(
          this.img,
          sourceX,
          sourceY,
          sourceWidth,
          1,
          0,
          0,
          canvasWidth,
          destinationY
        );

        context.drawImage(
          this.img,
          sourceX,
          sourceY + sourceHeight - 1,
          sourceWidth,
          1,
          0,
          destinationY +
            destinationHeight,
          canvasWidth,
          canvasHeight -
            destinationY -
            destinationHeight
        );
      }
    }

    // Return the ground position in canvas pixels.
    _groundY(
      canvasWidth,
      canvasHeight
    ) {
      const source =
        sheetPixels.bg[this.stageId];

      if (!source) {
        return canvasHeight * 0.82;
      }

      const [, , sourceWidth, sourceHeight] =
        source;

      const scale =
        canvasWidth / sourceWidth;

      const destinationHeight =
        sourceHeight * scale;

      const destinationY =
        (canvasHeight - destinationHeight) / 2;

      const groundFraction =
        SHEET.ground[this.stageId] ?? 0.82;

      return (
        destinationY +
        destinationHeight * groundFraction
      );
    }

    // Draw the Maprang character.
    _drawMaprang(
      context,
      canvasWidth,
      canvasHeight,
      now
    ) {
      const speed =
        0.0025 +
        state.pulse * 0.0003;

      this.charX +=
        speed * this.charDir;

      if (
        this.charX > 0.87 ||
        this.charX < 0.13
      ) {
        this.charDir *= -1;

        this.charX = Math.max(
          0.13,
          Math.min(0.87, this.charX)
        );
      }

      const walkFrame =
        Math.floor(now / 280) % 2 === 0
          ? 'idle'
          : 'run';

      let frameName = walkFrame;

      if (state.mood === 'jump') {
        frameName = 'jump';
      } else if (state.mood === 'wave') {
        frameName = 'wave';
      } else if (state.mood === 'happy') {
        frameName = 'happy';
      }

      const source =
        sheetPixels.frames[frameName];

      if (!source) {
        return;
      }

      const [
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
      ] = source;

      const spriteHeight =
        canvasHeight * 0.40;

      const spriteWidth =
        spriteHeight *
        (sourceWidth / sourceHeight);

      const groundY =
        this._groundY(
          canvasWidth,
          canvasHeight
        );

      let extraY = 0;

      if (state.mood === 'jump') {
        extraY =
          -Math.abs(
            Math.sin(now / 420)
          ) *
          canvasHeight *
          0.18;
      } else {
        extraY =
          Math.sin(now / 500) *
          canvasHeight *
          0.012;
      }

      const drawX =
        this.charX * canvasWidth;

      const drawY =
        groundY + extraY;

      context.save();

      context.translate(
        drawX,
        drawY
      );

      if (this.charDir < 0) {
        context.scale(-1, 1);
      }

      context.imageSmoothingEnabled = false;

      context.drawImage(
        this.img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        -spriteWidth / 2,
        -spriteHeight,
        spriteWidth,
        spriteHeight
      );

      if (state.mood === 'angry') {
        context.globalAlpha = 0.35;
        context.fillStyle = '#ff2020';

        context.fillRect(
          -spriteWidth / 2,
          -spriteHeight,
          spriteWidth,
          spriteHeight
        );

        context.globalAlpha = 1;
      }

      context.restore();
    }

    // Display the entire asset sheet with the crop regions.
    _drawDebug(
      context,
      canvasWidth,
      canvasHeight
    ) {
      if (!this.img) {
        return;
      }

      const imageWidth =
        this.img.naturalWidth;

      const imageHeight =
        this.img.naturalHeight;

      const scale =
        Math.min(
          canvasWidth / imageWidth,
          canvasHeight / imageHeight
        ) * 0.9;

      const offsetX =
        (canvasWidth -
          imageWidth * scale) / 2;

      const offsetY =
        (canvasHeight -
          imageHeight * scale) / 2;

      context.fillStyle =
        'rgba(0, 0, 0, 0.75)';

      context.fillRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      context.imageSmoothingEnabled = false;

      context.drawImage(
        this.img,
        offsetX,
        offsetY,
        imageWidth * scale,
        imageHeight * scale
      );

      const drawBox = (
        region,
        label,
        color
      ) => {
        const [
          normalizedLeft,
          normalizedTop,
          normalizedWidth,
          normalizedHeight,
        ] = region;

        const x =
          offsetX +
          normalizedLeft *
            imageWidth *
            scale;

        const y =
          offsetY +
          normalizedTop *
            imageHeight *
            scale;

        const width =
          normalizedWidth *
          imageWidth *
          scale;

        const height =
          normalizedHeight *
          imageHeight *
          scale;

        context.strokeStyle = color;
        context.lineWidth = 2;

        context.strokeRect(
          x,
          y,
          width,
          height
        );

        context.fillStyle = color;
        context.font =
          '9px monospace';

        context.textAlign = 'left';
        context.textBaseline = 'top';

        context.fillText(
          label,
          x + 2,
          y + 2
        );
      };

      Object.entries(
        SHEET.frames
      ).forEach(([key, region]) => {
        drawBox(
          region,
          key,
          '#ff6b9d'
        );
      });

      Object.entries(
        SHEET.bg
      ).forEach(([key, region]) => {
        drawBox(
          region,
          key,
          '#4ecdc4'
        );
      });

      context.fillStyle = '#ffff00';
      context.font =
        'bold 11px monospace';

      context.textAlign = 'center';
      context.textBaseline = 'top';

      context.fillText(
        'DEBUG MODE — Press D to toggle',
        canvasWidth / 2,
        8
      );
    }
  }

  // ── Keyboard controls ──────────────────────────────────────────
  document.addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'd' ||
        event.key === 'D'
      ) {
        SHEET.debug = !SHEET.debug;
      }
    }
  );

  // ── Event listeners ────────────────────────────────────────────
  document
    .querySelectorAll('.stage-tab')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          setStage(
            button.dataset.stage,
            true
          );
        }
      );
    });

  document
    .querySelectorAll('.filter-btn')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          state.filter =
            button.dataset.filter;

          document
            .querySelectorAll(
              '.filter-btn'
            )
            .forEach(filterButton => {
              filterButton.classList.toggle(
                'active',
                filterButton === button
              );
            });

          if (state.status) {
            renderRequests(
              state.status.recent || []
            );
          }
        }
      );
    });

  function addClickHandler(
    id,
    handler
  ) {
    const element = $(id);

    if (element) {
      element.addEventListener(
        'click',
        handler
      );
    }
  }

  addClickHandler(
    'openServer',
    () => {
      window.open(
        location.origin,
        '_blank',
        'noopener,noreferrer'
      );
    }
  );

  addClickHandler(
    'copyUrl',
    async () => {
      try {
        await navigator.clipboard.writeText(
          location.origin
        );

        setText(
          'miniScene',
          'Server URL copied!'
        );
      } catch {
        setText(
          'miniScene',
          location.origin
        );
      }
    }
  );

  addClickHandler(
    'healthJson',
    () => {
      window.open(
        '/api/server-status',
        '_blank',
        'noopener,noreferrer'
      );
    }
  );

  addClickHandler(
    'adminPortal',
    () => {
      window.open(
        '/index',
        '_blank',
        'noopener,noreferrer'
      );
    }
  );

  addClickHandler(
    'hmrReport',
    () => {
      window.open(
        '/hmr-report',
        '_blank',
        'noopener,noreferrer'
      );
    }
  );

  // ── Boot ───────────────────────────────────────────────────────
  function boot() {
    const stageElement =
      $('pixiStage');

    if (!stageElement) {
      console.error(
        '[Dashboard] Cannot start: #pixiStage was not found.'
      );

      return;
    }

    window._scene =
      new SpriteScene(stageElement);

    setStage('school');
    poll();
  }

  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      boot,
      { once: true }
    );
  } else {
    boot();
  }
})();