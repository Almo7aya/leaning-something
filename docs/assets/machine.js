/* ============================================================
   machine.js — a running model of the emulator, frame after frame.

   This is deliberately unlike everything else on the site. The
   other figures are explanations you step through; this is a
   simulation you perturb. Frames are produced continuously, the
   cost of each one is computed from the parameters you set, and
   that cost drives both the graph and how long the frame actually
   takes to play out — so a stutter is something you see the
   machine hesitate on, not something a caption tells you about.

   Built on Konva (vendored in assets/konva.min.js): one stage,
   several layers, a few thousand nodes mutated in place rather
   than recreated.

   The numbers are a teaching model, not a benchmark. They are
   shaped to reproduce the *behaviour* the topics describe —
   cache thrash, upload cost scaling with granularity, serialised
   compute — at magnitudes that read clearly on screen.
   ============================================================ */
(function () {
  "use strict";

  var host = document.getElementById("machine");
  if (!host) return;
  if (!window.Konva) {
    host.innerHTML = '<p class="mc-fail">This page needs <code>konva.min.js</code>, which did not load. ' +
      "A hard refresh (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) usually fixes it.</p>";
    return;
  }

  /* ============================================================
     PALETTE — Konva needs concrete colours, so resolve the CSS
     custom properties once and again whenever the theme flips.
     ============================================================ */

  var C = {};
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, fb) { return (cs.getPropertyValue(n) || "").trim() || fb; }
    C.bg      = v("--surface", "#1b1e24");
    C.bg2     = v("--surface-2", "#23272f");
    C.line    = v("--line", "#333944");
    C.line2   = v("--line-2", "#4d5563");
    C.ink     = v("--ink", "#f2f0ec");
    C.ink2    = v("--ink-2", "#c6c0b8");
    C.ink3    = v("--ink-3", "#948d84");
    C.guest   = v("--guest", "#63a0da");
    C.kyty    = v("--kyty", "#d09b2f");
    C.host    = v("--host", "#dc6f8b");
    C.accent  = v("--accent", "#63a0da");
  }
  readPalette();

  var MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  /* ============================================================
     PARAMETERS — everything here is live-editable
     ============================================================ */

  var P = {
    draws: 24,          // draw calls submitted per frame
    variety: 6,         // distinct pipeline states used per frame
    cacheSize: 16,      // pipeline cache capacity
    texMB: 6,           // texture working set the CPU touches
    dirtyRate: 0.12,    // fraction of guest pages the CPU writes per frame
    granKB: 64,         // page-watch granularity
    asyncCompute: true, // compute queues run alongside graphics
    vsync: true,
    speed: 1,
    paused: false
  };

  /* ============================================================
     SIMULATION
     ============================================================ */

  var PAGES = 192;          // pages shown in the memory grid
  var REGS = 128;           // hardware registers shown
  var RING = 72;            // ring-buffer slots
  var GRAPH = 110;          // frames of history

  var sim = {
    frame: 0,
    cache: [],              // pipeline cache slots: {key, age} | null
    pages: new Array(PAGES),// 0 clean · 1 dirty · 2 uploading
    regs: new Array(REGS).fill(0),
    ring: new Array(RING).fill(0),   // 0 empty · 1..4 packet kind
    history: [],
    lastReport: null,
    totals: { frames: 0, misses: 0, uploadedMB: 0, stallMs: 0 }
  };
  for (var i = 0; i < PAGES; i++) sim.pages[i] = 0;
  for (var i2 = 0; i2 < 24; i2++) sim.cache.push(null);

  function pageBytes() { return P.granKB * 1024; }

  /* One simulated frame. Returns a cost breakdown; the animation
     then plays that breakdown out over wall-clock time. */
  function computeFrame() {
    var r = { draws: P.draws, hits: 0, misses: 0, compileMs: 0, drawMs: 0,
              uploadMs: 0, uploadedMB: 0, syncMs: 0, dirtyPages: 0, totalMs: 0 };

    /* ---- pipeline cache ----
       `variety` distinct states are requested each frame. If the cache
       cannot hold them all, they evict each other and every frame pays
       to recompile — the thrash the Vulkan topic describes. */
    var live = P.cacheSize;
    for (var k = 0; k < P.variety; k++) {
      var key = "state-" + k;
      var slot = -1;
      for (var c = 0; c < live && c < sim.cache.length; c++) {
        if (sim.cache[c] && sim.cache[c].key === key) { slot = c; break; }
      }
      if (slot >= 0) {
        r.hits++;
        sim.cache[slot].age = 0;
      } else {
        r.misses++;
        r.compileMs += 2.6;                       // a real compile is milliseconds
        // insert, evicting the oldest
        var victim = 0, oldest = -1;
        for (var c2 = 0; c2 < live && c2 < sim.cache.length; c2++) {
          if (!sim.cache[c2]) { victim = c2; oldest = 1e9; break; }
          if (sim.cache[c2].age > oldest) { oldest = sim.cache[c2].age; victim = c2; }
        }
        sim.cache[victim] = { key: key, age: 0, fresh: 1 };
      }
    }
    for (var a = 0; a < sim.cache.length; a++) {
      if (sim.cache[a]) { sim.cache[a].age++; if (a >= live) sim.cache[a] = null; }
    }

    /* ---- CPU writes dirty pages ---- */
    var toDirty = Math.round(PAGES * P.dirtyRate);
    for (var d = 0; d < toDirty; d++) {
      sim.pages[(Math.random() * PAGES) | 0] = 1;
    }
    r.dirtyPages = sim.pages.filter(function (p) { return p === 1; }).length;

    /* ---- upload ----
       Cost is dirty *regions* × granularity. Coarse granularity means
       fewer protection changes but more bytes moved for the same writes:
       the trade the coherency topic is about. */
    r.uploadedMB = (r.dirtyPages * pageBytes()) / (1024 * 1024);
    r.uploadMs = r.uploadedMB * 0.42;

    /* ---- draws ---- */
    r.drawMs = P.draws * 0.055 + (P.texMB * 0.02);

    /* ---- synchronisation ----
       With async compute the compute queues overlap graphics and cost
       almost nothing. Without it they wait behind every batch, so the
       penalty scales with how much work there is — a flat cost would
       vanish inside the vsync window and teach the wrong thing. */
    r.syncMs = P.asyncCompute ? 0.3 : 0.3 + P.draws * 0.18;

    r.totalMs = r.compileMs + r.uploadMs + r.drawMs + r.syncMs + 1.1;

    if (P.vsync) {
      var refresh = 16.67;
      r.presented = Math.ceil(r.totalMs / refresh) * refresh;
      r.dropped = r.presented / refresh - 1;
    } else {
      r.presented = r.totalMs;
      r.dropped = 0;
    }

    sim.totals.frames++;
    sim.totals.misses += r.misses;
    sim.totals.uploadedMB += r.uploadedMB;
    sim.totals.stallMs += r.compileMs;

    sim.history.push(r);
    if (sim.history.length > GRAPH) sim.history.shift();
    sim.lastReport = r;
    return r;
  }

  /* ============================================================
     KONVA SCENE
     ============================================================ */

  /* Layout is driven by named constants rather than magic numbers: the
     panels were previously hand-placed and the GPU-queue rows silently
     overflowed their panel by 5px while the caption landed on top of
     them. Deriving positions makes that class of bug impossible. */
  var W = 1420, H = 1092;
  var R1Y = 20,  R1H = 168;    // guest · ring · command processor
  var R2Y = 204, R2H = 224;    // cache · memory · queues
  var R3Y = 444, R3H = 320;    // frame-time graph · screen
  var R4Y = 780, R4H = 116;    // cumulative totals
  var R5Y = 912, R5H = 164;    // narration
  var PADX = 16, TITLE_H = 34; // inner padding, and room under a panel title

  var stage = new Konva.Stage({ container: host, width: W, height: H });
  var lBack = new Konva.Layer({ listening: false });
  var lLive = new Konva.Layer({ listening: false });
  var lText = new Konva.Layer({ listening: false });
  stage.add(lBack); stage.add(lLive); stage.add(lText);

  /* Konva needs literal colours, so anything built from the palette is
     tracked here and recoloured when the theme flips — cheaper and far
     less rude than reloading the page mid-simulation. */
  var themed = [];
  function track(node, fillKey, strokeKey) {
    themed.push({ n: node, f: fillKey, s: strokeKey });
    return node;
  }
  function recolor() {
    readPalette();
    themed.forEach(function (t) {
      if (t.f) t.n.fill(C[t.f]);
      if (t.s) t.n.stroke(C[t.s]);
    });
    lBack.batchDraw();
    paint();
  }

  function panel(x, y, w, h, title, sub) {
    lBack.add(track(new Konva.Rect({
      x: x, y: y, width: w, height: h, cornerRadius: 10,
      fill: C.bg, stroke: C.line, strokeWidth: 1
    }), "bg", "line"));
    lText.add(track(new Konva.Text({
      x: x + PADX, y: y + 13, text: title.toUpperCase(),
      fontSize: 12, fontFamily: MONO, fontStyle: "bold",
      fill: C.ink3, letterSpacing: 1.4
    }), "ink3"));
    if (sub) {
      lText.add(track(new Konva.Text({
        x: x, y: y + 14, width: w - PADX, text: sub, align: "right",
        fontSize: 11, fontFamily: MONO, fill: C.ink3
      }), "ink3"));
    }
    return { x: x, y: y, w: w, h: h };
  }

  function label(x, y, text, size, fill, bold) {
    var t = new Konva.Text({
      x: x, y: y, text: text, fontSize: size || 12.5, fontFamily: MONO,
      fill: fill || C.ink2, fontStyle: bold ? "bold" : "normal"
    });
    lText.add(t);
    return t;
  }

  /* ---------- 1 · guest thread ---------- */
  panel(20, R1Y, 300, R1H, "Guest thread", "builds the frame");
  var guestTokens = [];
  var GT_X = 20 + PADX, GT_Y = R1Y + TITLE_H;
  for (var g = 0; g < 32; g++) {
    var rct = new Konva.Rect({
      x: GT_X + (g % 16) * 17, y: GT_Y + Math.floor(g / 16) * 17,
      width: 13, height: 13, cornerRadius: 2,
      fill: C.bg2, stroke: C.line, strokeWidth: 1
    });
    lLive.add(rct); guestTokens.push(rct);
  }
  var guestTxt = label(GT_X, GT_Y + 46, "", 12.5, C.ink2);
  var guestTxt2 = label(GT_X, GT_Y + 66, "", 11.5, C.ink3);

  /* ---------- 2 · ring buffer ----------
     Two rows of 36. The write and read markers sit just outside the row
     they point at, so they can never be confused for a cell. */
  panel(336, R1Y, 560, R1H, "Command ring", "PM4 packets");
  var RG_X = 336 + PADX, RG_Y = R1Y + TITLE_H + 6;
  var RG_DX = 15, RG_DY = 26, RG_CW = 12, RG_CH = 18, RG_COLS = 36;
  var ringCells = [];
  for (var rb = 0; rb < RING; rb++) {
    var rr = new Konva.Rect({
      x: RG_X + (rb % RG_COLS) * RG_DX, y: RG_Y + Math.floor(rb / RG_COLS) * RG_DY,
      width: RG_CW, height: RG_CH, cornerRadius: 2,
      fill: C.bg2, stroke: C.line, strokeWidth: 1
    });
    lLive.add(rr); ringCells.push(rr);
  }
  var wHead = new Konva.Rect({ x: RG_X, y: RG_Y - 6, width: RG_CW, height: 3, fill: C.guest, cornerRadius: 1 });
  var rHead = new Konva.Rect({ x: RG_X, y: RG_Y + RG_CH + 3, width: RG_CW, height: 3, fill: C.kyty, cornerRadius: 1 });
  lLive.add(wHead); lLive.add(rHead);
  var RG_BOT = RG_Y + RG_DY + RG_CH;
  label(RG_X, RG_BOT + 12, "▲ write head", 11, C.guest);
  label(RG_X + 108, RG_BOT + 12, "▼ read head", 11, C.kyty);
  var ringTxt = label(RG_X, RG_BOT + 32, "", 11.5, C.ink3);

  /* Position a marker outside the row holding cell `idx`. `above` puts it
     over the row, otherwise under it. Index is clamped rather than wrapped
     so a full buffer does not throw the marker back to column zero. */
  function placeHead(node, idx, above) {
    var i = Math.max(0, Math.min(RING - 1, idx));
    var row = Math.floor(i / RG_COLS);
    node.x(RG_X + (i % RG_COLS) * RG_DX);
    node.y(RG_Y + row * RG_DY + (above ? -6 : RG_CH + 3));
  }

  /* ---------- 3 · command processor + register file ---------- */
  panel(912, R1Y, 488, R1H, "Command processor", "decode → register file");
  var CP_X = 912 + PADX, CP_Y = R1Y + TITLE_H;
  var opTxt = label(CP_X, CP_Y + 4, "idle", 15, C.ink, true);
  var opSub = label(CP_X, CP_Y + 26, "", 11.5, C.ink3);
  var regCells = [];
  var RF_X = 1084, RF_Y = CP_Y, RF_D = 9.6;
  for (var rg = 0; rg < REGS; rg++) {
    var rc = new Konva.Rect({
      x: RF_X + (rg % 32) * RF_D, y: RF_Y + Math.floor(rg / 32) * RF_D,
      width: 7.6, height: 7.6, cornerRadius: 1,
      fill: C.bg2
    });
    lLive.add(rc); regCells.push(rc);
  }
  label(RF_X, RF_Y + 4 * RF_D + 8, "hardware register file · 128 shown", 11, C.ink3);
  var cpTxt = label(CP_X, CP_Y + 74, "", 11.5, C.ink3);

  /* ---------- 4 · pipeline cache ---------- */
  panel(20, R2Y, 300, R2H, "Pipeline cache", "compile on miss");
  var PCX = 20 + PADX, PCY = R2Y + TITLE_H;
  var cacheCells = [];
  for (var pc = 0; pc < 24; pc++) {
    var cc = new Konva.Rect({
      x: PCX + (pc % 6) * 45, y: PCY + Math.floor(pc / 6) * 28,
      width: 40, height: 22, cornerRadius: 3,
      fill: C.bg2, stroke: C.line, strokeWidth: 1
    });
    lLive.add(cc); cacheCells.push(cc);
  }
  var cacheTxt = label(PCX, PCY + 4 * 28 + 10, "", 12.5, C.ink2);
  var cacheTxt2 = new Konva.Text({
    x: PCX, y: PCY + 4 * 28 + 30, width: 300 - PADX * 2, text: "",
    fontSize: 11.5, fontFamily: MONO, fill: C.ink3, lineHeight: 1.35
  });
  lText.add(cacheTxt2);

  /* ---------- 5 · guest memory pages ---------- */
  panel(336, R2Y, 560, R2H, "Guest memory", "dirty pages → upload");
  var PGX = 336 + PADX, PGY = R2Y + TITLE_H, PG_D = 16.6;
  var pageCells = [];
  for (var pg = 0; pg < PAGES; pg++) {
    var pcell = new Konva.Rect({
      x: PGX + (pg % 32) * PG_D, y: PGY + Math.floor(pg / 32) * PG_D,
      width: 14, height: 14, cornerRadius: 2,
      fill: C.bg2
    });
    lLive.add(pcell); pageCells.push(pcell);
  }
  var pageTxt = label(PGX, PGY + 6 * PG_D + 12, "", 11.5, C.ink3);

  /* ---------- 6 · GPU queues ----------
     Five rows plus a caption have to fit inside R2H. Spacing is derived
     from the space available rather than guessed. */
  panel(912, R2Y, 488, R2H, "GPU queues", "graphics + compute");
  var QN = 5, Q_X = 912 + PADX, Q_Y = R2Y + TITLE_H;
  var Q_CAPTION_H = 34;
  var Q_DY = Math.floor(((R2H - TITLE_H - Q_CAPTION_H) / QN));
  var Q_CH = Math.min(15, Q_DY - 7);
  var queueRows = [];
  for (var q = 0; q < QN; q++) {
    var row = [];
    var qy = Q_Y + q * Q_DY;
    label(Q_X, qy + 1, q === 0 ? "gfx" : "cmp" + q, 11.5, q === 0 ? C.kyty : C.guest);
    for (var slot2 = 0; slot2 < 22; slot2++) {
      var qc = new Konva.Rect({
        x: Q_X + 46 + slot2 * 18.4, y: qy,
        width: Q_CH, height: Q_CH, cornerRadius: 2,
        fill: C.bg2, stroke: C.line, strokeWidth: 1
      });
      lLive.add(qc); row.push(qc);
    }
    queueRows.push(row);
  }
  var queueTxt = new Konva.Text({
    x: Q_X, y: Q_Y + QN * Q_DY + 8, width: 488 - PADX * 2, text: "",
    fontSize: 11.5, fontFamily: MONO, fill: C.ink3, lineHeight: 1.35
  });
  lText.add(queueTxt);

  /* ---------- 7 · frame-time graph ---------- */
  panel(20, R3Y, 876, R3H, "Frame time", "last 110 frames");
  var GX = 20 + PADX + 4, GY = R3Y + TITLE_H + 4, GW = 836, GH = R3H - TITLE_H - 66;
  lBack.add(new Konva.Rect({ x: GX, y: GY, width: GW, height: GH, fill: C.bg2, cornerRadius: 6 }));
  var msToY = function (ms) { return GY + GH - Math.min(GH, (ms / 50) * GH); };
  // 16.67 ms target line
  lBack.add(new Konva.Line({
    points: [GX, msToY(16.67), GX + GW, msToY(16.67)],
    stroke: C.kyty, strokeWidth: 1, dash: [4, 4], opacity: 0.75
  }));
  lText.add(new Konva.Text({ x: GX + GW - 96, y: msToY(16.67) - 14, text: "16.67 ms · 60 fps",
    fontSize: 9.5, fontFamily: MONO, fill: C.kyty }));
  lBack.add(new Konva.Line({
    points: [GX, msToY(33.3), GX + GW, msToY(33.3)],
    stroke: C.host, strokeWidth: 1, dash: [4, 4], opacity: 0.5
  }));
  lText.add(new Konva.Text({ x: GX + GW - 96, y: msToY(33.3) - 14, text: "33.3 ms · 30 fps",
    fontSize: 9.5, fontFamily: MONO, fill: C.host }));

  var bars = [];       // stacked: draw | upload | compile | sync
  var BW = GW / GRAPH;
  for (var b = 0; b < GRAPH; b++) {
    var seg = {};
    ["draw", "upload", "compile", "sync"].forEach(function (kind) {
      var s = new Konva.Rect({ x: GX + b * BW, y: GY + GH, width: BW - 1, height: 0, fill: C.bg2 });
      lLive.add(s); seg[kind] = s;
    });
    bars.push(seg);
  }
  var legendY = GY + GH + 16;
  [["draw", C.guest], ["upload", C.kyty], ["compile", C.host], ["sync", C.ink3]].forEach(function (p, n) {
    lBack.add(new Konva.Rect({ x: GX + n * 110, y: legendY + 2, width: 10, height: 10, fill: p[1], cornerRadius: 2 }));
    lText.add(new Konva.Text({ x: GX + 16 + n * 110, y: legendY, text: p[0], fontSize: 11.5, fontFamily: MONO, fill: C.ink3 }));
  });

  /* ---------- 8 · the screen ---------- */
  panel(912, R3Y, 488, R3H, "Screen", "presented frames");
  var SX = 912 + PADX + 8, SY = R3Y + TITLE_H + 4, SW = 440, SH = R3H - TITLE_H - 76;
  lBack.add(new Konva.Rect({ x: SX, y: SY, width: SW, height: SH, fill: "#07080b", cornerRadius: 5 }));
  var scene = new Konva.Group({ x: SX, y: SY, clip: { x: 0, y: 0, width: SW, height: SH } });
  lLive.add(scene);
  var polys = [];
  for (var pl = 0; pl < 7; pl++) {
    var poly = new Konva.Line({ points: [0, 0, 0, 0, 0, 0], closed: true, fill: C.guest, opacity: 0.9 });
    scene.add(poly); polys.push(poly);
  }
  var tearBar = new Konva.Rect({ x: 0, y: 0, width: SW, height: 3, fill: "#ffffff", opacity: 0 });
  scene.add(tearBar);
  var screenTxt = label(SX, SY + SH + 12, "", 12.5, C.ink2);
  var screenTxt2 = label(SX, SY + SH + 32, "", 11.5, C.ink3);

  /* ---------- 9 · running totals ---------- */
  panel(20, R4Y, 1380, R4H, "This run", "cumulative");
  var statTxt = [];
  var ST_X = 20 + PADX + 4, ST_W = 228;
  for (var st = 0; st < 6; st++) {
    label(ST_X + st * ST_W, R4Y + TITLE_H + 6,
      ["frames", "pipeline compiles", "uploaded", "stall time", "avg frame", "worst frame"][st],
      11, C.ink3);
    statTxt.push(label(ST_X + st * ST_W, R4Y + TITLE_H + 26, "—", 19, C.ink, true));
  }

  /* ---------- 10 · what is happening now ---------- */
  panel(20, R5Y, 1380, R5H, "Right now", "");
  var nowTitle = label(20 + PADX + 4, R5Y + TITLE_H + 4, "", 17, C.ink, true);
  var nowBody = new Konva.Text({
    x: 20 + PADX + 4, y: R5Y + TITLE_H + 32, width: 1330, text: "", fontSize: 15.5,
    fontFamily: 'Charter, "Iowan Old Style", Georgia, serif',
    fill: C.ink2, lineHeight: 1.5
  });
  lText.add(nowBody);

  /* ============================================================
     ANIMATION — one simulated frame plays out over wall-clock
     time proportional to its cost, so a stutter reads as one.
     ============================================================ */

  var phase = 0;              // 0..1 through the current frame
  var frameWall = 700;        // ms of wall clock for the current frame
  var report = computeFrame();
  var rotation = 0;

  var STAGES = [
    [0.00, 0.16, "Guest builds packets",
     "The game thread writes PM4 packets into the ring. Nothing has reached the emulator yet — this is the game talking to what it believes is a GPU driver."],
    [0.16, 0.38, "Command processor decodes",
     "Headers are read, opcodes dispatched, and register-write packets accumulate into the shadow register file. No drawing happens here; this is all state."],
    [0.38, 0.56, "Pipeline lookup",
     "Each distinct render state needs a Vulkan pipeline. A hit is free. A miss compiles shaders mid-frame — the single largest source of visible stutter."],
    [0.56, 0.76, "Upload dirty pages",
     "Pages the CPU wrote are copied to the GPU. Cost scales with granularity, not with how much actually changed: coarse tracking moves whole regions for a few bytes."],
    [0.76, 0.92, "Draw",
     "vkCmdDraw for each batch. Compute work either overlaps this or waits for it, depending on whether async compute is on."],
    [0.92, 1.00, "Present",
     "The finished image is flipped. With vsync the frame waits for the next refresh; miss the window and it waits for the one after that."]
  ];

  function stageAt(p) {
    for (var i = 0; i < STAGES.length; i++) if (p >= STAGES[i][0] && p < STAGES[i][1]) return i;
    return STAGES.length - 1;
  }

  function fmt(n, d) { return n.toFixed(d == null ? 1 : d); }

  function paint() {
    var st = stageAt(phase);
    var r = report;

    /* --- guest tokens --- */
    var built = Math.min(32, Math.floor((phase / 0.16) * Math.min(32, P.draws)));
    for (var i = 0; i < 32; i++) {
      var on = i < built && i < P.draws;
      guestTokens[i].fill(on ? C.guest : C.bg2);
      guestTokens[i].opacity(on ? 0.95 : 1);
    }
    guestTxt.text(P.draws + " draw calls this frame");
    guestTxt2.text(P.variety + " distinct pipeline states  ·  " + fmt(P.texMB, 0) + " MB textures");

    /* --- ring --- */
    var written = Math.floor(Math.min(1, phase / 0.16) * RING);
    var read = Math.floor(Math.max(0, Math.min(1, (phase - 0.16) / 0.22)) * RING);
    for (var rr2 = 0; rr2 < RING; rr2++) {
      var f = C.bg2;
      if (rr2 < written && rr2 >= read) f = [C.guest, C.kyty, C.host, C.guest][rr2 % 4];
      else if (rr2 < read) f = C.bg2;
      ringCells[rr2].fill(f);
      ringCells[rr2].opacity(rr2 < written && rr2 >= read ? 0.85 : 1);
    }
    placeHead(wHead, written, true);
    placeHead(rHead, read, false);
    ringTxt.text(written + " written  ·  " + read + " consumed  ·  " + Math.max(0, written - read) + " in flight");

    /* --- command processor --- */
    var OPS = ["IT_SET_CONTEXT_REG", "IT_SET_SH_REG", "IT_SET_UCONFIG_REG",
               "IT_DRAW_INDEX_AUTO", "IT_RELEASE_MEM", "IT_SURFACE_SYNC"];
    if (st === 1) {
      opTxt.text(OPS[(sim.frame * 3 + Math.floor(phase * 40)) % OPS.length]);
      opTxt.fill(C.ink);
      opSub.text("decoding  ·  consuming declared length");
    } else if (st >= 4) {
      opTxt.text("IT_DRAW_INDEX_AUTO"); opTxt.fill(C.kyty); opSub.text("the draw");
    } else { opTxt.text("—"); opTxt.fill(C.ink3); opSub.text(""); }

    var regsSet = st < 1 ? 0 : Math.min(REGS, Math.floor(((phase - 0.16) / 0.22) * REGS * 0.7));
    for (var rgi = 0; rgi < REGS; rgi++) {
      regCells[rgi].fill(rgi < regsSet ? C.guest : C.bg2);
      regCells[rgi].opacity(rgi < regsSet ? 0.35 + 0.65 * (1 - rgi / REGS) : 1);
    }
    cpTxt.text(regsSet + " registers written this frame");

    /* --- pipeline cache --- */
    for (var ci = 0; ci < cacheCells.length; ci++) {
      var slot = sim.cache[ci];
      var beyond = ci >= P.cacheSize;
      if (beyond) { cacheCells[ci].fill(C.bg); cacheCells[ci].stroke(C.line); cacheCells[ci].opacity(0.25); }
      else if (!slot) { cacheCells[ci].fill(C.bg2); cacheCells[ci].stroke(C.line); cacheCells[ci].opacity(1); }
      else {
        var fresh = slot.fresh && st === 2;
        cacheCells[ci].fill(fresh ? C.host : C.bg2);
        cacheCells[ci].stroke(fresh ? C.host : (slot.age < 2 ? C.guest : C.line));
        cacheCells[ci].opacity(1);
      }
    }
    cacheTxt.text(r.hits + " hits  ·  " + r.misses + " misses this frame");
    cacheTxt2.text(P.variety > P.cacheSize
      ? "thrashing — " + P.variety + " states will not fit in " + P.cacheSize + " slots"
      : "capacity " + P.cacheSize + " · compiling costs " + fmt(r.compileMs) + " ms");

    /* --- pages --- */
    var uploading = st === 3;
    var upFrac = uploading ? (phase - 0.56) / 0.20 : (st > 3 ? 1 : 0);
    var cleared = 0;
    for (var pi = 0; pi < PAGES; pi++) {
      var s2 = sim.pages[pi];
      if (s2 === 1 && upFrac > (pi / PAGES)) { s2 = 2; }
      pageCells[pi].fill(s2 === 0 ? C.bg2 : s2 === 1 ? C.host : C.kyty);
      pageCells[pi].opacity(s2 === 0 ? 1 : 0.9);
      if (s2 === 2) cleared++;
    }
    if (st > 3) { for (var pj = 0; pj < PAGES; pj++) if (sim.pages[pj] === 1) sim.pages[pj] = 0; }
    pageTxt.text(r.dirtyPages + " dirty  ·  " + P.granKB + " KB granularity  ·  " +
      fmt(r.uploadedMB, 2) + " MB uploaded  ·  " + fmt(r.uploadMs) + " ms");

    /* --- queues --- */
    var gfxFill = st >= 4 ? 1 : st === 3 ? 0.4 : 0.1;
    for (var qi = 0; qi < QN; qi++) {
      var isGfx = qi === 0;
      var frac = isGfx ? gfxFill
        : (P.asyncCompute ? (st >= 2 ? 0.8 : 0.2) : (st >= 4 ? 0.7 : 0));
      for (var si = 0; si < queueRows[qi].length; si++) {
        var on2 = si < Math.floor(frac * queueRows[qi].length);
        queueRows[qi][si].fill(on2 ? (isGfx ? C.kyty : C.guest) : C.bg2);
        queueRows[qi][si].opacity(on2 ? 0.9 : 1);
      }
    }
    queueTxt.text(P.asyncCompute
      ? "async compute on — compute overlaps graphics"
      : "async compute OFF — compute waits behind every batch (+" + fmt(r.syncMs) + " ms, scales with draws)");

    /* --- graph --- */
    var hist = sim.history;
    for (var bi = 0; bi < GRAPH; bi++) {
      var h2 = hist[hist.length - GRAPH + bi];
      var yb = GY + GH;
      ["draw", "upload", "compile", "sync"].forEach(function (kind) {
        var seg = bars[bi][kind];
        if (!h2) { seg.height(0); return; }
        var ms = kind === "draw" ? h2.drawMs + 1.1
               : kind === "upload" ? h2.uploadMs
               : kind === "compile" ? h2.compileMs : h2.syncMs;
        var px = Math.min(GH, (ms / 50) * GH);
        yb -= px;
        seg.y(yb); seg.height(Math.max(0, px));
        seg.fill(kind === "draw" ? C.guest : kind === "upload" ? C.kyty
               : kind === "compile" ? C.host : C.ink3);
        seg.opacity(bi === GRAPH - 1 ? 1 : 0.75);
      });
    }

    /* --- screen --- */
    var pres = st === 5;
    for (var pi2 = 0; pi2 < polys.length; pi2++) {
      var vis = st >= 4 && pi2 < Math.max(1, Math.round(P.variety));
      if (!vis) { polys[pi2].points([0, 0, 0, 0, 0, 0]); continue; }
      var ang = rotation + pi2 * (Math.PI * 2 / 7);
      var cx = SW / 2 + Math.cos(ang) * 96;
      var cy = SH / 2 + Math.sin(ang * 1.3) * 52;
      var sz = 30 + 16 * Math.sin(ang * 2);
      polys[pi2].points([cx, cy - sz, cx + sz, cy + sz * 0.7, cx - sz, cy + sz * 0.7]);
      polys[pi2].fill([C.guest, C.kyty, C.host][pi2 % 3]);
      polys[pi2].opacity(0.55 + 0.35 * Math.abs(Math.sin(ang)));
    }
    tearBar.opacity(!P.vsync && pres ? 0.5 : 0);
    tearBar.y((sim.frame * 37) % SH);
    screenTxt.text("frame " + sim.frame + "  ·  " + fmt(r.presented) + " ms  ·  " +
      fmt(1000 / Math.max(0.001, r.presented), 0) + " fps");
    screenTxt2.text(P.vsync
      ? (r.dropped > 0 ? "missed vsync — waited " + r.dropped + " extra refresh" + (r.dropped > 1 ? "es" : "") : "hit vsync")
      : "vsync off — tearing possible");

    /* --- totals --- */
    var avg = 0, worst = 0;
    hist.forEach(function (h3) { avg += h3.presented; worst = Math.max(worst, h3.presented); });
    avg = hist.length ? avg / hist.length : 0;
    statTxt[0].text(String(sim.totals.frames));
    statTxt[1].text(String(sim.totals.misses));
    statTxt[2].text(fmt(sim.totals.uploadedMB, 1) + " MB");
    statTxt[3].text(fmt(sim.totals.stallMs, 0) + " ms");
    statTxt[4].text(fmt(avg) + " ms");
    statTxt[5].text(fmt(worst) + " ms");
    statTxt[5].fill(worst > 33 ? C.host : worst > 17 ? C.kyty : C.ink);

    /* --- narration --- */
    nowTitle.text(STAGES[st][2]);
    nowBody.text(STAGES[st][3]);

    lLive.batchDraw(); lText.batchDraw();
  }

  var anim = new Konva.Animation(function (f) {
    if (!f || P.paused) return false;
    rotation += f.timeDiff * 0.0012 * P.speed;
    phase += (f.timeDiff / frameWall) * P.speed;
    if (phase >= 1) {
      phase = 0;
      sim.frame++;
      report = computeFrame();
      // heavy frames take longer in wall clock, so stutter is visible
      frameWall = Math.max(260, Math.min(2600, report.presented * 22));
      for (var ci = 0; ci < sim.cache.length; ci++) if (sim.cache[ci]) sim.cache[ci].fresh = 0;
    }
    paint();
  }, [lLive, lText]);

  /* ============================================================
     CONTROLS
     ============================================================ */

  function control(spec) {
    var wrap = document.createElement("label");
    wrap.className = "mc-ctl";
    var head = document.createElement("span");
    head.className = "mc-ctl-h";
    head.innerHTML = "<b>" + spec.label + "</b><i data-out></i>";
    wrap.appendChild(head);

    var input;
    if (spec.type === "toggle") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!P[spec.key];
      input.className = "mc-toggle";
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = spec.min; input.max = spec.max; input.step = spec.step || 1;
      input.value = P[spec.key];
      input.className = "mc-range";
    }
    wrap.appendChild(input);
    if (spec.note) {
      var n = document.createElement("span");
      n.className = "mc-ctl-n"; n.textContent = spec.note;
      wrap.appendChild(n);
    }
    var out = head.querySelector("[data-out]");
    function sync() {
      if (spec.type === "toggle") { P[spec.key] = input.checked; out.textContent = input.checked ? "on" : "off"; }
      else { P[spec.key] = parseFloat(input.value); out.textContent = spec.fmt ? spec.fmt(P[spec.key]) : P[spec.key]; }
      paint();
    }
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    sync();
    return wrap;
  }

  var CONTROLS = [
    { key: "draws", label: "Draw calls / frame", min: 1, max: 120, step: 1 },
    { key: "variety", label: "Distinct pipeline states", min: 1, max: 24, step: 1,
      note: "raise this above the cache size to force thrashing" },
    { key: "cacheSize", label: "Pipeline cache slots", min: 1, max: 24, step: 1 },
    { key: "texMB", label: "Texture working set", min: 1, max: 64, step: 1, fmt: function (v) { return v + " MB"; } },
    { key: "dirtyRate", label: "CPU write rate", min: 0, max: 0.6, step: 0.01,
      fmt: function (v) { return Math.round(v * 100) + "% of pages"; } },
    { key: "granKB", label: "Page-watch granularity", min: 4, max: 4096, step: 4,
      fmt: function (v) { return v >= 1024 ? (v / 1024) + " MB" : v + " KB"; },
      note: "coarser means fewer protection changes but more bytes moved" },
    { key: "asyncCompute", label: "Async compute", type: "toggle" },
    { key: "vsync", label: "VSync", type: "toggle" },
    { key: "speed", label: "Playback speed", min: 0.25, max: 4, step: 0.25, fmt: function (v) { return v + "×"; } }
  ];

  var panelEl = document.getElementById("machine-controls");
  if (panelEl) CONTROLS.forEach(function (c) { panelEl.appendChild(control(c)); });

  /* --- presets: the three pathologies, reproducible in one click --- */
  var PRESETS = {
    smooth:  { draws: 18, variety: 4, cacheSize: 16, texMB: 4, dirtyRate: 0.05, granKB: 4, asyncCompute: true, vsync: true },
    thrash:  { draws: 24, variety: 20, cacheSize: 4, texMB: 8, dirtyRate: 0.08, granKB: 16, asyncCompute: true, vsync: true },
    uploads: { draws: 20, variety: 5, cacheSize: 16, texMB: 32, dirtyRate: 0.32, granKB: 1024, asyncCompute: true, vsync: true },
    serial:  { draws: 90, variety: 6, cacheSize: 16, texMB: 12, dirtyRate: 0.12, granKB: 64, asyncCompute: false, vsync: true }
  };
  function applyPreset(name) {
    var p = PRESETS[name]; if (!p) return;
    Object.keys(p).forEach(function (k) { P[k] = p[k]; });
    if (panelEl) {
      panelEl.innerHTML = "";
      CONTROLS.forEach(function (c) { panelEl.appendChild(control(c)); });
    }
    sim.history.length = 0;
    paint();
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
    b.addEventListener("click", function () { applyPreset(b.dataset.preset); });
  });

  var pauseBtn = document.getElementById("mc-pause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      P.paused = !P.paused;
      pauseBtn.textContent = P.paused ? "▶ Resume" : "❙❙ Pause";
      pauseBtn.classList.toggle("on", P.paused);
      if (!P.paused) anim.start();
    });
  }
  var stepBtn = document.getElementById("mc-step");
  if (stepBtn) {
    stepBtn.addEventListener("click", function () {
      P.paused = true;
      if (pauseBtn) { pauseBtn.textContent = "▶ Resume"; pauseBtn.classList.add("on"); }
      phase += 0.17;
      if (phase >= 1) { phase = 0; sim.frame++; report = computeFrame(); }
      paint();
    });
  }
  var resetBtn = document.getElementById("mc-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      sim.frame = 0; sim.history.length = 0;
      sim.totals = { frames: 0, misses: 0, uploadedMB: 0, stallMs: 0 };
      for (var i = 0; i < PAGES; i++) sim.pages[i] = 0;
      for (var c = 0; c < sim.cache.length; c++) sim.cache[c] = null;
      paint();
    });
  }

  /* --- responsive: scale the fixed-size stage to its container --- */
  function fit() {
    var avail = host.clientWidth || W;
    var scale = Math.min(1, avail / W);
    stage.width(W * scale);
    stage.height(H * scale);
    stage.scale({ x: scale, y: scale });
    stage.batchDraw();
  }
  window.addEventListener("resize", fit);
  fit();

  /* --- recolour on theme change, without losing the run --- */
  new MutationObserver(recolor)
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  paint();
  anim.start();

  window.MACHINE = { P: P, sim: sim, paint: paint, anim: anim, preset: applyPreset };
})();

