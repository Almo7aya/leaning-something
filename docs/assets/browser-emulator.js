/* ============================================================
   browser-emulator.js

   A deliberately small but real emulation stack:
     executable builder -> loader -> paged guest memory
     -> fixed-width ISA interpreter -> guest scheduler
     -> NID/GOT linked HLE -> PM4-like command ring
     -> command processor -> WebGL2 -> framebuffer present

   It is not a PS5 emulator. It makes the same kinds of boundaries
   executable at a scale a browser can safely host and a learner can
   inspect in one page.
   ============================================================ */
(function () {
  "use strict";

  var root = document.getElementById("be-machine");
  if (!root) return;

  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function hex(n, width) { return (n >>> 0).toString(16).toUpperCase().padStart(width || 8, "0"); }
  function signed(n) { return n | 0; }
  function fmt(n, d) { return Number(n || 0).toFixed(d == null ? 1 : d); }

  var MEM_SIZE = 2 * 1024 * 1024;
  var PAGE_SIZE = 4096;
  var PAGE_COUNT = MEM_SIZE / PAGE_SIZE;
  var CODE_BASE = 0x00010000;
  var GOT_BASE = 0x00030000;
  var DATA_BASE = 0x00040000;
  var RING_BASE = 0x00080000;
  var RING_SIZE = 0x00020000;
  var STACK_BASE = 0x001d0000;
  var FIX = 16;

  var ADDR = {
    playerX: DATA_BASE + 0x00,
    playerY: DATA_BASE + 0x04,
    inputX: DATA_BASE + 0x08,
    inputY: DATA_BASE + 0x0c,
    score: DATA_BASE + 0x10,
    health: DATA_BASE + 0x14,
    tick: DATA_BASE + 0x18,
    invulnerable: DATA_BASE + 0x1c,
    entityCount: DATA_BASE + 0x20,
    entityX: DATA_BASE + 0x100,
    entityY: DATA_BASE + 0x200,
    entityVX: DATA_BASE + 0x300,
    entityVY: DATA_BASE + 0x400,
    entityType: DATA_BASE + 0x500,
    entityActive: DATA_BASE + 0x600
  };
  var ENTITY_COUNT = 22;
  var MAX_HEALTH = 8;

  var PERM = { R: 1, W: 2, X: 4 };
  function permText(bits) {
    return (bits & PERM.R ? "R" : "-") + (bits & PERM.W ? "W" : "-") + (bits & PERM.X ? "X" : "-");
  }

  /* ============================================================
     GUEST MEMORY
     ============================================================ */

  function GuestMemory(size) {
    this.size = size;
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.pages = new Array(size / PAGE_SIZE);
    this.maps = [];
    this.stats = { reads: 0, writes: 0, faults: 0, protectionFaults: 0, uploadedBytes: 0 };
    for (var i = 0; i < this.pages.length; i++) {
      this.pages[i] = { committed: false, perm: 0, dirty: false, gpuCurrent: false, label: "" };
    }
  }

  GuestMemory.prototype.map = function (addr, size, perm, label, kind) {
    if (addr < 0 || size <= 0 || addr + size > this.size) throw new Error("map outside guest address space");
    var start = Math.floor(addr / PAGE_SIZE);
    var end = Math.ceil((addr + size) / PAGE_SIZE);
    for (var p = start; p < end; p++) {
      if (this.pages[p].committed) throw new Error("guest mapping collision at page " + p);
      this.pages[p].committed = true;
      this.pages[p].perm = perm;
      this.pages[p].label = label;
    }
    this.maps.push({ addr: addr, size: size, perm: perm, label: label, kind: kind || "data" });
  };

  GuestMemory.prototype.protect = function (addr, size, perm) {
    var start = Math.floor(addr / PAGE_SIZE);
    var end = Math.ceil((addr + size) / PAGE_SIZE);
    for (var p = start; p < end; p++) {
      if (!this.pages[p].committed) throw new Error("protect on uncommitted guest page " + p);
      this.pages[p].perm = perm;
    }
    this.maps.forEach(function (m) {
      if (m.addr === addr && m.size === size) m.perm = perm;
    });
  };

  GuestMemory.prototype.check = function (addr, bytes, perm) {
    if ((addr | 0) < 0 || addr + bytes > this.size) {
      this.stats.faults++;
      throw new Error("guest address fault at 0x" + hex(addr));
    }
    var first = Math.floor(addr / PAGE_SIZE);
    var last = Math.floor((addr + bytes - 1) / PAGE_SIZE);
    for (var p = first; p <= last; p++) {
      if (!this.pages[p].committed || !(this.pages[p].perm & perm)) {
        this.stats.faults++;
        throw new Error("guest protection fault at 0x" + hex(addr) + " (need " + permText(perm) + ")");
      }
    }
  };

  GuestMemory.prototype.read32 = function (addr, execute) {
    this.check(addr, 4, execute ? PERM.X : PERM.R);
    this.stats.reads++;
    return this.view.getInt32(addr, true);
  };

  GuestMemory.prototype.peek32 = function (addr) {
    if (addr < 0 || addr + 4 > this.size || !this.pages[Math.floor(addr / PAGE_SIZE)].committed) {
      throw new Error("debugger peek outside committed guest memory at 0x" + hex(addr));
    }
    return this.view.getInt32(addr, true);
  };

  GuestMemory.prototype.write32 = function (addr, value, source, force) {
    if (!force) this.check(addr, 4, PERM.W);
    else if (addr < 0 || addr + 4 > this.size) throw new Error("loader write outside guest memory");
    this.view.setInt32(addr, value | 0, true);
    this.stats.writes++;
    var page = this.pages[Math.floor(addr / PAGE_SIZE)];
    if (page) {
      if (page.gpuCurrent && source !== "loader") {
        this.stats.protectionFaults++;
        page.gpuCurrent = false;
      }
      if (source !== "loader") page.dirty = true;
    }
  };

  GuestMemory.prototype.loadWords = function (addr, words) {
    for (var i = 0; i < words.length; i++) this.write32(addr + i * 4, words[i], "loader", true);
  };

  GuestMemory.prototype.uploadDirty = function () {
    var pages = 0;
    for (var i = 0; i < this.pages.length; i++) {
      var page = this.pages[i];
      if (page.dirty) {
        pages++;
        page.dirty = false;
        page.gpuCurrent = true;
      }
    }
    var bytes = pages * PAGE_SIZE;
    this.stats.uploadedBytes += bytes;
    return { pages: pages, bytes: bytes };
  };

  /* ============================================================
     FIXED-WIDTH GUEST ISA + ASSEMBLER
     Each instruction is two little-endian dwords:
       [ opcode | a<<8 | b<<16 | c<<24 ][ immediate ]
     ============================================================ */

  var OP = {
    NOP: 0, LI: 1, MOV: 2, LOAD: 3, STORE: 4, LDX: 5, STX: 6,
    ADD: 7, ADDI: 8, SUB: 9, MUL: 10, NEG: 11, CMP: 12,
    JMP: 13, JE: 14, JNE: 15, JLT: 16, JLE: 17, JGT: 18, JGE: 19,
    SYS: 20, YIELD: 21, HALT: 22
  };
  var OP_NAME = [];
  Object.keys(OP).forEach(function (name) { OP_NAME[OP[name]] = name; });

  function Assembler() {
    this.instructions = [];
    this.labels = {};
    this.fixups = [];
  }
  Assembler.prototype.label = function (name) { this.labels[name] = this.instructions.length; return this; };
  Assembler.prototype.emit = function (op, a, b, c, imm) {
    this.instructions.push({ op: typeof op === "string" ? OP[op] : op, a: a || 0, b: b || 0, c: c || 0, imm: imm || 0 });
    return this;
  };
  Assembler.prototype.jump = function (op, label) {
    this.fixups.push({ at: this.instructions.length, label: label });
    return this.emit(op, 0, 0, 0, 0);
  };
  Assembler.prototype.finish = function () {
    var self = this;
    this.fixups.forEach(function (f) {
      if (self.labels[f.label] == null) throw new Error("assembler label not found: " + f.label);
      self.instructions[f.at].imm = self.labels[f.label];
    });
    var words = [];
    this.instructions.forEach(function (i) {
      words.push((i.op & 255) | ((i.a & 255) << 8) | ((i.b & 255) << 16) | ((i.c & 255) << 24));
      words.push(i.imm | 0);
    });
    return { words: words, instructions: this.instructions, labels: this.labels };
  };

  function regName(r) { return "r" + r; }
  function disassemble(op, a, b, c, imm) {
    var name = OP_NAME[op] || "ILLEGAL";
    if (op === OP.NOP || op === OP.YIELD || op === OP.HALT) return name.toLowerCase();
    if (op === OP.LI) return "li " + regName(a) + ", " + signed(imm);
    if (op === OP.MOV || op === OP.NEG) return name.toLowerCase() + " " + regName(a) + ", " + regName(b);
    if (op === OP.LOAD) return "load " + regName(a) + ", [0x" + hex(imm) + "]";
    if (op === OP.STORE) return "store [0x" + hex(imm) + "], " + regName(a);
    if (op === OP.LDX) return "ldx " + regName(a) + ", [" + regName(b) + "+" + regName(c) + "*4" + (imm ? "+" + signed(imm) : "") + "]";
    if (op === OP.STX) return "stx [" + regName(b) + "+" + regName(c) + "*4" + (imm ? "+" + signed(imm) : "") + "], " + regName(a);
    if (op === OP.ADD || op === OP.SUB || op === OP.MUL) return name.toLowerCase() + " " + regName(a) + ", " + regName(b) + ", " + regName(c);
    if (op === OP.ADDI) return "addi " + regName(a) + ", " + regName(b) + ", " + signed(imm);
    if (op === OP.CMP) return "cmp " + regName(a) + ", " + regName(b);
    if (op >= OP.JMP && op <= OP.JGE) return name.toLowerCase() + " 0x" + hex(CODE_BASE + imm * 8);
    if (op === OP.SYS) return "sys GOT[" + imm + "]";
    return name.toLowerCase() + " ?";
  }

  /* ============================================================
     THE GUEST GAME EXECUTABLE
     Game rules and collision tests below become interpreted words.
     ============================================================ */

  var IMPORT_NAMES = [
    "libInput.readState",
    "libGame.collectSignal",
    "libGame.takeDamage",
    "libAgc.submitFrame",
    "libKernel.waitVblank"
  ];

  function buildGameExecutable() {
    var a = new Assembler();
    var rZero = 15;

    a.label("main");
    a.emit("SYS", 0, 0, 0, 0);                         // input HLE
    a.emit("LOAD", 1, 0, 0, ADDR.playerX);
    a.emit("LOAD", 2, 0, 0, ADDR.inputX);
    a.emit("ADD", 1, 1, 2);
    a.emit("LI", 8, 0, 0, 32 * FIX);
    a.emit("CMP", 1, 8); a.jump("JGE", "px_min_ok"); a.emit("MOV", 1, 8);
    a.label("px_min_ok");
    a.emit("LI", 8, 0, 0, 928 * FIX);
    a.emit("CMP", 1, 8); a.jump("JLE", "px_max_ok"); a.emit("MOV", 1, 8);
    a.label("px_max_ok");
    a.emit("STORE", 1, 0, 0, ADDR.playerX);
    a.emit("MOV", 11, 1);                              // r11 = player x

    a.emit("LOAD", 1, 0, 0, ADDR.playerY);
    a.emit("LOAD", 2, 0, 0, ADDR.inputY);
    a.emit("ADD", 1, 1, 2);
    a.emit("LI", 8, 0, 0, 48 * FIX);
    a.emit("CMP", 1, 8); a.jump("JGE", "py_min_ok"); a.emit("MOV", 1, 8);
    a.label("py_min_ok");
    a.emit("LI", 8, 0, 0, 508 * FIX);
    a.emit("CMP", 1, 8); a.jump("JLE", "py_max_ok"); a.emit("MOV", 1, 8);
    a.label("py_max_ok");
    a.emit("STORE", 1, 0, 0, ADDR.playerY);
    a.emit("MOV", 12, 1);                              // r12 = player y

    a.emit("LOAD", 1, 0, 0, ADDR.tick);
    a.emit("ADDI", 1, 1, 0, 1);
    a.emit("STORE", 1, 0, 0, ADDR.tick);

    a.emit("LI", 9, 0, 0, ENTITY_COUNT);               // r9 = entity count
    a.emit("LI", 10, 0, 0, 0);                         // r10 = loop index
    a.emit("LI", 13, 0, 0, ADDR.entityX);              // array bases
    a.emit("LI", 14, 0, 0, ADDR.entityY);
    a.label("entity_loop");
    a.emit("CMP", 10, 9); a.jump("JGE", "frame_end");

    a.emit("LDX", 1, 13, 10, 0);                       // x
    a.emit("LDX", 2, 14, 10, 0);                       // y
    a.emit("LI", 7, 0, 0, ADDR.entityVX);
    a.emit("LDX", 3, 7, 10, 0);                        // vx
    a.emit("LI", 7, 0, 0, ADDR.entityVY);
    a.emit("LDX", 4, 7, 10, 0);                        // vy
    a.emit("ADD", 1, 1, 3);
    a.emit("ADD", 2, 2, 4);

    a.emit("LI", 8, 0, 0, 16 * FIX);
    a.emit("CMP", 1, 8); a.jump("JGE", "ex_min_ok");
    a.emit("MOV", 1, 8); a.emit("NEG", 3, 3);
    a.label("ex_min_ok");
    a.emit("LI", 8, 0, 0, 944 * FIX);
    a.emit("CMP", 1, 8); a.jump("JLE", "ex_max_ok");
    a.emit("MOV", 1, 8); a.emit("NEG", 3, 3);
    a.label("ex_max_ok");
    a.emit("LI", 8, 0, 0, 16 * FIX);
    a.emit("CMP", 2, 8); a.jump("JGE", "ey_min_ok");
    a.emit("MOV", 2, 8); a.emit("NEG", 4, 4);
    a.label("ey_min_ok");
    a.emit("LI", 8, 0, 0, 524 * FIX);
    a.emit("CMP", 2, 8); a.jump("JLE", "ey_max_ok");
    a.emit("MOV", 2, 8); a.emit("NEG", 4, 4);
    a.label("ey_max_ok");

    a.emit("STX", 1, 13, 10, 0);
    a.emit("STX", 2, 14, 10, 0);
    a.emit("LI", 7, 0, 0, ADDR.entityVX); a.emit("STX", 3, 7, 10, 0);
    a.emit("LI", 7, 0, 0, ADDR.entityVY); a.emit("STX", 4, 7, 10, 0);

    a.emit("SUB", 5, 1, 11);                           // squared collision distance
    a.emit("MUL", 5, 5, 5);
    a.emit("SUB", 6, 2, 12);
    a.emit("MUL", 6, 6, 6);
    a.emit("ADD", 5, 5, 6);
    a.emit("LI", 8, 0, 0, 34 * FIX * 34 * FIX);
    a.emit("CMP", 5, 8); a.jump("JGE", "entity_next");
    a.emit("LI", 7, 0, 0, ADDR.entityType);
    a.emit("LDX", 6, 7, 10, 0);
    a.emit("CMP", 6, rZero); a.jump("JE", "hit_sentry");
    a.emit("MOV", 0, 10); a.emit("SYS", 0, 0, 0, 1); // collect signal
    a.jump("JMP", "entity_next");
    a.label("hit_sentry");
    a.emit("MOV", 0, 10); a.emit("SYS", 0, 0, 0, 2); // damage

    a.label("entity_next");
    a.emit("ADDI", 10, 10, 0, 1);
    a.jump("JMP", "entity_loop");

    a.label("frame_end");
    a.emit("SYS", 0, 0, 0, 3);                        // AGC submit
    a.emit("YIELD");
    a.jump("JMP", "main");

    a.label("vblank_thread");
    a.emit("SYS", 0, 0, 0, 4);
    a.emit("YIELD");
    a.jump("JMP", "vblank_thread");

    var program = a.finish();
    return {
      magic: "µEXE", machine: "ASTERIA-R32", type: "DYNEXEC", entry: a.labels.main,
      vblankEntry: a.labels.vblank_thread, program: program,
      imports: IMPORT_NAMES.map(function (name, slot) { return { name: name, nid: makeNid(name), slot: slot, address: 0 }; }),
      segments: [
        { name: ".text", addr: CODE_BASE, size: program.words.length * 4, finalPerm: PERM.R | PERM.X, kind: "code" },
        { name: ".got", addr: GOT_BASE, size: PAGE_SIZE, finalPerm: PERM.R, kind: "data" },
        { name: ".data", addr: DATA_BASE, size: PAGE_SIZE, finalPerm: PERM.R | PERM.W, kind: "data" },
        { name: ".gpu_ring", addr: RING_BASE, size: RING_SIZE, finalPerm: PERM.R | PERM.W, kind: "gpu" },
        { name: ".stacks", addr: STACK_BASE, size: PAGE_SIZE * 16, finalPerm: PERM.R | PERM.W, kind: "data" }
      ]
    };
  }

  function makeNid(name) {
    var h1 = 2166136261 >>> 0;
    var h2 = 2246822519 >>> 0;
    for (var i = 0; i < name.length; i++) {
      h1 ^= name.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0;
      h2 ^= name.charCodeAt(name.length - 1 - i); h2 = Math.imul(h2, 3266489917) >>> 0;
    }
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    var value = BigInt(h1) | (BigInt(h2) << 32n);
    var out = "";
    for (var b = 0; b < 11; b++) { out += alphabet[Number(value & 63n)]; value >>= 6n; }
    return out;
  }

  /* ============================================================
     CPU INTERPRETER AND GUEST SCHEDULER
     ============================================================ */

  function GuestThread(id, name, entry, stackTop) {
    this.id = id;
    this.name = name;
    this.pc = entry;
    this.regs = new Int32Array(16);
    this.regs[13] = stackTop | 0;
    this.cmp = 0;
    this.state = "ready";
    this.instructions = 0;
    this.instructionsFrame = 0;
    this.lastYield = "created";
  }

  function GuestCpu(memory, hle, trace) {
    this.memory = memory;
    this.hle = hle;
    this.trace = trace;
    this.totalInstructions = 0;
    this.frameInstructions = 0;
    this.lastThread = null;
    this.lastPc = 0;
    this.lastRegs = new Int32Array(16);
    this.illegalInstructions = 0;
    this.recent = [];
  }

  GuestCpu.prototype.run = function (thread, budget) {
    thread.state = "running";
    thread.instructionsFrame = 0;
    this.lastThread = thread;
    for (var step = 0; step < budget; step++) {
      var pc = thread.pc;
      var addr = CODE_BASE + pc * 8;
      var word = this.memory.read32(addr, true) >>> 0;
      var imm = this.memory.read32(addr + 4, true) | 0;
      var op = word & 255;
      var a = (word >>> 8) & 255;
      var b = (word >>> 16) & 255;
      var c = (word >>> 24) & 255;
      var r = thread.regs;
      var advance = true;

      this.lastPc = pc;
      this.totalInstructions++;
      this.frameInstructions++;
      thread.instructions++;
      thread.instructionsFrame++;
      this.recent.unshift({ pc: pc, op: op, a: a, b: b, c: c, imm: imm, thread: thread.name });
      if (this.recent.length > 40) this.recent.length = 40;

      if (op === OP.NOP) {
        // no-op
      } else if (op === OP.LI) {
        r[a] = imm;
      } else if (op === OP.MOV) {
        r[a] = r[b];
      } else if (op === OP.LOAD) {
        r[a] = this.memory.read32(imm, false);
      } else if (op === OP.STORE) {
        this.memory.write32(imm, r[a], "cpu");
      } else if (op === OP.LDX) {
        r[a] = this.memory.read32((r[b] + Math.imul(r[c], 4) + imm) | 0, false);
      } else if (op === OP.STX) {
        this.memory.write32((r[b] + Math.imul(r[c], 4) + imm) | 0, r[a], "cpu");
      } else if (op === OP.ADD) {
        r[a] = (r[b] + r[c]) | 0;
      } else if (op === OP.ADDI) {
        r[a] = (r[b] + imm) | 0;
      } else if (op === OP.SUB) {
        r[a] = (r[b] - r[c]) | 0;
      } else if (op === OP.MUL) {
        r[a] = Math.imul(r[b], r[c]);
      } else if (op === OP.NEG) {
        r[a] = (-r[b]) | 0;
      } else if (op === OP.CMP) {
        thread.cmp = r[a] === r[b] ? 0 : r[a] < r[b] ? -1 : 1;
      } else if (op === OP.JMP) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JE && thread.cmp === 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JNE && thread.cmp !== 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JLT && thread.cmp < 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JLE && thread.cmp <= 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JGT && thread.cmp > 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JGE && thread.cmp >= 0) {
        thread.pc = imm; advance = false;
      } else if (op === OP.JE || op === OP.JNE || op === OP.JLT || op === OP.JLE || op === OP.JGT || op === OP.JGE) {
        // branch not taken
      } else if (op === OP.SYS) {
        var target = this.memory.read32(GOT_BASE + imm * 4, false);
        this.hle.invoke(target, thread, imm);
      } else if (op === OP.YIELD) {
        thread.pc++;
        thread.state = "waiting";
        thread.lastYield = "frame boundary";
        this.lastRegs.set(thread.regs);
        return { reason: "yield", executed: thread.instructionsFrame };
      } else if (op === OP.HALT) {
        thread.state = "halted";
        thread.lastYield = "halt";
        this.lastRegs.set(thread.regs);
        return { reason: "halt", executed: thread.instructionsFrame };
      } else {
        this.illegalInstructions++;
        throw new Error("illegal guest opcode 0x" + hex(op, 2) + " at 0x" + hex(addr));
      }

      r[15] = 0; // hard-wired zero register
      if (advance) thread.pc++;
    }
    thread.state = "ready";
    thread.lastYield = "timeslice exhausted";
    this.lastRegs.set(thread.regs);
    return { reason: "budget", executed: thread.instructionsFrame };
  };

  function Scheduler(cpu) {
    this.cpu = cpu;
    this.threads = [];
    this.switches = 0;
    this.frames = 0;
    this.lastResults = [];
  }
  Scheduler.prototype.add = function (thread) { this.threads.push(thread); };
  Scheduler.prototype.runFrame = function () {
    this.frames++;
    this.cpu.frameInstructions = 0;
    this.lastResults = [];
    for (var i = 0; i < this.threads.length; i++) {
      var thread = this.threads[i];
      if (thread.state === "halted") continue;
      thread.state = "ready";
      this.switches++;
      this.lastResults.push(this.cpu.run(thread, i === 0 ? 6000 : 256));
    }
  };

  /* ============================================================
     NID DATABASE + HLE
     ============================================================ */

  function HleRegistry(eventSink) {
    this.eventSink = eventSink;
    this.byId = {};
    this.byName = {};
    this.nextId = 1;
    this.calls = {};
    this.totalCalls = 0;
    this.lastCall = "—";
  }
  HleRegistry.prototype.register = function (name, fn) {
    var record = { id: this.nextId++, name: name, nid: makeNid(name), fn: fn };
    this.byId[record.id] = record;
    this.byName[name] = record;
    this.calls[name] = 0;
    return record;
  };
  HleRegistry.prototype.resolve = function (name) { return this.byName[name] || null; };
  HleRegistry.prototype.invoke = function (id, thread, slot) {
    var record = this.byId[id];
    if (!record) throw new Error("unresolved HLE target " + id + " from GOT slot " + slot);
    this.calls[record.name]++;
    this.totalCalls++;
    this.lastCall = record.name;
    record.fn(thread);
  };

  /* ============================================================
     VIRTUAL FILE SYSTEM, INPUT AND AUDIO DEVICES
     ============================================================ */

  function VirtualFileSystem() {
    this.mounts = [
      { guest: "/app0", host: "browser://game-package", mode: "R--" },
      { guest: "/savedata0", host: "localStorage://asteria", mode: "RW-" },
      { guest: "/temp0", host: "memory://temporary", mode: "RW-" }
    ];
    this.files = new Map();
    this.reads = 0;
    this.writes = 0;
    this.files.set("/app0/eboot.mexe", "[synthetic executable object]");
    this.files.set("/app0/sce_sys/param.json", JSON.stringify({ TITLE_ID: "ASTR00001", TITLE: "Signal Run" }));
    var saved = null;
    try { saved = localStorage.getItem("asteria.signal-run.save"); } catch (e) {}
    this.files.set("/savedata0/save.json", saved || JSON.stringify({ highScore: 0 }));
  }
  VirtualFileSystem.prototype.read = function (path) {
    this.reads++;
    if (!this.files.has(path)) throw new Error("VFS file not found: " + path);
    return this.files.get(path);
  };
  VirtualFileSystem.prototype.write = function (path, value) {
    this.writes++;
    this.files.set(path, String(value));
    if (path === "/savedata0/save.json") {
      try { localStorage.setItem("asteria.signal-run.save", String(value)); } catch (e) {}
    }
  };

  function InputDevice() {
    this.keys = new Set();
    this.touch = { up: false, down: false, left: false, right: false };
    this.samples = 0;
    this.gamepad = "not connected";
    var self = this;
    window.addEventListener("keydown", function (e) {
      var key = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].indexOf(key) >= 0) e.preventDefault();
      self.keys.add(key);
    });
    window.addEventListener("keyup", function (e) { self.keys.delete(e.key.toLowerCase()); });
    window.addEventListener("blur", function () { self.keys.clear(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-touch]"), function (button) {
      var dir = button.dataset.touch;
      function down(e) { e.preventDefault(); self.touch[dir] = true; }
      function up(e) { e.preventDefault(); self.touch[dir] = false; }
      button.addEventListener("pointerdown", down);
      button.addEventListener("pointerup", up);
      button.addEventListener("pointercancel", up);
      button.addEventListener("pointerleave", up);
    });
  }
  InputDevice.prototype.sample = function () {
    this.samples++;
    var left = this.keys.has("a") || this.keys.has("arrowleft") || this.touch.left;
    var right = this.keys.has("d") || this.keys.has("arrowright") || this.touch.right;
    var up = this.keys.has("w") || this.keys.has("arrowup") || this.touch.up;
    var down = this.keys.has("s") || this.keys.has("arrowdown") || this.touch.down;
    var x = (right ? 1 : 0) - (left ? 1 : 0);
    var y = (down ? 1 : 0) - (up ? 1 : 0);

    if (navigator.getGamepads) {
      var pads = navigator.getGamepads();
      var pad = pads && pads[0];
      if (pad) {
        this.gamepad = pad.id || "connected gamepad";
        var gx = Math.abs(pad.axes[0] || 0) > 0.18 ? pad.axes[0] : 0;
        var gy = Math.abs(pad.axes[1] || 0) > 0.18 ? pad.axes[1] : 0;
        if (Math.abs(gx) > Math.abs(x)) x = gx;
        if (Math.abs(gy) > Math.abs(y)) y = gy;
      }
    }
    if (x && y) { x *= 0.7071; y *= 0.7071; }
    return { x: Math.round(x * 70), y: Math.round(y * 70) };
  };

  function AudioDevice() {
    this.context = null;
    this.enabled = false;
    this.events = 0;
    this.lastTone = "—";
  }
  AudioDevice.prototype.enable = function () {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio is not available in this browser");
    if (!this.context) this.context = new Ctx();
    if (this.context.state === "suspended") this.context.resume();
    this.enabled = true;
  };
  AudioDevice.prototype.beep = function (frequency, duration, type, volume) {
    this.events++;
    this.lastTone = frequency + " Hz";
    if (!this.enabled || !this.context) return;
    var now = this.context.currentTime;
    var osc = this.context.createOscillator();
    var gain = this.context.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume == null ? 0.05 : volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain); gain.connect(this.context.destination);
    osc.start(now); osc.stop(now + duration);
  };

  /* ============================================================
     PM4-LIKE COMMAND RING
     ============================================================ */

  var PKT = { CLEAR: 1, SET_PIPELINE: 2, SET_COLOR: 3, DRAW: 4, PRESENT: 5 };
  var PKT_NAME = { 1: "CLEAR", 2: "SET_PIPELINE", 3: "SET_COLOR", 4: "DRAW", 5: "PRESENT" };

  function CommandRing(memory) {
    this.memory = memory;
    this.wordCount = 0;
    this.packetCount = 0;
    this.lastWords = [];
  }
  CommandRing.prototype.reset = function () {
    this.wordCount = 0;
    this.packetCount = 0;
  };
  CommandRing.prototype.emit = function (opcode, payload) {
    payload = payload || [];
    if ((this.wordCount + payload.length + 1) * 4 >= RING_SIZE) throw new Error("guest GPU command ring overflow");
    var header = (opcode & 255) | ((payload.length & 255) << 8);
    this.memory.write32(RING_BASE + this.wordCount * 4, header, "cpu");
    this.wordCount++;
    for (var i = 0; i < payload.length; i++) {
      this.memory.write32(RING_BASE + this.wordCount * 4, payload[i], "cpu");
      this.wordCount++;
    }
    this.packetCount++;
  };
  CommandRing.prototype.snapshot = function () {
    this.lastWords = [];
    for (var i = 0; i < this.wordCount; i++) this.lastWords.push(this.memory.read32(RING_BASE + i * 4, false) >>> 0);
    return this.lastWords;
  };

  function packColor(r, g, b, a) {
    return ((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a == null ? 255 : a & 255);
  }
  function unpackColor(word) {
    return [((word >>> 24) & 255) / 255, ((word >>> 16) & 255) / 255, ((word >>> 8) & 255) / 255, (word & 255) / 255];
  }

  /* ============================================================
     WEBGL2 RENDERER
     Scene draws land in an offscreen guest render target. PRESENT
     samples it through a separate post-processing pipeline.
     ============================================================ */

  var PIPELINE_INFO = {
    1: { name: "player/triangle", shape: "triangle", blend: "alpha", variant: 1 },
    2: { name: "sentry/triangle", shape: "triangle", blend: "additive", variant: 2 },
    3: { name: "signal/circle", shape: "circle", blend: "additive", variant: 3 }
  };

  function WebGlRenderer(canvas, onEvent) {
    this.canvas = canvas;
    this.onEvent = onEvent;
    this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: false });
    this.fallback = !this.gl;
    this.ctx = null;
    this.pipelines = new Map();
    this.pipelineStats = {};
    this.currentPipeline = 0;
    this.currentPipelineObject = null;
    this.currentColor = [1, 1, 1, 1];
    this.drawCalls = 0;
    this.totalDrawCalls = 0;
    this.compiles = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.presentCount = 0;
    this.lastFrameMs = 0;
    this.lastCompiled = 0;
    this.tick = 0;

    if (this.fallback) {
      this.ctx = canvas.getContext("2d");
      if (!this.ctx) throw new Error("Neither WebGL2 nor Canvas 2D is available");
      return;
    }
    this.initializeGl();
  }

  WebGlRenderer.prototype.compileShader = function (type, source) {
    var gl = this.gl;
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("guest shader compile failed: " + message);
    }
    return shader;
  };

  WebGlRenderer.prototype.linkProgram = function (vsSource, fsSource) {
    var gl = this.gl;
    var vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    var fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    var program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("guest pipeline link failed: " + message);
    }
    return program;
  };

  WebGlRenderer.prototype.initializeGl = function () {
    var gl = this.gl;
    var self = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    function buffer(data) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return b;
    }
    this.geometry = {
      triangle: { buffer: buffer([0, -1, 0.866, 0.5, -0.866, 0.5]), mode: gl.TRIANGLES, count: 3 },
      circle: { buffer: null, mode: gl.TRIANGLE_FAN, count: 0 }
    };
    var circle = [0, 0];
    for (var i = 0; i <= 28; i++) {
      var angle = i / 28 * Math.PI * 2;
      circle.push(Math.cos(angle), Math.sin(angle));
    }
    this.geometry.circle.buffer = buffer(circle);
    this.geometry.circle.count = circle.length / 2;

    this.frameTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("guest render target is incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var postVS = "#version 300 es\n" +
      "precision highp float; out vec2 v_uv;\n" +
      "void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.0-1.0,0.0,1.0); }";
    var postFS = "#version 300 es\n" +
      "precision highp float; uniform sampler2D u_scene; uniform float u_tick; in vec2 v_uv; out vec4 outColor;\n" +
      "void main(){ vec2 uv=v_uv; float bend=0.018; vec2 cc=uv-0.5; uv+=cc*dot(cc,cc)*bend;\n" +
      "vec2 px=vec2(1.0/960.0,0.0); float r=texture(u_scene,uv+px*0.8).r; float g=texture(u_scene,uv).g; float b=texture(u_scene,uv-px*0.8).b;\n" +
      "vec3 col=vec3(r,g,b); float grid=(step(0.975,fract(uv.x*24.0))+step(0.982,fract(uv.y*13.5)))*0.018; col+=vec3(0.10,0.42,0.52)*grid;\n" +
      "float scan=0.965+0.035*sin(uv.y*540.0*3.14159); float vig=1.0-smoothstep(0.25,0.72,length(uv-0.5)); col*=scan*(0.78+0.22*vig);\n" +
      "col+=0.008*sin(vec3(0.0,2.0,4.0)+u_tick*0.03); outColor=vec4(col,1.0); }";
    this.postProgram = this.linkProgram(postVS, postFS);
    this.postScene = gl.getUniformLocation(this.postProgram, "u_scene");
    this.postTick = gl.getUniformLocation(this.postProgram, "u_tick");
    gl.useProgram(this.postProgram);
    gl.uniform1i(this.postScene, 0);
    gl.useProgram(null);
    self.onEvent("gpu", "WebGL2 device + offscreen render target created", "ok");
  };

  WebGlRenderer.prototype.getPipeline = function (id) {
    if (this.pipelines.has(id)) {
      this.cacheHits++;
      this.pipelineStats[id].hits++;
      return this.pipelines.get(id);
    }
    this.cacheMisses++;
    this.compiles++;
    this.lastCompiled = id;
    var info = PIPELINE_INFO[id];
    if (!info) throw new Error("unknown guest pipeline key " + id);

    if (this.fallback) {
      var fallback = { id: id, info: info };
      this.pipelines.set(id, fallback);
      this.pipelineStats[id] = { id: id, name: info.name, hits: 0, compiledAt: performance.now() };
      return fallback;
    }

    var variant = info.variant.toFixed(1);
    var vs = "#version 300 es\n" +
      "precision highp float; layout(location=0) in vec2 a_pos; uniform vec2 u_translate; uniform float u_size; uniform float u_rotation; uniform vec2 u_resolution;\n" +
      "void main(){ float c=cos(u_rotation),s=sin(u_rotation); vec2 p=mat2(c,-s,s,c)*(a_pos*u_size)+u_translate; vec2 clip=p/u_resolution*2.0-1.0; gl_Position=vec4(clip.x,-clip.y,0.0,1.0); }";
    var fs = "#version 300 es\n" +
      "precision highp float; uniform vec4 u_color; out vec4 outColor; const float VARIANT=" + variant + ";\n" +
      "void main(){ float energy=0.92+0.08*sin(VARIANT*1.71); outColor=vec4(u_color.rgb*energy,u_color.a); }";
    var program = this.linkProgram(vs, fs);
    var pipeline = {
      id: id, info: info, program: program,
      uTranslate: this.gl.getUniformLocation(program, "u_translate"),
      uSize: this.gl.getUniformLocation(program, "u_size"),
      uRotation: this.gl.getUniformLocation(program, "u_rotation"),
      uResolution: this.gl.getUniformLocation(program, "u_resolution"),
      uColor: this.gl.getUniformLocation(program, "u_color")
    };
    this.pipelines.set(id, pipeline);
    this.pipelineStats[id] = { id: id, name: info.name, hits: 0, compiledAt: performance.now() };
    this.onEvent("shader", "compiled guest pipeline " + info.name + " into WebGL program", "gpu");
    return pipeline;
  };

  WebGlRenderer.prototype.begin = function (color) {
    this.drawCalls = 0;
    if (this.fallback) {
      this.ctx.fillStyle = "rgb(" + Math.round(color[0] * 255) + "," + Math.round(color[1] * 255) + "," + Math.round(color[2] * 255) + ")";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(color[0], color[1], color[2], color[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  WebGlRenderer.prototype.bindPipeline = function (id) {
    this.currentPipeline = id;
    var pipeline = this.getPipeline(id);
    this.currentPipelineObject = pipeline;
    if (this.fallback) return;
    var gl = this.gl;
    gl.useProgram(pipeline.program);
    gl.enable(gl.BLEND);
    if (pipeline.info.blend === "additive") gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    var geom = this.geometry[pipeline.info.shape];
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pipeline.uResolution, this.canvas.width, this.canvas.height);
  };

  WebGlRenderer.prototype.setColor = function (color) { this.currentColor = color; };

  WebGlRenderer.prototype.draw = function (x, y, size, rotation) {
    var pipeline = this.currentPipelineObject || this.getPipeline(this.currentPipeline);
    this.drawCalls++;
    this.totalDrawCalls++;
    if (this.fallback) {
      var ctx = this.ctx;
      var c = this.currentColor;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.fillStyle = "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + c[3] + ")";
      ctx.beginPath();
      if (pipeline.info.shape === "circle") ctx.arc(0, 0, size, 0, Math.PI * 2);
      else { ctx.moveTo(0, -size); ctx.lineTo(size * 0.866, size * 0.5); ctx.lineTo(-size * 0.866, size * 0.5); ctx.closePath(); }
      ctx.fill(); ctx.restore();
      return;
    }
    var gl = this.gl;
    var geom = this.geometry[pipeline.info.shape];
    gl.useProgram(pipeline.program);
    gl.uniform2f(pipeline.uTranslate, x, y);
    gl.uniform1f(pipeline.uSize, size);
    gl.uniform1f(pipeline.uRotation, rotation);
    gl.uniform4fv(pipeline.uColor, this.currentColor);
    gl.drawArrays(geom.mode, 0, geom.count);
  };

  WebGlRenderer.prototype.flushPipelines = function () {
    var gl = this.gl;
    if (gl) {
      this.pipelines.forEach(function (pipeline) {
        if (pipeline.program) gl.deleteProgram(pipeline.program);
      });
    }
    this.pipelines.clear();
    this.pipelineStats = {};
    this.currentPipeline = 0;
    this.currentPipelineObject = null;
    this.lastCompiled = 0;
  };

  WebGlRenderer.prototype.present = function (tick) {
    var start = performance.now();
    this.tick = tick;
    this.presentCount++;
    if (!this.fallback) {
      var gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(this.postProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
      gl.uniform1f(this.postTick, tick);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.lastFrameMs = performance.now() - start;
  };

  /* ============================================================
     COMMAND PROCESSOR
     ============================================================ */

  function CommandProcessor(memory, renderer, pulse, eventSink) {
    this.memory = memory;
    this.renderer = renderer;
    this.pulse = pulse;
    this.eventSink = eventSink;
    this.registers = { pipeline: 0, color: 0xffffffff, drawIndex: 0, packetIndex: 0 };
    this.packetLog = [];
    this.packets = 0;
    this.draws = 0;
    this.unknown = 0;
    this.lastUpload = { pages: 0, bytes: 0 };
    this.routeStage = 0;
  }

  CommandProcessor.prototype.process = function (wordCount, tick) {
    this.packetLog = [];
    this.packets = 0;
    this.draws = 0;
    this.routeStage = 1;
    this.pulse("cpu");
    this.routeStage = 4;
    this.lastUpload = this.memory.uploadDirty();
    if (this.lastUpload.pages) this.pulse("upload");
    var cursor = 0;
    while (cursor < wordCount) {
      var start = cursor;
      var header = this.memory.read32(RING_BASE + cursor * 4, false) >>> 0;
      cursor++;
      var opcode = header & 255;
      var length = (header >>> 8) & 255;
      if (cursor + length > wordCount) throw new Error("PM4 packet overruns command ring at word " + start);
      var payload = [];
      for (var i = 0; i < length; i++) payload.push(this.memory.read32(RING_BASE + (cursor + i) * 4, false));
      cursor += length;
      this.packets++;
      this.registers.packetIndex = this.packets;
      this.packetLog.push({ at: start, opcode: opcode, name: PKT_NAME[opcode] || "UNKNOWN", length: length, header: header });

      if (opcode === PKT.CLEAR && length === 1) {
        this.routeStage = 2;
        this.renderer.begin(unpackColor(payload[0] >>> 0));
      } else if (opcode === PKT.SET_PIPELINE && length === 1) {
        this.routeStage = 3;
        this.registers.pipeline = payload[0];
        this.renderer.bindPipeline(payload[0]);
      } else if (opcode === PKT.SET_COLOR && length === 1) {
        this.registers.color = payload[0] >>> 0;
        this.renderer.setColor(unpackColor(payload[0] >>> 0));
      } else if (opcode === PKT.DRAW && length === 4) {
        this.routeStage = 5;
        this.pulse("gpu");
        this.registers.drawIndex++;
        this.draws++;
        this.renderer.draw(payload[0] / FIX, payload[1] / FIX, payload[2] / FIX, payload[3] / 10000);
      } else if (opcode === PKT.PRESENT && length === 0) {
        this.routeStage = 6;
        this.renderer.present(tick);
        this.pulse("flip");
      } else {
        this.unknown++;
        throw new Error("unknown or malformed PM4-like packet 0x" + hex(opcode, 2) + " length " + length);
      }
    }
    this.routeStage = 7;
  };

  /* ============================================================
     EMULATOR ORCHESTRATION
     ============================================================ */

  var BOOT_STAGES = [
    { name: "reserve VM", text: "reserve 0x00000000–0x001fffff guest address space" },
    { name: "open game", text: "mount /app0 and parse µEXE headers" },
    { name: "map ELF", text: "copy code, GOT, data, GPU ring and thread stacks" },
    { name: "resolve NIDs", text: "bind five imports to registered HLE targets" },
    { name: "protect", text: "apply RX/R/RW final segment protection" },
    { name: "threads", text: "create guest-main and vblank guest contexts" },
    { name: "graphics", text: "create WebGL device, render target and command processor" },
    { name: "entry", text: "jump to guest entry point and begin frame scheduling" }
  ];

  function Emulator() {
    this.memory = null;
    this.vfs = null;
    this.executable = null;
    this.hle = null;
    this.cpu = null;
    this.scheduler = null;
    this.input = new InputDevice();
    this.audio = new AudioDevice();
    this.ring = null;
    this.renderer = null;
    this.commandProcessor = null;
    this.running = false;
    this.booted = false;
    this.processAlive = false;
    this.faulted = false;
    this.injectPacketFault = false;
    this.faultStatus = "All invariants currently hold.";
    this.bootStage = -1;
    this.bootToken = 0;
    this.clockMultiplier = 1;
    this.frame = 0;
    this.highScore = 0;
    this.randomState = 0x6d2b79f5;
    this.events = [];
    this.boundary = { from: "host", to: "loader", text: "Power-on self-test.", kind: "BOOT" };
    this.pulses = { cpu: 0, upload: 0, gpu: 0, flip: 0 };
    this.frameTimes = [];
    this.lastFrameStart = 0;
    this.lastInput = { x: 0, y: 0 };
    this.uiLastRegs = new Int32Array(16);
  }

  Emulator.prototype.event = function (kind, text, level) {
    this.events.unshift({ frame: this.booted ? "f" + this.frame : "boot", kind: kind, text: text, level: level || "" });
    if (this.events.length > 100) this.events.length = 100;
    if (!this.booted) {
      var pre = $("be-boot-text");
      var lines = pre.textContent.split("\n").filter(Boolean);
      lines.push("[" + kind.toUpperCase() + "] " + text);
      pre.textContent = lines.slice(-9).join("\n");
    }
  };
  Emulator.prototype.setBoundary = function (from, to, text, kind) {
    this.boundary = { from: from, to: to, text: text, kind: kind || "LIVE" };
  };
  Emulator.prototype.pulse = function (name) { this.pulses[name] = performance.now(); };
  Emulator.prototype.random = function () {
    var x = this.randomState | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomState = x >>> 0;
    return (this.randomState >>> 0) / 4294967296;
  };
  Emulator.prototype.read = function (addr) { return this.memory.read32(addr, false); };
  Emulator.prototype.write = function (addr, value, source) { this.memory.write32(addr, value, source || "cpu"); };

  Emulator.prototype.spawnEntity = function (index, type, initial) {
    var margin = type === 0 ? 30 : 55;
    var x;
    var y;
    do {
      x = Math.round((margin + this.random() * (960 - margin * 2)) * FIX);
      y = Math.round((margin + this.random() * (540 - margin * 2)) * FIX);
    } while (Math.abs(x - 480 * FIX) < 130 * FIX && Math.abs(y - 270 * FIX) < 100 * FIX);
    var speed = type === 0 ? 19 + this.random() * 33 + this.frame * 0.004 : 5 + this.random() * 12;
    var angle = this.random() * Math.PI * 2;
    var force = initial ? "loader" : "cpu";
    this.memory.write32(ADDR.entityX + index * 4, x, force, !!initial);
    this.memory.write32(ADDR.entityY + index * 4, y, force, !!initial);
    this.memory.write32(ADDR.entityVX + index * 4, Math.round(Math.cos(angle) * speed), force, !!initial);
    this.memory.write32(ADDR.entityVY + index * 4, Math.round(Math.sin(angle) * speed), force, !!initial);
    this.memory.write32(ADDR.entityType + index * 4, type, force, !!initial);
    this.memory.write32(ADDR.entityActive + index * 4, 1, force, !!initial);
  };

  Emulator.prototype.initializeData = function () {
    var m = this.memory;
    m.write32(ADDR.playerX, 480 * FIX, "loader", true);
    m.write32(ADDR.playerY, 270 * FIX, "loader", true);
    m.write32(ADDR.inputX, 0, "loader", true);
    m.write32(ADDR.inputY, 0, "loader", true);
    m.write32(ADDR.score, 0, "loader", true);
    m.write32(ADDR.health, MAX_HEALTH, "loader", true);
    m.write32(ADDR.tick, 0, "loader", true);
    m.write32(ADDR.invulnerable, 0, "loader", true);
    m.write32(ADDR.entityCount, ENTITY_COUNT, "loader", true);
    for (var i = 0; i < ENTITY_COUNT; i++) this.spawnEntity(i, i < 15 ? 0 : 1, true);
  };

  Emulator.prototype.buildHle = function () {
    var self = this;
    var hle = new HleRegistry(function (kind, text, level) { self.event(kind, text, level); });

    hle.register("libInput.readState", function (thread) {
      var state = self.input.sample();
      self.lastInput = state;
      self.write(ADDR.inputX, state.x, "cpu");
      self.write(ADDR.inputY, state.y, "cpu");
      var inv = self.read(ADDR.invulnerable);
      if (inv > 0) self.write(ADDR.invulnerable, inv - 1, "cpu");
      thread.regs[0] = 0;
      self.pulse("cpu");
      self.setBoundary("host input", "guest memory", "Keyboard or gamepad state copied through the resolved input HLE import.", "HLE");
    });

    hle.register("libGame.collectSignal", function (thread) {
      var index = thread.regs[0] | 0;
      var score = self.read(ADDR.score) + 100;
      self.write(ADDR.score, score, "cpu");
      self.spawnEntity(index, 1, false);
      self.audio.beep(720 + (score % 500), 0.12, "sine", 0.045);
      self.event("HLE", "collectSignal(entity=" + index + ") → score " + score, "ok");
      if (score > self.highScore) {
        self.highScore = score;
        self.vfs.write("/savedata0/save.json", JSON.stringify({ highScore: score }));
        self.event("VFS", "wrote /savedata0/save.json through browser storage", "ok");
      }
      self.setBoundary("guest CPU", "HLE + VFS", "Collision branch called collectSignal; HLE respawned the entity and persisted the high score.", "HLE");
      thread.regs[0] = score;
    });

    hle.register("libGame.takeDamage", function (thread) {
      var index = thread.regs[0] | 0;
      var inv = self.read(ADDR.invulnerable);
      if (inv > 0) { thread.regs[0] = 0; return; }
      var health = Math.max(0, self.read(ADDR.health) - 1);
      self.write(ADDR.health, health, "cpu");
      self.write(ADDR.invulnerable, 70, "cpu");
      self.spawnEntity(index, 0, false);
      self.audio.beep(115, 0.28, "sawtooth", 0.06);
      self.event("FAULT", "sentry collision → guest integrity " + health + "/" + MAX_HEALTH, "fault");
      self.setBoundary("guest collision", "HLE damage", "The interpreted collision path crossed into a game service and updated guest memory.", "FAULT");
      if (health <= 0) {
        self.processAlive = false;
        self.running = false;
        self.event("KERNEL", "guest-main terminated with GAME_OVER", "fault");
      }
      thread.regs[0] = health;
    });

    hle.register("libAgc.submitFrame", function (thread) {
      self.buildGpuCommands();
      if (self.injectPacketFault) {
        self.injectPacketFault = false;
        self.memory.write32(RING_BASE, 0x000001fe, "debugger");
        self.faultStatus = "Injected opcode 0xfe into the live ring; the command processor rejected it.";
      }
      self.setBoundary("guest AGC", "command processor", self.ring.packetCount + " packets / " + self.ring.wordCount + " dwords submitted from guest memory.", "PM4");
      self.commandProcessor.process(self.ring.wordCount, self.read(ADDR.tick));
      self.ring.snapshot();
      self.event("GPU", self.commandProcessor.draws + " draws decoded; " + self.commandProcessor.lastUpload.pages + " dirty pages uploaded", "gpu");
      self.setBoundary("WebGL GPU", "video out", "Offscreen render target sampled by the presentation shader.", "FLIP");
      thread.regs[0] = self.commandProcessor.draws;
    });

    hle.register("libKernel.waitVblank", function (thread) {
      if (self.audio.enabled && self.frame % 45 === 0) {
        var note = [110, 146.8, 164.8, 220][Math.floor(self.frame / 45) % 4];
        self.audio.beep(note, 0.18, "triangle", 0.012);
      }
      thread.regs[0] = self.frame;
    });
    this.hle = hle;
  };

  Emulator.prototype.buildGpuCommands = function () {
    var m = this.memory;
    var ring = this.ring;
    var tick = m.read32(ADDR.tick, false);
    var inv = m.read32(ADDR.invulnerable, false);
    ring.reset();
    ring.emit(PKT.CLEAR, [packColor(3, 10, 18, 255)]);

    if (!(inv > 0 && Math.floor(inv / 5) % 2 === 0)) {
      ring.emit(PKT.SET_PIPELINE, [1]);
      ring.emit(PKT.SET_COLOR, [packColor(76, 214, 235, 245)]);
      var rotation = Math.atan2(this.lastInput.y, this.lastInput.x) + Math.PI / 2;
      if (!this.lastInput.x && !this.lastInput.y) rotation = tick * 0.018;
      ring.emit(PKT.DRAW, [m.read32(ADDR.playerX, false), m.read32(ADDR.playerY, false), 19 * FIX, Math.round(rotation * 10000)]);
    }

    ring.emit(PKT.SET_PIPELINE, [2]);
    ring.emit(PKT.SET_COLOR, [packColor(240, 78, 126, 205)]);
    for (var i = 0; i < ENTITY_COUNT; i++) {
      if (m.read32(ADDR.entityType + i * 4, false) !== 0 || !m.read32(ADDR.entityActive + i * 4, false)) continue;
      ring.emit(PKT.DRAW, [m.read32(ADDR.entityX + i * 4, false), m.read32(ADDR.entityY + i * 4, false), 13 * FIX, Math.round((tick * 0.013 + i * 0.73) * 10000)]);
    }

    ring.emit(PKT.SET_PIPELINE, [3]);
    ring.emit(PKT.SET_COLOR, [packColor(246, 190, 65, 220)]);
    for (var j = 0; j < ENTITY_COUNT; j++) {
      if (m.read32(ADDR.entityType + j * 4, false) !== 1 || !m.read32(ADDR.entityActive + j * 4, false)) continue;
      var pulse = 9 + Math.round((Math.sin(tick * 0.08 + j) + 1) * 2);
      ring.emit(PKT.DRAW, [m.read32(ADDR.entityX + j * 4, false), m.read32(ADDR.entityY + j * 4, false), pulse * FIX, 0]);
    }
    ring.emit(PKT.PRESENT, []);
  };

  Emulator.prototype.mapExecutable = function () {
    var self = this;
    this.executable.segments.forEach(function (seg) {
      self.memory.map(seg.addr, seg.size, PERM.R | PERM.W, seg.name, seg.kind);
    });
    this.memory.loadWords(CODE_BASE, this.executable.program.words);
    this.initializeData();
    this.event("LOADER", this.executable.program.instructions.length + " guest instructions copied into .text");
  };

  Emulator.prototype.resolveImports = function () {
    var self = this;
    this.executable.imports.forEach(function (imp) {
      var target = self.hle.resolve(imp.name);
      if (!target || target.nid !== imp.nid) throw new Error("unresolved NID " + imp.nid + " (" + imp.name + ")");
      imp.address = target.id;
      self.memory.write32(GOT_BASE + imp.slot * 4, target.id, "loader", true);
    });
    this.event("LINKER", this.executable.imports.length + " NIDs resolved and written into the GOT", "ok");
  };

  Emulator.prototype.applyProtection = function () {
    var self = this;
    this.executable.segments.forEach(function (seg) { self.memory.protect(seg.addr, seg.size, seg.finalPerm); });
    this.event("VM", ".text is RX, GOT is R, data/ring/stacks are RW", "ok");
  };

  Emulator.prototype.createThreads = function () {
    this.cpu = new GuestCpu(this.memory, this.hle, this.event.bind(this));
    this.scheduler = new Scheduler(this.cpu);
    this.scheduler.add(new GuestThread(1, "guest-main", this.executable.entry, STACK_BASE + PAGE_SIZE * 8 - 16));
    this.scheduler.add(new GuestThread(2, "vblank", this.executable.vblankEntry, STACK_BASE + PAGE_SIZE * 16 - 16));
    this.event("KERNEL", "guest-main and vblank contexts created with private stacks", "ok");
  };

  Emulator.prototype.createGraphics = function () {
    var self = this;
    this.renderer = new WebGlRenderer($("be-screen"), function (kind, text, level) { self.event(kind, text, level); });
    this.ring = new CommandRing(this.memory);
    this.commandProcessor = new CommandProcessor(this.memory, this.renderer, this.pulse.bind(this), this.event.bind(this));
    this.event("GPU", this.renderer.fallback ? "WebGL2 unavailable; Canvas 2D compatibility backend active" : "WebGL2 queues and pipeline cache ready", this.renderer.fallback ? "fault" : "ok");
  };

  Emulator.prototype.loadHighScore = function () {
    try { this.highScore = Math.max(0, JSON.parse(this.vfs.read("/savedata0/save.json")).highScore | 0); }
    catch (e) { this.highScore = 0; }
  };

  Emulator.prototype.coldBoot = function () {
    var self = this;
    var token = ++this.bootToken;
    this.running = false;
    this.booted = false;
    this.processAlive = false;
    this.faulted = false;
    this.injectPacketFault = false;
    this.faultStatus = "All invariants currently hold.";
    this.bootStage = -1;
    this.frame = 0;
    this.randomState = 0x6d2b79f5;
    this.events = [];
    this.boundary = { from: "host", to: "loader", text: "Power-on self-test.", kind: "BOOT" };
    this.frameTimes = [];
    this.memory = null; this.vfs = null; this.executable = null; this.hle = null;
    this.cpu = null; this.scheduler = null; this.ring = null; this.renderer = null; this.commandProcessor = null;
    $("be-boot-text").textContent = "power on self-test…";
    $("be-boot-screen").classList.remove("is-hidden");
    $("be-game-over").hidden = true;
    renderAll(true);

    var actions = [
      function () {
        self.memory = new GuestMemory(MEM_SIZE);
        self.event("VM", "reserved 2 MB / 512-page guest address space", "ok");
      },
      function () {
        self.vfs = new VirtualFileSystem();
        self.loadHighScore();
        self.executable = buildGameExecutable();
        self.event("VFS", "mounted /app0, /savedata0 and /temp0");
        self.event("ELF", "opened /app0/eboot.mexe (ASTERIA-R32 DYNEXEC)");
      },
      function () { self.mapExecutable(); },
      function () { self.buildHle(); self.resolveImports(); },
      function () { self.applyProtection(); },
      function () { self.createThreads(); },
      function () { self.createGraphics(); },
      function () {
        self.booted = true;
        self.processAlive = true;
        self.running = true;
        self.setBoundary("loader", "guest-main", "Entry PC loaded from the executable; native browser interpreter owns execution.", "RUN");
        self.event("EXEC", "jumped to guest entry at 0x" + hex(CODE_BASE), "ok");
        $("be-boot-screen").classList.add("is-hidden");
      }
    ];

    function next() {
      if (token !== self.bootToken) return;
      self.bootStage++;
      if (self.bootStage >= actions.length) { renderAll(true); return; }
      try {
        self.setBoundary(self.bootStage < 3 ? "host loader" : "Kyty-shaped runtime", BOOT_STAGES[self.bootStage].name, BOOT_STAGES[self.bootStage].text, "BOOT");
        actions[self.bootStage]();
        renderAll(true);
      } catch (error) {
        self.crash(error);
        return;
      }
      setTimeout(next, reduceMotion ? 20 : 180);
    }
    setTimeout(next, 30);
  };

  Emulator.prototype.crash = function (error) {
    this.running = false;
    this.processAlive = false;
    this.faulted = true;
    this.faultStatus = "FAULT: " + (error.message || String(error));
    this.event("CRASH", error.message || String(error), "fault");
    this.setBoundary("guest", "exception handler", error.message || String(error), "CRASH");
    $("be-game-over").hidden = false;
    $("be-game-over").querySelector("b").textContent = "GUEST EXCEPTION";
    $("be-game-over").querySelector("span").textContent = error.message || String(error);
    renderAll(true);
  };

  Emulator.prototype.runGuestFrame = function () {
    if (!this.booted || !this.running || !this.processAlive) return;
    var start = performance.now();
    try {
      this.frame++;
      this.scheduler.runFrame();
      var duration = performance.now() - start;
      this.frameTimes.push(duration);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
      if (!this.processAlive) {
        $("be-game-over").hidden = false;
        $("be-game-over").querySelector("b").textContent = "GUEST PROCESS TERMINATED";
        $("be-game-over").querySelector("span").textContent = "Integrity reached zero after " + this.frame + " guest frames. Cold reboot reloads every segment and resets the CPU.";
      }
    } catch (error) {
      this.crash(error);
    }
  };

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var emu = new Emulator();

  /* ============================================================
     DEBUGGER UI — reads the same objects used above
     ============================================================ */

  var pageEls = [];
  var registerEls = [];
  var ROUTE = ["guest store", "AGC packets", "decode", "dirty upload", "pipeline", "draw", "present"];

  function buildStaticUi() {
    var rail = $("be-boot-rail");
    BOOT_STAGES.forEach(function (stage) {
      rail.appendChild(make("div", "be-boot-step", stage.name));
    });

    var regs = $("be-registers");
    for (var i = 0; i < 16; i++) {
      var reg = make("div", "be-reg");
      reg.innerHTML = "<span>r" + i + "</span><code>0x00000000</code>";
      regs.appendChild(reg);
      registerEls.push(reg);
    }

    var pages = $("be-pages");
    for (var p = 0; p < PAGE_COUNT; p++) {
      var page = make("i", "be-page");
      page.title = "page " + p + " · uncommitted";
      pages.appendChild(page);
      pageEls.push(page);
    }

    var route = $("be-frame-route");
    ROUTE.forEach(function (name, r) {
      var node = make("div", "be-route-step", name);
      node.dataset.route = r + 1;
      route.appendChild(node);
    });
  }

  function renderBoot() {
    Array.prototype.forEach.call($("be-boot-rail").children, function (node, i) {
      node.classList.toggle("is-done", i < emu.bootStage || emu.booted);
      node.classList.toggle("is-current", !emu.booted && i === emu.bootStage);
    });
  }

  function renderChrome() {
    root.classList.toggle("is-running", emu.running && emu.processAlive);
    root.classList.toggle("is-faulted", emu.faulted || (emu.booted && !emu.processAlive));
    var status = !emu.booted ? (emu.faulted ? "boot fault" : "loading executable · stage " + Math.max(1, emu.bootStage + 1))
      : !emu.processAlive ? "guest process terminated"
      : emu.running ? "guest-main running · frame " + emu.frame
      : "guest scheduler paused · frame " + emu.frame;
    $("be-status-sub").textContent = status;
    $("be-run").textContent = emu.running ? "Pause" : emu.processAlive ? "Resume" : "Stopped";
    $("be-run").disabled = !emu.booted || !emu.processAlive;
    $("be-step").disabled = !emu.booted || !emu.processAlive;
    $("be-sound").textContent = emu.audio.enabled ? "Sound enabled" : "Enable sound";
    $("be-live-badge").textContent = emu.boundary.kind;
  }

  function renderHud() {
    var score = emu.memory && emu.booted ? emu.read(ADDR.score) : 0;
    var health = emu.memory && emu.booted ? emu.read(ADDR.health) : MAX_HEALTH;
    $("be-score").textContent = String(Math.max(0, score)).padStart(6, "0");
    $("be-high").textContent = String(Math.max(0, emu.highScore)).padStart(6, "0");
    var host = $("be-health");
    host.innerHTML = "";
    for (var i = 0; i < MAX_HEALTH; i++) host.appendChild(make("i", i < health ? "" : "is-empty"));
  }

  function renderBoundary() {
    $("be-boundary-from").textContent = emu.boundary.from;
    $("be-boundary-to").textContent = emu.boundary.to;
    $("be-boundary-text").textContent = emu.boundary.text;
    var now = performance.now();
    ["cpu", "upload", "gpu", "flip"].forEach(function (name) {
      $("be-" + name + "-light").classList.toggle("is-active", now - emu.pulses[name] < 180);
    });
  }

  function average(list) {
    if (!list || !list.length) return 0;
    return list.reduce(function (sum, n) { return sum + n; }, 0) / list.length;
  }

  function renderLiveMetrics() {
    var renderer = emu.renderer;
    var memory = emu.memory;
    var cpu = emu.cpu;
    var dirty = memory ? memory.pages.filter(function (p) { return p.dirty; }).length : 0;
    var values = [
      ["GUEST FRAME", emu.booted ? emu.frame : "—"],
      ["CPU / FRAME", cpu ? cpu.frameInstructions : "—"],
      ["GUEST PC", cpu ? "0x" + hex(CODE_BASE + cpu.lastPc * 8) : "—"],
      ["HLE CALLS", emu.hle ? emu.hle.totalCalls : "—"],
      ["DIRTY PAGES", dirty],
      ["DRAW CALLS", renderer ? renderer.drawCalls : "—"],
      ["PIPELINES", renderer ? renderer.pipelines.size : "—"],
      ["HOST FRAME", emu.frameTimes.length ? fmt(average(emu.frameTimes), 2) + " ms" : "—"],
      ["AUDIO", emu.audio.enabled ? "active" : "muted"]
    ];
    var host = $("be-live-metrics");
    host.innerHTML = "";
    values.forEach(function (v) {
      var card = make("div", "be-live-metric");
      card.innerHTML = "<span>" + v[0] + "</span><b>" + v[1] + "</b>";
      host.appendChild(card);
    });
  }

  function decodeMemoryInstruction(pc) {
    if (!emu.memory || !emu.executable || pc < 0 || pc >= emu.executable.program.instructions.length) return null;
    try {
      var addr = CODE_BASE + pc * 8;
      var word = emu.memory.peek32(addr) >>> 0;
      var imm = emu.memory.peek32(addr + 4) | 0;
      var op = word & 255, a = word >>> 8 & 255, b = word >>> 16 & 255, c = word >>> 24 & 255;
      return { pc: pc, addr: addr, word: word, imm: imm, op: op, a: a, b: b, c: c, text: disassemble(op, a, b, c, imm) };
    } catch (e) { return null; }
  }

  function renderMiniDisassembly() {
    var host = $("be-mini-disasm");
    host.innerHTML = "";
    if (!emu.cpu || !emu.cpu.recent.length) {
      var empty = make("li");
      empty.innerHTML = "<span>—</span><code>waiting for guest entry</code>";
      host.appendChild(empty);
      return;
    }
    emu.cpu.recent.slice(0, 7).forEach(function (trace, i) {
      var li = make("li", i === 0 ? "is-pc" : "");
      li.innerHTML = "<span>" + trace.thread.replace("guest-", "") + "</span><code>" + disassemble(trace.op, trace.a, trace.b, trace.c, trace.imm) + "</code>";
      host.appendChild(li);
    });
  }

  function renderEventLog() {
    var host = $("be-event-log");
    host.innerHTML = "";
    if (!emu.events.length) {
      var empty = make("li");
      empty.innerHTML = "<time>—</time><em>POST</em><span>waiting for power-on</span>";
      host.appendChild(empty);
      return;
    }
    emu.events.slice(0, 28).forEach(function (entry) {
      var li = make("li", entry.level || "");
      li.innerHTML = "<time>" + entry.frame + "</time><em>" + entry.kind + "</em><span>" + entry.text + "</span>";
      host.appendChild(li);
    });
  }

  function renderRegisters() {
    var thread = emu.scheduler && emu.scheduler.threads[0];
    var regs = thread ? thread.regs : new Int32Array(16);
    registerEls.forEach(function (node, i) {
      node.querySelector("code").textContent = "0x" + hex(regs[i]);
      node.classList.toggle("is-changed", regs[i] !== emu.uiLastRegs[i]);
    });
    emu.uiLastRegs.set(regs);
  }

  function renderThreads() {
    var host = $("be-thread-list");
    host.innerHTML = "";
    if (!emu.scheduler) {
      host.appendChild(make("div", "be-thread", "No guest threads before loader entry."));
      return;
    }
    var max = Math.max.apply(Math, emu.scheduler.threads.map(function (t) { return t.instructionsFrame || 1; }));
    emu.scheduler.threads.forEach(function (thread) {
      var row = make("div", "be-thread");
      row.style.setProperty("--thread-load", Math.max(4, thread.instructionsFrame / max * 100) + "%");
      row.innerHTML = "<b>" + thread.name + "</b><span>" + thread.state + "</span><small>PC 0x" + hex(CODE_BASE + thread.pc * 8) + " · " + thread.instructionsFrame + " insn/frame</small><i></i>";
      host.appendChild(row);
    });
  }

  function renderFullDisassembly() {
    var host = $("be-disassembly");
    host.innerHTML = "";
    if (!emu.executable || !emu.memory) {
      host.textContent = "Executable not mapped yet.";
      return;
    }
    var currentPc = emu.scheduler ? emu.scheduler.threads[0].pc : -1;
    var count = emu.executable.program.instructions.length;
    for (var pc = 0; pc < count; pc++) {
      var insn = decodeMemoryInstruction(pc);
      if (!insn) continue;
      var row = make("div", "be-insn" + (pc === currentPc ? " is-pc" : ""));
      row.innerHTML = "<span>0x" + hex(insn.addr) + "</span><code>" + hex(insn.word) + " " + hex(insn.imm) + "</code><code>" + insn.text + "</code>";
      host.appendChild(row);
    }
    var active = host.querySelector(".is-pc");
    if (active) active.scrollIntoView({ block: "center" });
  }

  function dlPair(host, name, value) {
    host.appendChild(make("dt", "", name));
    host.appendChild(make("dd", "", value));
  }

  function renderCpuStats() {
    var host = $("be-cpu-stats"); host.innerHTML = "";
    dlPair(host, "ISA", "ASTERIA-R32 · 8-byte instructions");
    dlPair(host, "instructions total", emu.cpu ? emu.cpu.totalInstructions.toLocaleString() : "—");
    dlPair(host, "instructions last frame", emu.cpu ? emu.cpu.frameInstructions : "—");
    dlPair(host, "context switches", emu.scheduler ? emu.scheduler.switches.toLocaleString() : "—");
    dlPair(host, "illegal opcodes", emu.cpu ? emu.cpu.illegalInstructions : "—");
    dlPair(host, "average host cost", emu.frameTimes.length ? fmt(average(emu.frameTimes), 3) + " ms" : "—");
  }

  function renderMemoryMap() {
    var host = $("be-memory-map"); host.innerHTML = "";
    if (!emu.memory || !emu.memory.maps.length) {
      host.textContent = "No committed mappings.";
      return;
    }
    emu.memory.maps.forEach(function (map) {
      var row = make("div", "be-map-row " + map.kind);
      row.innerHTML = "<code>0x" + hex(map.addr) + "</code><b>" + map.label + "</b><span>" + permText(map.perm) + "</span><small>" + Math.ceil(map.size / 1024) + " KB</small>";
      host.appendChild(row);
    });
  }

  function renderPages() {
    pageEls.forEach(function (node, i) {
      var page = emu.memory ? emu.memory.pages[i] : null;
      node.className = "be-page";
      if (page && page.committed) {
        if (page.perm & PERM.X) node.classList.add("rx");
        else node.classList.add("rw");
        if (page.dirty) node.classList.add("dirty");
        if (page.gpuCurrent) node.classList.add("gpu");
        node.title = "page " + i + " · " + page.label + " · " + permText(page.perm) + (page.dirty ? " · dirty" : "");
      } else node.title = "page " + i + " · uncommitted";
    });
  }

  function renderHexdump() {
    var host = $("be-hexdump");
    if (!emu.memory || !emu.booted) { host.textContent = "data segment unavailable"; return; }
    var lines = ["address     +0        +4        +8        +c       interpretation"];
    for (var row = 0; row < 8; row++) {
      var index = row * 2;
      var addr = ADDR.entityX + index * 4;
      var words = [
        emu.read(ADDR.entityX + index * 4), emu.read(ADDR.entityY + index * 4),
        emu.read(ADDR.entityVX + index * 4), emu.read(ADDR.entityVY + index * 4)
      ];
      lines.push("0x" + hex(addr) + "  " + words.map(function (w) { return hex(w); }).join("  ") + "  entity[" + index + "] x/y/vx/vy");
    }
    host.textContent = lines.join("\n");
  }

  function renderMemoryStats() {
    var host = $("be-memory-stats"); host.innerHTML = "";
    var s = emu.memory ? emu.memory.stats : {};
    dlPair(host, "guest reads", (s.reads || 0).toLocaleString());
    dlPair(host, "guest writes", (s.writes || 0).toLocaleString());
    dlPair(host, "address faults", s.faults || 0);
    dlPair(host, "write-watch faults", s.protectionFaults || 0);
    dlPair(host, "uploaded total", fmt((s.uploadedBytes || 0) / 1048576, 2) + " MB");
    dlPair(host, "last upload", emu.commandProcessor ? emu.commandProcessor.lastUpload.pages + " pages / " + (emu.commandProcessor.lastUpload.bytes / 1024) + " KB" : "—");
  }

  function renderExecutable() {
    var info = $("be-elf-info"); info.innerHTML = "";
    var x = emu.executable;
    dlPair(info, "magic", x ? x.magic : "—");
    dlPair(info, "machine", x ? x.machine : "—");
    dlPair(info, "type", x ? x.type : "—");
    dlPair(info, "entry", x ? "0x" + hex(CODE_BASE + x.entry * 8) : "—");
    dlPair(info, "instruction count", x ? x.program.instructions.length : "—");
    dlPair(info, "imports", x ? x.imports.length : "—");
    var segments = $("be-segments"); segments.innerHTML = "";
    if (x) x.segments.forEach(function (seg) {
      var row = make("div", "be-segment");
      row.innerHTML = "<b>" + seg.name + "</b><code>0x" + hex(seg.addr) + " + " + seg.size + "</code><span>" + permText(seg.finalPerm) + "</span>";
      segments.appendChild(row);
    });
  }

  function renderImports() {
    var host = $("be-imports"); host.innerHTML = "";
    if (!emu.executable) { host.textContent = "Dynamic table not parsed."; return; }
    emu.executable.imports.forEach(function (imp) {
      var row = make("div", "be-import");
      row.innerHTML = "<b>" + imp.name + "</b><code>" + imp.nid + "</code><span>GOT+" + (imp.slot * 4) + " → " + (imp.address || "—") + "</span>";
      host.appendChild(row);
    });
  }

  function renderVfs() {
    var host = $("be-vfs"); host.innerHTML = "";
    if (!emu.vfs) { host.textContent = "Filesystem lifecycle not initialised."; return; }
    emu.vfs.mounts.forEach(function (mount) {
      var row = make("div", "be-file");
      row.innerHTML = "<code>" + mount.guest + " → " + mount.host + "</code><span>" + mount.mode + "</span>";
      host.appendChild(row);
    });
    emu.vfs.files.forEach(function (value, path) {
      var row = make("div", "be-file");
      row.innerHTML = "<code>" + path + "</code><span>" + String(value).length + " bytes</span>";
      host.appendChild(row);
    });
  }

  function renderHleProfile() {
    var host = $("be-hle-profile"); host.innerHTML = "";
    if (!emu.hle) { host.textContent = "HLE symbol database is empty."; return; }
    var names = Object.keys(emu.hle.calls);
    var max = Math.max.apply(Math, names.map(function (n) { return emu.hle.calls[n]; }).concat([1]));
    names.forEach(function (name) {
      var count = emu.hle.calls[name];
      var row = make("div", "be-hle-row");
      row.style.setProperty("--hle-load", count / max * 100 + "%");
      row.innerHTML = "<code>" + name + "</code><span>" + count.toLocaleString() + " calls</span><i></i>";
      host.appendChild(row);
    });
  }

  function renderRing() {
    var summary = $("be-ring-summary");
    var host = $("be-ring-words"); host.innerHTML = "";
    if (!emu.ring || !emu.ring.lastWords.length) {
      summary.textContent = "No command buffer has been submitted.";
      return;
    }
    summary.textContent = emu.ring.packetCount + " packets · " + emu.ring.wordCount + " dwords · " + (emu.ring.wordCount * 4) + " bytes · read pointer caught write pointer";
    var headerAt = {};
    if (emu.commandProcessor) emu.commandProcessor.packetLog.forEach(function (packet) { headerAt[packet.at] = packet; });
    emu.ring.lastWords.slice(0, 168).forEach(function (word, i) {
      var packet = headerAt[i];
      var cls = "be-ring-word";
      if (packet) cls += " header" + (packet.opcode === PKT.DRAW ? " draw" : packet.opcode === PKT.PRESENT ? " present" : "");
      var node = make("div", cls, hex(word, 8));
      node.title = packet ? "word " + i + " · " + packet.name + " · payload " + packet.length : "word " + i + " · payload";
      host.appendChild(node);
    });
  }

  function renderGpuRegisters() {
    var host = $("be-gpu-registers"); host.innerHTML = "";
    var cp = emu.commandProcessor;
    dlPair(host, "pipeline key", cp ? cp.registers.pipeline : "—");
    dlPair(host, "packed color", cp ? "0x" + hex(cp.registers.color) : "—");
    dlPair(host, "packets decoded", cp ? cp.packets : "—");
    dlPair(host, "draw index", cp ? cp.registers.drawIndex.toLocaleString() : "—");
    dlPair(host, "unknown packets", cp ? cp.unknown : "—");
  }

  function renderPipelines() {
    var host = $("be-pipelines"); host.innerHTML = "";
    if (!emu.renderer || !emu.renderer.pipelines.size) {
      host.textContent = "Pipeline cache is cold. The first guest frame will compile programs.";
      return;
    }
    emu.renderer.pipelines.forEach(function (pipeline, id) {
      var stat = emu.renderer.pipelineStats[id];
      var node = make("div", "be-pipeline" + (emu.renderer.lastCompiled === id && performance.now() - stat.compiledAt < 1400 ? " is-new" : ""));
      node.innerHTML = "<b>key " + id + " · " + stat.name + "</b><span>linked · " + stat.hits.toLocaleString() + " cache hits</span>";
      host.appendChild(node);
    });
  }

  function renderFrameRoute() {
    var stage = emu.commandProcessor ? emu.commandProcessor.routeStage : 0;
    Array.prototype.forEach.call($("be-frame-route").children, function (node, i) {
      node.classList.toggle("is-active", i + 1 === stage);
      node.classList.toggle("is-done", i + 1 < stage || stage === 7);
    });
  }

  function renderGpuStats() {
    var host = $("be-gpu-stats"); host.innerHTML = "";
    var r = emu.renderer;
    dlPair(host, "backend", r ? (r.fallback ? "Canvas 2D fallback" : "WebGL2") : "—");
    dlPair(host, "draws this frame", r ? r.drawCalls : "—");
    dlPair(host, "draws total", r ? r.totalDrawCalls.toLocaleString() : "—");
    dlPair(host, "pipeline compiles", r ? r.compiles : "—");
    dlPair(host, "cache hits / misses", r ? r.cacheHits.toLocaleString() + " / " + r.cacheMisses : "—");
    dlPair(host, "present count", r ? r.presentCount.toLocaleString() : "—");
    dlPair(host, "post-process cost", r ? fmt(r.lastFrameMs, 3) + " ms" : "—");
  }

  function renderFaultLab() {
    var status = $("be-fault-status");
    status.textContent = emu.faultStatus;
    status.classList.toggle("is-armed", emu.injectPacketFault);
    status.classList.toggle("is-fault", emu.faulted);
    $("be-flush-pipelines").disabled = !emu.booted || !emu.renderer;
    $("be-corrupt-pm4").disabled = !emu.booted || !emu.processAlive || emu.injectPacketFault;
    $("be-write-rx").disabled = !emu.booted || !emu.processAlive;
  }

  function renderAll(force) {
    renderBoot();
    renderChrome();
    renderHud();
    renderBoundary();
    renderLiveMetrics();
    renderMiniDisassembly();
    renderEventLog();
    renderRegisters();
    renderThreads();
    renderCpuStats();
    renderMemoryMap();
    renderPages();
    renderMemoryStats();
    renderExecutable();
    renderImports();
    renderVfs();
    renderHleProfile();
    renderRing();
    renderGpuRegisters();
    renderPipelines();
    renderFrameRoute();
    renderGpuStats();
    renderFaultLab();
    if (force || !renderAll.disassemblyDrawn || (emu.booted && renderAll.disassemblyVersion !== emu.bootToken)) {
      renderFullDisassembly();
      renderAll.disassemblyDrawn = true;
      renderAll.disassemblyVersion = emu.bootToken;
    } else if (emu.booted) {
      var current = $("be-disassembly").querySelector(".is-pc");
      if (current) current.classList.remove("is-pc");
      var main = emu.scheduler && emu.scheduler.threads[0];
      if (main) {
        var rows = $("be-disassembly").children;
        if (rows[main.pc]) rows[main.pc].classList.add("is-pc");
      }
    }
  }

  /* ============================================================
     CONTROLS + MAIN CLOCK
     ============================================================ */

  $("be-run").addEventListener("click", function () {
    if (!emu.booted || !emu.processAlive) return;
    emu.running = !emu.running;
    emu.event("KERNEL", emu.running ? "guest scheduler resumed" : "guest scheduler paused");
    renderAll(false);
  });

  $("be-step").addEventListener("click", function () {
    if (!emu.booted || !emu.processAlive) return;
    emu.running = true;
    emu.runGuestFrame();
    emu.running = false;
    emu.event("DEBUG", "single guest frame executed");
    renderAll(false);
  });

  $("be-reset").addEventListener("click", function () { emu.coldBoot(); });
  $("be-restart-game").addEventListener("click", function () { emu.coldBoot(); });
  $("be-sound").addEventListener("click", function () {
    try {
      emu.audio.enable();
      emu.audio.beep(440, 0.08, "sine", 0.035);
      emu.event("AUDIO", "Web Audio device opened after user gesture", "ok");
    } catch (error) { emu.event("AUDIO", error.message, "fault"); }
    renderAll(false);
  });
  $("be-speed").addEventListener("change", function () { emu.clockMultiplier = parseFloat(this.value) || 1; });
  $("be-clear-log").addEventListener("click", function () { emu.events = []; renderEventLog(); });

  $("be-flush-pipelines").addEventListener("click", function () {
    if (!emu.renderer) return;
    var count = emu.renderer.pipelines.size;
    emu.renderer.flushPipelines();
    emu.faultStatus = "Pipeline cache flushed: " + count + " WebGL programs evicted. The next frame must rebuild them.";
    emu.event("GPU", "debugger evicted " + count + " cached guest pipelines", "gpu");
    renderAll(false);
  });

  $("be-corrupt-pm4").addEventListener("click", function () {
    if (!emu.booted || !emu.processAlive) return;
    emu.injectPacketFault = true;
    emu.faultStatus = "Armed: the next AGC submission will replace CLEAR with unknown opcode 0xfe.";
    emu.event("DEBUG", "PM4 corruption armed for the next guest frame", "fault");
    renderAll(false);
  });

  $("be-write-rx").addEventListener("click", function () {
    if (!emu.memory || !emu.processAlive) return;
    try {
      emu.memory.write32(CODE_BASE, 0, "debugger");
    } catch (error) {
      emu.crash(error);
    }
  });

  window.addEventListener("keydown", function (e) {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === "p") {
      e.preventDefault();
      $("be-run").click();
    } else if (e.key.toLowerCase() === "n") {
      e.preventDefault();
      $("be-step").click();
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-be-tab]"), function (button) {
    button.addEventListener("click", function () {
      var tab = button.dataset.beTab;
      Array.prototype.forEach.call(document.querySelectorAll("[data-be-tab]"), function (b) { b.setAttribute("aria-selected", b === button ? "true" : "false"); });
      ["cpu", "memory", "loader", "gpu"].forEach(function (name) { $("be-panel-" + name).hidden = name !== tab; });
      if (tab === "cpu") setTimeout(renderFullDisassembly, 0);
    });
  });

  var accumulator = 0;
  var previousTime = 0;
  var lastUi = 0;
  function clock(time) {
    if (!previousTime) previousTime = time;
    var dt = Math.min(100, time - previousTime);
    previousTime = time;
    if (emu.running && emu.booted && emu.processAlive) {
      accumulator += dt;
      var interval = 1000 / 60 / emu.clockMultiplier;
      var frames = 0;
      while (accumulator >= interval && frames < 8) {
        emu.runGuestFrame();
        accumulator -= interval;
        frames++;
      }
    } else accumulator = 0;
    if (time - lastUi > 100) {
      renderAll(false);
      lastUi = time;
    }
    window.requestAnimationFrame(clock);
  }

  buildStaticUi();
  renderAll(true);
  emu.coldBoot();
  window.requestAnimationFrame(clock);

  window.BROWSER_EMULATOR = {
    emulator: emu,
    constants: { memorySize: MEM_SIZE, pageSize: PAGE_SIZE, maxHealth: MAX_HEALTH, addresses: ADDR, opcodes: OP, packets: PKT },
    reboot: function () { emu.coldBoot(); },
    step: function () { $("be-step").click(); },
    pause: function () { if (emu.running) $("be-run").click(); }
  };
})();
