(function () {
  "use strict";
  var root = document.getElementById("ax-machine");
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  function hex(n, w) { return (n >>> 0).toString(16).toUpperCase().padStart(w || 8, "0"); }

  var PAGE = 4096, MEM = 512 * 1024, PAGES = MEM / PAGE;
  var CODE = 0x10000, GOT = 0x18000, DATA = 0x20000, RING = 0x28000, TLS = 0x2A000, ARING = 0x2C000, STACK = 0x30000;
  var PERM = { R: 1, W: 2, X: 4 };
  var U = { tick: DATA, mode: DATA + 4, warp: DATA + 8, bass: DATA + 12, hash: DATA + 16 };
  var OP = { NOP: 0, LI: 1, LOAD: 2, STORE: 3, ADDI: 4, SYS: 5, YIELD: 6, JMP: 7 };
  var OPN = []; Object.keys(OP).forEach(function (k) { OPN[OP[k]] = k; });
  var PKT = { SET_UD: 1, SET_PIPE: 2, DRAW: 3, PRESENT: 4 };
  var PKTN = { 1: "SET_USER_DATA", 2: "SET_PIPELINE", 3: "DRAW_FULLSCREEN", 4: "PRESENT" };
  var SH = ["Decode", "CFG", "Translate", "Materialize", "Compile"];
  var PIPE = ["reserve", "map ELF", "relocate", "TLS patch", "protect", "threads", "entry", "raster", "mixer", "HLE", "PM4", "shader", "upload", "present"];
  var PIPE_HELP = [
    "Reserve the guest address space before anything is copied.",
    "Map ELF-like segments: .text, .got, .data, PM4 ring, TLS, stacks.",
    "Relocate imports: each NID is written into the GOT as a callable id.",
    "Patch TLS: fs:[0] becomes Call9 (48 E8 … 48 89 C0).",
    "Drop write permission on executable and GOT pages.",
    "Stand up raster and mixer guest threads.",
    "Jump to guest entry. From here the CPU runs intro code.",
    "Raster thread: sample knobs, bump tick, submit a fullscreen draw.",
    "Mixer thread: write the audio-ring envelope and optionally beep.",
    "SYS crosses into HLE — a GOT slot becomes a native function.",
    "PM4: SET_USER_DATA, SET_PIPELINE, DRAW_FULLSCREEN, PRESENT.",
    "Shader cache: TranslateProgram once, CompileProgram per permutation.",
    "Upload dirty pages the GPU still thinks are current.",
    "Present the specialised fullscreen pass to VIDEO_OUT_0."
  ];
  var SH_HELP = [
    "Decode: typed ops from the guest effect blob.",
    "CFG: blocks, branches, reducibility.",
    "Translate: Frontend::TranslateProgram into the typed IR.",
    "Materialize: run the SRT plan against current uniforms.",
    "Compile: ApplyResourceSpecialization and emit the host program."
  ];
  var FX = ["plasma.fs", "tunnel.fs", "constellation.fs", "fire.fs", "starfield.fs", "moire.fs", "hexrain.fs", "kaleido.fs"];
  FX[10] = "serpent.game"; FX[11] = "breakout.game"; FX[12] = "drift.game";
  var IMPORTS = ["libDemo.knobs", "libAgc.submit", "libAudio.mix"];

  function nid(name) {
    var h = 2166136261, a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    var s = "", x = h >>> 0;
    for (var k = 0; k < 11; k++) { s += a[x & 63]; x = (x >>> 6) ^ (h << (k % 5)); }
    return s;
  }

  function Mem() {
    this.v = new DataView(new ArrayBuffer(MEM));
    this.pages = []; this.maps = [];
    this.st = { r: 0, w: 0, faults: 0, watch: 0, up: 0 };
    for (var i = 0; i < PAGES; i++) this.pages.push({ on: 0, perm: 0, dirty: 0, gpu: 0 });
  }
  Mem.prototype.map = function (a, n, perm, lab, kind) {
    var s = a / PAGE | 0, e = Math.ceil((a + n) / PAGE);
    for (var p = s; p < e; p++) { this.pages[p].on = 1; this.pages[p].perm = perm; }
    this.maps.push({ a: a, n: n, perm: perm, lab: lab, kind: kind });
  };
  Mem.prototype.protect = function (a, n, perm) {
    var s = a / PAGE | 0, e = Math.ceil((a + n) / PAGE);
    for (var p = s; p < e; p++) this.pages[p].perm = perm;
  };
  Mem.prototype.chk = function (a, perm) {
    if (a < 0 || a + 4 > MEM) { this.st.faults++; throw new Error("addr 0x" + hex(a)); }
    var p = this.pages[a / PAGE | 0];
    if (!p.on || !(p.perm & perm)) { this.st.faults++; throw new Error("prot 0x" + hex(a)); }
  };
  Mem.prototype.r32 = function (a) { this.chk(a, PERM.R); this.st.r++; return this.v.getInt32(a, true); };
  Mem.prototype.w32 = function (a, val, src, force) {
    if (!force) this.chk(a, PERM.W);
    this.v.setInt32(a, val | 0, true); this.st.w++;
    var p = this.pages[a / PAGE | 0];
    if (p) {
      if (p.gpu && src !== "ldr") { this.st.watch++; p.gpu = 0; }
      if (src !== "ldr") p.dirty = 1;
    }
  };
  Mem.prototype.peek = function (a) {
    if (a < 0 || a + 4 > MEM || !this.pages[a / PAGE | 0].on) return 0;
    return this.v.getInt32(a, true);
  };
  Mem.prototype.upload = function () {
    var n = 0;
    for (var i = 0; i < PAGES; i++) if (this.pages[i].dirty) { n++; this.pages[i].dirty = 0; this.pages[i].gpu = 1; }
    this.st.up += n * PAGE; return n;
  };

  function Asm() { this.ins = []; this.lab = {}; this.fix = []; }
  Asm.prototype.L = function (n) { this.lab[n] = this.ins.length; return this; };
  Asm.prototype.E = function (op, a, b, c, imm) {
    this.ins.push({ op: OP[op], a: a | 0, b: b | 0, c: c | 0, imm: imm | 0 });
    return this;
  };
  Asm.prototype.J = function (op, l) { this.fix.push({ at: this.ins.length, l: l }); return this.E(op, 0, 0, 0, 0); };
  Asm.prototype.fin = function () {
    var s = this;
    this.fix.forEach(function (f) { s.ins[f.at].imm = s.lab[f.l]; });
    return this.ins;
  };
  function dis(i) {
    var n = (OPN[i.op] || "?").toLowerCase();
    if (i.op === OP.LI) return "li r" + i.a + ", " + i.imm;
    if (i.op === OP.LOAD) return "load r" + i.a + ", [0x" + hex(i.imm) + "]";
    if (i.op === OP.STORE) return "store [0x" + hex(i.imm) + "], r" + i.a;
    if (i.op === OP.ADDI) return "addi r" + i.a + ", r" + i.b + ", " + i.imm;
    if (i.op === OP.SYS) return "sys GOT[" + i.imm + "]";
    if (i.op === OP.JMP) return "jmp 0x" + hex(CODE + i.imm * 8);
    return n;
  }

  function buildRaster() {
    var a = new Asm();
    a.L("main");
    a.E("SYS", 0, 0, 0, 0);
    a.E("LOAD", 1, 0, 0, U.tick);
    a.E("ADDI", 1, 1, 0, 1);
    a.E("STORE", 1, 0, 0, U.tick);
    a.E("SYS", 0, 0, 0, 1);
    a.E("YIELD");
    a.J("JMP", "main");
    return a.fin();
  }
  function buildMixer() {
    var a = new Asm();
    a.L("mix");
    a.E("SYS", 0, 0, 0, 2);
    a.E("YIELD");
    a.J("JMP", "mix");
    return a.fin();
  }

  function Cache() {
    this.pipes = {}; this.stage = -1; this.last = "cold"; this.hits = 0; this.misses = 0;
  }
  Cache.prototype.get = function (key) {
    var name = FX[key] || ("perm-" + key);
    if (this.pipes[key]) { this.hits++; this.stage = 4; this.last = "hit " + name; return this.pipes[key]; }
    this.misses++;
    var pipe = { key: key, name: name, hash: (0x51A00000 + key * 0x20F) >>> 0 };
    for (var s = 0; s < SH.length; s++) this.stage = s;
    this.pipes[key] = pipe;
    this.last = "CompileProgram " + pipe.name + " 0x" + hex(pipe.hash);
    return pipe;
  };

  function Emu() {
    this.m = null; this.code = [null, null]; this.th = []; this.view = 0;
    this.hle = []; this.got = []; this.shaders = new Cache();
    this.running = false; this.booted = false; this.faulted = false; this.alive = false;
    this.frame = 0; this.clock = 1; this.pm4 = []; this.uploads = 0;
    this.events = []; this.pipeOn = 0;
    this.bound = { from: "host", to: "loader", t: "cold", k: "BOOT" };
    this.tls = { before: "64 48 8B 04 25 00 00 00 00", after: "" };
    this.crash = "No unhandled fault this run.";
    this.holdPipe = null; this.holdSh = null;
    this.knobMode = 0; this.knobWarp = 8; this.audioOn = false; this.actx = null;
    this.ctx = null; this.img = null; this.small = null;
    this.keys = new Set(); this.game = null; this.stars = []; this.fire = null;
  }
  Emu.prototype.log = function (k, t, lv) {
    this.events.unshift({ k: k, t: t, lv: lv || "", f: this.booted ? this.frame : "boot" });
    if (this.events.length > 60) this.events.length = 60;
  };

  Emu.prototype.boot = function () {
    var self = this;
    this.m = new Mem();
    this.shaders = new Cache();
    this.pm4 = []; this.events = []; this.faulted = false; this.alive = true;
    this.crash = "No unhandled fault this run."; this.frame = 0;
    this.code = [buildRaster(), buildMixer()];
    this.pipeOn = 0;
    this.log("boot", "reserve 512 KB guest space", "ok");

    var rlen = this.code[0].length * 8, mlen = this.code[1].length * 8;
    this.m.map(CODE, rlen + mlen + 16, PERM.R | PERM.W | PERM.X, ".text", "code");
    this.m.map(GOT, 32, PERM.R | PERM.W, ".got", "data");
    this.m.map(DATA, 64, PERM.R | PERM.W, ".data", "data");
    this.m.map(RING, 256, PERM.R | PERM.W, "pm4", "gpu");
    this.m.map(TLS, 16, PERM.R | PERM.W, "tls", "data");
    this.m.map(ARING, 64, PERM.R | PERM.W, "audio-ring", "data");
    this.m.map(STACK, 256, PERM.R | PERM.W, "stack", "data");
    this.pipeOn = 1;
    function writeIns(base, ins) {
      for (var i = 0; i < ins.length; i++) {
        var x = ins[i];
        self.m.w32(base + i * 8, (x.op) | (x.a << 8) | (x.b << 16) | (x.c << 24), "ldr", true);
        self.m.w32(base + i * 8 + 4, x.imm, "ldr", true);
      }
    }
    writeIns(CODE, this.code[0]);
    writeIns(CODE + rlen, this.code[1]);
    this.log("load", "raster " + this.code[0].length + " ops · mixer " + this.code[1].length + " ops", "ok");

    this.hle = IMPORTS.map(function (name, i) { return { name: name, nid: nid(name), id: i + 1, calls: 0 }; });
    this.got = this.hle.map(function (h, i) {
      self.m.w32(GOT + i * 4, h.id, "ldr", true);
      return { slot: i, nid: h.nid, name: h.name, addr: h.id };
    });
    this.pipeOn = 2;
    this.log("nids", "3 imports bound", "ok");

    var patched = [0x48, 0xE8, 0x44, 0x33, 0x22, 0x00, 0x48, 0x89, 0xC0];
    for (var b = 0; b < 9; b++) this.m.v.setUint8(TLS + b, patched[b]);
    this.tls.after = patched.map(function (x) { return hex(x, 2); }).join(" ");
    this.pipeOn = 3;
    this.log("patch", "TLS Call9 → 48 E8 … 48 89 C0", "ok");

    this.m.protect(CODE, rlen + mlen + 16, PERM.R | PERM.X);
    this.m.protect(GOT, 32, PERM.R);
    this.pipeOn = 4;
    this.m.w32(U.tick, 0, "ldr", true);
    this.m.w32(U.mode, this.knobMode, "ldr", true);
    this.m.w32(U.warp, this.knobWarp, "ldr", true);
    this.th = [
      { name: "raster", pc: 0, r: new Int32Array(16), ins: this.code[0], base: CODE },
      { name: "mixer", pc: 0, r: new Int32Array(16), ins: this.code[1], base: CODE + rlen }
    ];
    this.pipeOn = 5;
    this.booted = true;
    this.pipeOn = 6;
    this.bound = { from: "loader", to: "raster", t: "Both guest threads at entry.", k: "LIVE" };
    $("ax-boot").classList.add("is-off");
  };

  Emu.prototype.exec = function (t) {
    var i = t.ins[t.pc], r = t.r, m = this.m, adv = true;
    if (!i) throw new Error("PC out of range");
    this.pipeOn = t.name === "raster" ? 7 : 8;
    if (i.op === OP.LI) r[i.a] = i.imm;
    else if (i.op === OP.LOAD) r[i.a] = m.r32(i.imm);
    else if (i.op === OP.STORE) m.w32(i.imm, r[i.a], "cpu");
    else if (i.op === OP.ADDI) r[i.a] = (r[i.b] + i.imm) | 0;
    else if (i.op === OP.JMP) { t.pc = i.imm; adv = false; }
    else if (i.op === OP.SYS) {
      this.pipeOn = 9;
      var rec = this.hle[m.r32(GOT + i.imm * 4) - 1];
      rec.calls++;
      this.bound = { from: t.name, to: rec.name, t: rec.nid, k: "HLE" };
      if (i.imm === 0) this.sysKnobs();
      if (i.imm === 1) this.sysSubmit();
      if (i.imm === 2) this.sysMix();
    } else if (i.op === OP.YIELD) { t.pc++; return "yield"; }
    if (adv) t.pc++;
    if (t.pc >= t.ins.length) t.pc = 0;
    return "ok";
  };
  Emu.prototype.stepInsn = function () {
    if (!this.alive) return;
    try { this.exec(this.th[this.view]); } catch (e) { this.dump(0); }
  };
  Emu.prototype.stepFrame = function () {
    if (!this.alive) return;
    this.frame++;
    try {
      var n, t, g;
      for (n = 0; n < 2; n++) {
        t = this.th[n]; g = 64;
        while (g-- > 0) if (this.exec(t) === "yield") break;
      }
    } catch (e) { this.dump(0); }
    if ((this.knobMode | 0) >= 10) this.gameStep();
    this.draw();
  };

  Emu.prototype.sysKnobs = function () {
    this.m.w32(U.mode, this.knobMode, "hle");
    this.m.w32(U.warp, this.knobWarp, "hle");
  };
  Emu.prototype.sysSubmit = function () {
    var mode = this.m.peek(U.mode) | 0;
    var warp = this.m.peek(U.warp) | 0;
    var tick = this.m.peek(U.tick) | 0;
    this.pipeOn = 10;
    this.pm4 = [
      { name: "SET_USER_DATA", n: 3, pl: [tick, mode, warp] },
      { name: "SET_PIPELINE", n: 1, pl: [mode] },
      { name: "DRAW_FULLSCREEN", n: 0, pl: [] },
      { name: "PRESENT", n: 0, pl: [] }
    ];
    this.pipeOn = 11;
    this.shaders.get(mode);
    this.m.w32(U.hash, this.shaders.pipes[mode].hash, "gpu");
    this.pipeOn = 12;
    this.uploads = this.m.upload();
    this.pipeOn = 13;
  };
  Emu.prototype.sysMix = function () {
    var tick = this.m.peek(U.tick);
    var env = Math.abs(Math.sin(tick * 0.07)) * 100 | 0;
    this.m.w32(ARING + ((tick & 7) * 4), env, "cpu");
    this.m.w32(U.bass, env, "hle");
    if (this.audioOn && this.actx && (tick & 15) === 0) {
      var o = this.actx.createOscillator(), g = this.actx.createGain(), now = this.actx.currentTime;
      o.frequency.value = 110 + (this.knobMode * 80) + env;
      o.type = this.knobMode === 2 ? "triangle" : "sine";
      g.gain.setValueAtTime(0.03, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.connect(g); g.connect(this.actx.destination); o.start(now); o.stop(now + 0.12);
    }
  };

  Emu.prototype.resetGame = function (mode) {
    var i;
    if (mode === 10) {
      this.game = { kind: "serpent", body: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], dir: 1, next: 1, food: { x: 14, y: 6 }, score: 0, dead: 0, acc: 0 };
    } else if (mode === 11) {
      var bricks = [];
      for (i = 0; i < 40; i++) bricks.push({ x: (i % 8) * 70 + 40, y: (i / 8 | 0) * 22 + 28, on: 1 });
      this.game = { kind: "breakout", px: 280, ball: { x: 320, y: 240, vx: 3.2, vy: -3.6 }, bricks: bricks, lives: 3, score: 0, dead: 0 };
    } else if (mode === 12) {
      this.game = { kind: "drift", x: 320, spd: 4, road: 0, obst: [{ y: -40, lane: 0 }, { y: -180, lane: 1 }, { y: -320, lane: 2 }], score: 0, dead: 0 };
    } else this.game = null;
    if (!this.stars.length) {
      for (i = 0; i < 90; i++) this.stars.push({ x: Math.random() * 640, y: Math.random() * 360, z: 0.3 + Math.random() * 2 });
    }
  };

  Emu.prototype.held = function (a, b) { return this.keys.has(a) || this.keys.has(b); };

  Emu.prototype.gameStep = function () {
    var g = this.game; if (!g || g.dead) return;
    if (g.kind === "serpent") {
      if (this.held("arrowleft", "a")) g.next = 3;
      if (this.held("arrowright", "d")) g.next = 1;
      if (this.held("arrowup", "w")) g.next = 0;
      if (this.held("arrowdown", "s")) g.next = 2;
      g.acc++;
      if (g.acc < 6) return;
      g.acc = 0;
      if ((g.next + 2) % 4 !== g.dir) g.dir = g.next;
      var h = { x: g.body[0].x + [0, 1, 0, -1][g.dir], y: g.body[0].y + [-1, 0, 1, 0][g.dir] };
      if (h.x < 0 || h.y < 0 || h.x >= 32 || h.y >= 18) { g.dead = 1; return; }
      for (var i = 0; i < g.body.length; i++) if (g.body[i].x === h.x && g.body[i].y === h.y) { g.dead = 1; return; }
      g.body.unshift(h);
      if (h.x === g.food.x && h.y === g.food.y) {
        g.score += 10;
        g.food = { x: (Math.random() * 32) | 0, y: (Math.random() * 18) | 0 };
      } else g.body.pop();
    } else if (g.kind === "breakout") {
      if (this.held("arrowleft", "a")) g.px = Math.max(20, g.px - 8);
      if (this.held("arrowright", "d")) g.px = Math.min(520, g.px + 8);
      g.ball.x += g.ball.vx; g.ball.y += g.ball.vy;
      if (g.ball.x < 8 || g.ball.x > 632) g.ball.vx *= -1;
      if (g.ball.y < 8) g.ball.vy *= -1;
      if (g.ball.y > 348) { g.lives--; g.ball = { x: 320, y: 240, vx: 3.2, vy: -3.6 }; if (g.lives <= 0) g.dead = 1; }
      if (g.ball.y > 318 && g.ball.x > g.px && g.ball.x < g.px + 100) { g.ball.vy = -Math.abs(g.ball.vy); g.ball.vx += (g.ball.x - (g.px + 50)) * 0.08; }
      g.bricks.forEach(function (br) {
        if (!br.on) return;
        if (g.ball.x > br.x && g.ball.x < br.x + 64 && g.ball.y > br.y && g.ball.y < br.y + 18) {
          br.on = 0; g.ball.vy *= -1; g.score += 25;
        }
      });
    } else if (g.kind === "drift") {
      if (this.held("arrowleft", "a")) g.x = Math.max(160, g.x - 7);
      if (this.held("arrowright", "d")) g.x = Math.min(480, g.x + 7);
      g.road += g.spd; g.spd = Math.min(11, g.spd + 0.004); g.score += g.spd * 0.2;
      g.obst.forEach(function (o) {
        o.y += g.spd * 1.4;
        if (o.y > 380) { o.y = -60 - Math.random() * 120; o.lane = (Math.random() * 3) | 0; }
        var ox = 220 + o.lane * 100;
        if (o.y > 250 && o.y < 320 && Math.abs(g.x - ox) < 28) g.dead = 1;
      });
    }
  };

  Emu.prototype.draw = function () {
    var c = this.ctx, m = this.m; if (!c || !m) return;
    var w = 160, h = 90, t = (m.peek(U.tick) | 0) * 0.035, mode = m.peek(U.mode) | 0, warp = (m.peek(U.warp) || 8) * 0.12;
    var bass = (m.peek(U.bass) || 0) / 100, i, x, y, u, v, p, r, g, b, z;
    if (mode >= 10) { this.drawGame(c, mode); return; }
    if (!this.small) this.small = c.createImageData(w, h);
    var d = this.small.data;
    function put(x, y, r, g, b) { var i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    if (mode === 2) {
      c.fillStyle = "#06080e"; c.fillRect(0, 0, 640, 360);
      this.hle.forEach(function (h, n) {
        var ang = t * 0.4 + n * 2.1, rad = 90 + n * 28 + bass * 30;
        var cx = 320 + Math.cos(ang) * rad, cy = 180 + Math.sin(ang * 0.9) * rad * 0.6;
        c.beginPath(); c.arc(cx, cy, 4 + (h.calls % 7), 0, Math.PI * 2);
        c.fillStyle = ["#55c5de", "#f0b849", "#ec668b"][n] || "#fff"; c.fill();
        c.fillStyle = "#b2bfca"; c.font = "10px monospace"; c.fillText(h.nid.slice(0, 6), cx + 8, cy);
      });
      return;
    }
    if (mode === 4) {
      c.fillStyle = "#05070c"; c.fillRect(0, 0, 640, 360);
      this.stars.forEach(function (s) {
        s.y += s.z * (2 + warp); if (s.y > 360) { s.y = 0; s.x = Math.random() * 640; }
        c.fillStyle = "rgba(200,220,255," + (0.3 + s.z / 3) + ")";
        c.fillRect(s.x, s.y, s.z, s.z * 3);
      });
      return;
    }
    if (mode === 6) {
      c.fillStyle = "#070b10"; c.fillRect(0, 0, 640, 360);
      c.font = "11px monospace";
      for (x = 0; x < 32; x++) {
        for (y = 0; y < 20; y++) {
          var gy = (y * 18 + ((t * 40 + x * 13) | 0) % 360) % 360;
          c.fillStyle = "rgba(85,197,222," + (0.15 + (y % 7) * 0.08) + ")";
          c.fillText(hex((x * 17 + y + (t * 8 | 0)) & 255, 2), 12 + x * 20, gy);
        }
      }
      return;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      u = x / w - 0.5; v = y / h - 0.5;
      if (mode === 0) {
        p = Math.sin(u * 12 * warp + t) + Math.sin(v * 10 + t * 1.3) + Math.sin((u + v) * 8 + t * 0.7);
        r = 20 + (Math.sin(p) * 0.5 + 0.5) * 80; g = 40 + (Math.sin(p + 2) * 0.5 + 0.5) * 140; b = 70 + (Math.sin(p + 4) * 0.5 + 0.5) * 160;
      } else if (mode === 1) {
        z = 0.7 / (Math.abs(v * 2) + 0.12); p = (((u * 2 * z + t * 0.4) * 18 * warp) ^ (z * 14)) & 1;
        r = p ? 10 : 80 + bass * 80; g = p ? 18 : 30; b = p ? 28 : 90 + z * 40;
      } else if (mode === 3) {
        p = Math.max(0, 1 - (0.5 - v) * 2) * (0.5 + 0.5 * Math.sin(u * 30 + t * 4 + Math.sin(v * 20)));
        r = 40 + p * 200; g = p * p * 90; b = 10;
      } else if (mode === 5) {
        p = Math.sin(Math.sqrt(u * u + v * v) * 40 * warp - t * 3) + Math.sin((u + 0.2) * 28 + t);
        r = 8; g = 20 + (p * 0.5 + 0.5) * 160; b = 40 + (p * 0.5 + 0.5) * 180;
      } else {
        var ang = Math.atan2(v, u), rad = Math.sqrt(u * u + v * v);
        p = Math.sin(ang * 6 + t) * Math.cos(rad * 18 * warp - t);
        r = 30 + (p * 0.5 + 0.5) * 90; g = 20 + (p * 0.5 + 0.5) * 40; b = 50 + (p * 0.5 + 0.5) * 180;
      }
      put(x, y, r, g, b);
    }
    var tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
    tmp.getContext("2d").putImageData(this.small, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 0, 0, 640, 360);
  };

  Emu.prototype.drawGame = function (c, mode) {
    var g = this.game, i;
    c.fillStyle = "#070b12"; c.fillRect(0, 0, 640, 360);
    c.font = "12px monospace"; c.fillStyle = "#b2bfca";
    if (!g) { c.fillText("loading cartridge…", 24, 40); return; }
    if (g.kind === "serpent") {
      c.fillStyle = "#12202c";
      for (i = 0; i < 32; i++) for (var j = 0; j < 18; j++) c.fillRect(i * 20 + 1, j * 20 + 1, 18, 18);
      g.body.forEach(function (s, n) {
        c.fillStyle = n ? "#55c5de" : "#eaf0f5";
        c.fillRect(s.x * 20 + 2, s.y * 20 + 2, 16, 16);
      });
      c.fillStyle = "#f0b849"; c.fillRect(g.food.x * 20 + 4, g.food.y * 20 + 4, 12, 12);
      c.fillStyle = "#eaf0f5"; c.fillText("SERPENT  score " + g.score + (g.dead ? "  ·  dead — switch cartridge" : ""), 16, 352);
    } else if (g.kind === "breakout") {
      g.bricks.forEach(function (br) {
        if (!br.on) return;
        c.fillStyle = br.y < 50 ? "#ec668b" : br.y < 90 ? "#f0b849" : "#55c5de";
        c.fillRect(br.x, br.y, 62, 16);
      });
      c.fillStyle = "#eaf0f5"; c.fillRect(g.px, 328, 100, 10);
      c.beginPath(); c.arc(g.ball.x, g.ball.y, 6, 0, Math.PI * 2); c.fillStyle = "#75d49a"; c.fill();
      c.fillStyle = "#b2bfca"; c.fillText("BREAKOUT  score " + g.score + "  lives " + g.lives + (g.dead ? "  ·  dead" : ""), 16, 20);
    } else if (g.kind === "drift") {
      c.fillStyle = "#1a2430"; c.fillRect(180, 0, 280, 360);
      c.strokeStyle = "#f0b849"; c.setLineDash([18, 16]); c.beginPath(); c.moveTo(320, 0); c.lineTo(320, 360); c.stroke(); c.setLineDash([]);
      g.obst.forEach(function (o) {
        c.fillStyle = "#ec668b"; c.fillRect(204 + o.lane * 100, o.y, 32, 40);
      });
      c.fillStyle = "#55c5de"; c.fillRect(g.x - 14, 280, 28, 44);
      c.fillStyle = "#eaf0f5"; c.fillText("DRIFT  km " + (g.score | 0) + (g.dead ? "  ·  crashed" : ""), 16, 20);
    }
  };

  Emu.prototype.dump = function (addr) {
    var t = this.th[this.view], r = t.r, pc = t.base + t.pc * 8;
    this.crash = [
      "--- Guest fault context ---",
      "thread: " + t.name,
      "r0=" + hex(r[0]) + " r1=" + hex(r[1]) + " r2=" + hex(r[2]) + " r3=" + hex(r[3]),
      "r4=" + hex(r[4]) + " r5=" + hex(r[5]) + " r6=" + hex(r[6]) + " r7=" + hex(r[7]),
      "code (pc): 0x" + hex(pc),
      "--- Error ---",
      "Unhandled host exception: type=1 code=5 pc=0x" + hex(pc) + " access=2 address=0x" + hex(addr)
    ].join("\n");
    this.faulted = true; this.alive = false; this.running = false;
    this.log("cpu", "fault on " + t.name, "err");
  };

  var emu = new Emu();
  emu.ctx = $("ax-screen").getContext("2d");

  PIPE.forEach(function (n, i) {
    var li = document.createElement("li");
    li.textContent = n; li.tabIndex = 0; li.setAttribute("role", "button");
    li.onclick = function () {
      emu.running = false; emu.holdPipe = i;
      emu.bound = { from: "inspect", to: n, t: PIPE_HELP[i], k: "PIPE" };
      paint();
    };
    $("ax-pipe").appendChild(li);
  });
  SH.forEach(function (n, i) {
    var li = document.createElement("li");
    li.textContent = n; li.tabIndex = 0; li.setAttribute("role", "button");
    li.onclick = function () {
      emu.running = false; emu.holdSh = i; emu.shaders.stage = i;
      emu.bound = { from: "recompiler", to: n, t: SH_HELP[i], k: "IR" };
      paint();
    };
    $("ax-sh-stages").appendChild(li);
  });

  function paint() {
    $("ax-led").className = emu.faulted ? "fault" : emu.booted ? "on" : "";
    $("ax-sub").textContent = emu.faulted ? "faulted" : emu.running ? "running" : emu.booted ? "paused" : "cold";
    $("ax-run").textContent = emu.running ? "Pause" : "Run";
    $("ax-bound-kind").textContent = emu.bound.k;
    $("ax-from").textContent = emu.bound.from;
    $("ax-to").textContent = emu.bound.to;
    $("ax-bound-text").textContent = emu.bound.t;
    $("ax-tick").textContent = emu.m ? emu.m.peek(U.tick) : 0;
    $("ax-perm").textContent = emu.shaders.last;
    $("ax-which").textContent = emu.th[emu.view] ? emu.th[emu.view].name : "—";
    $("ax-effect-name").textContent = FX[emu.knobMode] || ("mode-" + emu.knobMode);
    $("ax-metrics").innerHTML = "<dt>PC</dt><dd>0x" + hex(emu.th[emu.view] ? emu.th[emu.view].base + emu.th[emu.view].pc * 8 : 0) + "</dd><dt>shader</dt><dd>" + emu.shaders.last + "</dd>";
    var log = $("ax-log"); log.innerHTML = "";
    emu.events.slice(0, 12).forEach(function (e) {
      var li = document.createElement("li"); li.className = e.lv; li.textContent = "[" + e.f + "] " + e.k + " · " + e.t; log.appendChild(li);
    });
    var pipeLit = emu.holdPipe != null ? emu.holdPipe : emu.pipeOn;
    var shLit = emu.holdSh != null ? emu.holdSh : emu.shaders.stage;
    Array.prototype.forEach.call($("ax-pipe").children, function (el, i) {
      el.className = i === pipeLit ? "on" : (emu.holdPipe == null && i < emu.pipeOn ? "done" : "");
    });
    Array.prototype.forEach.call($("ax-sh-stages").children, function (el, i) { el.className = i === shLit ? "on" : ""; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function (b) {
      b.classList.toggle("ax-pri", +b.getAttribute("data-th") === emu.view);
    });

    var h = $("ax-regs"); h.innerHTML = "";
    if (emu.th[emu.view]) {
      for (var i = 0; i < 8; i++) {
        var d = document.createElement("div"); d.className = "ax-reg";
        d.innerHTML = "<span>r" + i + "</span><code>" + hex(emu.th[emu.view].r[i]) + "</code>";
        h.appendChild(d);
      }
    }
    var ol = $("ax-disasm"); ol.innerHTML = "";
    var th = emu.th[emu.view];
    if (th) {
      for (var p = Math.max(0, th.pc - 2); p < Math.min(th.ins.length, th.pc + 8); p++) {
        var li = document.createElement("li"); if (p === th.pc) li.className = "pc";
        li.innerHTML = "<span>0x" + hex(th.base + p * 8) + "</span><code>" + dis(th.ins[p]) + "</code>";
        ol.appendChild(li);
      }
    }
    var lines = ["tick  " + hex(emu.m.peek(U.tick)) + "    mode  " + hex(emu.m.peek(U.mode)),
      "warp  " + hex(emu.m.peek(U.warp)) + "    bass  " + hex(emu.m.peek(U.bass)),
      "hash  " + hex(emu.m.peek(U.hash))];
    $("ax-hex").textContent = lines.join("\n");
    var pg = $("ax-pages");
    if (!pg.childElementCount) for (i = 0; i < 64; i++) pg.appendChild(document.createElement("i")).className = "ax-page";
    Array.prototype.forEach.call(pg.children, function (el, n) {
      var pge = emu.m.pages[n]; el.className = "ax-page";
      if (pge && pge.on) { el.classList.add(pge.perm & PERM.X ? "rx" : "rw"); if (pge.dirty) el.classList.add("dirty"); }
    });
    var got = $("ax-got"); got.innerHTML = "";
    emu.got.forEach(function (g) {
      var d = document.createElement("div"); d.className = "ax-row";
      d.innerHTML = "<b>" + g.name + "</b><code>" + g.nid + "</code><span>GOT[" + g.slot + "]</span>";
      got.appendChild(d);
    });
    $("ax-tls").textContent = "on disk  " + emu.tls.before + "\nin memory " + emu.tls.after;
    var hh = $("ax-hle"); hh.innerHTML = "";
    emu.hle.forEach(function (r) {
      var d = document.createElement("div"); d.className = "ax-row";
      d.innerHTML = "<b>" + r.name + "</b><code>" + r.nid + "</code><span>" + r.calls + "</span>";
      hh.appendChild(d);
    });
    var pm = $("ax-pm4"); pm.innerHTML = "";
    emu.pm4.forEach(function (p) {
      var d = document.createElement("div"); d.className = "ax-row";
      d.innerHTML = "<b>" + p.name + "</b><code>n=" + p.n + "</code><span>" + p.pl.join(",") + "</span>";
      pm.appendChild(d);
    });
    var sh = $("ax-pipes"); sh.innerHTML = "";
    Object.keys(emu.shaders.pipes).forEach(function (k) {
      var p = emu.shaders.pipes[k];
      var d = document.createElement("div"); d.className = "ax-row";
      d.innerHTML = "<b>" + p.name + "</b><code>0x" + hex(p.hash) + "</code><span>key " + k + "</span>";
      sh.appendChild(d);
    });
    $("ax-crash").textContent = emu.crash;
    var s = emu.m.st;
    $("ax-coh").innerHTML = [["reads", s.r], ["writes", s.w], ["watch faults", s.watch], ["uploaded", s.up], ["hits", emu.shaders.hits], ["misses", emu.shaders.misses]].map(function (row) {
      return "<dt>" + row[0] + "</dt><dd>" + row[1] + "</dd>";
    }).join("");
  }

  $("ax-run").onclick = function () {
    emu.running = !emu.running;
    if (emu.running) { emu.holdPipe = null; emu.holdSh = null; }
    paint();
  };
  $("ax-frame").onclick = function () { emu.running = false; emu.stepFrame(); paint(); };
  $("ax-insn").onclick = function () { emu.running = false; emu.stepInsn(); paint(); };
  $("ax-reset").onclick = function () { emu.running = false; emu.boot(); emu.running = true; paint(); };
  $("ax-sound").onclick = function () {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!emu.actx && Ctx) emu.actx = new Ctx();
    if (emu.actx && emu.actx.state === "suspended") emu.actx.resume();
    emu.audioOn = !emu.audioOn;
    this.textContent = emu.audioOn ? "Mute" : "Sound";
  };
  $("ax-warp").oninput = function () { emu.knobWarp = +this.value; };
  Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
    b.onclick = function () {
      emu.knobMode = +this.getAttribute("data-mode");
      emu.resetGame(emu.knobMode);
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function (b) {
    b.onclick = function () { emu.view = +this.getAttribute("data-th"); paint(); };
  });
  $("ax-fault-rx").onclick = function () {
    try { emu.m.w32(CODE, 0, "cpu"); } catch (e) { emu.dump(CODE); }
    paint();
  };
  $("ax-flush").onclick = function () { emu.shaders = new Cache(); emu.log("gpu", "permutations dropped", "gpu"); paint(); };
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].indexOf(k) >= 0) e.preventDefault();
    emu.keys.add(k);
    if (k === "p") emu.running = !emu.running;
    if (k === ".") { emu.running = false; emu.stepInsn(); }
    if (k === ",") { emu.running = false; emu.stepFrame(); }
  });
  window.addEventListener("keyup", function (e) { emu.keys.delete(e.key.toLowerCase()); });

  var acc = 0, last = performance.now();
  function tick(now) {
    var dt = now - last; last = now;
    if (emu.running && emu.alive) {
      acc += dt;
      while (acc > 33) { acc -= 33; emu.stepFrame(); }
    }
    paint();
    requestAnimationFrame(tick);
  }
  emu.boot();
  emu.running = true;
  requestAnimationFrame(tick);
})();
