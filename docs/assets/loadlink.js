(function () {
  "use strict";
  var mount = document.getElementById("loadlink");
  if (!mount || !window.KytyFlow) return;

  function hash(name) {
    var h = 2166136261, a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-";
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    var s = "", x = h >>> 0;
    for (var k = 0; k < 11; k++) { s += a[x & 63]; x = (x >>> 6) ^ (h << (k % 5)); }
    return s;
  }

  var IMPORTS = [
    { name: "sceKernelAllocateDirectMemory", lib: "libkernel", addr: "00A1B2C0" },
    { name: "sceKernelCreateThread", lib: "libkernel", addr: "00A1B310" },
    { name: "sceGnmSubmitCommandBuffers", lib: "libSceGnmDriver", addr: "00B40120" },
    { name: "sceAudioOutOutput", lib: "libSceAudioOut", addr: "00C21040" },
    { name: "sceVideoOutSubmitFlip", lib: "libSceVideoOut", addr: "00D02080" },
    { name: "sceNpCheckPlus", lib: "libSceNp", addr: null }
  ];
  IMPORTS.forEach(function (im) { im.nid = hash(im.name + "#" + im.lib); });
  var LIBS = [
    { name: "libkernel", file: "libKernel.cpp", exp: ["sceKernelAllocateDirectMemory", "sceKernelCreateThread", "sceKernelMapDirectMemory"] },
    { name: "libc", file: "libc.cpp", exp: ["malloc", "memcpy", "printf"] },
    { name: "libSceGnmDriver", file: "graphics/…/agc.cpp", exp: ["sceGnmSubmitCommandBuffers", "sceGnmDrawIndex"] },
    { name: "libSceAudioOut", file: "audioOut.cpp", exp: ["sceAudioOutOutput", "sceAudioOutOpen"] },
    { name: "libSceVideoOut", file: "videoOut.cpp", exp: ["sceVideoOutSubmitFlip", "sceVideoOutOpen"] },
    { name: "libSceNp", file: "libNp.cpp (partial)", exp: ["sceNpGetState"] }
  ];

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

  function body(id, st, H) {
    var n = NODES[id], x = n.x + 10, w = n.w - 20, k = [];
    if (id === "file") {
      k.push(H.note(x, n.y + 62, "SELF wrapper (signed)", st.step >= 1 ? "done" : ""));
      k.push(H.row(x, n.y + 72, w, "ELF header", "e_entry", st.step >= 2 ? "hot" : ""));
      k.push(H.note(x, n.y + 116, "PROGRAM HEADERS", "hd"));
      k.push(H.row(x, n.y + 122, w, ".text", "R·X", st.mapped ? "seg" : ""));
      k.push(H.row(x, n.y + 146, w, ".rodata", "R", st.mapped ? "seg" : ""));
      k.push(H.row(x, n.y + 170, w, ".data", "R·W", st.mapped ? "seg" : ""));
      k.push(H.row(x, n.y + 194, w, "PT_DYNAMIC", "tags", st.step >= 5 ? "hot" : ""));
      k.push(H.note(x, n.y + 238, "DT_NEEDED · DT_SYMTAB · DT_JMPREL", "sm"));
      k.push(H.note(x, n.y + 262, "IMPORTS (.dynsym → NID)", "hd"));
      IMPORTS.forEach(function (im, i) {
        var hot = st.step === 7 && i === 0;
        k.push(H.row(x, n.y + 268 + i * 22, w, im.name.replace("sce", ""), im.nid.slice(0, 7), (st.step >= 8 ? "res" : "") + (hot ? " hot" : "")));
      });
    } else if (id === "space") {
      if (!st.reserved) return [H.note(x, n.y + 70, "— not reserved yet —", "sm")];
      k.push(H.note(x, n.y + 60, "reserved 0x0900000000 … +N", "sm"));
      var bands = [["module .text", st.protectd ? "R·X" : "R·W·X", st.protectd ? "band-rx" : "band-rw"],
        ["module .rodata", "R", "band-r"], ["module .data", "R·W", "band-rw"],
        [".got", st.protectd ? "R" : "R·W", st.protectd ? "band-rx" : "band-rw"],
        ["tls (main thread)", "R·W", st.threadsUp ? "band-rw" : "band-off"],
        ["stack", "R·W", st.threadsUp ? "band-rw" : "band-off"]];
      bands.forEach(function (bd, i) {
        var y = n.y + 74 + i * 34;
        k.push(H.band(x, y, w, bd[0], st.mapped || i > 3 ? bd[1] : "…", bd[2]));
        if (st.patched && i === 0) k.push(H.e("text", { x: x + w - 48, y: y + 17, class: "fd-patch", "text-anchor": "end" }, "Call9"));
      });
    } else if (id === "got") {
      IMPORTS.forEach(function (im, i) {
        if (i > 5) return;
        var val = !st.resolved ? "?" : im.addr ? "0x" + im.addr : (st.stub ? "→ thunk" : "?");
        var cls = "";
        if (st.calling && st.calling === im.name) cls = "hot";
        else if (st.resolved && im.addr) cls = "res";
        else if (st.resolved && !im.addr && st.stub) cls = "stub";
        k.push(H.row(x, n.y + 44 + i * 26, w, "[" + i + "] " + im.name.replace("sce", "").slice(0, 16), val, cls));
      });
    } else if (id === "libs") {
      var y = n.y + 52;
      LIBS.forEach(function (lib) {
        var calling = st.calling && lib.exp.indexOf(st.calling) >= 0;
        k.push(H.e("g", null, [
          H.e("rect", { x: x, y: y, width: w, height: 18 + lib.exp.length * 15, rx: 5, class: "fd-lib " + (calling ? "hot" : st.libsProvided ? "on" : "") }),
          H.e("text", { x: x + 8, y: y + 14, class: "fd-libn" }, lib.name),
          H.e("text", { x: x + w - 8, y: y + 14, class: "fd-libf", "text-anchor": "end" }, lib.file)
        ]));
        lib.exp.forEach(function (fn, j) {
          k.push(H.e("text", { x: x + 14, y: y + 30 + j * 15, class: "fd-ex" + (st.calling === fn ? " hot" : "") }, fn + "  ·  " + hash(fn + "#" + lib.name).slice(0, 7)));
        });
        y += 24 + lib.exp.length * 15;
      });
    } else if (id === "linker") {
      k.push(H.note(x + 2, n.y + 66, st.op || "idle", "op"));
      k.push(H.note(x + 2, n.y + 92, st.op2 || "", "sm"));
      k.push(H.note(x + 2, n.y + 118, st.op3 || "", "sm"));
    } else if (id === "threads") {
      if (!st.threadsUp) return [H.note(x, n.y + 70, "— not created yet —", "sm")];
      k.push(H.row(x, n.y + 56, w, "main thread", "TLS+stack", "cy"));
      k.push(H.note(x, n.y + 84, "→ e_entry after init", "sm"));
      k.push(H.row(x, n.y + 96, w, "GPU submit thread", "graphicsRun", "cy"));
      k.push(H.row(x, n.y + 122, w, "audio thread", "AudioOut", "cy"));
      k.push(H.note(x, n.y + 156, "guest threads = host threads", "sm"));
    } else if (id === "game") {
      if (!st.entered) return [H.note(x + 2, n.y + 70, "— not started —", "sm")];
      k.push(H.note(x + 2, n.y + 58, "the game's main() runs", "op"));
      var calls = [["call [GOT+0]  ; AllocateDirectMemory", "Allocate"], ["call [GOT+2]  ; SubmitCommandBuffers", "Submit"], ["call [GOT+3]  ; AudioOutOutput", "Audio"], ["call [GOT+4]  ; SubmitFlip", "Flip"]];
      calls.forEach(function (c, i) {
        k.push(H.note(x + 2, n.y + 84 + i * 22, c[0], st.calling && st.calling.indexOf(c[1]) >= 0 ? "hot mono" : "mono"));
      });
    }
    return k;
  }

  var STEPS = [
    { t: "Hand the game to the loader", on: ["file", "linker"], w: [], op: "Loader::Run(eboot.bin)", op2: "mount /app0", op3: "open eboot.bin",
      cap: "The launcher mounts the game's read-only <code>/app0</code> and hands its main module — <code>eboot.bin</code> — to the emulator. <code>Loader::Run</code> opens it and starts the loader." },
    { t: "Unwrap the SELF", on: ["file"], w: ["parse"], op: "parse SELF header", op2: "→ plain ELF", op3: "self.cpp",
      cap: "<code>eboot.bin</code> is a Sony <b>SELF</b>: a signed (on a real console, encrypted) wrapper around an ordinary <b>ELF</b>. The loader reads the SELF header and segment table to recover the plain ELF underneath." },
    { t: "Read the ELF headers", on: ["file"], w: ["parse"], op: "read ELF header", op2: "e_entry, program headers", op3: "",
      cap: "The ELF header gives <code>e_entry</code> — the address where execution will start — and the <b>program headers</b>: several <code>PT_LOAD</code> segments (<code>.text</code>, <code>.rodata</code>, <code>.data</code>) plus one <code>PT_DYNAMIC</code>." },
    { t: "Reserve the address space", on: ["linker", "space"], w: ["map"], reserved: 1, op: "VirtualMemory::Alloc", op2: "reserve guest range", op3: "kernel/memory.cpp",
      cap: "Before copying anything the loader <b>reserves</b> the guest virtual range so the module lands exactly where the game's own addresses expect it — the PS5 program image sits high in the address space." },
    { t: "Map the segments", on: ["file", "space"], w: ["map"], reserved: 1, mapped: 1, op: "map PT_LOAD segments", op2: "copy bytes into pages", op3: "",
      cap: "Each <code>PT_LOAD</code> is mapped into pages and its bytes copied in: <code>.text</code> as R+W+X for now, <code>.rodata</code> R, <code>.data</code> R+W, plus the <code>.got</code>. Nothing is protected yet — the loader still has to write into code and the GOT." },
    { t: "Read the dynamic section", on: ["file", "linker"], w: ["parse"], reserved: 1, mapped: 1, op: "walk PT_DYNAMIC", op2: "DT_NEEDED / DT_SYMTAB", op3: "DT_JMPREL",
      cap: "<code>PT_DYNAMIC</code> is a table of tags: <code>DT_NEEDED</code> (which libraries this module imports), <code>DT_SYMTAB</code>/<code>DT_STRTAB</code> (the symbols and their names), and <code>DT_JMPREL</code> (the relocations that target GOT slots)." },
    { t: "Provide the needed libraries", on: ["linker", "libs"], w: ["reg"], reserved: 1, mapped: 1, libsProvided: 1, op: "Libs::InitAll(symbolDB)", op2: "register exports by NID", op3: "symbolDatabase.cpp",
      cap: "For every <code>DT_NEEDED</code> library — <code>libkernel</code>, <code>libc</code>, <code>libSceGnmDriver</code>, <code>libSceAudioOut</code>, <code>libSceVideoOut</code> — KytyPS5 has a <b>hand-written HLE module</b>. Their exported functions are registered in the symbol database, keyed by NID." },
    { t: "What a NID is", on: ["file"], w: [], reserved: 1, mapped: 1, libsProvided: 1, op: "hash(name#lib)", op2: "first 8 bytes of SHA-1", op3: "base64 → 11 chars",
      cap: "The module does not import functions by name — it imports them by <b>NID</b>: an encoded id, the first bytes of a SHA-1 of <code>functionName + suffix</code>, base64-ed to 11 characters. So <code>sceKernelAllocateDirectMemory</code> becomes something like <code>" + IMPORTS[0].nid + "</code>." },
    { t: "Resolve the NIDs → the GOT", on: ["file", "linker", "libs", "got"], w: ["imports", "reg", "resolve"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, op: "for each import NID", op2: "lookup in symbol DB", op3: "write addr → GOT slot",
      cap: "This is the <b>linking</b>. The linker walks the import table; for each imported NID it looks the NID up in the symbol database, and on a hit it writes the native function's address into that import's <b>GOT slot</b>. One resolved slot per import." },
    { t: "Unresolved imports become thunks", on: ["got", "libs"], w: [], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, op: "no implementation?", op2: "generate a thunk", op3: "log NID + EXIT if called",
      cap: "A NID with no implementation — here <code>sceNpCheckPlus</code> — gets a generated <b>thunk</b> written into its GOT slot: if the game ever calls it, the thunk logs the NID and <code>EXIT</code>s. Grepping these is how you map the frontier of what is implemented." },
    { t: "Relocate and patch", on: ["linker", "space"], w: ["map"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, op: "apply relocations", op2: "R_X86_64_RELATIVE (rebase)", op3: "TLS read → Jit::Call9",
      cap: "<code>R_X86_64_RELATIVE</code> entries are rebased to the load address. The guest's TLS access (<code>fs:[0]</code>) is rewritten to <code>Jit::Call9</code> so it works on the host CPU — the cross-vendor patch you saw in the Intro machine." },
    { t: "Protect the pages", on: ["space"], w: ["map"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, op: "VirtualProtect", op2: ".text → R·X", op3: ".got → R",
      cap: "Now that code and the GOT are fully written, the loader drops write permission: <code>.text</code> becomes R+X and the GOT R. A later write to either faults — which is exactly what the <em>Write RX page</em> button in the Intro machine demonstrates." },
    { t: "TLS and threads", on: ["linker", "threads"], w: ["create"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, op: "create main thread", op2: "TLS block + stack", op3: "kernel/pthread.cpp",
      cap: "The main guest thread is a real <b>host thread</b> with its own stack and a TLS block initialised from the module's TLS template. The emulator also stands up its own service threads — the GPU submit thread and the audio thread." },
    { t: "Run the initialisers", on: ["threads", "game"], w: ["entry"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, op: "DT_INIT / .init_array", op2: "C++ constructors", op3: "before main()",
      cap: "Before <code>main</code>, the module's <code>DT_INIT</code> and <code>.init_array</code> run — the C++ global constructors. These may already call into the libraries through the GOT." },
    { t: "Jump to the entry point", on: ["threads", "game"], w: ["entry"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1, op: "jmp e_entry", op2: "_start → main()", op3: "runs natively",
      cap: "The loader jumps to <code>e_entry</code>. The module's <code>_start</code> sets up argc/argv and calls the game's <code>main()</code>. From here the CPU runs the game's <b>own machine code natively</b> — there is no interpreter." },
    { t: "The game calls a library", on: ["game", "got", "libs"], w: ["call", "jump"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1, calling: "sceKernelAllocateDirectMemory", op: "game executes", op2: "call [GOT+0]", op3: "→ native HLE fn",
      cap: "When the game calls <code>sceKernelAllocateDirectMemory</code>, its code executes <code>call [GOT+0]</code>. That slot holds the address the linker wrote at load time, so control jumps <b>straight into the native HLE function</b>. There is no name lookup at run time — the GOT slot is the whole indirection." },
    { t: "Every service, the same way", on: ["game", "got", "libs"], w: ["call", "jump", "ret"], reserved: 1, mapped: 1, libsProvided: 1, resolved: 1, stub: 1, patched: 1, protectd: 1, threadsUp: 1, entered: 1, calling: "sceGnmSubmitCommandBuffers", op: "graphics · audio · files", op2: "call [GOT+n]", op3: "resolved once, called forever",
      cap: "Every service the game uses is this same pattern: graphics (<code>sceGnmSubmitCommandBuffers</code> → the GPU thread), audio (<code>sceAudioOutOutput</code>), files, threads. One GOT slot per import, <b>resolved once at load and called forever</b>. That indirection is how a game written for a console runs on your PC." }
  ];

  KytyFlow(mount, { viewBox: "0 0 1240 720", aria: "How a game loads and links", nodes: NODES, wires: WIRES, steps: STEPS, body: body });
})();
