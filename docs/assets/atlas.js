/* ============================================================
   atlas.js — deep-dive visualisations for the KytyPS5 Visual Atlas
   Requires viz.js (loaded first) for window.VIZ helpers + styles.
   Registers: nativeexec · abiflow · patchbytes · faultpath · addrmap
              pagegrain · elfmap · relocgot · pm4stream · queuebank
              srtwalk · flipmodel
   ============================================================ */
(function () {
  "use strict";
  if (!window.VIZ) { return; }
  var V = window.VIZ, frame = V.frame, svg = V.svg, mk = V.mk, box = V.box,
      arrowDefs = V.arrowDefs, driver = V.driver, litOnly = V.litOnly;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function hex(v, w) { var s = (v >>> 0).toString(16).toUpperCase(); while (s.length < w) s = "0" + s; return s; }

  /* ============================================================
     CPU · 1 — interpreter vs native execution
     ============================================================ */
  V.register("nativeexec", function (host) {
    var body = frame(host, "Why there is no CPU emulator", "interpreter vs native, same guest code",
      "This is the single most important fact about KytyPS5. The PS5's CPU is an 8-core AMD Zen 2 running x86-64 — the same instruction set as your PC. There is nothing to translate, so the emulator maps the code in and jumps to it. Search the repository for an interpreter loop or a JIT and you will find neither.");

    var wrap = el("div", "atl-two");
    wrap.innerHTML =
      '<div class="atl-col"><h5>If the CPUs differed — interpretation</h5>' +
      '<div class="atl-code" data-r="interp"></div>' +
      '<div class="atl-meter"><span>interpreter stages</span><b data-n="interp">0</b></div></div>' +
      '<div class="atl-col"><h5>PS5 on a PC — native execution</h5>' +
      '<div class="atl-code" data-r="native"></div>' +
      '<div class="atl-meter"><span>host instructions</span><b data-n="native">0</b></div></div>';
    var iR = wrap.querySelector('[data-r="interp"]'), nR = wrap.querySelector('[data-r="native"]');
    var iN = wrap.querySelector('[data-n="interp"]'), nN = wrap.querySelector('[data-n="native"]');

    var GUEST = ["mov  rax, [rdi]", "add  rax, rsi", "mov  [rdi], rax", "ret"];
    var INTERP = [
      "fetch   opcode byte at pc",
      "decode  switch on opcode",
      "read    operand registers",
      "execute the operation",
      "write   result back",
      "advance pc, loop"
    ];

    var CAPS = [
      "Four guest instructions to run. Both columns will execute the same ones.",
      "<b>An interpreter</b> must fetch, decode, read operands, execute, write back and advance — roughly 10–50 host instructions for <em>every one</em> guest instruction. A 3.5&nbsp;GHz guest would need a 100&nbsp;GHz host.",
      "<b>Native execution</b> has no loop at all. The instruction <em>is</em> the host instruction. One for one, at full speed.",
      "After four guest instructions: 24 interpreter stages against 4 host instructions — and each of those stages is itself several host instructions, so the real ratio is nearer 10–50×. It compounds for the billions a game executes per second, which is why every PS4/PS5 emulator takes the native route.",
      "<b>So the difficulty moves elsewhere.</b> The calling convention, the memory layout, the thousands of operating-system functions, and above all the GPU. Roughly 70% of this codebase is graphics."
    ];

    var drv = driver(body, CAPS, function (i) {
      var iCount = 0, nCount = 0;
      iR.innerHTML = GUEST.map(function (g, k) {
        var active = i >= 1 && (i >= 3 || k === 0);
        if (active) iCount += INTERP.length;
        return '<div class="atl-ln' + (active ? " hot" : "") + '">' + g + "</div>" +
          (active ? INTERP.map(function (s) { return '<div class="atl-sub">↳ ' + s + "</div>"; }).join("") : "");
      }).join("");
      nR.innerHTML = GUEST.map(function (g, k) {
        var active = i >= 2 && (i >= 3 || k === 0);
        if (active) nCount += 1;
        return '<div class="atl-ln' + (active ? " hot" : "") + '">' + g + "</div>";
      }).join("");
      iN.textContent = iCount; nN.textContent = nCount;
      wrap.classList.toggle("atl-dim-left", i === 2);
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     CPU · 2 — the calling-convention handoff
     ============================================================ */
  V.register("abiflow", function (host) {
    var body = frame(host, "Where the arguments go", "System V (PS5) vs Microsoft x64 (Windows)",
      "Clang's <code>__attribute__((sysv_abi))</code> is what closes this gap. Every function the guest can call is tagged <code>KYTY_SYSV_ABI</code>, so the compiler emits a System&nbsp;V prologue for that one function while the rest of the emulator stays native. MSVC has no such attribute, which is exactly why the build requires <code>clang-cl</code>.");

    var SYSV = ["rdi", "rsi", "rdx", "rcx", "r8", "r9"];
    var MSX = ["rcx", "rdx", "r8", "r9"];
    var ARGS = ["handle", "index", "flags", "buffer", "size", "userdata"];

    var wrap = el("div", "atl-two");
    wrap.innerHTML =
      '<div class="atl-col"><h5>System V — what the guest does</h5><div data-r="sv" class="atl-regs"></div></div>' +
      '<div class="atl-col"><h5>Microsoft x64 — what Windows expects</h5><div data-r="ms" class="atl-regs"></div></div>';
    var svR = wrap.querySelector('[data-r="sv"]'), msR = wrap.querySelector('[data-r="ms"]');

    var CAPS = [
      "The guest calls <code>scePadReadState(handle, index, flags, buffer, size, userdata)</code> — six arguments.",
      "<b>System&nbsp;V</b> puts the first six integer arguments in <code>rdi rsi rdx rcx r8 r9</code>. That is what the PS5's compiler emitted, and it is what the registers actually contain when execution reaches the emulator.",
      "<b>Microsoft x64</b> uses only four registers — <code>rcx rdx r8 r9</code> — and requires the caller to reserve 32 bytes of shadow space regardless. Note that <code>rcx</code> is argument 4 under System&nbsp;V and argument <em>1</em> under Microsoft.",
      "<b>Read the same registers with the wrong convention</b> and every argument is wrong. <code>handle</code> becomes whatever was in <code>rcx</code> — here the <code>buffer</code> pointer. A struct pointer read as an integer, a size read as a pointer: garbage, and usually a crash somewhere far away.",
      "With <code>KYTY_SYSV_ABI</code> the compiler reads them correctly, and the two worlds line up. The reverse direction — emulator code the <em>guest</em> calls into, like the TLS stubs — has to switch back by hand in assembly."
    ];

    function rows(regs, args, shadow, mismatch) {
      var h = "";
      for (var i = 0; i < 6; i++) {
        var reg = i < regs.length ? regs[i] : "stack";
        var val = args[i];
        var bad = mismatch && reg !== SYSV[i];
        h += '<div class="atl-reg' + (i < regs.length ? "" : " st") + (bad ? " bad" : "") + '">' +
          '<span class="r">' + reg + '</span><span class="v">' + (val || "&mdash;") + "</span></div>";
      }
      if (shadow) h += '<div class="atl-reg st"><span class="r">+32B</span><span class="v">shadow space, always reserved</span></div>';
      return h;
    }

    var drv = driver(body, CAPS, function (i) {
      if (i === 0) { svR.innerHTML = rows(SYSV, ["", "", "", "", "", ""], false, false); msR.innerHTML = rows(MSX, ["", "", "", "", "", ""], true, false); }
      else if (i === 1) { svR.innerHTML = rows(SYSV, ARGS, false, false); msR.innerHTML = rows(MSX, ["", "", "", "", "", ""], true, false); }
      else if (i === 2) { svR.innerHTML = rows(SYSV, ARGS, false, false); msR.innerHTML = rows(MSX, ARGS, true, false); }
      else if (i === 3) {
        svR.innerHTML = rows(SYSV, ARGS, false, false);
        // reading SysV-loaded registers as if they were MS arguments
        msR.innerHTML = rows(MSX, ["buffer", "flags", "size", "userdata", "?", "?"], true, true);
      } else { svR.innerHTML = rows(SYSV, ARGS, false, false); msR.innerHTML = rows(SYSV, ARGS, false, false); }
      wrap.classList.toggle("atl-warn", i === 3);
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     CPU · 3 — rewriting the guest's instruction bytes
     ============================================================ */
  V.register("patchbytes", function (host) {
    var body = frame(host, "Rewriting guest instruction bytes", "the fs:[0] thread-local storage patch",
      "PS5 code reads its thread control block through the <code>fs</code> segment register. Windows uses <code>fs</code> for its own Thread Information Block, so the read returns something unrelated and the guest then dereferences it. With no recompiler in the pipeline, the loader fixes this by rewriting the bytes in place — before the code is ever executed.");

    var BEFORE = ["64", "48", "8B", "04", "25", "00", "00", "00", "00"];
    var AFTER = ["E8", "1C", "4A", "01", "00", "48", "89", "C0", "90"];
    var LBL_B = ["fs prefix", "REX.W", "mov r64", "modrm", "sib", "disp32", "", "", ""];
    var LBL_A = ["call rel32", "", "", "", "", "mov rax,rax", "", "", "nop"];

    var wrap = el("div");
    wrap.innerHTML =
      '<div class="atl-bytes-row"><span class="atl-tag">on disk</span><div class="atl-bytes" data-r="b"></div></div>' +
      '<div class="atl-asm" data-r="ab"></div>' +
      '<div class="atl-bytes-row" style="margin-top:14px"><span class="atl-tag">in memory</span><div class="atl-bytes" data-r="a"></div></div>' +
      '<div class="atl-asm" data-r="aa"></div>';
    var bR = wrap.querySelector('[data-r="b"]'), aR = wrap.querySelector('[data-r="a"]');
    var abR = wrap.querySelector('[data-r="ab"]'), aaR = wrap.querySelector('[data-r="aa"]');

    var CAPS = [
      "The ELF file on disk contains this nine-byte instruction: <code>mov rax, qword ptr fs:[0]</code>. Perfectly valid on the console.",
      "The loader scans every executable segment for the five-byte signature <code>64 48 8B _ 25</code>, tolerating up to three <code>0x66</code> padding prefixes that compilers insert.",
      "It reads the ModR/M byte to learn <b>which register</b> the original targeted — bits 5:3. Here that is <code>rax</code>. A different register selects a different stub variant.",
      "<b>The rewrite.</b> Nine bytes become a five-byte <code>call</code> to a generated stub, a three-byte <code>mov</code> putting the result in the right register, and one <code>nop</code>. Exactly nine bytes, so nothing shifts and no address changes.",
      "At run time the stub fetches the guest's real thread control block, switching from System&nbsp;V to the Microsoft convention on the way in and back on the way out — saving flags and every volatile register, aligning the stack, reserving shadow space.",
      "A second pattern gets the same treatment: stack-canary stores through <code>fs:[0x28]</code>, which would otherwise fault writing to address <code>0x28</code>. Those twelve bytes become <code>nop</code>s — or <code>pop rbp; ret</code> if the loader recognises the canary-failure epilogue that follows."
    ];

    function paint(arr, lbl, target, litFrom, litTo, cls) {
      target.innerHTML = arr.map(function (b, k) {
        var on = k >= litFrom && k <= litTo;
        return '<div class="atl-byte' + (on ? " " + cls : "") + '">' + b +
          (lbl[k] ? '<span class="bl">' + lbl[k] + "</span>" : "") + "</div>";
      }).join("");
    }

    var drv = driver(body, CAPS, function (i) {
      paint(BEFORE, LBL_B, bR, -1, -1, "");
      abR.textContent = "mov rax, qword ptr fs:[0]";
      if (i >= 3) { paint(AFTER, LBL_A, aR, -1, -1, ""); aaR.textContent = "call tls_handler ; mov rax, rax ; nop"; aR.parentElement.style.opacity = 1; aaR.style.opacity = 1; }
      else { aR.innerHTML = ""; aaR.textContent = ""; aR.parentElement.style.opacity = .35; }

      if (i === 1) paint(BEFORE, LBL_B, bR, 0, 4, "sig");
      if (i === 2) paint(BEFORE, LBL_B, bR, 3, 3, "hot");
      if (i === 3) { paint(BEFORE, LBL_B, bR, 0, 8, "old"); paint(AFTER, LBL_A, aR, 0, 8, "new"); }
      if (i === 4) paint(AFTER, LBL_A, aR, 0, 4, "hot");
      if (i === 5) { abR.textContent = "mov qword ptr fs:[0x28], rax   ; the other pattern"; }
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     CPU · 4 — the exception handler as control flow
     ============================================================ */
  V.register("faultpath", function (host) {
    var body = frame(host, "A fault arrives — what happens next", "three of these branches are load-bearing",
      "Because guest code runs natively, the emulator cannot instrument it. The CPU's own fault mechanism becomes the primary hook: three of the four branches below are deliberate design, not error handling.");

    var W = 740, H = 300;
    var s = svg(W, H, "Decision tree for a CPU fault inside guest code");
    arrowDefs(s);

    var start = box(s, 270, 8, 200, 40, "g", "CPU raises a fault", "in guest code");
    var b1 = box(s, 40, 78, 300, 44, "h", "Illegal instruction?", "X64InstructionEmulator::TryEmulate");
    var b2 = box(s, 40, 140, 300, 44, "k", "GPU-watched page?", "Memory::HandleGpuFault");
    var b3 = box(s, 40, 202, 300, 44, "k", "Reserved, not committed?", "KernelHandleReservedRangeAccessViolation");
    var crash = box(s, 400, 202, 300, 44, "h", "Genuine crash", "dump module, code, regs, stack walk");
    var resume = box(s, 400, 106, 300, 50, "g", "return true", "guest resumes — it never knew");

    var arr = [];
    [[190, 48, 190, 76], [190, 122, 190, 138], [190, 184, 190, 200], [340, 224, 396, 224]].forEach(function (c) {
      var p = mk("path", { d: "M" + c[0] + " " + c[1] + " L" + c[2] + " " + c[3], "class": "wire", "marker-end": "url(#vz-ah)" });
      s.appendChild(p); arr.push(p);
    });
    var toResume = [];
    [100, 162, 224].forEach(function (y) {
      var p = mk("path", { d: "M340 " + y + " C 372 " + y + ", 372 131, 396 131", "class": "wire", "stroke-dasharray": "4 3", "marker-end": "url(#vz-ah)" });
      s.appendChild(p); toResume.push(p);
    });
    var yes = mk("text", { x: 352, y: 262, "class": "s" }, "no to all three");
    s.appendChild(yes);

    var CAPS = [
      "Guest code faults. On Windows this arrives as a vectored exception; on Linux and macOS as a signal. Either way it reaches <code>KytyExceptionHandler</code>.",
      "<b>Branch 1 — an instruction this CPU lacks.</b> The PS5's Zen 2 has instructions your processor may not, notably the SHA extensions. The handler decodes the bytes at the fault address, performs the operation in software against the saved register context, advances the instruction pointer past it, and resumes.",
      "<b>Branch 2 — the GPU cares about this page.</b> Memory the renderer has cached as a Vulkan resource is deliberately write-protected. A guest write traps here, the tracker marks the page dirty, protection is lifted, and execution resumes. <b>The fault is the notification mechanism</b> — there is no other way to learn of the write without a recompiler.",
      "<b>Branch 3 — reserved but not yet committed.</b> The guest touched a range inside a reservation the memory manager commits on demand.",
      "<b>Otherwise it is a real crash.</b> The handler prints the faulting module, 64 bytes of code around the fault (probed first so the dump does not itself fault), all sixteen registers, sixteen stack words, and a guest stack walk — accepted only where the frame pointer is inside the stack and the return address inside the module band.",
      "Reading the dump: a fault address of <code>0x28</code> means an unpatched canary store. A small address usually means a null pointer downstream of a stubbed import that returned zero. An address in the <code>0x9…</code> band with a sensible stack walk is a genuine guest bug."
    ];

    body.insertBefore(s, body.firstChild);
    var drv = driver(body, CAPS, function (i) {
      [start, b1, b2, b3, crash, resume].forEach(function (n) { n.rect.classList.remove("lit"); });
      arr.concat(toResume).forEach(function (p) { p.classList.remove("on"); });
      yes.setAttribute("opacity", i >= 4 ? 1 : 0.25);
      if (i === 0) { start.rect.classList.add("lit"); }
      if (i === 1) { b1.rect.classList.add("lit"); resume.rect.classList.add("lit"); arr[0].classList.add("on"); toResume[0].classList.add("on"); }
      if (i === 2) { b2.rect.classList.add("lit"); resume.rect.classList.add("lit"); arr[1].classList.add("on"); toResume[1].classList.add("on"); }
      if (i === 3) { b3.rect.classList.add("lit"); resume.rect.classList.add("lit"); arr[2].classList.add("on"); toResume[2].classList.add("on"); }
      if (i >= 4) { crash.rect.classList.add("lit"); arr[3].classList.add("on"); }
    }, 3600);
    return drv;
  });

  /* ============================================================
     MEMORY · 1 — the address space, filling up
     ============================================================ */
  V.register("addrmap", function (host) {
    var body = frame(host, "The guest address space, filling up", "who owns which addresses, and why",
      "Kyty does not let the host OS choose where anything goes. It claims whole bands up front and hands out pieces itself — which is what makes a guest pointer distinguishable from a host pointer by value alone, and what lets the crash handler walk a guest stack by range-checking return addresses.");

    var BANDS = [
      { k: "h", n: "system managed", a: "0x00_0004_0000", w: 22, d: "host OS, emulator image, Qt, SDL, Vulkan driver" },
      { k: "k", n: "system reserved", a: "0x07_FFFF_C000", w: 22, d: "loaded guest modules + generated PLT tables" },
      { k: "g", n: "user area", a: "0x10_0000_0000", w: 42, d: "every guest allocation" },
      { k: "x", n: "host high", a: "0xFC…", w: 14, d: "emulator linked up here on purpose" }
    ];
    var ITEMS = [
      { at: 1, band: 1, label: "eboot.bin @ 0x900000000", note: "The main executable lands at the band base plus a <code>0x100000000</code> code offset. Each further module is placed <code>0x10000000</code> — 256 MB — beyond the last." },
      { at: 2, band: 1, label: "libSceX.prx @ 0x910000000", note: "Adjacent <code>.prx</code> modules are preloaded before relocation, because a symbol may be exported by a module loaded after the one importing it." },
      { at: 3, band: 2, label: "direct memory (GPU-visible)", note: "<b>Direct memory</b> is a reservation out of <em>physical</em> memory identified by a physical offset; mapping it to a virtual address is a separate step, and one physical range may be mapped twice." },
      { at: 4, band: 2, label: "flexible memory", note: "<b>Flexible memory</b> is ordinary paged memory from a fixed per-title budget declared in <code>param.json</code> — applied before the memory subsystem initialises, because pools are sized during init." },
      { at: 5, band: 2, label: "guest thread stacks", note: "Each guest thread needs a stack <em>inside</em> the guest bands, because guest code computes addresses relative to it and those addresses may be handed to the GPU." },
      { at: 6, band: 1, label: "unresolved-import thunks", note: "162 bytes per unresolved import, packed into executable pages — 25 to a 4 KB page." }
    ];

    var wrap = el("div");
    var bar = el("div", "atl-space");
    BANDS.forEach(function (b, i) {
      var d = el("div", "atl-band b" + b.k);
      d.style.flex = "0 0 " + b.w + "%";
      d.innerHTML = '<span class="bn">' + b.n + '</span><span class="ba">' + b.a + "</span><div class='bi' data-band='" + i + "'></div>";
      bar.appendChild(d);
    });
    wrap.appendChild(bar);
    wrap.appendChild(el("div", "atl-scale", "<span>low addresses</span><span>log scale — the user area is far larger than it looks</span><span>high</span>"));

    var CAPS = [
      "Four bands. Nothing crosses between them. On Windows this is enforced by passing an explicit lowest/highest address pair to <code>VirtualAlloc2</code>, so the allocator physically cannot return an address outside the band it was asked for."
    ].concat(ITEMS.map(function (it) { return it.note; })).concat([
      "Notice the shape of the result: a value beginning <code>0x9…</code> is guest module code, <code>0x1…</code> is guest heap, and anything above <code>0x7000_0000_0000</code> is the emulator itself. That is not decoration — it turns a whole class of pointer-confusion bug into something you can spot in a hex dump."
    ]);

    var drv = driver(body, CAPS, function (i) {
      [0, 1, 2, 3].forEach(function (b) {
        var slot = wrap.querySelector(".bi[data-band='" + b + "']");
        slot.innerHTML = ITEMS.filter(function (it) { return it.band === b && it.at <= i; })
          .map(function (it) { return '<span class="chipm' + (it.at === i ? " nu" : "") + '">' + it.label + "</span>"; }).join("");
      });
      Array.prototype.forEach.call(bar.children, function (c, k) {
        var active = (i === 0) || ITEMS.some(function (it) { return it.at === i && it.band === k; });
        c.classList.toggle("lit", active);
      });
    }, 3600);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     MEMORY · 2 — 16 KB guest pages over 4 KB host pages
     ============================================================ */
  V.register("pagegrain", function (host) {
    var body = frame(host, "One guest page is four host pages", "why protection is coarser than you would like",
      "The PS5 uses 16 KB pages and games observe this through <code>sceKernelVirtualQuery</code> and alignment requirements. Your PC uses 4 KB. Kyty's allocator works in <code>0x4000</code> units, so every protection change touches four host pages at once — and a single guest write dirties the whole 16 KB.");

    var wrap = el("div");
    wrap.innerHTML =
      '<div class="atl-tag">guest view — 16 KB pages</div><div class="atl-gp" data-r="g"></div>' +
      '<div class="atl-tag" style="margin-top:14px">host view — 4 KB pages</div><div class="atl-hp" data-r="h"></div>';
    var gR = wrap.querySelector('[data-r="g"]'), hR = wrap.querySelector('[data-r="h"]');

    var CAPS = [
      "Four guest pages of 16 KB, sitting on sixteen host pages of 4 KB.",
      "The renderer uploads a texture living in guest page 1 and write-protects it. On the host that means <b>four</b> <code>VirtualProtect</code>-equivalent calls, or one call spanning four pages.",
      "The game writes <b>one byte</b> somewhere in guest page 1. One host page faults.",
      "But the tracker's granularity is the guest page, so <b>the whole 16 KB is marked dirty</b> — and the next upload copies all of it, not the four bytes that changed. Correct, and conservative.",
      "This is a deliberate trade. Tracking at 4 KB would upload less but multiply the bookkeeping and the fault count; tracking at 16 KB matches what the guest believes about its own memory."
    ];

    var drv = driver(body, CAPS, function (i) {
      var gcls = ["", "", "", ""], hcls = new Array(16).fill("");
      if (i >= 1) { gcls[1] = "lock"; for (var k = 4; k < 8; k++) hcls[k] = "lock"; }
      if (i === 2) { hcls[5] = "fault"; }
      if (i >= 3) { gcls[1] = "dirty"; for (var j = 4; j < 8; j++) hcls[j] = "dirty"; }
      gR.innerHTML = gcls.map(function (c, k) { return '<div class="atl-pgbox ' + c + '">guest page ' + k + '<span>16 KB</span></div>'; }).join("");
      hR.innerHTML = hcls.map(function (c, k) { return '<div class="atl-pgsm ' + c + '">' + k + "</div>"; }).join("");
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     STARTUP · 1 — the ELF becoming a running program
     ============================================================ */
  V.register("elfmap", function (host) {
    var body = frame(host, "From file on disk to executable memory", "LoadProgramToMemory, step by step",
      "Note the ordering: patch, then protect, then flush the instruction cache. Reversing any two of those either faults or executes stale bytes.");

    var wrap = el("div", "atl-two atl-elf");
    wrap.innerHTML =
      '<div class="atl-col"><h5>eboot.bin</h5><div data-r="f" class="atl-segs"></div></div>' +
      '<div class="atl-col"><h5>guest memory @ 0x900000000</h5><div data-r="m" class="atl-segs"></div></div>';
    var fR = wrap.querySelector('[data-r="f"]'), mR = wrap.querySelector('[data-r="m"]');

    var SEG = [
      { t: "ELF header + phdrs", k: "", mem: null },
      { t: "PT_LOAD  R-X   .text", k: "g", mem: "code — ExecuteRead" },
      { t: "PT_LOAD  R--   .rodata", k: "g", mem: "read-only data — Read" },
      { t: "PT_LOAD  RW-   .data", k: "g", mem: "data — ReadWrite, tail zeroed" },
      { t: "PT_TLS  (template)", k: "k", mem: "recorded, copied per thread" },
      { t: "PT_OS_DYNLIBDATA", k: "k", mem: "symbol / reloc tables" },
      { t: "PT_OS_PROCPARAM", k: "k", mem: "proc_param_vaddr" }
    ];

    var CAPS = [
      "A SELF container wrapping standard ELF64, with Sony's own type and tag values: <code>ET_DYNEXEC = 0xfe10</code>, and a <code>PT_OS_DYNLIBDATA</code> segment holding the symbol, string and relocation tables.",
      "<b>Compute the span.</b> The highest address any <code>PT_LOAD</code> or <code>PT_OS_RELRO</code> segment reaches, rounded up to a 16 KB guest page, plus room for the generated TLS handler.",
      "<b>Reserve it</b> as ExecuteReadWrite. Correct per-segment protection comes later — the loader needs write access to copy data in and to patch instructions.",
      "<b>Copy each loadable segment</b> to <code>p_vaddr + base_vaddr</code>. Where <code>filesz &lt; memsz</code> the remainder is zero-filled — that is how <code>.bss</code> arrives.",
      "<b>Patch executable segments</b> for the <code>fs:</code> patterns, while the pages are still writable.",
      "<b>Now</b> apply real protection per segment and flush the instruction cache over the executable ranges.",
      "<b>Record, don't copy:</b> the TLS image is a template each thread copies from lazily, and the process-parameter block is just an address the runtime reads. Nothing has executed yet — not even module initialisers."
    ];

    var drv = driver(body, CAPS, function (i) {
      fR.innerHTML = SEG.map(function (sg, k) {
        var lit = (i === 3 && k >= 1 && k <= 3) || (i === 4 && k === 1) || (i === 6 && k >= 4);
        return '<div class="atl-seg ' + sg.k + (lit ? " lit" : "") + '">' + sg.t + "</div>";
      }).join("");
      mR.innerHTML = SEG.filter(function (sg) { return sg.mem; }).map(function (sg, k) {
        var shown = i >= 3 || (i >= 2 && false);
        var isTls = sg.mem.indexOf("per thread") >= 0 || sg.mem.indexOf("proc_param") >= 0 || sg.mem.indexOf("reloc") >= 0;
        var vis = i >= 3 && (!isTls || i >= 6);
        var lit = (i === 5 && !isTls) || (i === 6 && isTls);
        return '<div class="atl-seg ' + sg.k + (lit ? " lit" : "") + '" style="opacity:' + (vis ? 1 : .2) + '">' + sg.mem + "</div>";
      }).join("");
      wrap.classList.toggle("atl-reserved", i >= 2);
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     STARTUP · 2 — relocation filling the GOT
     ============================================================ */
  V.register("relocgot", function (host) {
    var body = frame(host, "Relocation — wiring the imports", "one pointer per row, and the game never changes",
      "Every import the emulator implements is bound here. Everything it does not gets a generated 162-byte thunk that retries resolution at call time and, failing that, returns zero — which is why a stubbed function produces odd behaviour rather than a clean crash.");

    var ROWS = [
      { nid: "lUwEK9UwLNo", lib: "libSceGnmDriver", to: "Gen5::GraphicsSubmit", kind: "hle" },
      { nid: "4J2sUJmuHZQ", lib: "libkernel", to: "KernelGetProcessTime", kind: "hle" },
      { nid: "7H0iTOciTLo", lib: "Posix", to: "pthread_mutex_lock", kind: "hle" },
      { nid: "aBcDeFgHiJk", lib: "libSceSomething", to: "lazy thunk (unresolved)", kind: "stub" },
      { nid: "0GnN4QCgIfs", lib: "ContentExport", to: "ContentExportInit2", kind: "hle" }
    ];

    var wrap = el("div");
    wrap.innerHTML = '<div class="atl-reloc" data-r="t"></div>';
    var tR = wrap.querySelector('[data-r="t"]');

    var CAPS = [
      "The module's <code>jmprela</code> table: one <code>R_X86_64_JUMP_SLOT</code> record per imported function. Each names a NID and targets a Global Offset Table slot.",
      "PS5 modules do not export readable names. A NID is an 11-character encoding of a hash, qualified by library and module — <code>nid#library#module</code> — and the library and module identifiers are small integers resolved through the file's own import tables.",
      "<b>Resolution searches the HLE database first.</b> If Kyty implements that NID, the address of its own C++ function is written into the GOT slot.",
      "Then every other loaded module's export table, in load order. This is why all modules must be present before relocation begins.",
      "<b>Anything left over gets a thunk.</b> Aborting here would make almost nothing bootable, because games import far more than they call. Failing lazily at call time limits the damage to code paths actually taken — and the log records exactly which NID was stubbed.",
      "Five slots filled, one stubbed, and <b>not a single byte of the game's own code was modified</b>. Every call goes through its PLT stub, which jumps through the GOT."
    ];

    var drv = driver(body, CAPS, function (i) {
      tR.innerHTML = ROWS.map(function (r, k) {
        var resolved = (r.kind === "hle" && i >= 2 && k <= (i === 2 ? 0 : (i === 3 ? 2 : 4))) ||
                       (r.kind === "hle" && i >= 4);
        var stubbed = r.kind === "stub" && i >= 4;
        var lit = (i === 2 && k === 0) || (i === 3 && (k === 1 || k === 2)) || (i === 4 && r.kind === "stub");
        return '<div class="atl-rr' + (lit ? " lit" : "") + '">' +
          '<span class="nid">' + r.nid + "</span>" +
          '<span class="lib">' + r.lib + "</span>" +
          '<span class="arw">' + (resolved || stubbed ? "→" : "·") + "</span>" +
          '<span class="tgt ' + (stubbed ? "stub" : (resolved ? "ok" : "")) + '">' +
            (resolved ? r.to : (stubbed ? r.to : "&nbsp;")) + "</span></div>";
      }).join("");
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     GPU · 1 — a PM4 stream being consumed
     ============================================================ */
  V.register("pm4stream", function (host) {
    var body = frame(host, "A PM4 command stream being consumed", "dwords in, register writes out, then a draw",
      "This is what the GPU thread does all day. Register-write packets accumulate state; a draw packet carries almost no information of its own and consumes everything set before it. That is why <code>agcRegisterDefaults.inc</code> — a 215 KB table of reset values — is the largest file in the repository: games only set the registers they change.");

    var STREAM = [
      { dw: "0xC0021000", op: "IT_NOP", n: 3, note: "padding / alignment", eff: null },
      { dw: "0xC0016900", op: "IT_SET_CONTEXT_REG", n: 2, note: "2 context registers", eff: ["CB_COLOR0_BASE", "CB_COLOR0_INFO"] },
      { dw: "0xC0016900", op: "IT_SET_CONTEXT_REG", n: 2, note: "2 more", eff: ["DB_Z_INFO", "DB_DEPTH_CONTROL"] },
      { dw: "0xC0027600", op: "IT_SET_SH_REG", n: 3, note: "shader user data", eff: ["SPI_SHADER_PGM_LO_PS", "USER_DATA_0"] },
      { dw: "0xC0007900", op: "IT_SET_UCONFIG_REG", n: 1, note: "primitive type", eff: ["VGT_PRIMITIVE_TYPE"] },
      { dw: "0xC0012D00", op: "IT_DRAW_INDEX_AUTO", n: 2, note: "← the draw", eff: null },
      { dw: "0xC0044900", op: "IT_RELEASE_MEM", n: 5, note: "end-of-pipe fence", eff: null },
      { dw: "0xC000105C", op: "IT_NOP  R_FLIP", n: 1, note: "present", eff: null }
    ];

    var wrap = el("div", "atl-pm4");
    wrap.innerHTML =
      '<div class="atl-col"><h5>command buffer</h5><div class="atl-stream" data-r="s"></div></div>' +
      '<div class="atl-col"><h5>hardware register file</h5><div class="atl-regfile" data-r="r"></div>' +
      '<div class="atl-out" data-r="o"></div></div>';
    var sR = wrap.querySelector('[data-r="s"]'), rR = wrap.querySelector('[data-r="r"]'), oR = wrap.querySelector('[data-r="o"]');

    var CAPS = [
      "The stream is a sequence of 32-bit dwords. Each packet's header carries its type in bits 31:30, a body length in 29:16, and an opcode in 15:8. Everything Kyty handles is type&nbsp;3.",
      "<code>IT_NOP</code> — skipped. Sony also uses NOP packets as a carrier: bits 7:2 hold a sub-selector, so <code>R_FLIP</code> and friends arrive disguised as no-ops.",
      "<b>A context-register write.</b> The handler is found by indexing <code>g_hw_ctx_func</code> with the register offset, unpacks the bit fields into a typed struct, and returns how many dwords it consumed so multi-register writes advance correctly.",
      "More context state — depth this time. Note that nothing has been drawn yet; this is all accumulation.",
      "<b>Shader registers.</b> Shader addresses plus up to 64 dwords of user data, which is the <em>only</em> channel by which a draw passes parameters to its shaders.",
      "User-config state: the primitive type. Rect-list appears constantly here for full-screen passes, and Vulkan has no equivalent primitive.",
      "<b>The draw packet.</b> Two body dwords — an index count and flags — and that is all. Everything else comes from the register file you just watched fill up. Now the real work starts: resolve targets, recompile shaders if not cached, materialise descriptors, build a pipeline, record <code>vkCmdDraw</code>.",
      "<b>End of pipe.</b> \"When everything before this has completed, write this value there and raise an interrupt.\" Kyty maps these onto Vulkan timeline semaphores and its own event queues — this is how the game learns a frame is done.",
      "<b>Flip.</b> The guest's buffer gets blitted into the swapchain image and presented. One frame, and the register file carries over to the next."
    ];

    var regs = {};
    var drv = driver(body, CAPS, function (i) {
      var upto = Math.min(i, STREAM.length);
      sR.innerHTML = STREAM.map(function (p, k) {
        var done = k < upto - 1, cur = k === upto - 1;
        return '<div class="atl-pk' + (cur ? " cur" : (done ? " done" : "")) + '">' +
          '<span class="d">' + p.dw + '</span><span class="o">' + p.op + '</span>' +
          '<span class="c">+' + p.n + ' dw</span></div>';
      }).join("");

      regs = {};
      for (var k = 0; k < upto; k++) if (STREAM[k].eff) STREAM[k].eff.forEach(function (r) { regs[r] = k; });
      var keys = Object.keys(regs);
      rR.innerHTML = keys.length
        ? keys.map(function (r) { return '<div class="atl-rg' + (regs[r] === upto - 1 ? " nu" : "") + '">' + r + "</div>"; }).join("")
        : '<div class="atl-rg empty">empty — defaults from agcRegisterDefaults.inc</div>';

      var msg = "";
      if (i === 6) msg = "<b>DRAW</b> consumes " + keys.length + " registers of accumulated state";
      if (i === 7) msg = "<b>FENCE</b> timeline semaphore signalled";
      if (i === 8) msg = "<b>FLIP</b> swapchain present";
      oR.innerHTML = msg;
      oR.classList.toggle("hot", !!msg);
    }, 3200);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     GPU · 2 — 57 queues, and one of them blocked
     ============================================================ */
  V.register("queuebank", function (host) {
    var body = frame(host, "One graphics queue, fifty-six compute queues", "and what happens when one blocks",
      "The queue topology mirrors the hardware because games rely on it for asynchronous compute. Each queue owns its own <code>CommandProcessor</code> — and therefore its own register state — so they never contaminate one another.");

    var wrap = el("div");
    wrap.innerHTML =
      '<div class="atl-tag">graphics</div><div class="atl-qgfx" data-r="g"></div>' +
      '<div class="atl-tag" style="margin-top:12px">compute — 7 pipes × 8 queues</div><div class="atl-qbank" data-r="c"></div>';
    var gR = wrap.querySelector('[data-r="g"]'), cR = wrap.querySelector('[data-r="c"]');

    var CAPS = [
      "57 queues: one graphics, plus seven compute pipes of eight queues each. All idle.",
      "The game submits a graphics command buffer. Kyty <b>copies</b> it first — games reuse that memory sooner than a strict reading of the fence protocol allows — then enqueues it.",
      "Compute work arrives on several pipes at once. This is asynchronous compute: physics, culling and post-processing running alongside the graphics stream.",
      "<b>The graphics queue hits a <code>WAIT_REG_MEM</code></b> whose condition is not yet true. On real hardware the command processor spins.",
      "Kyty returns <code>Pm4ProcessResult::Blocked</code> and <b>suspends the submission</b>, keeping its buffer-stack cursor intact. The compute queues keep running — a busy-wait here would starve them.",
      "The condition becomes true, the graphics submission resumes exactly where it stopped, and the frame completes. <code>Pm4Execution</code> also tracks whether any progress was made, so a queue that is blocked and getting nowhere can be skipped rather than spun on."
    ];

    var drv = driver(body, CAPS, function (i) {
      var gcls = i === 0 ? "" : (i >= 3 && i <= 4 ? "blocked" : "busy");
      gR.innerHTML = '<div class="atl-q ' + gcls + '">GFX<span>' +
        (i === 0 ? "idle" : (i === 3 ? "WAIT_REG_MEM" : (i === 4 ? "suspended" : "running"))) + "</span></div>";
      var h = "";
      for (var p = 0; p < 7; p++) {
        h += '<div class="pl">pipe ' + p + "</div>";
        for (var q = 0; q < 8; q++) {
          var busy = i >= 2 && ((p * 8 + q) % 3 === 0);
          h += '<div class="atl-qs ' + (busy ? "busy" : "") + '" title="pipe ' + p + ' queue ' + q + '"></div>';
        }
      }
      cR.innerHTML = h;
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });

  /* ============================================================
     GPU · 3 — finding the texture a shader wants
     ============================================================ */
  V.register("srtwalk", function (host) {
    var body = frame(host, "How the emulator finds the texture a shader wants", "user data → table → descriptor → Vulkan",
      "There is no analogue for this in any PC graphics API, and it is why the shader recompiler needs a dataflow analysis. The plan is computed once at compile time and re-executed on every draw — which is how one compiled shader serves many draws with different textures bound.");

    var W = 740, H = 190;
    var s = svg(W, H, "Pointer chase from shader user data to a bound Vulkan image");
    arrowDefs(s);
    var n1 = box(s, 12, 66, 150, 54, "g", "User data", "s[0:1] = 0x1A40000");
    var n2 = box(s, 196, 66, 150, 54, "g", "SRT in memory", "table of descriptors");
    var n3 = box(s, 380, 66, 150, 54, "g", "T# descriptor", "8 dwords");
    var n4 = box(s, 564, 66, 164, 54, "h", "VkImageView", "bound for the draw");
    var w = [];
    [[162, 93, 192], [346, 93, 376], [530, 93, 560]].forEach(function (c) {
      var p = mk("path", { d: "M" + c[0] + " " + c[1] + " L" + c[2] + " " + c[1], "class": "wire", "marker-end": "url(#vz-ah)" });
      s.appendChild(p); w.push(p);
    });
    var asmT = mk("text", { x: 12, y: 26, "class": "s" }, "");
    var asmT2 = mk("text", { x: 12, y: 42, "class": "s" }, "");
    s.appendChild(asmT); s.appendChild(asmT2);
    var noteT = mk("text", { x: 12, y: 165, "class": "s" }, "");
    s.appendChild(noteT);

    var CAPS = [
      "A shader receives up to 64 dwords in its first scalar registers, written by <code>SET_SH_REG</code> packets. Inside those dwords the game may place inline descriptors, plain constants, or <b>pointers to tables</b> — in any arrangement it likes.",
      "In the machine code you see the shader loading a pointer out of its own user data, then loading a 256-bit descriptor from that table. Tables may point at further tables, to arbitrary depth.",
      "<b>ScalarProvenance</b> works out, for every scalar value, where it came from: a user-data slot, a constant, an arithmetic combination, a memory load, or unknown. 34 KB of analysis with a 52 KB test file.",
      "<b>BuildSrtPlan</b> turns that provenance into a recipe — the list of memory reads needed to recover each descriptor, expressed relative to user data. Constant offsets get compact slots; genuinely dynamic offsets stay explicit and are never given a fake slot.",
      "<b>MaterializeResources</b> executes the recipe against the <em>current</em> user data and guest memory, producing concrete descriptors: this address, this format, these dimensions, this tiling mode.",
      "Which finally becomes a Vulkan image view. And if any read fails — a null pointer, an unmapped address — <code>ShaderMaterializeStageRuntime</code> keeps the <em>previous</em> stage rather than binding garbage. A failed descriptor read produces a stale frame, not corruption."
    ];

    body.insertBefore(s, body.firstChild);
    var drv = driver(body, CAPS, function (i) {
      [n1, n2, n3, n4].forEach(function (n) { n.rect.classList.remove("lit"); });
      w.forEach(function (p) { p.classList.remove("on"); p.setAttribute("stroke-dasharray", "4 3"); });
      asmT.textContent = i >= 1 ? "s_load_dwordx4  s[8:11], s[0:1], 0x20    ; pointer out of user data" : "";
      asmT2.textContent = i >= 1 ? "s_load_dwordx8  s[12:19], s[8:9], 0x40   ; T# out of that table" : "";
      noteT.textContent = ["", "", "compile time — analysis", "compile time — plan", "draw time — execute the plan", "draw time — bind"][i] || "";
      if (i === 0) n1.rect.classList.add("lit");
      if (i === 1) { n1.rect.classList.add("lit"); n2.rect.classList.add("lit"); w[0].classList.add("on"); w[0].removeAttribute("stroke-dasharray"); }
      if (i === 2 || i === 3) { n1.rect.classList.add("lit"); n2.rect.classList.add("lit"); w[0].classList.add("on"); w[0].removeAttribute("stroke-dasharray"); }
      if (i === 4) { [n1, n2, n3].forEach(function (n) { n.rect.classList.add("lit"); }); w.slice(0, 2).forEach(function (p) { p.classList.add("on"); p.removeAttribute("stroke-dasharray"); }); }
      if (i === 5) { [n1, n2, n3, n4].forEach(function (n) { n.rect.classList.add("lit"); }); w.forEach(function (p) { p.classList.add("on"); p.removeAttribute("stroke-dasharray"); }); }
    }, 3600);
    return drv;
  });

  /* ============================================================
     PRESENT · 1 — the flip model
     ============================================================ */
  V.register("flipmodel", function (host) {
    var body = frame(host, "The flip model", "a game does not 'present a frame'",
      "Reproducing this protocol faithfully matters more than it sounds. A flip submitted while another is pending must block, exactly as on hardware, and the virtual vertical blank must stay steady even when rendering is slow — many engines drive their entire simulation from it, so a late vblank means a late simulation step, not just a late frame.");

    var wrap = el("div");
    wrap.innerHTML =
      '<div class="atl-tag">registered buffers (guest memory)</div><div class="atl-bufs" data-r="b"></div>' +
      '<div class="atl-flipbar"><span data-r="q">flip queue: empty</span><span data-r="v" class="vb">vblank</span></div>' +
      '<div class="atl-tag" style="margin-top:12px">host swapchain</div><div class="atl-swap" data-r="s"></div>';
    var bR = wrap.querySelector('[data-r="b"]'), qR = wrap.querySelector('[data-r="q"]'),
        vR = wrap.querySelector('[data-r="v"]'), sR = wrap.querySelector('[data-r="s"]');

    var CAPS = [
      "<code>VideoOutRegisterBuffers2</code>: the game hands over guest addresses plus a tiling and format description. Kyty records them; the texture cache creates images lazily.",
      "The game renders into buffer 0 through the ordinary command stream — the same draws you watched in the PM4 animation.",
      "<code>VideoOutSubmitFlip</code> is <b>queued, not immediate</b>. It asks the display to scan out buffer 0 starting at the next vertical blank.",
      "Meanwhile the game starts rendering buffer 1. A second flip submitted now would <b>block</b> until the first completes — and that back-pressure is how many games pace themselves.",
      "<b>Vertical blank fires.</b> A virtual one, at the configured rate — 60 Hz by default, <code>--vblank-frequency</code>. Events are pushed into every queue that registered for them.",
      "Only now does the guest buffer reach the host: blitted into the acquired swapchain image and presented. The flip completes and its event is delivered.",
      "There is a more interesting variant. <code>SubmitFlipFromGpu</code> requests a flip from <em>inside</em> the command stream, which must happen after the preceding draws complete — so it becomes a Vulkan submission ordered by timeline semaphore rather than a CPU-side call."
    ];

    var drv = driver(body, CAPS, function (i) {
      var st = ["", "", ""];
      if (i === 1) st[0] = "render";
      if (i === 2) st[0] = "flipq";
      if (i === 3) { st[0] = "flipq"; st[1] = "render"; }
      if (i === 4) { st[0] = "flipq"; st[1] = "render"; }
      if (i >= 5) { st[0] = "scanout"; st[1] = "render"; }
      bR.innerHTML = st.map(function (c, k) {
        var lbl = { render: "rendering", flipq: "flip queued", scanout: "scanning out" }[c] || "idle";
        return '<div class="atl-buf ' + c + '">buffer ' + k + "<span>" + lbl + "</span></div>";
      }).join("");
      qR.textContent = i >= 2 && i < 5 ? "flip queue: buffer 0 pending" : (i >= 5 ? "flip queue: empty (completed)" : "flip queue: empty");
      vR.classList.toggle("fire", i === 4);
      sR.innerHTML = i >= 5
        ? '<div class="atl-sw lit">swapchain image — presented</div>'
        : '<div class="atl-sw">swapchain image — waiting</div>';
    }, 3400);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  });
})();
