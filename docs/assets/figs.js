/* ============================================================
   figs.js — additional explainers, filling the topics that had
   no visual of their own.

   Registers: hlelle · selfunwrap · hlemodule · tlscopy
              redzone · diagflow · contribloop

   Uses window.VIZ from viz.js for the frame + stepper, and the
   .atl-* layout classes from atlas.css, so these look native
   next to the animations that were already here.
   ============================================================ */
(function () {
  "use strict";
  if (!window.VIZ || !window.VIZ.register) return;

  var V = window.VIZ, frame = V.frame, driver = V.driver;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* Small helper: a column of labelled rows that light up by step. */
  function rows(items, lit) {
    return items.map(function (it, k) {
      return '<div class="atl-ln' + (lit(k) ? " hot" : "") + '">' + it + "</div>";
    }).join("");
  }

  /* ============================================================
     01 · what an emulator is — HLE against LLE
     ============================================================ */
  V.register("hlelle", function (host) {
    var body = frame(host, "Two ways to emulate", "low level against high level",
      "The choice made here decides almost everything else about the project: what has to be written, what runs fast, and what breaks.");

    var wrap = el("div", "atl-two");
    wrap.innerHTML =
      '<div class="atl-col"><h5>LLE — emulate the hardware</h5><div class="atl-code" data-r="lle"></div>' +
      '<div class="atl-meter"><span>what you must write</span><b data-n="lle">—</b></div></div>' +
      '<div class="atl-col"><h5>HLE — emulate the interfaces</h5><div class="atl-code" data-r="hle"></div>' +
      '<div class="atl-meter"><span>what you must write</span><b data-n="hle">—</b></div></div>';
    var lR = wrap.querySelector('[data-r="lle"]'), hR = wrap.querySelector('[data-r="hle"]');
    var lN = wrap.querySelector('[data-n="lle"]'), hN = wrap.querySelector('[data-n="hle"]');

    var LLE = ["CPU cores + pipeline", "memory controller", "GPU silicon", "the real firmware", "every peripheral"];
    var HLE = ["run guest code natively", "reimplement the OS calls", "translate GPU commands", "translate shaders", "—"];

    var CAPS = [
      "The console is hardware plus an operating system plus a driver stack. An emulator has to stand in for some layer of that — the question is which.",
      "<b>LLE</b> reproduces the machine itself, then boots the console's real firmware on top. Extremely faithful, and extremely slow: every guest instruction costs many host instructions, and you need the firmware to begin with.",
      "<b>HLE</b> ignores the hardware and reimplements the <em>interfaces</em>. Guest code runs natively on your CPU; the emulator provides the functions it calls and translates the commands it sends to the GPU.",
      "KytyPS5 is HLE. That is why there is no CPU emulator anywhere in the tree — and why roughly 70% of the codebase is graphics, because translating a GPU is the part HLE does not make easy.",
      "The cost of the choice: a guest bug corrupts the emulator's own process, because there is no simulated machine to contain it. Hence the elaborate crash dumps."
    ];

    var drv = driver(body, CAPS, function (i) {
      lR.innerHTML = rows(LLE, function () { return i >= 1 && i < 2 || i >= 3; });
      hR.innerHTML = rows(HLE, function (k) { return i >= 2 && k < 4; });
      lN.textContent = i >= 1 ? "a whole machine" : "—";
      hN.textContent = i >= 2 ? "a whole OS + driver" : "—";
      wrap.classList.toggle("atl-dim-left", i >= 2);
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     05 · elf & self — unwrapping the container
     ============================================================ */
  V.register("selfunwrap", function (host) {
    var body = frame(host, "Getting to the ELF", "SELF container → ELF64 → segments",
      "A game module is an ELF hidden inside a Sony container, with the parts a linker needs moved somewhere no standard linker looks.");

    var wrap = el("div", "atl-elf");
    wrap.innerHTML = '<div class="atl-segs" data-r="segs"></div>';
    var segs = wrap.querySelector('[data-r="segs"]');

    var LAYERS = [
      { n: "SELF header", d: "magic, entry count", k: "" },
      { n: "segment table", d: "where the ELF lives inside", k: "" },
      { n: "ELF64 header", d: "e_type = ET_SCE_DYNEXEC", k: "g" },
      { n: "PT_LOAD  .text", d: "R-X — guest instructions", k: "g" },
      { n: "PT_LOAD  .data", d: "RW- — filesz &lt; memsz", k: "g" },
      { n: "PT_TLS", d: "template, copied per thread", k: "g" },
      { n: "PT_OS_DYNLIBDATA", d: "symbols, strings, relocations", k: "k" }
    ];

    var CAPS = [
      "On disk this is <code>eboot.bin</code> — a <b>SELF</b>, Sony's container format. A standard ELF reader does not get past the first four bytes.",
      "Unwrap it and there is an ordinary ELF64 header, except for one field: <code>e_type</code> is <code>ET_SCE_DYNEXEC</code>, a value outside the standard range. That alone makes every normal loader refuse it.",
      "The <code>PT_LOAD</code> segments are conventional — bytes, an address they want, and a protection. Note <code>.data</code>, where <code>filesz</code> is smaller than <code>memsz</code>: the gap is <code>.bss</code> and must be zero-filled rather than copied.",
      "<b>This is the part that matters.</b> <code>PT_OS_DYNLIBDATA</code> holds the symbol table, the string table and the relocations — everything a dynamic linker needs. Sony moved it out of the standard sections into a proprietary segment.",
      "Which is why running <code>readelf</code> on a PS5 module shows you a binary with no imports at all. They are all in there, addressed by <code>DT_OS_*</code> tags that only this loader understands."
    ];

    var drv = driver(body, CAPS, function (i) {
      var show = i === 0 ? 2 : i === 1 ? 3 : i === 2 ? 6 : 7;
      segs.innerHTML = LAYERS.slice(0, show).map(function (l, k) {
        var hot = (i === 1 && k === 2) || (i === 2 && k >= 3 && k <= 5) || (i >= 3 && k === 6);
        return '<div class="atl-seg ' + l.k + (hot ? " hot" : "") + '">' +
          "<b>" + l.n + "</b><span>" + l.d + "</span></div>";
      }).join("");
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     12 · HLE libraries — one call, end to end
     ============================================================ */
  V.register("hlemodule", function (host) {
    var body = frame(host, "Anatomy of an HLE call", "from the game's call instruction to your C++ and back",
      "Every one of the thousands of system functions in src/libs/ is reached exactly this way. Learn the path once and the whole directory reads the same.");

    var wrap = el("div", "atl-reloc");
    wrap.innerHTML = '<div class="atl-code" data-r="chain"></div>';
    var chain = wrap.querySelector('[data-r="chain"]');

    var CHAIN = [
      "guest:  call [rip + 0x2f18]      <i>; through the GOT</i>",
      "GOT:    0x00007ff6_a41c2280      <i>; patched at load time</i>",
      "thunk:  ABI transition           <i>; System V → host</i>",
      "kyty:   SystemServiceGetStatus() <i>; KYTY_SYSV_ABI</i>",
      "kyty:   PRINT_NAME()             <i>; shows up in your log</i>",
      "kyty:   *status = {}; return OK  <i>; the actual work</i>",
      "guest:  continues                <i>; never knew it left</i>"
    ];

    var CAPS = [
      "The game makes an ordinary indirect call. It has no idea an emulator exists — as far as it is concerned this is a system library.",
      "The call goes <b>through the GOT</b>. That slot was empty until the runtime linker resolved a NID and wrote an address into it at load time.",
      "The address is not guest code, it is the emulator's. Crossing means changing calling convention — the guest passes arguments the System V way, the host expects something else.",
      "Now you are in ordinary C++. The <code>KYTY_SYSV_ABI</code> annotation is what made the argument registers line up; without it this function reads whatever happened to be in the registers it expects.",
      "<code>PRINT_NAME()</code> is the trace that tells you the guest genuinely called through — not just that the symbol resolved. Those are different failures and it is worth being able to tell them apart.",
      "The body does the work and returns a status code. Most functions in <code>src/libs/</code> are a validity check and a zeroed-out struct.",
      "Control returns and the game carries on. <b>Nothing was simulated</b> — a real function ran, on a real CPU, on behalf of a program that thinks it is talking to a PlayStation."
    ];

    var drv = driver(body, CAPS, function (i) {
      chain.innerHTML = CHAIN.map(function (l, k) {
        return '<div class="atl-ln' + (k === i ? " hot" : (k < i ? "" : " dimmed")) + '">' + l + "</div>";
      }).join("");
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     11 · threads — the TLS template and its copies
     ============================================================ */
  V.register("tlscopy", function (host) {
    var body = frame(host, "One template, many threads", "PT_TLS and what each thread gets",
      "PT_TLS is not thread-local storage. It is the pattern that thread-local storage is stamped out from, and the difference matters the moment a second thread exists.");

    var wrap = el("div", "atl-elf");
    wrap.innerHTML =
      '<div class="atl-segs" data-r="tpl"></div>' +
      '<div class="atl-bufs" data-r="thr"></div>';
    var tpl = wrap.querySelector('[data-r="tpl"]'), thr = wrap.querySelector('[data-r="thr"]');

    var CAPS = [
      "The module carries a <code>PT_TLS</code> segment: 64 bytes of initialised data, and a <code>memsz</code> that is larger than its <code>filesz</code>.",
      "That gap is <code>.tbss</code> — thread-local variables with no initial value. It occupies no space in the file, but every thread needs it <b>zeroed</b>.",
      "The first guest thread gets a copy: the 64 initialised bytes, then 128 zero bytes. The template itself is never used directly by anything.",
      "Every thread the game creates gets its own copy. They start identical and immediately diverge — that is the whole point of thread-local storage.",
      "Guest code reaches its copy through the <code>fs</code> segment register. On Windows <code>fs</code> does not mean that, which is why the loader rewrote those instructions before any of this ran."
    ];

    var drv = driver(body, CAPS, function (i) {
      tpl.innerHTML =
        '<div class="atl-seg g' + (i <= 1 ? " hot" : "") + '"><b>PT_TLS template</b>' +
        '<span>filesz 64 B' + (i >= 1 ? '  ·  memsz 192 B → 128 B of .tbss' : "") + "</span></div>";
      var n = i <= 1 ? 0 : i === 2 ? 1 : 4;
      var out = "";
      for (var k = 0; k < n; k++) {
        out += '<div class="atl-buf' + (i === 2 || i >= 4 ? " hot" : "") + '">' +
          "<b>thread " + k + "</b><span>64 B copied · 128 B zeroed</span></div>";
      }
      thr.innerHTML = out || '<div class="atl-buf"><span>no guest threads yet</span></div>';
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     08 · patching — the red zone
     ============================================================ */
  V.register("redzone", function (host) {
    var body = frame(host, "The red zone", "128 bytes System V promises and Windows does not",
      "A newer, Windows-only patching pass, ported from shadPS4. It exists because of one sentence in the System V ABI that has no equivalent on Windows.");

    var wrap = el("div", "atl-bytes");
    wrap.innerHTML = '<div class="atl-bytes-row" data-r="stack"></div>' +
                     '<div class="atl-code" data-r="note"></div>';
    var stack = wrap.querySelector('[data-r="stack"]'), note = wrap.querySelector('[data-r="note"]');

    var CAPS = [
      "System V gives a leaf function 128 bytes <b>below</b> the stack pointer — the red zone. It may use them freely without adjusting <code>rsp</code>, which saves two instructions in every small function.",
      "Guest code was compiled with that promise and uses it constantly. Here a function has stashed values below <code>rsp</code> and expects them to still be there.",
      "Windows never agreed to this. A kernel-delivered exception, an APC, or a signal handler will use the space below <code>rsp</code> for its own frame — <b>overwriting the guest's data</b>.",
      "The guest then reads back whatever the kernel left behind. No crash, no message: just a value that is quietly wrong, in a function that looks correct.",
      "So <code>redZonePatcher.cpp</code> walks <code>.eh_frame</code> to find function boundaries, identifies the ones that touch the red zone, and rewrites their memory instructions to route through a trampoline instead.",
      "It cannot fix everything, and it says so: the result struct counts <code>unrelocatable_memory_instruction_count</code> alongside the ones it patched. That honesty is worth more than a silent pass."
    ];

    var drv = driver(body, CAPS, function (i) {
      var cells = [];
      for (var k = 0; k < 16; k++) {
        var inRed = k >= 8;
        var cls = "atl-byte";
        if (inRed && i >= 1) cls += " g";
        if (inRed && i >= 2 && i <= 3) cls += " hot";
        if (inRed && i >= 4) cls += " k";
        cells.push('<div class="' + cls + '">' +
          (k === 8 ? "rsp" : inRed ? (i >= 2 && i <= 3 ? "??" : "..") : "") + "</div>");
      }
      stack.innerHTML = cells.join("");
      note.innerHTML =
        i <= 1 ? '<div class="atl-ln">guest stores below rsp — legal under System V</div>'
        : i <= 3 ? '<div class="atl-ln hot">kernel wrote here — the guest\'s bytes are gone</div>'
        : '<div class="atl-ln">memory instructions rerouted through a trampoline</div>';
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     18 · debugging — what each flag produces
     ============================================================ */
  V.register("diagflow", function (host) {
    var body = frame(host, "Turning the black box inside out", "which flag produces which artifact",
      "Everything the later topics ask you to read comes from one of these switches. Run with all three once and you have the whole picture on disk.");

    var wrap = el("div", "atl-reloc");
    wrap.innerHTML = '<div class="atl-code" data-r="flags"></div>';
    var flags = wrap.querySelector('[data-r="flags"]');

    var F = [
      ["--printf-direction File", "_kyty.txt", "everything the emulator says: unresolved imports, unimplemented calls, errors"],
      ["--command-buffer-dump true", "command buffers", "the raw PM4 dwords the game submitted — feed these to the decoder"],
      ["--shader-log-direction File", "_Shaders/", "input ISA, the IR, and the emitted SPIR-V for every shader"],
      ["(crash)", "crash log", "faulting module, code bytes, every register, a stack walk"]
    ];

    var CAPS = [
      "By default the emulator tells you very little. That is the right default for playing and the wrong one for learning.",
      "<code>--printf-direction File</code> is the one to start with. Everything the emulator has to say lands in a file you can search — and drop straight into the log triage tool.",
      "<code>--command-buffer-dump true</code> captures what the game actually submitted to the GPU. Without it, the graphics topics are theory.",
      "<code>--shader-log-direction File</code> fills <code>_Shaders/</code> with the input ISA, the intermediate representation and the SPIR-V for every shader translated. Reading all three side by side is the fastest way to understand the recompiler.",
      "And when it crashes you get the crash log for free: which module faulted, the bytes at the faulting address, every register, and a walk back up the stack. Because guest code runs natively, that is a <em>real</em> crash — which is exactly why the dump has to be this thorough."
    ];

    var drv = driver(body, CAPS, function (i) {
      flags.innerHTML = F.map(function (f, k) {
        var on = i >= k + 1;
        return '<div class="atl-ln' + (i === k + 1 ? " hot" : on ? "" : " dimmed") + '">' +
          "<b>" + f[0] + "</b>" + (on ? '  →  <span class="atl-tag">' + f[1] + "</span>" : "") +
          (on ? '<div class="atl-sub">' + f[2] + "</div>" : "") + "</div>";
      }).join("");
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     19 · your first change — the contribution loop
     ============================================================ */
  V.register("contribloop", function (host) {
    var body = frame(host, "The loop", "log → pick → implement → register → verify",
      "This is the smallest complete contribution to the project, and it is the same five steps every time. The first one takes an evening; the fifth takes fifteen minutes.");

    var wrap = el("div", "atl-reloc");
    wrap.innerHTML = '<div class="atl-code" data-r="loop"></div>';
    var loop = wrap.querySelector('[data-r="loop"]');

    var L = [
      ["1 · run", "kyty_emulator --printf-direction File", "let the title get as far as it can"],
      ["2 · pick", "unresolved symbol rPo6tV8D9bM", "one NID from the log — self-contained work"],
      ["3 · implement", "static int KYTY_SYSV_ABI …", "the annotation is not optional"],
      ["4 · register", 'LIB_FUNC("rPo6tV8D9bM", …)', "bind the id to your function"],
      ["5 · verify", "PRINT_NAME() appears", "resolved is not the same as called"]
    ];

    var CAPS = [
      "Start by running a title you own with logging on. You are not looking for it to work — you are looking for what it asks for and does not get.",
      "The unresolved imports are your work queue. Each one is a function some game genuinely needs, chosen by the actual behaviour of real software rather than by a tutorial.",
      "Write the implementation. Ordinary C++, with two obligations: <code>KYTY_SYSV_ABI</code> so the arguments arrive where the guest put them, and a <code>PRINT_NAME()</code> trace.",
      "Register it against the NID in the library's <code>LIB_DEFINE</code> block. This is the whole binding mechanism — one line mapping an encoded id to your function.",
      "Rebuild and re-run, then check <b>both</b> things: the unresolved line is gone, <em>and</em> your trace appears. Only the second proves the guest actually called through.",
      "Then do it again. The loop is the same every time, and after a few passes you stop reading the log for errors and start reading it for which missing function is blocking all the others."
    ];

    var drv = driver(body, CAPS, function (i) {
      loop.innerHTML = L.map(function (s, k) {
        var on = i >= k + 1;
        return '<div class="atl-ln' + (i === k + 1 ? " hot" : on ? "" : " dimmed") + '">' +
          "<b>" + s[0] + "</b>  <code>" + s[1] + "</code>" +
          (on ? '<div class="atl-sub">' + s[2] + "</div>" : "") + "</div>";
      }).join("");
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });
})();
