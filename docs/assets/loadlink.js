(function () {
  "use strict";
  var mount = document.getElementById("loadlink");
  if (!mount) return;
  var SVGNS = "http://www.w3.org/2000/svg";
  function e(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (kids != null) { if (Array.isArray(kids)) kids.forEach(function (c) { if (c) n.appendChild(c); }); else n.textContent = kids; }
    return n;
  }
  function nid(name) {
    var h = 2166136261, a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-";
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    var s = "", x = h >>> 0;
    for (var k = 0; k < 11; k++) { s += a[x & 63]; x = (x >>> 6) ^ (h << (k % 5)); }
    return s;
  }

  /* ---- the imports this fake module needs, and the libraries that satisfy them ---- */
  var IMPORTS = [
    { name: "sceKernelAllocateDirectMemory", lib: "libkernel", addr: "00A1B2C0" },
    { name: "sceKernelCreateThread", lib: "libkernel", addr: "00A1B310" },
    { name: "sceGnmSubmitCommandBuffers", lib: "libSceGnmDriver", addr: "00B40120" },
    { name: "sceAudioOutOutput", lib: "libSceAudioOut", addr: "00C21040" },
    { name: "sceVideoOutSubmitFlip", lib: "libSceVideoOut", addr: "00D02080" },
    { name: "sceNpCheckPlus", lib: "libSceNp", addr: null }   // unimplemented → thunk
  ];
  IMPORTS.forEach(function (im) { im.nid = nid(im.name + "#" + im.lib); });
  var LIBS = [
    { name: "libkernel", file: "libKernel.cpp", exp: ["sceKernelAllocateDirectMemory", "sceKernelCreateThread", "sceKernelMapDirectMemory"] },
    { name: "libc", file: "libc.cpp", exp: ["malloc", "memcpy", "printf"] },
    { name: "libSceGnmDriver", file: "graphics/…/agc.cpp", exp: ["sceGnmSubmitCommandBuffers", "sceGnmDrawIndex"] },
    { name: "libSceAudioOut", file: "audioOut.cpp", exp: ["sceAudioOutOutput", "sceAudioOutOpen"] },
    { name: "libSceVideoOut", file: "videoOut.cpp", exp: ["sceVideoOutSubmitFlip", "sceVideoOutOpen"] },
    { name: "libSceNp", file: "libNp.cpp (partial)", exp: ["sceNpGetState"] }
  ];

  var C = { line: "#273446", line2: "#3a4b61", ink: "#eaf0f5", ink2: "#b2bfca", ink3: "#718092", c: "#55c5de", a: "#f0b849", k: "#ec668b", g: "#75d49a", p: "#101722", p2: "#161f2c" };

  /* ---- node frames (viewBox 1240 x 720) ---- */
  var NODES = {
    file: { x: 22, y: 52, w: 248, h: 618, t: "eboot.bin", s: "SELF → ELF module" },
    linker: { x: 316, y: 52, w: 236, h: 150, t: "Runtime linker", s: "loader/runtimeLinker.cpp" },
    threads: { x: 316, y: 238, w: 236, h: 190, t: "Threads", s: "kernel/pthread.cpp" },
    game: { x: 316, y: 466, w: 236, h: 204, t: "Running game", s: "native guest code" },
    space: { x: 598, y: 52, w: 306, h: 376, t: "Guest address space", s: "kernel/memory.cpp" },
    got: { x: 598, y: 466, w: 306, h: 204, t: "GOT · import table", s: "one slot per import" },
    libs: { x: 940, y: 52, w: 278, h: 618, t: "HLE libraries", s: "symbol database" }
  };
  var WIRES = {
    parse: { d: "M270,116 H316", lab: "parse", lx: 293, ly: 108 },
    map: { d: "M552,112 H598", lab: "reserve · map · protect", lx: 575, ly: 104 },
    reg: { d: "M552,84 C740,84 800,96 940,110", lab: "register exports", lx: 720, ly: 74 },
    imports: { d: "M270,520 C420,520 470,540 598,556", lab: "imports (NIDs)", lx: 400, ly: 532 },
    resolve: { d: "M940,560 H904", lab: "native addr", lx: 922, ly: 552 },
    create: { d: "M434,202 V238", lab: "create", lx: 446, ly: 222 },
    entry: { d: "M434,428 V466", lab: "jmp e_entry", lx: 468, ly: 450 },
    call: { d: "M552,556 C570,556 582,572 598,578", lab: "call [GOT+n]", lx: 556, ly: 596 },
    jump: { d: "M904,520 C980,520 980,470 940,430", lab: "→ native fn", lx: 968, ly: 500 },
    ret: { d: "M940,470 C700,470 700,600 552,600", lab: "return", lx: 720, ly: 618 }
  };

  var svg = e("svg", { viewBox: "0 0 1240 720", class: "ll-svg", role: "img", "aria-label": "How a game loads and links" });
  var defs = e("defs");
  ["m-line", "m-on"].forEach(function (id) {
    defs.appendChild(e("marker", { id: id, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
      [e("path", { d: "M0,0 L10,5 L0,10 z", fill: id === "m-on" ? C.c : C.line2 })]));
  });
  svg.appendChild(defs);

  // wires first (under nodes)
  var wireEls = {};
  Object.keys(WIRES).forEach(function (id) {
    var w = WIRES[id];
    var path = e("path", { d: w.d, class: "ll-wire", fill: "none", "marker-end": "url(#m-line)" });
    var lab = e("text", { x: w.lx, y: w.ly, class: "ll-wire-lab" }, w.lab);
    var grp = e("g", { class: "ll-wg", "data-w": id }, [path, lab]);
    svg.appendChild(grp);
    wireEls[id] = { grp: grp, path: path };
  });

  // node frames + a body group we refill each step
  var bodyEls = {};
  Object.keys(NODES).forEach(function (id) {
    var n = NODES[id];
    var g = e("g", { class: "ll-node", "data-n": id });
    g.appendChild(e("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 10, class: "ll-frame" }));
    g.appendChild(e("text", { x: n.x + 12, y: n.y + 22, class: "ll-title" }, n.t));
    g.appendChild(e("text", { x: n.x + 12, y: n.y + 38, class: "ll-sub" }, n.s));
    var body = e("g", { class: "ll-body" });
    g.appendChild(body);
    svg.appendChild(g);
    bodyEls[id] = body;
    g.addEventListener("click", function () { focusNode(id); });
  });
  mount.appendChild(svg);

  /* ---- helpers to fill node bodies ---- */
  function row(x, y, w, label, val, cls) {
    var g = e("g", { class: "ll-row " + (cls || "") });
    g.appendChild(e("rect", { x: x, y: y, width: w, height: 20, rx: 4, class: "ll-rrect" }));
    g.appendChild(e("text", { x: x + 8, y: y + 14, class: "ll-rl" }, label));
    if (val != null) g.appendChild(e("text", { x: x + w - 8, y: y + 14, class: "ll-rv", "text-anchor": "end" }, val));
    return g;
  }
  function note(x, y, txt, cls) { return e("text", { x: x, y: y, class: "ll-note " + (cls || "") }, txt); }

  function fillFile(st) {
    var b = bodyEls.file, n = NODES.file, x = n.x + 10, w = n.w - 20, kids = [];
    kids.push(note(x, n.y + 62, "SELF wrapper (signed)", st.step >= 1 ? "done" : ""));
    kids.push(row(x, n.y + 72, w, "ELF header", "e_entry", st.step >= 2 ? "hot" : ""));
    kids.push(note(x, n.y + 116, "PROGRAM HEADERS", "hd"));
    kids.push(row(x, n.y + 122, w, ".text", "R·X", st.mapped ? "seg" : ""));
    kids.push(row(x, n.y + 146, w, ".rodata", "R", st.mapped ? "seg" : ""));
    kids.push(row(x, n.y + 170, w, ".data", "R·W", st.mapped ? "seg" : ""));
    kids.push(row(x, n.y + 194, w, "PT_DYNAMIC", "tags", st.step >= 5 ? "hot" : ""));
    kids.push(note(x, n.y + 238, "DT_NEEDED · DT_SYMTAB · DT_JMPREL", "sm"));
    kids.push(note(x, n.y + 262, "IMPORTS (.dynsym → NID)", "hd"));
    var iy = n.y + 268;
    IMPORTS.forEach(function (im, i) {
      var hot = st.step === 7 && i === 0;
      kids.push(row(x, iy + i * 22, w, im.name.replace("sce", ""), im.nid.slice(0, 7), (st.step >= 8 ? "res" : "") + (hot ? " hot" : "")));
    });
    b.replaceChildren.apply(b, kids);
  }
  function fillSpace(st) {
    var b = bodyEls.space, n = NODES.space, x = n.x + 10, w = n.w - 20, kids = [];
    if (!st.reserved) { kids.push(note(x, n.y + 70, "— not reserved yet —", "sm")); b.replaceChildren.apply(b, kids); return; }
    kids.push(note(x, n.y + 60, "reserved 0x0900000000 … +N", "sm"));
    var bands = [["module .text", st.protectd ? "R·X" : "R·W·X", st.protectd ? "rx" : "rw"],
      ["module .rodata", "R", "r"], ["module .data", "R·W", "rw"],
      [".got", st.protectd ? "R" : "R·W", st.protectd ? "rx" : "rw"],
      ["tls (main thread)", "R·W", st.threadsUp ? "rw" : "off"],
      ["stack", "R·W", st.threadsUp ? "rw" : "off"]];
    bands.forEach(function (bd, i) {
      var y = n.y + 74 + i * 34;
      var cls = bd[2] === "off" ? "band-off" : "band-" + bd[2];
      var g = e("g");
      g.appendChild(e("rect", { x: x, y: y, width: w, height: 28, rx: 5, class: "ll-band " + cls }));
      g.appendChild(e("text", { x: x + 10, y: y + 18, class: "ll-bl" }, bd[0]));
      g.appendChild(e("text", { x: x + w - 10, y: y + 18, class: "ll-bv", "text-anchor": "end" }, st.mapped || i > 3 ? bd[1] : "…"));
      if (st.patched && (i === 0)) g.appendChild(e("text", { x: x + w - 46, y: y + 18, class: "ll-patch", "text-anchor": "end" }, "Call9"));
      kids.push(g);
    });
    b.replaceChildren.apply(b, kids);
  }
  function fillGot(st) {
    var b = bodyEls.got, n = NODES.got, x = n.x + 10, w = n.w - 20, kids = [];
    IMPORTS.forEach(function (im, i) {
      if (i > 5) return;
      var y = n.y + 44 + i * 26;
      var resolved = st.resolved && (im.addr || st.stub);
      var val = !st.resolved ? "?" : im.addr ? "0x" + im.addr : (st.stub ? "→ thunk" : "?");
      var cls = "";
      if (st.calling && st.calling === im.name) cls = "hot";
      else if (resolved && im.addr) cls = "res";
      else if (st.resolved && !im.addr) cls = "stub";
      kids.push(row(x, y, w, "[" + i + "] " + im.name.replace("sce", "").slice(0, 16), val, cls));
    });
    b.replaceChildren.apply(b, kids);
  }
  function fillLibs(st) {
    var b = bodyEls.libs, n = NODES.libs, x = n.x + 10, w = n.w - 20, kids = [], y = n.y + 52;
    LIBS.forEach(function (lib) {
      var provided = st.libsProvided;
      var calling = st.calling && lib.exp.indexOf(st.calling) >= 0;
      var g = e("g");
      g.appendChild(e("rect", { x: x, y: y, width: w, height: 18 + lib.exp.length * 15, rx: 5, class: "ll-lib " + (calling ? "hot" : provided ? "on" : "") }));
      g.appendChild(e("text", { x: x + 8, y: y + 14, class: "ll-libn" }, lib.name));
      g.appendChild(e("text", { x: x + w - 8, y: y + 14, class: "ll-libf", "text-anchor": "end" }, lib.file));
      lib.exp.forEach(function (fn, j) {
        kids.push(e("text", { x: x + 14, y: y + 30 + j * 15, class: "ll-ex" + (st.calling === fn ? " hot" : ""), }, fn + "  ·  " + nid(fn + "#" + lib.name).slice(0, 7)));
      });
      kids.unshift(g);
      y += 24 + lib.exp.length * 15;
    });
    b.replaceChildren.apply(b, kids);
  }
  function fillLinker(st) {
    var b = bodyEls.linker, n = NODES.linker, x = n.x + 12;
    b.replaceChildren(note(x, n.y + 66, st.op || "idle", "op"),
      note(x, n.y + 92, st.op2 || "", "sm"),
      note(x, n.y + 118, st.op3 || "", "sm"));
  }
  function fillThreads(st) {
    var b = bodyEls.threads, n = NODES.threads, x = n.x + 10, w = n.w - 20, kids = [];
    if (!st.threadsUp) { kids.push(note(x, n.y + 70, "— not created yet —", "sm")); }
    else {
      kids.push(row(x, n.y + 56, w, "main thread", "TLS+stack", "th"));
      kids.push(note(x, n.y + 84, "→ e_entry after init", "sm"));
      kids.push(row(x, n.y + 96, w, "GPU submit thread", "graphicsRun", "th"));
      kids.push(row(x, n.y + 122, w, "audio thread", "AudioOut", "th"));
      kids.push(note(x, n.y + 156, "guest threads = host threads", "sm"));
    }
    b.replaceChildren.apply(b, kids);
  }
  function fillGame(st) {
    var b = bodyEls.game, n = NODES.game, x = n.x + 12, kids = [];
    if (!st.entered) { kids.push(note(x, n.y + 70, "— not started —", "sm")); }
    else {
      kids.push(note(x, n.y + 58, "the game's main() runs", "op"));
      var calls = ["call [GOT+0]  ; AllocateDirectMemory", "call [GOT+2]  ; SubmitCommandBuffers", "call [GOT+3]  ; AudioOutOutput", "call [GOT+4]  ; SubmitFlip"];
      calls.forEach(function (c, i) {
        kids.push(note(x, n.y + 84 + i * 22, c, st.calling && ((i === 0 && st.calling.indexOf("Allocate") >= 0) || (i === 1 && st.calling.indexOf("Submit") >= 0) || (i === 2 && st.calling.indexOf("Audio") >= 0) || (i === 3 && st.calling.indexOf("Flip") >= 0)) ? "hot mono" : "mono"));
      });
    }
    b.replaceChildren.apply(b, kids);
  }

  /* ---- the steps ---- */
  var STEPS = [
    { t: "Hand the game to the loader", on: ["file", "linker"], w: [],
      op: "Loader::Run(eboot.bin)", op2: "mount /app0", op3: "open eboot.bin",
      cap: "The launcher mounts the game's read-only <code>/app0</code> and hands its main module — <code>eboot.bin</code> — to the emulator. <code>Loader::Run</code> opens it and starts the loader." },
    { t: "Unwrap the SELF", on: ["file"], w: ["parse"],
      op: "parse SELF header", op2: "→ plain ELF", op3: "self.cpp",
      cap: "<code>eboot.bin</code> is a Sony <b>SELF</b>: a signed (on a real console, encrypted) wrapper around an ordinary <b>ELF</b>. The loader reads the SELF header and segment table to recover the plain ELF underneath." },
    { t: "Read the ELF headers", on: ["file"], w: ["parse"],
      op: "read ELF header", op2: "e_entry, program headers", op3: "",
      cap: "The ELF header gives <code>e_entry</code> — the address where execution will start — and the <b>program headers</b>: several <code>PT_LOAD</code> segments (<code>.text</code>, <code>.rodata</code>, <code>.data</code>) plus one <code>PT_DYNAMIC</code>." },
    { t: "Reserve the address space", on: ["linker", "space"], w: ["map"], reserved: 1,
      op: "VirtualMemory::Alloc", op2: "reserve guest range", op3: "kernel/memory.cpp",
      cap: "Before copying anything the loader <b>reserves</b> the guest virtual range so the module lands exactly where the game's own addresses expect it — the PS5 program image sits high in the address space." },
    { t: "Map the segments", on: ["file", "space"], w: ["map"], reserved: 1, mapped: 1,
      op: "map PT_LOAD segments", op2: "copy bytes into pages", op3: "",
      cap: "Each <code>PT_LOAD</code> is mapped into pages and its bytes copied in: <code>.text</code> as R+W+X for now, <code>.rodata</code> R, <code>.data</code> R+W, plus the <code>.got</code>. Nothing is protected yet — the loader still has to write into code and the GOT." },
    { t: "Read the dynamic section", on: ["file", "linker"], w: ["parse"], reserved: 1, mapped: 1,
      op: "walk PT_DYNAMIC", op2: "DT_NEEDED / DT_SYMTAB", op3: "DT_JMPREL",
      cap: "<code>PT_DYNAMIC</code> is a table of tags: <code>DT_NEEDED</code> (which libraries this module imports), <code>DT_SYMTAB</code>/<code>DT_STRTAB</code> (the symbols and their names), and <code>DT_JMPREL</code> (the relocations that target GOT slots)." },
    { t: "Provide the needed libraries", on: ["linker", "libs"], w: ["reg"], reserved: 1, mapped: 1, libsProvided: 1,
      op: "Libs::InitAll(symbolDB)", op2: "register exports by NID", op3: "symbolDatabase.cpp",
      cap: "For every <code>DT_NEEDED</code> library — <code>libkernel</code>, <code>libc</code>, <code>libSceGnmDriver</code>, <code>libSceAudioOut</code>, <code>libSceVideoOut</code> — KytyPS5 has a <b>hand-written HLE module</b>. Their exported functions are registered in the symbol database, keyed by NID." },
    { t: "What a NID is", on: ["file"], w: [], reserved: 1, mapped: 1, libsProvided: 1,
      op: "hash(name#lib)", op2: "first 8 bytes of SHA-1", op3: "base64 → 11 chars",
      cap: "The module does not import functions by name — it imports them by <b>NID</b>: an encoded id, the first bytes of a SHA-1 of <code>functionName + suffix</code>, base64-ed to 11 characters. So <code>sceKernelAllocateDirectMemory</code> becomes something like <code>" + IMPORTS[0].nid + "</code>." },
    { t: "Resolve the NIDs → the GOT", on: ["file", "linker", "libs", "got"], w: ["imports", "reg", "resolve"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1,
      op: "for each import NID", op2: "lookup in symbol DB", op3: "write addr → GOT slot",
      cap: "This is the <b>linking</b>. The linker walks the import table; for each imported NID it looks the NID up in the symbol database, and on a hit it writes the native function's address into that import's <b>GOT slot</b>. One resolved slot per import." },
    { t: "Unresolved imports become thunks", on: ["got", "libs"], w: [], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1,
      op: "no implementation?", op2: "generate a thunk", op3: "log NID + EXIT if called",
      cap: "A NID with no implementation — here <code>sceNpCheckPlus</code> — gets a generated <b>thunk</b> written into its GOT slot: if the game ever calls it, the thunk logs the NID and <code>EXIT</code>s. Grepping these is how you map the frontier of what is implemented." },
    { t: "Relocate and patch", on: ["linker", "space"], w: ["map"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1,
      op: "apply relocations", op2: "R_X86_64_RELATIVE (rebase)", op3: "TLS read → Jit::Call9",
      cap: "<code>R_X86_64_RELATIVE</code> entries are rebased to the load address. The guest's TLS access (<code>fs:[0]</code>) is rewritten to <code>Jit::Call9</code> so it works on the host CPU — the cross-vendor patch you saw in the Intro machine." },
    { t: "Protect the pages", on: ["space"], w: ["map"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1,
      op: "VirtualProtect", op2: ".text → R·X", op3: ".got → R",
      cap: "Now that code and the GOT are fully written, the loader drops write permission: <code>.text</code> becomes R+X and the GOT R. A later write to either faults — which is exactly what the <em>Write RX page</em> button in the Intro machine demonstrates." },
    { t: "TLS and threads", on: ["linker", "threads"], w: ["create"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1,
      op: "create main thread", op2: "TLS block + stack", op3: "kernel/pthread.cpp",
      cap: "The main guest thread is a real <b>host thread</b> with its own stack and a TLS block initialised from the module's TLS template. The emulator also stands up its own service threads — the GPU submit thread and the audio thread." },
    { t: "Run the initialisers", on: ["threads", "game"], w: ["entry"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1,
      op: "DT_INIT / .init_array", op2: "C++ constructors", op3: "before main()",
      cap: "Before <code>main</code>, the module's <code>DT_INIT</code> and <code>.init_array</code> run — the C++ global constructors. These may already call into the libraries through the GOT." },
    { t: "Jump to the entry point", on: ["threads", "game"], w: ["entry"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1,
      op: "jmp e_entry", op2: "_start → main()", op3: "runs natively",
      cap: "The loader jumps to <code>e_entry</code>. The module's <code>_start</code> sets up argc/argv and calls the game's <code>main()</code>. From here the CPU runs the game's <b>own machine code natively</b> — there is no interpreter." },
    { t: "The game calls a library", on: ["game", "got", "libs"], w: ["call", "jump"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1, calling: "sceKernelAllocateDirectMemory",
      op: "game executes", op2: "call [GOT+0]", op3: "→ native HLE fn",
      cap: "When the game calls <code>sceKernelAllocateDirectMemory</code>, its code executes <code>call [GOT+0]</code>. That slot holds the address the linker wrote at load time, so control jumps <b>straight into the native HLE function</b>. There is no name lookup at run time — the GOT slot is the whole indirection." },
    { t: "Every service, the same way", on: ["game", "got", "libs"], w: ["call", "jump", "ret"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1, calling: "sceGnmSubmitCommandBuffers",
      op: "graphics · audio · files", op2: "call [GOT+n]", op3: "resolved once, called forever",
      cap: "Every service the game uses is this same pattern: graphics (<code>sceGnmSubmitCommandBuffers</code> → the GPU thread), audio (<code>sceAudioOutOutput</code>), files, threads. One GOT slot per import, <b>resolved once at load and called forever</b>. That indirection is how a game written for a console runs on your PC." }
  ];

  var cur = 0, playing = false, timer = null;
  function state(i) {
    var s = STEPS[i], st = {};
    for (var k in s) st[k] = s[k];
    st.step = i;
    return st;
  }
  function render(i) {
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    var st = state(cur);
    // node / wire highlight
    Object.keys(NODES).forEach(function (id) {
      var g = svg.querySelector('[data-n="' + id + '"]');
      g.classList.toggle("on", st.on.indexOf(id) >= 0);
    });
    Object.keys(WIRES).forEach(function (id) {
      var on = (st.w || []).indexOf(id) >= 0;
      wireEls[id].grp.classList.toggle("on", on);
      wireEls[id].path.setAttribute("marker-end", on ? "url(#m-on)" : "url(#m-line)");
    });
    fillFile(st); fillSpace(st); fillGot(st); fillLibs(st); fillLinker(st); fillThreads(st); fillGame(st);
    // caption + rail
    $cap.innerHTML = "<b>" + (cur + 1) + " / " + STEPS.length + " · " + st.t + "</b> " + st.cap;
    Array.prototype.forEach.call(rail.children, function (m, k) { m.classList.toggle("on", k === cur); m.classList.toggle("done", k < cur); });
    $pos.textContent = (cur + 1) + " / " + STEPS.length;
  }
  function focusNode(id) {
    // jump to the first step that lights this node
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].on.indexOf(id) >= 0) { stop(); render(i); return; }
  }

  /* ---- controls ---- */
  var bar = document.createElement("div"); bar.className = "ll-bar";
  var $cap = document.createElement("div"); $cap.className = "ll-cap";
  var ctl = document.createElement("div"); ctl.className = "ll-ctl";
  function btn(txt, fn, cls) { var b = document.createElement("button"); b.type = "button"; b.className = "ll-btn " + (cls || ""); b.textContent = txt; b.onclick = fn; return b; }
  var playBtn = btn("▶ Play", function () { toggle(); }, "pri");
  var $pos = document.createElement("span"); $pos.className = "ll-pos";
  ctl.appendChild(btn("‹ Prev", function () { stop(); render(cur - 1); }));
  ctl.appendChild(playBtn);
  ctl.appendChild(btn("Next ›", function () { stop(); render(cur + 1); }));
  ctl.appendChild($pos);
  var rail = document.createElement("div"); rail.className = "ll-rail";
  STEPS.forEach(function (s, i) {
    var m = document.createElement("button"); m.type = "button"; m.className = "ll-mark"; m.title = (i + 1) + ". " + s.t;
    m.onclick = function () { stop(); render(i); };
    rail.appendChild(m);
  });
  bar.appendChild($cap);
  bar.appendChild(ctl);
  bar.appendChild(rail);
  mount.appendChild(bar);

  function stop() { playing = false; playBtn.textContent = "▶ Play"; if (timer) { clearInterval(timer); timer = null; } }
  function toggle() {
    if (playing) { stop(); return; }
    playing = true; playBtn.textContent = "❚❚ Pause";
    if (cur >= STEPS.length - 1) render(0);
    timer = setInterval(function () {
      if (cur >= STEPS.length - 1) { stop(); return; }
      render(cur + 1);
    }, 4200);
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    if (ev.key === "ArrowRight") { stop(); render(cur + 1); }
    else if (ev.key === "ArrowLeft") { stop(); render(cur - 1); }
  });

  render(0);
})();
