(function () {
  "use strict";
  var root = document.getElementById("ax-machine");
  if (!root) return;
  function $(id) { return document.getElementById(id); }
  function hex(n, w) { return (n >>> 0).toString(16).toUpperCase().padStart(w || 8, "0"); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  var PAGE = 4096, MEM = 512 * 1024, PAGES = MEM / PAGE;
  var CODE = 0x10000, GOT = 0x18000, DATA = 0x20000, RING = 0x28000, TLS = 0x2A000, ARING = 0x2C000, STACK = 0x30000;
  var PERM = { R: 1, W: 2, X: 4 };
  var U = { tick: DATA, mode: DATA + 4, warp: DATA + 8, bass: DATA + 12, hash: DATA + 16, variant: DATA + 20 };
  var OP = { NOP: 0, LI: 1, LOAD: 2, STORE: 3, ADDI: 4, SYS: 5, YIELD: 6, JMP: 7 };
  var OPN = []; Object.keys(OP).forEach(function (k) { OPN[OP[k]] = k; });
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
  /* what each stage maps to in the real KytyPS5 tree */
  var PIPE_MAP = [
    "kernel/memory.cpp · VirtualMemory::Alloc reserves the range",
    "loader/runtimeLinker.cpp · maps PT_LOAD segments (.text/.data/…)",
    "loader/runtimeLinker.cpp · relocations resolve every NID into the GOT",
    "loader/runtimeLinker.cpp · Jit::Call9 rewrites the fs:[0] TLS read",
    "VirtualProtect drops W on code + GOT once they are written",
    "kernel/pthread.cpp · a guest thread is a real host thread",
    "runtimeLinker Execute() jumps to the module entry point",
    "the game's own code — runs natively, no interpreter",
    "a second guest thread doing audio work",
    "libs/*.cpp · a NID becomes a hand-written native function",
    "guest_gpu/command_processor · PM4 packets drive the GPU",
    "shader/recompiler · TranslateProgram once, CompileProgram per key",
    "host_gpu page-fault coherency uploads dirty guest pages",
    "presentation · VideoOutSubmitFlip queues the frame"
  ];
  var SH_HELP = [
    "Decode: typed ops from the guest effect blob (ShaderDecoder).",
    "CFG: blocks, branches, reducibility (ShaderCFG::BuildGraph).",
    "Translate: Frontend::TranslateProgram into the typed IR.",
    "Materialize: run the SRT plan against the current uniforms.",
    "Compile: ApplyResourceSpecialization, then emit the host program."
  ];
  var SH_MAP = [
    "recompiler/frontend/decode/ShaderDecoder.cpp",
    "recompiler/frontend/cfg/ShaderCFG.cpp",
    "recompiler/ShaderRecompiler.cpp · TranslateProgram (485)",
    "recompiler/ir/passes · resource plan vs draw-time snapshot",
    "recompiler/ShaderRecompiler.cpp · CompileProgram (615) → SPIR-V"
  ];
  var FX = ["plasma.fs", "tunnel.fs", "constellation.fs", "fire.fs", "starfield.fs", "moire.fs", "hexrain.fs", "kaleido.fs", "metaballs.fs", "voronoi.fs"];
  FX[10] = "serpent.game"; FX[11] = "breakout.game"; FX[12] = "drift.game";
  FX[13] = "invaders.game"; FX[14] = "flappy.game"; FX[15] = "pong.game";
  var IMPORTS = ["libDemo.knobs", "libAgc.submit", "libAudio.mix"];
  var GAME0 = 10;   // first game mode
  var MEGA = 20;    // the big demo

  // A permutation key is the render mode plus a specialisation variant, exactly
  // as a real pipeline key mixes shader id with resource/render state. Same shader,
  // different variant → a different host program that has to be compiled once.
  function permName(key) { var m = key % 64, vr = (key / 64) | 0; var n = FX[m] || ("perm-" + m); return vr ? n + " #" + vr : n; }

  // The effect-specific core of each fragment program — the ALU that makes it look
  // different, shown as RDNA 2 ISA, typed IR and SPIR-V so the recompiler is visible.
  var CORE = {
    0: { isa: ["v_sin_f32 v5, v4", "v_mad_f32 v6, v3, s1, v5"], ir: ["%5 = Sin %4", "%6 = Fma %3, tick, %5"], spv: ["%5 = OpExtInst %glsl Sin %4", "%6 = OpFma %3 %tick %5"] },
    1: { isa: ["v_rcp_f32 v5, |v3|", "v_cmp_gt_f32 vcc, v5, s2", "s_cbranch_vccnz block_2"], ir: ["%5 = Rcp Abs %3", "%c = FOrdGt %5, warp", "BranchCond %c bb2 bb1"], spv: ["%5 = OpFDiv %one %3", "%c = OpFOrdGreaterThan %5 %warp", "OpBranchConditional %c %bb2 %bb1"] },
    3: { isa: ["v_mul_f32 v5, v4, v4", "v_fma_f32 v6, v5, s3, v5"], ir: ["%5 = FMul %4, %4", "%6 = Fma %5, bass, %5"], spv: ["%5 = OpFMul %4 %4", "%6 = OpFma %5 %bass %5"] },
    5: { isa: ["v_sqrt_f32 v5, v4", "v_sin_f32 v6, v5"], ir: ["%5 = Sqrt %4", "%6 = Sin %5"], spv: ["%5 = OpExtInst %glsl Sqrt %4", "%6 = OpExtInst %glsl Sin %5"] },
    8: { isa: ["v_rcp_f32 v5, v4", "v_add_f32 v6, v6, v5   ; sum blob field"], ir: ["%5 = Rcp %4", "%6 = FAdd %6, %5"], spv: ["%5 = OpFDiv %one %4", "%6 = OpFAdd %6 %5"] },
    9: { isa: ["v_min_f32 v5, v5, v4  ; nearest seed", "v_cmp_lt_f32 vcc, v4, v5"], ir: ["%5 = FMin %5, %4", "%c = FOrdLt %4, %5"], spv: ["%5 = OpExtInst %glsl FMin %5 %4", "%c = OpFOrdLessThan %4 %5"] }
  };
  function shaderArtifacts(key) {
    var mode = key % 64, vr = (key / 64) | 0, core = CORE[mode] || { isa: ["v_mul_f32 v5, v4, s2", "v_add_f32 v6, v5, s0"], ir: ["%5 = FMul %4, warp", "%6 = FAdd %5, tick"], spv: ["%5 = OpFMul %4 %warp", "%6 = OpFAdd %5 %tick"] };
    var branch = mode === 1 || mode === 9;
    var isa = ["s_load_dwordx4 s[0:3], s[8:9]   ; SRT → tick,mode,warp,bass",
      "v_interp_p1_f32 v2, v0, attr0    ; screen u",
      "v_interp_p1_f32 v3, v1, attr1    ; screen v",
      "v_mul_f32 v4, v2, s2             ; u * warp"]
      .concat(core.isa.map(function (l) { return "  " + l; }))
      .concat(["v_cvt_pkrtz_f16_f32 v7, v6, v6 ; pack RGBA",
        "exp mrt0, v7, v7, off, off done  ; export → CB_COLOR0",
        "s_endpgm"]);
    var cfg = branch
      ? ["bb0  entry           7 insns  → bb1, bb2", "bb1  then (colour A)  3 insns  → bb3", "bb2  else (colour B)  3 insns  → bb3", "bb3  export           2 insns  (return)", "reducible: yes · 1 natural region"]
      : ["bb0  entry           " + (isa.length - 2) + " insns  → bb1", "bb1  export           2 insns  (return)", "reducible: yes · no loops"];
    var ir = ["%1 = LoadUniform tick", "%2 = Interp attr0.x", "%3 = Interp attr0.y", "%4 = FMul %2, warp"]
      .concat(core.ir).concat(["%7 = PackUnorm4x8 %6", "Store mrt0, %7"]);
    var srt = ["DescriptorBindingKind::ShaderData  → 1 storage buffer",
      "  +0  tick   (u32)", "  +4  mode   (u32)", "  +8  warp   (u32)", "  +12 bass   (u32)",
      "snapshot resolved from current .data at draw time"];
    var spv = ["OpCapability Shader", "%glsl = OpExtInstImport \"GLSL.std.450\"", "OpEntryPoint Fragment %main \"main\" %mrt0",
      "%f = OpTypeFloat 32", "%tick = OpLoad %f %u_tick", "%3 = OpFMul %f %u %warp"]
      .concat(core.spv).concat(["%col = OpExtInst %glsl PackUnorm4x8 %6", "OpStore %mrt0 %col", "OpReturn", "OpFunctionEnd"]);
    return { isa: isa, cfg: cfg, ir: ir, srt: srt, spv: spv, name: permName(key), branch: branch };
  }

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
  Mem.prototype.usedPages = function () { var n = 0; for (var i = 0; i < PAGES; i++) if (this.pages[i].on) n++; return n; };

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
  Cache.prototype.has = function (key) { return !!this.pipes[key]; };
  Cache.prototype.hit = function (key) {
    this.hits++; this.stage = 4;
    this.last = "hit " + permName(key);
    return this.pipes[key];
  };
  Cache.prototype.commit = function (key) {
    this.misses++;
    var pipe = { key: key, name: permName(key), hash: (0x51A00000 + key * 0x20F) >>> 0 };
    this.pipes[key] = pipe; this.stage = 4;
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
    this.inspect = null;               // {t:'pipe'|'sh', i}
    this.bootAnim = null; this.bootT = 0;      // watchable cold boot
    this.compileAnim = null;                   // watchable specialisation
    this.act = { cpu: 0, gpu: 0, up: 0, flip: 0 };
    this.bootMs = 380; this.compMs = 320;      // default to a learnable pace
    this.knobVariant = 0; this.demoFx = 0; this.demo = null; this.bootParts = 0;
    this.recompile = null;                     // {key, arts} the current/last program
    this.knobMode = 0; this.knobWarp = 8; this.audioOn = false; this.actx = null;
    this.ctx = null; this.img = null; this.small = null;
    this.keys = new Set(); this.pressedEdge = new Set();
    this.game = null; this.stars = []; this.fire = null;
  }
  Emu.prototype.log = function (k, t, lv) {
    this.events.unshift({ k: k, t: t, lv: lv || "", f: this.booted ? this.frame : "boot" });
    if (this.events.length > 60) this.events.length = 60;
  };

  /* ---- cold boot: build everything, then play the pipeline back visibly ---- */
  Emu.prototype.boot = function () {
    var self = this;
    this.m = new Mem();
    this.shaders = new Cache();
    this.pm4 = []; this.events = []; this.faulted = false; this.alive = true;
    this.crash = "No unhandled fault this run."; this.frame = 0;
    this.code = [buildRaster(), buildMixer()];
    this.compileAnim = null; this.inspect = null;
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
    this.log("nids", "3 imports bound", "ok");

    var patched = [0x48, 0xE8, 0x44, 0x33, 0x22, 0x00, 0x48, 0x89, 0xC0];
    for (var b = 0; b < 9; b++) this.m.v.setUint8(TLS + b, patched[b]);
    this.tls.after = patched.map(function (x) { return hex(x, 2); }).join(" ");
    this.log("patch", "TLS Call9 → 48 E8 … 48 89 C0", "ok");

    this.m.protect(CODE, rlen + mlen + 16, PERM.R | PERM.X);
    this.m.protect(GOT, 32, PERM.R);
    this.m.w32(U.tick, 0, "ldr", true);
    this.m.w32(U.mode, this.knobMode === MEGA ? this.demoFx : this.knobMode, "ldr", true);
    this.m.w32(U.warp, this.knobWarp, "ldr", true);
    this.m.w32(U.variant, this.knobVariant, "ldr", true);
    this.th = [
      { name: "raster", pc: 0, r: new Int32Array(16), ins: this.code[0], base: CODE },
      { name: "mixer", pc: 0, r: new Int32Array(16), ins: this.code[1], base: CODE + rlen }
    ];
    this.resetGame(this.knobMode);

    // the megademo links many parts, so its boot has an extra loading phase
    this.bootParts = 0; this.bootPartsTotal = 0;
    if (this.knobMode === MEGA && this.demo) {
      this.bootPartsTotal = this.demo.seq.length; this.bootParts = 8;
      this.log("boot", "megademo · " + this.demo.seq.length + " parts to link", "ok");
    }

    // machine is fully built — now replay the boot pipeline as an animation
    this.booted = false; this.bootAnim = 0; this.bootT = 0;
    this.bound = { from: "host", to: "reserve", t: PIPE_HELP[0], k: "BOOT" };
    var bootEl = $("ax-boot"); if (bootEl) bootEl.classList.remove("is-off");
    this.setBootText(0);
  };
  Emu.prototype.setBootText = function (i) {
    var el = $("ax-boot-text"); if (!el) return;
    el.textContent = "[" + (i + 1) + "/7] " + PIPE[i] + "\n" + PIPE_HELP[i];
  };
  Emu.prototype.setBootTextRaw = function (txt) { var el = $("ax-boot-text"); if (el) el.textContent = txt; };
  Emu.prototype.advanceBoot = function (dt) {
    this.bootT += dt;
    if (this.bootAnim <= 6) {
      if (this.bootT >= this.bootMs) {
        this.bootT = 0; this.bootAnim++;
        if (this.bootAnim <= 6) {
          this.pipeOn = this.bootAnim;
          this.bound = { from: PIPE[this.bootAnim - 1] || "host", to: PIPE[this.bootAnim], t: PIPE_HELP[this.bootAnim], k: "BOOT" };
          this.setBootText(this.bootAnim);
        }
      }
      return;
    }
    if (this.bootParts > 0) {
      if (this.bootT >= this.bootMs * 0.6) {
        this.bootT = 0;
        var done = this.bootPartsTotal - Math.round((this.bootParts - 1) / 8 * this.bootPartsTotal);
        this.setBootTextRaw("[demo] link part " + Math.min(done, this.bootPartsTotal) + " / " + this.bootPartsTotal + "\nresolve effect blob → resource table → prefetch");
        this.log("load", "demo parts linked", "ok");
        this.bootParts--;
      }
      return;
    }
    this.finishBoot();
  };
  Emu.prototype.finishBoot = function () {
    this.booted = true; this.bootAnim = null; this.pipeOn = 6; this.bootParts = 0;
    this.bound = { from: "loader", to: "raster", t: "Both guest threads at entry.", k: "LIVE" };
    var bootEl = $("ax-boot"); if (bootEl) bootEl.classList.add("is-off");
  };
  var MEGA_PARTS = ["ignition", "warp core", "ice tunnel", "ember field", "starlace", "moiré weave",
    "datastream", "kaleidos", "plasma sea", "cell mitosis", "aurora", "hyperjump",
    "supernova", "black ice", "cinder", "lattice", "spiral", "rain of glyphs",
    "prismatic", "singularity", "meltdown", "frostbite", "resonance", "afterglow"];
  function buildMegaSeq() {
    var seq = [];
    for (var i = 0; i < MEGA_PARTS.length; i++) seq.push({ fx: i % 10, v: i + 1, name: MEGA_PARTS[i] });
    return seq;
  }
  Emu.prototype.enterMega = function () {
    this.knobMode = MEGA;
    this.demo = { scene: 0, t: 0, dwell: 18, seq: buildMegaSeq() };
    this.demoFx = this.demo.seq[0].fx; this.knobVariant = this.demo.seq[0].v;
    this.boot();
    this.running = true;
  };

  Emu.prototype.exec = function (t) {
    var i = t.ins[t.pc], r = t.r, m = this.m, adv = true;
    if (!i) throw new Error("PC out of range");
    this.pipeOn = t.name === "raster" ? 7 : 8; this.act.cpu = 1;
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
    if (!this.booted) { this.finishBoot(); return; }
    if (!this.alive || this.compileAnim) return;
    try { this.exec(this.th[this.view]); } catch (e) { this.dump(0); }
  };
  Emu.prototype.stepFrame = function () {
    if (!this.booted) { this.finishBoot(); return; }
    if (!this.alive || this.compileAnim) return;
    this.frame++;
    try {
      var n, t, g;
      for (n = 0; n < 2; n++) {
        t = this.th[n]; g = 64;
        while (g-- > 0) {
          if (this.exec(t) === "yield") break;
          if (this.compileAnim) break;   // a specialisation miss stalls the frame
        }
        if (this.compileAnim) break;
      }
    } catch (e) { this.dump(0); }
    if (this.knobMode === MEGA) this.demoStep();
    else if ((this.knobMode | 0) >= GAME0) this.gameStep();
    this.pressedEdge.clear();
    this.draw();
  };
  Emu.prototype.demoStep = function () {
    var d = this.demo; if (!d) return;
    d.t++;
    if (d.t >= d.dwell) {
      d.t = 0;
      d.scene = (d.scene + 1) % d.seq.length;
      var sc = d.seq[d.scene];
      this.demoFx = sc.fx; this.knobVariant = sc.v;
      this.log("demo", "part " + (d.scene + 1) + "/" + d.seq.length + " · " + sc.name, "");
    }
  };

  Emu.prototype.sysKnobs = function () {
    var mode = this.knobMode === MEGA ? this.demoFx : this.knobMode;
    this.m.w32(U.mode, mode, "hle");
    this.m.w32(U.warp, this.knobWarp, "hle");
    this.m.w32(U.variant, this.knobVariant, "hle");
  };
  Emu.prototype.sysSubmit = function () {
    var mode = this.m.peek(U.mode) | 0, variant = this.m.peek(U.variant) | 0;
    var warp = this.m.peek(U.warp) | 0, tick = this.m.peek(U.tick) | 0;
    var key = mode + variant * 64;
    this.pipeOn = 10;
    // a small but PM4-shaped command stream (type-3 packets → register writes)
    this.pm4 = [
      { name: "IT_SET_SH_REG", n: 4, reg: "SPI_SHADER_USER_DATA_0..3", pl: [tick, mode, warp, variant] },
      { name: "IT_SET_CONTEXT_REG", n: 2, reg: "CB_COLOR0_INFO · DB_DEPTH", pl: [mode, 0] },
      { name: "IT_DISPATCH_/_DRAW_INDEX_AUTO", n: 2, reg: "3 verts · fullscreen", pl: [3, 1] },
      { name: "IT_EVENT_WRITE_EOP", n: 4, reg: "FLIP + release fence", pl: [] }
    ];
    this.pipeOn = 11;
    if (!this.shaders.has(key)) { this.startCompile(key); return; }
    this.shaders.hit(key);
    this.recompile = { key: key, arts: shaderArtifacts(key) };
    this.finishSubmit(key);
  };
  Emu.prototype.startCompile = function (key) {
    this.compileAnim = { key: key, stage: 0, t: 0 };
    this.recompile = { key: key, arts: shaderArtifacts(key) };
    this.shaders.stage = 0;
    this.log("gpu", "specialisation miss " + permName(key) + " → TranslateProgram", "gpu");
  };
  Emu.prototype.advanceCompile = function (dt) {
    var ca = this.compileAnim; ca.t += dt;
    if (ca.t >= this.compMs) {
      ca.t = 0; ca.stage++;
      this.shaders.stage = Math.min(ca.stage, 4);
      if (ca.stage <= 4) this.log("gpu", SH[ca.stage] + " · " + permName(ca.key), "gpu");
    }
    if (ca.stage > 4) {
      var key = ca.key;
      this.shaders.commit(key);
      this.compileAnim = null;
      this.finishSubmit(key);
      this.log("gpu", "CompileProgram done 0x" + hex(this.shaders.pipes[key].hash) + " → SPIR-V", "gpu");
    }
    this.draw();
  };
  Emu.prototype.finishSubmit = function (key) {
    this.m.w32(U.hash, this.shaders.pipes[key].hash, "gpu");
    this.pipeOn = 12;
    this.uploads = this.m.upload();
    this.pipeOn = 13;
    this.act.gpu = 1; this.act.flip = 1; if (this.uploads > 0) this.act.up = 1;
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

  /* ---------------- games ---------------- */
  Emu.prototype.resetGame = function (mode) {
    var i, j;
    if (mode === 10) {
      this.game = { kind: "serpent", body: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], dir: 1, next: 1, food: { x: 14, y: 6 }, score: 0, dead: 0, acc: 0 };
    } else if (mode === 11) {
      var bricks = [];
      for (i = 0; i < 40; i++) bricks.push({ x: (i % 8) * 70 + 40, y: (i / 8 | 0) * 22 + 28, on: 1 });
      this.game = { kind: "breakout", px: 280, ball: { x: 320, y: 240, vx: 3.2, vy: -3.6 }, bricks: bricks, lives: 3, score: 0, dead: 0 };
    } else if (mode === 12) {
      this.game = { kind: "drift", x: 320, spd: 4, road: 0, obst: [{ y: -40, lane: 0 }, { y: -180, lane: 1 }, { y: -320, lane: 2 }], score: 0, dead: 0 };
    } else if (mode === 13) {
      var en = [];
      for (j = 0; j < 4; j++) for (i = 0; i < 9; i++) en.push({ x: 90 + i * 46, y: 40 + j * 34, on: 1 });
      this.game = { kind: "invaders", px: 300, enemies: en, dir: 1, drop: 0, bullets: [], ebul: [], score: 0, lives: 3, dead: 0, cool: 0, etick: 0, win: 0 };
    } else if (mode === 14) {
      this.game = { kind: "flappy", y: 180, vy: 0, pipes: [{ x: 640, gap: 150 }, { x: 860, gap: 120 }, { x: 1080, gap: 190 }], score: 0, dead: 0, t: 0 };
    } else if (mode === 15) {
      this.game = { kind: "pong", ly: 150, ry: 150, ball: { x: 320, y: 180, vx: 4.2, vy: 2.4 }, ls: 0, rs: 0, dead: 0 };
    } else this.game = null;
    if (!this.stars.length) {
      for (i = 0; i < 90; i++) this.stars.push({ x: Math.random() * 640, y: Math.random() * 360, z: 0.3 + Math.random() * 2 });
    }
  };

  Emu.prototype.held = function (a, b) { return this.keys.has(a) || this.keys.has(b); };
  Emu.prototype.pressed = function (a, b) { return this.pressedEdge.has(a) || this.pressedEdge.has(b); };

  Emu.prototype.gameStep = function () {
    var g = this.game, self = this; if (!g || g.dead || g.win) return;
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
      if (g.bricks.every(function (br) { return !br.on; })) g.win = 1;
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
    } else if (g.kind === "invaders") {
      if (this.held("arrowleft", "a")) g.px = Math.max(20, g.px - 6);
      if (this.held("arrowright", "d")) g.px = Math.min(596, g.px + 6);
      if (g.cool > 0) g.cool--;
      if (this.pressed(" ", "arrowup") && g.cool <= 0) { g.bullets.push({ x: g.px + 12, y: 300 }); g.cool = 10; }
      // enemy block moves every few frames
      g.etick++;
      var live = g.enemies.filter(function (e) { return e.on; });
      var speed = Math.max(4, 40 - live.length);
      if (g.etick >= speed) {
        g.etick = 0;
        var minx = 640, maxx = 0, maxy = 0;
        live.forEach(function (e) { minx = Math.min(minx, e.x); maxx = Math.max(maxx, e.x); maxy = Math.max(maxy, e.y); });
        if ((g.dir > 0 && maxx > 600) || (g.dir < 0 && minx < 20)) { g.dir *= -1; g.enemies.forEach(function (e) { e.y += 18; }); }
        else g.enemies.forEach(function (e) { e.x += g.dir * 12; });
        if (Math.random() < 0.6 && live.length) { var s = live[(Math.random() * live.length) | 0]; g.ebul.push({ x: s.x + 12, y: s.y + 16 }); }
        if (maxy + 18 > 300) g.dead = 1;
      }
      g.bullets.forEach(function (b) {
        b.y -= 9;
        g.enemies.forEach(function (e) { if (e.on && Math.abs(e.x + 12 - b.x) < 16 && Math.abs(e.y + 8 - b.y) < 12) { e.on = 0; b.y = -99; g.score += 10; } });
      });
      g.bullets = g.bullets.filter(function (b) { return b.y > -10; });
      g.ebul.forEach(function (b) { b.y += 5; if (Math.abs(b.x - (g.px + 12)) < 16 && b.y > 300 && b.y < 328) { g.lives--; b.y = 999; if (g.lives <= 0) g.dead = 1; } });
      g.ebul = g.ebul.filter(function (b) { return b.y < 360; });
      if (g.enemies.every(function (e) { return !e.on; })) g.win = 1;
    } else if (g.kind === "flappy") {
      if (this.pressed(" ", "arrowup") || this.pressed("w", "arrowup")) g.vy = -6.2;
      g.vy = Math.min(9, g.vy + 0.45); g.y += g.vy; g.t++;
      g.pipes.forEach(function (p) {
        p.x -= 3;
        if (p.x < -60) { p.x += 3 * 220 / 3 * 3 + 660; p.gap = 90 + Math.random() * 150; p.scored = 0; }
        if (!p.scored && p.x + 30 < 120) { p.scored = 1; g.score++; }
        if (p.x < 150 && p.x > 60) {
          if (g.y < p.gap - 45 || g.y > p.gap + 45) g.dead = 1;
        }
      });
      if (g.y > 350 || g.y < 6) g.dead = 1;
    } else if (g.kind === "pong") {
      if (this.held("arrowup", "w")) g.ly = Math.max(0, g.ly - 7);
      if (this.held("arrowdown", "s")) g.ly = Math.min(280, g.ly + 7);
      // AI paddle tracks the ball, imperfectly
      var target = g.ball.y - 40;
      g.ry += Math.max(-5, Math.min(5, (target - g.ry) * 0.14));
      g.ry = Math.max(0, Math.min(280, g.ry));
      var bl = g.ball;
      bl.x += bl.vx; bl.y += bl.vy;
      if (bl.y < 6 || bl.y > 354) bl.vy *= -1;
      if (bl.x < 28 && bl.y > g.ly && bl.y < g.ly + 80) { bl.vx = Math.abs(bl.vx) + 0.3; bl.vy += (bl.y - (g.ly + 40)) * 0.06; }
      if (bl.x > 612 && bl.y > g.ry && bl.y < g.ry + 80) { bl.vx = -Math.abs(bl.vx) - 0.3; bl.vy += (bl.y - (g.ry + 40)) * 0.06; }
      if (bl.x < 4) { g.rs++; bl.x = 320; bl.y = 180; bl.vx = 4.2; bl.vy = 2.4; }
      if (bl.x > 636) { g.ls++; bl.x = 320; bl.y = 180; bl.vx = -4.2; bl.vy = 2.4; }
      if (g.ls >= 7 || g.rs >= 7) g.dead = 1;
    }
  };

  /* ---------------- rendering ---------------- */
  Emu.prototype.draw = function () {
    var c = this.ctx, m = this.m; if (!c || !m) return;
    var w = 160, h = 90, t = (m.peek(U.tick) | 0) * 0.035, mode = m.peek(U.mode) | 0, warp = (m.peek(U.warp) || 8) * 0.12;
    var bass = (m.peek(U.bass) || 0) / 100, i, x, y, u, v, p, r, g, b, z, bi, si;
    var showMode = this.compileAnim ? (this.compileAnim.key % 64) : mode;
    if (showMode >= GAME0) { this.drawGame(c, showMode); if (this.compileAnim) this.compileOverlay(c); return; }
    if (!this.small) this.small = c.createImageData(w, h);
    var d = this.small.data;
    function put(x, y, r, g, b) { var i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    if (showMode === 2) {
      c.fillStyle = "#06080e"; c.fillRect(0, 0, 640, 360);
      this.hle.forEach(function (h, n) {
        var ang = t * 0.4 + n * 2.1, rad = 90 + n * 28 + bass * 30;
        var cx = 320 + Math.cos(ang) * rad, cy = 180 + Math.sin(ang * 0.9) * rad * 0.6;
        c.beginPath(); c.arc(cx, cy, 4 + (h.calls % 7), 0, Math.PI * 2);
        c.fillStyle = ["#55c5de", "#f0b849", "#ec668b"][n] || "#fff"; c.fill();
        c.fillStyle = "#b2bfca"; c.font = "10px monospace"; c.fillText(h.nid.slice(0, 6), cx + 8, cy);
      });
      if (this.compileAnim) this.compileOverlay(c); return;
    }
    if (showMode === 4) {
      c.fillStyle = "#05070c"; c.fillRect(0, 0, 640, 360);
      this.stars.forEach(function (s) {
        s.y += s.z * (2 + warp); if (s.y > 360) { s.y = 0; s.x = Math.random() * 640; }
        c.fillStyle = "rgba(200,220,255," + (0.3 + s.z / 3) + ")";
        c.fillRect(s.x, s.y, s.z, s.z * 3);
      });
      if (this.compileAnim) this.compileOverlay(c); return;
    }
    if (showMode === 6) {
      c.fillStyle = "#070b10"; c.fillRect(0, 0, 640, 360);
      c.font = "11px monospace";
      for (x = 0; x < 32; x++) {
        for (y = 0; y < 20; y++) {
          var gy = (y * 18 + ((t * 40 + x * 13) | 0) % 360) % 360;
          c.fillStyle = "rgba(85,197,222," + (0.15 + (y % 7) * 0.08) + ")";
          c.fillText(hex((x * 17 + y + (t * 8 | 0)) & 255, 2), 12 + x * 20, gy);
        }
      }
      if (this.compileAnim) this.compileOverlay(c); return;
    }
    var blobs = null, seeds = null;
    if (showMode === 8) { blobs = []; for (bi = 0; bi < 5; bi++) blobs.push({ x: 0.42 * Math.sin(t * 0.6 + bi * 1.7), y: 0.34 * Math.cos(t * 0.5 + bi * 2.1), s: 0.012 + 0.006 * (bi % 3) }); }
    if (showMode === 9) { seeds = []; for (si = 0; si < 8; si++) seeds.push({ x: 0.46 * Math.sin(t * 0.4 + si * 0.9), y: 0.46 * Math.cos(t * 0.33 + si * 1.3), h: (si * 41) % 240 }); }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      u = x / w - 0.5; v = y / h - 0.5;
      if (showMode === 0) {
        p = Math.sin(u * 12 * warp + t) + Math.sin(v * 10 + t * 1.3) + Math.sin((u + v) * 8 + t * 0.7);
        r = 20 + (Math.sin(p) * 0.5 + 0.5) * 80; g = 40 + (Math.sin(p + 2) * 0.5 + 0.5) * 140; b = 70 + (Math.sin(p + 4) * 0.5 + 0.5) * 160;
      } else if (showMode === 1) {
        z = 0.7 / (Math.abs(v * 2) + 0.12); p = (((u * 2 * z + t * 0.4) * 18 * warp) ^ (z * 14)) & 1;
        r = p ? 10 : 80 + bass * 80; g = p ? 18 : 30; b = p ? 28 : 90 + z * 40;
      } else if (showMode === 3) {
        p = Math.max(0, 1 - (0.5 - v) * 2) * (0.5 + 0.5 * Math.sin(u * 30 + t * 4 + Math.sin(v * 20)));
        r = 40 + p * 200; g = p * p * 90; b = 10;
      } else if (showMode === 5) {
        p = Math.sin(Math.sqrt(u * u + v * v) * 40 * warp - t * 3) + Math.sin((u + 0.2) * 28 + t);
        r = 8; g = 20 + (p * 0.5 + 0.5) * 160; b = 40 + (p * 0.5 + 0.5) * 180;
      } else if (showMode === 8) {
        var sum = 0; for (bi = 0; bi < blobs.length; bi++) { var dx = u - blobs[bi].x, dy = v - blobs[bi].y; sum += blobs[bi].s / (dx * dx + dy * dy + 0.0009); }
        var mm = Math.min(1, sum * 0.5);
        r = mm * mm * 70; g = 30 + mm * 190; b = 80 + (Math.sin(t) * 0.5 + 0.5) * mm * 130;
      } else if (showMode === 9) {
        var best = 9, best2 = 9, bh = 0;
        for (si = 0; si < seeds.length; si++) { var ex = u - seeds[si].x, ey = v - seeds[si].y, dd = ex * ex + ey * ey; if (dd < best) { best2 = best; best = dd; bh = seeds[si].h; } else if (dd < best2) best2 = dd; }
        var edge = Math.min(1, (best2 - best) * 12);
        r = (20 + bh * 0.5) * edge; g = (70 + (240 - bh) * 0.5) * edge; b = (110 + bh * 0.2) * edge;
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
    if (this.compileAnim) this.compileOverlay(c);
  };

  Emu.prototype.compileOverlay = function (c) {
    var ca = this.compileAnim;
    c.fillStyle = "rgba(3,6,10,.72)"; c.fillRect(0, 0, 640, 360);
    c.fillStyle = "#f0b849"; c.font = "600 15px monospace"; c.textAlign = "center";
    c.fillText("◷ COMPILING  " + permName(ca.key), 320, 150);
    var stage = Math.min(ca.stage, 4);
    for (var i = 0; i < SH.length; i++) {
      c.fillStyle = i < stage ? "#75d49a" : i === stage ? "#55c5de" : "#3a4b61";
      c.fillRect(150 + i * 70, 180, 60, 8);
      c.fillStyle = i === stage ? "#eaf0f5" : "#718092"; c.font = "9px monospace";
      c.fillText(SH[i], 180 + i * 70, 202);
    }
    c.fillStyle = "#b2bfca"; c.font = "10px monospace";
    c.fillText("first-encounter compile — a real pipeline miss stalls the frame here", 320, 230);
    c.textAlign = "left";
  };

  Emu.prototype.drawGame = function (c, mode) {
    var g = this.game, i;
    c.fillStyle = "#070b12"; c.fillRect(0, 0, 640, 360);
    c.font = "12px monospace"; c.fillStyle = "#b2bfca"; c.textAlign = "left";
    if (!g) { c.fillText("loading cartridge…", 24, 40); return; }
    function over(txt) { c.fillStyle = "rgba(3,6,10,.6)"; c.fillRect(0, 150, 640, 60); c.fillStyle = "#eaf0f5"; c.font = "600 16px monospace"; c.textAlign = "center"; c.fillText(txt, 320, 186); c.textAlign = "left"; c.font = "12px monospace"; }
    if (g.kind === "serpent") {
      c.fillStyle = "#12202c";
      for (i = 0; i < 32; i++) for (var j = 0; j < 18; j++) c.fillRect(i * 20 + 1, j * 20 + 1, 18, 18);
      g.body.forEach(function (s, n) {
        c.fillStyle = n ? "#55c5de" : "#eaf0f5";
        c.fillRect(s.x * 20 + 2, s.y * 20 + 2, 16, 16);
      });
      c.fillStyle = "#f0b849"; c.fillRect(g.food.x * 20 + 4, g.food.y * 20 + 4, 12, 12);
      c.fillStyle = "#eaf0f5"; c.fillText("SERPENT  score " + g.score, 16, 352);
      if (g.dead) over("dead — switch cartridge to reset");
    } else if (g.kind === "breakout") {
      g.bricks.forEach(function (br) {
        if (!br.on) return;
        c.fillStyle = br.y < 50 ? "#ec668b" : br.y < 90 ? "#f0b849" : "#55c5de";
        c.fillRect(br.x, br.y, 62, 16);
      });
      c.fillStyle = "#eaf0f5"; c.fillRect(g.px, 328, 100, 10);
      c.beginPath(); c.arc(g.ball.x, g.ball.y, 6, 0, Math.PI * 2); c.fillStyle = "#75d49a"; c.fill();
      c.fillStyle = "#b2bfca"; c.fillText("BREAKOUT  score " + g.score + "  lives " + g.lives, 16, 20);
      if (g.dead) over("dead"); else if (g.win) over("cleared! score " + g.score);
    } else if (g.kind === "drift") {
      c.fillStyle = "#1a2430"; c.fillRect(180, 0, 280, 360);
      c.strokeStyle = "#f0b849"; c.setLineDash([18, 16]); c.beginPath(); c.moveTo(320, 0); c.lineTo(320, 360); c.stroke(); c.setLineDash([]);
      g.obst.forEach(function (o) {
        c.fillStyle = "#ec668b"; c.fillRect(204 + o.lane * 100, o.y, 32, 40);
      });
      c.fillStyle = "#55c5de"; c.fillRect(g.x - 14, 280, 28, 44);
      c.fillStyle = "#eaf0f5"; c.fillText("DRIFT  km " + (g.score | 0), 16, 20);
      if (g.dead) over("crashed — km " + (g.score | 0));
    } else if (g.kind === "invaders") {
      g.enemies.forEach(function (e) { if (!e.on) return; c.fillStyle = e.y < 60 ? "#ec668b" : e.y < 90 ? "#f0b849" : "#55c5de"; c.fillRect(e.x, e.y, 24, 16); });
      c.fillStyle = "#75d49a"; g.bullets.forEach(function (b) { c.fillRect(b.x - 1, b.y, 3, 10); });
      c.fillStyle = "#ec668b"; g.ebul.forEach(function (b) { c.fillRect(b.x - 1, b.y, 3, 10); });
      c.fillStyle = "#eaf0f5"; c.fillRect(g.px, 318, 26, 12); c.fillRect(g.px + 10, 310, 6, 8);
      c.fillText("INVADERS  score " + g.score + "  lives " + g.lives, 16, 20);
      if (g.dead) over("overrun — score " + g.score); else if (g.win) over("wave cleared! score " + g.score);
    } else if (g.kind === "flappy") {
      c.fillStyle = "#0e2436"; c.fillRect(0, 352, 640, 8);
      g.pipes.forEach(function (p) {
        c.fillStyle = "#75d49a";
        c.fillRect(p.x, 0, 46, p.gap - 45);
        c.fillRect(p.x, p.gap + 45, 46, 360 - (p.gap + 45));
      });
      c.fillStyle = "#f0b849"; c.beginPath(); c.arc(120, g.y, 10, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#eaf0f5"; c.fillText("FLAPPY  score " + g.score + "   space/up = flap", 16, 20);
      if (g.dead) over("dead — score " + g.score);
    } else if (g.kind === "pong") {
      c.strokeStyle = "#273446"; c.setLineDash([8, 10]); c.beginPath(); c.moveTo(320, 0); c.lineTo(320, 360); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#eaf0f5"; c.fillRect(16, g.ly, 8, 80); c.fillRect(616, g.ry, 8, 80);
      c.beginPath(); c.arc(g.ball.x, g.ball.y, 6, 0, Math.PI * 2); c.fillStyle = "#55c5de"; c.fill();
      c.fillStyle = "#b2bfca"; c.font = "22px monospace"; c.textAlign = "center";
      c.fillText(g.ls + "   " + g.rs, 320, 40); c.textAlign = "left"; c.font = "12px monospace";
      c.fillText("PONG  you (left) · W/S or ↑/↓", 16, 352);
      if (g.dead) over(g.ls > g.rs ? "you win " + g.ls + "–" + g.rs : "AI wins " + g.rs + "–" + g.ls);
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

  /* ---------------- stage inspector ---------------- */
  function tbl(rows) {
    return "<div class='ax-ins-tbl'>" + rows.map(function (r) {
      return "<div><span>" + r[0] + "</span><code>" + r[1] + "</code></div>";
    }).join("") + "</div>";
  }
  Emu.prototype.pipeInspect = function (i) {
    var m = this.m, self = this;
    switch (i) {
      case 0: return tbl([["reserved", (MEM / 1024) + " KB"], ["page size", PAGE + " B"], ["pages live", m.usedPages() + " / " + PAGES], ["faults", m.st.faults]]);
      case 1: return tbl(m.maps.map(function (mp) { return [mp.lab, "0x" + hex(mp.a) + " · " + mp.n + "B · " + (["", "R", "W", "RW", "X", "RX", "WX", "RWX"][mp.perm] || mp.perm)]; }));
      case 2: return tbl(this.got.map(function (g) { return [g.name, g.nid + " → GOT[" + g.slot + "]"]; }));
      case 3: return "<pre class='ax-ins-pre'>on disk : " + this.tls.before + "\nin memory: " + (this.tls.after || "—") + "</pre><p class='ax-ins-note'>REX.W near-call + mov rax,rax neutralises a stray 0x66 prefix on AMD.</p>";
      case 4: { var rx = 0, rw = 0; for (var p = 0; p < PAGES; p++) { if (!m.pages[p].on) continue; if (m.pages[p].perm & PERM.X) rx++; else if (m.pages[p].perm & PERM.W) rw++; } return tbl([["R+X pages", rx + " (code, GOT)"], ["R+W pages", rw + " (data, ring)"], ["W-on-X?", "denied → fault"]]); }
      case 5: return tbl(this.th.map(function (t) { return [t.name, "pc 0x" + hex(t.base + t.pc * 8)]; }));
      case 6: return tbl([["entry", "0x" + hex(CODE)], ["first op", this.th[0] ? dis(this.th[0].ins[0]) : "—"], ["mode", "native — no interpreter"]]);
      case 7: { var t = this.th[0]; return tbl([["pc", "0x" + hex(t.base + t.pc * 8)], ["r1 (tick)", hex(t.r[1])], ["next", dis(t.ins[t.pc])]]); }
      case 8: { var vals = []; for (var k = 0; k < 8; k++) vals.push(m.peek(ARING + k * 4)); return tbl([["audio ring", vals.join(" ")], ["bass", m.peek(U.bass)], ["beep", this.audioOn ? "on" : "off"]]); }
      case 9: return tbl(this.hle.map(function (h) { return [h.name, h.nid + " · " + h.calls + " calls"]; }));
      case 10: return tbl(this.pm4.length ? this.pm4.map(function (p) { return [p.name, (p.reg || ("n=" + p.n)) + (p.pl.length ? " · [" + p.pl.join(" ") + "]" : "")]; }) : [["(idle)", "no packet yet"]]);
      case 11: { var rows = Object.keys(this.shaders.pipes).map(function (k) { var p = self.shaders.pipes[k]; return [p.name, "0x" + hex(p.hash)]; }); rows.push(["hits / misses", this.shaders.hits + " / " + this.shaders.misses]); return tbl(rows); }
      case 12: return tbl([["uploaded", (m.st.up / 1024 | 0) + " KB"], ["watch faults", m.st.watch], ["last upload", this.uploads + " pages"]]);
      case 13: return tbl([["present", "VIDEO_OUT_0"], ["tick", m.peek(U.tick)], ["effect", FX[this.knobMode] || this.knobMode]]);
    }
    return "";
  };
  Emu.prototype.curKey = function () {
    if (this.compileAnim) return this.compileAnim.key;
    if (this.recompile) return this.recompile.key;
    return (this.m.peek(U.mode) | 0) + (this.m.peek(U.variant) | 0) * 64;
  };
  Emu.prototype.shInspect = function (i) {
    var key = this.curKey(), arts = (this.recompile && this.recompile.key === key) ? this.recompile.arts : shaderArtifacts(key);
    var stageArr = [arts.isa, arts.cfg, arts.ir, arts.srt, arts.spv][i];
    var label = ["RDNA 2 ISA (decoded)", "control-flow graph", "typed value IR", "resource table (SRT snapshot)", "emitted SPIR-V"][i];
    return "<p class='ax-ins-sub'>" + esc(arts.name) + " · " + esc(label) + "</p><pre class='ax-ins-pre'>" + esc(stageArr.join("\n")) + "</pre>";
  };
  // the live RDNA 2 → IR → SPIR-V tape in the recompiler card, revealed stage by stage
  var SH_HDR = ["RDNA 2 ISA (decode)", "control-flow graph", "typed value IR", "resource table (SRT)", "SPIR-V (compile)"];
  function recompileHTML() {
    var r = emu.recompile;
    if (!r) return "<span class='ax-dim'>no fragment program specialised yet — pick an effect</span>";
    var arts = r.arts, stages = [arts.isa, arts.cfg, arts.ir, arts.srt, arts.spv];
    var upto = emu.compileAnim ? Math.min(emu.compileAnim.stage, 4) : 4;
    var out = "<b>" + esc(arts.name) + "</b>  <span class='ax-dim'>0x" + hex((0x51A00000 + r.key * 0x20F) >>> 0) + (emu.compileAnim ? " · compiling…" : " · cached") + "</span>";
    for (var s = 0; s <= upto; s++) out += "\n\n<i>; ── " + SH_HDR[s] + " ──</i>\n" + esc(stages[s].join("\n"));
    return out;
  }

  var emu = new Emu();
  emu.ctx = $("ax-screen").getContext("2d");

  PIPE.forEach(function (n, i) {
    var li = document.createElement("li");
    li.textContent = n; li.tabIndex = 0; li.setAttribute("role", "button");
    li.title = PIPE_HELP[i];
    li.onclick = function () { emu.toggleInspect("pipe", i); };
    li.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); emu.toggleInspect("pipe", i); } };
    $("ax-pipe").appendChild(li);
  });
  SH.forEach(function (n, i) {
    var li = document.createElement("li");
    li.textContent = n; li.tabIndex = 0; li.setAttribute("role", "button");
    li.title = SH_HELP[i];
    li.onclick = function () { emu.toggleInspect("sh", i); };
    li.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); emu.toggleInspect("sh", i); } };
    $("ax-sh-stages").appendChild(li);
  });
  Emu.prototype.toggleInspect = function (t, i) {
    if (this.inspect && this.inspect.t === t && this.inspect.i === i) this.inspect = null;
    else this.inspect = { t: t, i: i };
    paint();
  };

  var inspectBuilt = null;
  function paint() {
    $("ax-led").className = emu.faulted ? "fault" : emu.booted ? "on" : "";
    $("ax-sub").textContent = emu.faulted ? "faulted" : emu.compileAnim ? "compiling" : !emu.booted ? "booting" : emu.running ? "running" : "paused";
    $("ax-run").textContent = emu.running ? "Pause" : "Run";

    // --- side panel: live boundary, or the stage inspector ---
    var insEl = $("ax-inspect");
    if (emu.inspect) {
      var t = emu.inspect.t, i = emu.inspect.i, sig = t + ":" + i;
      var title = t === "pipe" ? PIPE[i] : SH[i];
      var map = t === "pipe" ? PIPE_MAP[i] : SH_MAP[i];
      $("ax-bound-kind").textContent = t === "pipe" ? "INSPECT · STAGE" : "INSPECT · IR";
      $("ax-from").textContent = t === "pipe" ? "stage " + (i + 1) : "recompiler";
      $("ax-to").textContent = title;
      $("ax-bound-text").textContent = t === "pipe" ? PIPE_HELP[i] : SH_HELP[i];
      // Build the shell (map line + data slot + button) only when the selected
      // stage changes, so the button stays a stable element clicks can complete on.
      if (inspectBuilt !== sig) {
        insEl.hidden = false;
        insEl.innerHTML = "<p class='ax-ins-map'>KytyPS5 · " + esc(map) + "</p>" +
          "<div class='ax-ins-data'></div>" +
          "<button type='button' class='ax-btn ax-ins-x' id='ax-ins-x'>&#9654; back to live</button>";
        $("ax-ins-x").onclick = function () { emu.inspect = null; paint(); };
        inspectBuilt = sig;
      }
      insEl.querySelector(".ax-ins-data").innerHTML = t === "pipe" ? emu.pipeInspect(i) : emu.shInspect(i);
    } else {
      if (inspectBuilt !== null) { insEl.hidden = true; insEl.innerHTML = ""; inspectBuilt = null; }
      $("ax-bound-kind").textContent = emu.bound.k;
      $("ax-from").textContent = emu.bound.from;
      $("ax-to").textContent = emu.bound.to;
      $("ax-bound-text").textContent = emu.bound.t;
    }

    $("ax-l-cpu").className = emu.act.cpu ? "hot" : "";
    $("ax-l-gpu").className = (emu.act.gpu || emu.compileAnim) ? "hot" : "";
    $("ax-l-up").className = emu.act.up ? "hot" : "";
    $("ax-l-flip").className = emu.act.flip ? "hot" : "";
    $("ax-tick").textContent = emu.m ? emu.m.peek(U.tick) : 0;
    $("ax-perm").textContent = emu.shaders.last;
    $("ax-which").textContent = emu.th[emu.view] ? emu.th[emu.view].name : "—";
    $("ax-effect-name").textContent = emu.knobMode === MEGA
      ? "megademo · " + (emu.demo ? emu.demo.seq[emu.demo.scene].name : "")
      : (FX[emu.knobMode] || ("mode-" + emu.knobMode));
    $("ax-metrics").innerHTML = "<dt>PC</dt><dd>0x" + hex(emu.th[emu.view] ? emu.th[emu.view].base + emu.th[emu.view].pc * 8 : 0) + "</dd><dt>shader</dt><dd>" + esc(emu.shaders.last) + "</dd>";
    var log = $("ax-log"); log.innerHTML = "";
    emu.events.slice(0, 12).forEach(function (e) {
      var li = document.createElement("li"); li.className = e.lv; li.textContent = "[" + e.f + "] " + e.k + " · " + e.t; log.appendChild(li);
    });

    var pipeLit = emu.pipeOn, pipeSel = emu.inspect && emu.inspect.t === "pipe" ? emu.inspect.i : -1;
    var shLit = emu.compileAnim ? Math.min(emu.compileAnim.stage, 4) : emu.shaders.stage;
    var shSel = emu.inspect && emu.inspect.t === "sh" ? emu.inspect.i : -1;
    Array.prototype.forEach.call($("ax-pipe").children, function (el, i) {
      el.className = (i === pipeSel ? "sel " : "") + (i === pipeLit ? "on" : (i < emu.pipeOn ? "done" : ""));
    });
    Array.prototype.forEach.call($("ax-sh-stages").children, function (el, i) {
      el.className = (i === shSel ? "sel " : "") + (i === shLit ? "on" : (emu.compileAnim && i < emu.compileAnim.stage ? "done" : ""));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function (b) {
      b.classList.toggle("ax-pri", +b.getAttribute("data-th") === emu.view);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
      b.classList.toggle("ax-pri", +b.getAttribute("data-mode") === emu.knobMode);
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
      var d = document.createElement("div"); d.className = "ax-row ax-pm4-row";
      d.innerHTML = "<b>" + p.name + "</b><code>" + (p.reg || ("n=" + p.n)) + "</code><span>" + (p.pl.length ? p.pl.join(" ") : "—") + "</span>";
      pm.appendChild(d);
    });
    $("ax-recompile").innerHTML = recompileHTML();
    var sh = $("ax-pipes"); sh.innerHTML = "";
    var keys = Object.keys(emu.shaders.pipes);
    keys.slice(-14).forEach(function (k) {
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
    if (!emu.booted) emu.finishBoot();
    emu.running = !emu.running;
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
  var PACE = { learn: [520, 460], normal: [260, 230], fast: [110, 80] };
  $("ax-speed").onchange = function () { var p = PACE[this.value] || PACE.learn; emu.bootMs = p[0]; emu.compMs = p[1]; };
  (function () { var p = PACE.learn; emu.bootMs = p[0]; emu.compMs = p[1]; })();
  Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) {
    b.onclick = function () {
      var m = +this.getAttribute("data-mode");
      if (m === MEGA) { emu.enterMega(); paint(); return; }
      if (!emu.booted) emu.finishBoot();
      emu.knobMode = m; emu.knobVariant = 0; emu.demo = null;
      emu.resetGame(m);
      emu.running = true;
      paint();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function (b) {
    b.onclick = function () { emu.view = +this.getAttribute("data-th"); paint(); };
  });
  $("ax-fault-rx").onclick = function () {
    try { emu.m.w32(CODE, 0, "cpu"); } catch (e) { emu.dump(CODE); }
    paint();
  };
  $("ax-flush").onclick = function () { var was = emu.shaders; emu.shaders = new Cache(); emu.shaders.hits = 0; emu.log("gpu", "permutations dropped — next draw recompiles", "gpu"); paint(); };
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].indexOf(k) >= 0) e.preventDefault();
    if (!emu.keys.has(k)) emu.pressedEdge.add(k);
    emu.keys.add(k);
    if (k === "p") { emu.running = !emu.running; }
    if (k === ".") { emu.running = false; emu.stepInsn(); }
    if (k === ",") { emu.running = false; emu.stepFrame(); }
  });
  window.addEventListener("keyup", function (e) { emu.keys.delete(e.key.toLowerCase()); });

  var acc = 0, last = performance.now();
  function tick(now) {
    var dt = now - last; last = now;
    if (dt > 250) dt = 250;
    if (!emu.booted) { emu.advanceBoot(dt); }
    else if (emu.compileAnim) { emu.advanceCompile(dt); }
    else if (emu.running && emu.alive) {
      emu.act = { cpu: 0, gpu: 0, up: 0, flip: 0 };
      acc += dt;
      var guard = 6;
      while (acc > 33 && guard-- > 0 && !emu.compileAnim) { acc -= 33; emu.stepFrame(); }
      if (acc > 200) acc = 0;
    }
    paint();
    requestAnimationFrame(tick);
  }
  emu.boot();
  emu.running = true;
  requestAnimationFrame(tick);
})();
