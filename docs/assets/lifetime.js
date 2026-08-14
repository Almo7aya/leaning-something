/* ============================================================
   lifetime.js — one continuous run of the emulator, from the
   process starting to a finished frame on screen.

   The point of this page is coherence: the same four panels stay
   on screen the whole way through, so you can watch cause and
   effect across them. Guest memory fills up on the left, the
   active mechanism plays out in the middle, and the render target
   on the right goes from black to a finished frame — all driven
   by the same step index.

   Nothing plays on its own. Prev/Next drive it; Play is opt-in.
   ============================================================ */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function s(tag, attrs, txt) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (txt != null) n.textContent = txt;
    return n;
  }
  function esc(t) {
    return String(t).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  /* ============================================================
     GUEST ADDRESS SPACE
     Bands appear as the run reaches the step that creates them.
     ============================================================ */

  var BANDS = [
    { at: 1,  a: "0x0000000000", n: "host process",       sz: "the emulator itself", k: "host" },
    { at: 2,  a: "0x0400000000", n: "guest reservation",  sz: "reserved, uncommitted", k: "res" },
    { at: 4,  a: "0x0900000000", n: "eboot.bin  .text",   sz: "132 KB  R-X", k: "guest" },
    { at: 4,  a: "0x0900021000", n: "eboot.bin  .rodata", sz: "12 KB  R--", k: "guest" },
    { at: 4,  a: "0x0900024000", n: "eboot.bin  .data",   sz: "20 KB  RW-", k: "guest" },
    { at: 5,  a: "0x0900029000", n: "TLS template",       sz: "64 B + 128 B .tbss", k: "guest" },
    { at: 8,  a: "0x090002c000", n: "GOT",                sz: "patched by the linker", k: "kyty" },
    { at: 11, a: "0x0910000000", n: "thread stacks  ×4",  sz: "512 KB each", k: "kyty" },
    { at: 12, a: "0x0a00000000", n: "direct memory",      sz: "256 MB  texture + vertex", k: "guest" },
    { at: 13, a: "0x0b00000000", n: "command ring",       sz: "2 MB  PM4 packets", k: "guest" }
  ];

  /* ============================================================
     STEPS
     ============================================================ */

  var STEPS = [
    { p: "Launch", t: "The host process starts", to: ["t-what-an-emulator-is.html", "01 · What an emulator is"],
      stage: "boot", focus: "mem",
      say: "Nothing is emulated yet. This is an ordinary program: it registers its subsystems, parses the command line, and opens a window. The guest does not exist." },

    { p: "Launch", t: "Reserve the guest address space", to: ["t-address-space.html", "09 · The guest address space"],
      stage: "reserve", focus: "mem",
      say: "Before any game data is touched, the emulator claims the whole address range the guest expects to own — up front, in one reservation. It cannot hand out addresses later if the host has already used them for something else." },

    { p: "Load", t: "Open eboot.bin", to: ["t-elf-and-self.html", "05 · ELF, SELF and Sony's format"],
      stage: "self", focus: "stage",
      say: "The executable is a <b>SELF</b>: a Sony container wrapping an ELF. Inside, the type is <code>ET_SCE_DYNEXEC</code> — a value no ordinary loader accepts, which is the first sign you are not dealing with a normal binary." },

    { p: "Load", t: "Read the program headers", to: ["t-elf-and-self.html", "05 · ELF, SELF and Sony's format"],
      stage: "phdr", focus: "stage",
      say: "Each <code>PT_LOAD</code> says where its bytes want to live and how much room they need. Note <code>.data</code>: <code>filesz</code> is smaller than <code>memsz</code>, and that gap is <code>.bss</code> — it must be zero-filled, not copied." },

    { p: "Load", t: "Map the segments", to: ["t-mapping.html", "06 · Mapping a program into memory"],
      stage: "map", focus: "mem",
      say: "Segments are copied to <code>p_vaddr + base</code> and given their final protection. The code band is now R-X and holds real guest instructions — but nothing has executed yet." },

    { p: "Load", t: "Set aside the TLS template", to: ["t-threads.html", "11 · Threads and TLS"],
      stage: "tls", focus: "mem",
      say: "<code>PT_TLS</code> is not thread-local storage — it is the <em>pattern</em> for it. Every thread created later gets its own copy, with the <code>.tbss</code> tail zeroed." },

    { p: "Link", t: "Find the imports", to: ["t-elf-and-self.html", "05 · ELF, SELF and Sony's format"],
      stage: "dynlib", focus: "stage",
      say: "The imports are not in the usual place. They live in <code>PT_OS_DYNLIBDATA</code>, a proprietary segment holding the symbol table, string table and relocations — which is why a stock <code>readelf</code> reports a module with no imports at all." },

    { p: "Link", t: "Resolve the NIDs", to: ["t-nids.html", "07 · NIDs and the runtime linker"],
      stage: "nid", focus: "stage",
      say: "Each import names a function by <b>NID</b> — an 11-character encoded id, not a name. The runtime linker looks each one up in a database built at startup from every <code>LIB_FUNC</code> registration in the emulator." },

    { p: "Link", t: "Patch the GOT", to: ["t-nids.html", "07 · NIDs and the runtime linker"],
      stage: "got", focus: "mem",
      say: "The resolved address is written into the Global Offset Table. <b>The game's own machine code is never modified</b> — it already calls through the table, so one pointer write is the entire binding step." },

    { p: "Link", t: "Rewrite what cannot run", to: ["t-patching.html", "08 · Patching guest instructions"],
      stage: "patch", focus: "stage",
      say: "Some instructions cannot execute as written. Guest code reads TLS through <code>fs:[0]</code>, which means something else on the host — so the loader edits those instructions in place, keeping them exactly the same length so nothing after them shifts." },

    { p: "Run", t: "Jump to the entry point", to: ["t-calling-conventions.html", "03 · Calling conventions & the ABI wall"],
      stage: "abi", focus: "stage",
      say: "Control enters guest code. This is the ABI wall: the emulator was compiled for the host convention, the guest for <b>System V</b>. Arguments live in different registers on each side, so the crossing has to be deliberate — and from here the CPU runs the game's own instructions natively, at full speed." },

    { p: "Run", t: "The game spawns threads", to: ["t-threads.html", "11 · Threads and TLS"],
      stage: "threads", focus: "mem",
      say: "Guest threads are real host threads — there is no scheduler here. Each gets a stack and its own copy of the TLS template before its first instruction runs." },

    { p: "Run", t: "The game allocates memory", to: ["t-address-space.html", "09 · The guest address space"],
      stage: "alloc", focus: "mem",
      say: "The game asks for direct memory at a specific address and gets it, because the whole range was reserved in step 2. It will store raw pointers into this block and hand them to the GPU later." },

    { p: "Draw", t: "The game writes command packets", to: ["t-pm4.html", "14 · PM4 & the command processor"],
      stage: "pm4", focus: "stage",
      say: "The game does not call a draw function the emulator can intercept. It writes <b>PM4 packets</b> into a ring buffer and rings a doorbell. Register writes accumulate as state; the draw packet is what forces a decision." },

    { p: "Draw", t: "The command processor reads them back", to: ["t-pm4.html", "14 · PM4 & the command processor"],
      stage: "cp", focus: "stage",
      say: "Read a header, take the opcode, consume exactly the declared number of dwords, dispatch, repeat. Getting a length wrong here desynchronises everything after it — which is why an unknown packet consumed cleanly beats one interpreted badly." },

    { p: "Draw", t: "Recompile the shader", to: ["t-shaders.html", "16 · Shaders: RDNA 2 to SPIR-V"],
      stage: "shader", focus: "stage",
      say: "The game shipped compiled <b>RDNA&nbsp;2</b> machine code. Vulkan wants SPIR-V. The arithmetic maps almost one to one; the hard part is rebuilding <em>structured</em> control flow that the original compiler threw away." },

    { p: "Draw", t: "Create the pipeline", to: ["t-vulkan.html", "17 · The Vulkan backend"],
      stage: "pipeline", focus: "screen",
      say: "All the accumulated register state becomes one Vulkan pipeline object. It misses the cache the first time, so this compiles mid-frame — the reason a title can stutter the first time it shows you something new." },

    { p: "Draw", t: "Bind the resources", to: ["t-registers.html", "15 · Registers, sharps & resources"],
      stage: "bind", focus: "stage",
      say: "The shader reaches its data through <b>sharps</b> — packed descriptors found by walking from a user-data register into a resource table. Each becomes a Vulkan descriptor. A wrong pointer here gives you garbled geometry, not a clean crash." },

    { p: "Draw", t: "The texture is stale", to: ["t-coherency.html", "10 · Page faults & CPU/GPU coherency"],
      stage: "fault", focus: "stage",
      say: "The CPU wrote that texture, and the GPU has not seen it. The emulator knew because the page was write-protected and the store <b>faulted</b> — with no interpreter to instrument, a page fault is the notification channel. Only the dirty pages are uploaded." },

    { p: "Draw", t: "Draw", to: ["t-gpu-basics.html", "13 · How a GPU actually draws"],
      stage: "draw", focus: "screen",
      say: "<code>vkCmdDraw</code>. Geometry is transformed, the fragment shader samples the texture that was just uploaded, and pixels land in the render target." },

    { p: "Present", t: "Signal and flip", to: ["t-vulkan.html", "17 · The Vulkan backend"],
      stage: "flip", focus: "screen",
      say: "An <code>IT_RELEASE_MEM</code> packet becomes a timeline semaphore signal, so the CPU learns the frame is done. The finished image is flipped to the window — and the whole loop begins again for frame two." }
  ];

  /* ============================================================
     SCREEN — the render target, built up across the last steps
     ============================================================ */

  function drawScreen(svg, i) {
    svg.innerHTML = "";
    var W = 220, H = 132;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);

    // nothing to show until there is a pipeline
    if (i < 16) {
      svg.appendChild(s("rect", { x: 0, y: 0, width: W, height: H, fill: "#08090c" }));
      svg.appendChild(s("text", {
        x: W / 2, y: H / 2 + 4, "text-anchor": "middle",
        class: "sc-off"
      }, i < 13 ? "no output yet" : "building state…"));
      return;
    }

    // cleared render target
    svg.appendChild(s("rect", { x: 0, y: 0, width: W, height: H, fill: "#0d1b2a" }));

    if (i === 16) {
      svg.appendChild(s("text", { x: W / 2, y: H / 2 + 4, "text-anchor": "middle", class: "sc-off" },
        "cleared — pipeline ready"));
      return;
    }

    if (i === 17 || i === 18) {
      // geometry only, wireframe
      svg.appendChild(s("polygon", {
        points: "110,26 176,100 44,100", fill: "none",
        stroke: "var(--guest)", "stroke-width": 1.2, "stroke-dasharray": "3 3"
      }));
      svg.appendChild(s("text", { x: W / 2, y: 122, "text-anchor": "middle", class: "sc-off" },
        i === 17 ? "geometry bound, texture stale" : "uploading dirty pages…"));
      return;
    }

    // shaded + textured
    var g = s("defs", {});
    var lg = s("linearGradient", { id: "sc-g", x1: "0", y1: "0", x2: "1", y2: "1" });
    lg.appendChild(s("stop", { offset: "0", "stop-color": "#4a8ac8" }));
    lg.appendChild(s("stop", { offset: "1", "stop-color": "#b0532f" }));
    g.appendChild(lg);
    svg.appendChild(g);

    // a simple checker "texture" clipped to the triangle
    var clip = s("clipPath", { id: "sc-clip" });
    clip.appendChild(s("polygon", { points: "110,26 176,100 44,100" }));
    svg.appendChild(clip);

    svg.appendChild(s("polygon", { points: "110,26 176,100 44,100", fill: "url(#sc-g)" }));

    var chk = s("g", { "clip-path": "url(#sc-clip)", opacity: "0.28" });
    for (var y = 20; y < 104; y += 10) {
      for (var x = 40; x < 180; x += 10) {
        if (((x / 10) + (y / 10)) % 2 === 0) {
          chk.appendChild(s("rect", { x: x, y: y, width: 10, height: 10, fill: "#fff" }));
        }
      }
    }
    svg.appendChild(chk);

    if (i >= 20) {
      // present: add a little HUD so it reads as a finished frame
      svg.appendChild(s("rect", { x: 8, y: 8, width: 54, height: 9, rx: 2, fill: "#ffffff", opacity: ".22" }));
      svg.appendChild(s("rect", { x: 8, y: 21, width: 32, height: 6, rx: 2, fill: "#ffffff", opacity: ".14" }));
      svg.appendChild(s("circle", { cx: 202, cy: 15, r: 6, fill: "var(--kyty)", opacity: ".8" }));
    }
    svg.appendChild(s("text", { x: W / 2, y: 122, "text-anchor": "middle", class: "sc-on" },
      i >= 20 ? "frame presented" : "drawn"));
  }

  /* ============================================================
     STAGE — the mechanism for the current step
     ============================================================ */

  var W = 560, H = 280;

  function box(g, x, y, w, h, label, sub, kind, dim) {
    var r = s("rect", { x: x, y: y, width: w, height: h, rx: 6, class: "st-box " + (kind || "") + (dim ? " dim" : "") });
    g.appendChild(r);
    g.appendChild(s("text", { x: x + w / 2, y: y + (sub ? h / 2 - 3 : h / 2 + 4), "text-anchor": "middle", class: "st-t" }, label));
    if (sub) g.appendChild(s("text", { x: x + w / 2, y: y + h / 2 + 12, "text-anchor": "middle", class: "st-s" }, sub));
    return r;
  }
  function arrow(g, x1, y1, x2, y2, label, dash) {
    g.appendChild(s("line", { x1: x1, y1: y1, x2: x2, y2: y2, class: "st-arr" + (dash ? " dash" : ""), "marker-end": "url(#lt-ah)" }));
    if (label) g.appendChild(s("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, "text-anchor": "middle", class: "st-s" }, label));
  }
  function caption(g, txt) {
    g.appendChild(s("text", { x: W / 2, y: H - 8, "text-anchor": "middle", class: "st-cap" }, txt));
  }

  var STAGE = {
    boot: function (g) {
      box(g, 40, 60, 150, 60, "main()", "subsystems up", "host");
      arrow(g, 195, 90, 235, 90);
      box(g, 240, 60, 150, 60, "parse args", "--game <path>", "host");
      arrow(g, 395, 90, 435, 90);
      box(g, 440, 60, 90, 60, "window", null, "host");
      caption(g, "all host, no guest yet");
    },
    reserve: function (g) {
      box(g, 60, 50, 200, 80, "host asks the OS", "VirtualAlloc2 / mmap", "host");
      arrow(g, 265, 90, 315, 90, "reserve");
      box(g, 320, 50, 200, 80, "guest range", "claimed, not committed", "res");
      caption(g, "claim the whole range first — addresses cannot be negotiated later");
    },
    self: function (g) {
      box(g, 50, 40, 180, 90, "eboot.bin", "SELF container", "guest");
      arrow(g, 235, 85, 285, 85, "unwrap");
      box(g, 290, 40, 220, 90, "ELF64", "e_type = ET_SCE_DYNEXEC", "guest");
      caption(g, "a value no ordinary ELF loader will accept");
    },
    phdr: function (g) {
      var rows = [
        ["PT_LOAD", ".text", "R-X", "filesz = memsz"],
        ["PT_LOAD", ".rodata", "R--", "filesz = memsz"],
        ["PT_LOAD", ".data", "RW-", "filesz < memsz  → .bss"],
        ["PT_TLS", "template", "R--", "copied per thread"],
        ["PT_OS_DYNLIBDATA", "imports", "R--", "Sony-specific"]
      ];
      rows.forEach(function (r, i) {
        var y = 26 + i * 46;
        box(g, 30, y, 150, 38, r[0], null, i === 4 ? "kyty" : "guest");
        g.appendChild(s("text", { x: 200, y: y + 23, class: "st-s" }, r[1] + "   " + r[2]));
        g.appendChild(s("text", { x: 330, y: y + 23, class: "st-s dimtxt" }, r[3]));
      });
      caption(g, "where each piece wants to live, and how much room it needs");
    },
    map: function (g) {
      box(g, 40, 40, 160, 190, "file on disk", null, "guest");
      [0, 1, 2].forEach(function (i) {
        box(g, 55, 60 + i * 55, 130, 40, [".text", ".rodata", ".data"][i], null, "guest");
        arrow(g, 205, 80 + i * 55, 355, 80 + i * 55, i === 2 ? "+ zero fill" : null, i === 2);
      });
      box(g, 360, 40, 170, 190, "guest memory", "base 0x900000000", "kyty");
      caption(g, "copied to p_vaddr + base, then protected");
    },
    tls: function (g) {
      box(g, 190, 30, 180, 55, "PT_TLS template", "64 B + 128 B .tbss", "guest");
      [0, 1, 2].forEach(function (i) {
        arrow(g, 280, 90, 110 + i * 175, 150, null, true);
        box(g, 40 + i * 175, 155, 140, 55, "thread " + i, "own copy", "kyty");
      });
      caption(g, "the template is never used directly — each thread gets a copy");
    },
    dynlib: function (g) {
      box(g, 40, 90, 180, 70, "PT_OS_DYNLIBDATA", null, "kyty");
      ["symbol table", "string table", "relocations"].forEach(function (n, i) {
        arrow(g, 225, 125, 285, 60 + i * 60);
        box(g, 290, 38 + i * 60, 210, 44, n, null, "guest");
      });
      caption(g, "everything a linker needs, in a place no standard linker looks");
    },
    nid: function (g) {
      box(g, 30, 40, 190, 50, "pt2fEBBpEJk", "NID in the import table", "guest");
      arrow(g, 225, 65, 285, 65, "look up");
      box(g, 290, 30, 240, 70, "symbol database", "built from every LIB_FUNC", "kyty");
      arrow(g, 410, 105, 410, 150);
      box(g, 290, 155, 240, 60, "SystemServiceGetStatus", "your C++ function", "host");
      g.appendChild(s("text", { x: 125, y: 175, "text-anchor": "middle", class: "st-s dimtxt" }, "a hash — it cannot"));
      g.appendChild(s("text", { x: 125, y: 190, "text-anchor": "middle", class: "st-s dimtxt" }, "be decoded back"));
      caption(g, "imports are matched by id, never by name");
    },
    got: function (g) {
      box(g, 30, 40, 170, 60, "guest code", "call [GOT+0x18]", "guest");
      arrow(g, 205, 70, 265, 70);
      var r = box(g, 270, 40, 140, 60, "GOT slot", "0x0000…", "kyty");
      r.classList.add("pulse");
      arrow(g, 340, 105, 340, 150, "patched");
      box(g, 250, 155, 200, 60, "Kyty C++", "KYTY_SYSV_ABI", "host");
      caption(g, "one pointer write — the game's instructions are untouched");
    },
    patch: function (g) {
      box(g, 40, 60, 220, 70, "mov rax, fs:[0]", "means nothing here", "guest");
      arrow(g, 265, 95, 315, 95, "rewrite");
      box(g, 320, 60, 220, 70, "mov rax, [r15]", "same length", "kyty");
      caption(g, "the replacement must be byte-for-byte the same size");
    },
    abi: function (g) {
      box(g, 30, 30, 230, 46, "Kyty (host convention)", null, "host");
      box(g, 300, 30, 230, 46, "guest (System V)", null, "guest");
      var hostR = ["rcx", "rdx", "r8", "r9"], gR = ["rdi", "rsi", "rdx", "rcx"];
      for (var i = 0; i < 4; i++) {
        g.appendChild(s("text", { x: 60, y: 108 + i * 30, class: "st-mono" }, hostR[i]));
        g.appendChild(s("text", { x: 130, y: 108 + i * 30, class: "st-s" }, "arg " + (i + 1)));
        arrow(g, 190, 103 + i * 30, 330, 103 + i * 30, null, true);
        g.appendChild(s("text", { x: 345, y: 108 + i * 30, class: "st-mono" }, gR[i]));
        g.appendChild(s("text", { x: 415, y: 108 + i * 30, class: "st-s" }, "arg " + (i + 1)));
      }
      caption(g, "same argument, different register — the thunk is what makes it line up");
    },
    threads: function (g) {
      box(g, 210, 26, 150, 46, "scePthreadCreate", null, "guest");
      [0, 1, 2].forEach(function (i) {
        arrow(g, 285, 78, 105 + i * 175, 130, null);
        box(g, 35 + i * 175, 135, 140, 46, "host thread", null, "host");
        box(g, 35 + i * 175, 190, 140, 40, "TLS copy", null, "kyty");
      });
      caption(g, "real OS threads — the host scheduler runs them");
    },
    alloc: function (g) {
      box(g, 40, 60, 200, 70, "sceKernelAllocate…", "wants 0xa00000000", "guest");
      arrow(g, 245, 95, 305, 95, "commit");
      box(g, 310, 60, 210, 70, "inside the reservation", "granted at that exact address", "kyty");
      caption(g, "granted because step 2 claimed the range up front");
    },
    pm4: function (g) {
      var pk = [["IT_SET_CONTEXT_REG", "state"], ["IT_SET_SH_REG", "shader ptrs"],
                ["IT_DRAW_INDEX_AUTO", "the draw"], ["IT_RELEASE_MEM", "fence"]];
      pk.forEach(function (p, i) {
        box(g, 60, 26 + i * 58, 260, 44, p[0], null, i === 2 ? "kyty" : "guest");
        g.appendChild(s("text", { x: 340, y: 53 + i * 58, class: "st-s dimtxt" }, p[1]));
      });
      g.appendChild(s("text", { x: 460, y: 130, "text-anchor": "middle", class: "st-s" }, "ring buffer"));
      caption(g, "the game writes dwords into memory, then rings a doorbell");
    },
    cp: function (g) {
      box(g, 30, 100, 130, 60, "read header", null, "kyty");
      arrow(g, 165, 130, 205, 130);
      box(g, 210, 100, 130, 60, "consume len", "dwords", "kyty");
      arrow(g, 345, 130, 385, 130);
      box(g, 390, 100, 140, 60, "dispatch", "handler", "kyty");
      g.appendChild(s("path", { d: "M460 165 L460 205 L95 205 L95 165", class: "st-arr", "marker-end": "url(#lt-ah)", fill: "none" }));
      g.appendChild(s("text", { x: 277, y: 222, "text-anchor": "middle", class: "st-s" }, "repeat to the end of the buffer"));
      caption(g, "a length taken wrong desynchronises everything after it");
    },
    shader: function (g) {
      ["RDNA 2 binary", "control-flow graph", "IR", "SPIR-V"].forEach(function (n, i) {
        box(g, 22 + i * 138, 100, 122, 60, n, null, i === 3 ? "kyty" : "guest");
        if (i < 3) arrow(g, 146 + i * 138, 130, 156 + i * 138, 130);
      });
      g.appendChild(s("text", { x: 215, y: 190, "text-anchor": "middle", class: "st-s dimtxt" }, "structure has to be"));
      g.appendChild(s("text", { x: 215, y: 205, "text-anchor": "middle", class: "st-s dimtxt" }, "recovered here"));
      caption(g, "the arithmetic is easy; the control flow is the real work");
    },
    pipeline: function (g) {
      box(g, 40, 40, 180, 44, "register state", null, "guest");
      box(g, 40, 96, 180, 44, "shader modules", null, "kyty");
      box(g, 40, 152, 180, 44, "blend / depth", null, "guest");
      [0, 1, 2].forEach(function (i) { arrow(g, 225, 62 + i * 56, 300, 118); });
      var r = box(g, 305, 90, 210, 60, "VkPipeline", "cache MISS — compiling", "host");
      r.classList.add("pulse");
      caption(g, "compiled mid-frame the first time — this is where stutter comes from");
    },
    bind: function (g) {
      box(g, 30, 110, 130, 54, "user data", "SGPR", "guest");
      arrow(g, 165, 137, 205, 137);
      box(g, 210, 110, 130, 54, "resource table", null, "guest");
      arrow(g, 345, 137, 385, 137);
      box(g, 390, 70, 140, 46, "V#  buffer", null, "kyty");
      box(g, 390, 126, 140, 46, "T#  texture", null, "kyty");
      box(g, 390, 182, 140, 46, "S#  sampler", null, "kyty");
      caption(g, "packed descriptors, reached by walking a pointer chain");
    },
    fault: function (g) {
      box(g, 30, 40, 180, 50, "CPU writes texture", null, "guest");
      arrow(g, 120, 95, 120, 130, "page is R--");
      var r = box(g, 30, 135, 180, 50, "FAULT", null, "host");
      r.classList.add("pulse");
      arrow(g, 215, 160, 275, 160, "handler");
      box(g, 280, 110, 240, 50, "mark dirty, unprotect", null, "kyty");
      arrow(g, 400, 165, 400, 195);
      box(g, 280, 200, 240, 46, "upload only those pages", null, "kyty");
      caption(g, "with no interpreter, the fault is how the emulator finds out");
    },
    draw: function (g) {
      box(g, 40, 100, 150, 60, "vkCmdDraw", null, "host");
      arrow(g, 195, 130, 245, 130);
      box(g, 250, 100, 130, 60, "vertex", null, "kyty");
      arrow(g, 385, 130, 425, 130);
      box(g, 430, 100, 110, 60, "fragment", null, "kyty");
      caption(g, "the fragment shader samples the texture that was just uploaded");
    },
    flip: function (g) {
      box(g, 30, 100, 170, 56, "IT_RELEASE_MEM", null, "guest");
      arrow(g, 205, 128, 255, 128, "becomes");
      box(g, 260, 100, 180, 56, "timeline semaphore", null, "kyty");
      arrow(g, 350, 161, 350, 196, "CPU waits");
      box(g, 250, 200, 200, 46, "flip to the window", null, "host");
      caption(g, "the CPU learns the frame is done, and the loop starts again");
    }
  };

  /* ============================================================
     BUILD
     ============================================================ */

  function build(host) {
    var i = 0, playing = null;

    var wrap = el("div", "lt");

    /* --- controls --- */
    var bar = el("div", "lt-bar");
    var prev = el("button", "lt-b", "‹ Prev");
    var next = el("button", "lt-b", "Next ›");
    var play = el("button", "lt-b lt-play", "▶ Play");
    var reset = el("button", "lt-b", "Reset");
    [prev, next, play, reset].forEach(function (b) { b.type = "button"; });
    var counter = el("span", "lt-count");
    var phase = el("span", "lt-phase");
    bar.appendChild(prev); bar.appendChild(next);
    bar.appendChild(counter); bar.appendChild(phase);
    var sp = el("span", "lt-sp"); bar.appendChild(sp);
    bar.appendChild(play); bar.appendChild(reset);
    wrap.appendChild(bar);

    /* --- progress rail --- */
    var rail = el("div", "lt-rail");
    var ticks = [];
    STEPS.forEach(function (st, n) {
      var t = el("button", "lt-tick");
      t.type = "button";
      t.title = (n + 1) + " · " + st.t;
      t.setAttribute("aria-label", t.title);
      t.addEventListener("click", function () { stop(); go(n); });
      rail.appendChild(t);
      ticks.push(t);
    });
    wrap.appendChild(rail);

    /* --- three panels --- */
    var grid = el("div", "lt-grid");

    var memPanel = el("section", "lt-panel lt-mem");
    memPanel.appendChild(el("h3", "lt-h", "Guest address space"));
    var memList = el("div", "lt-bands");
    memPanel.appendChild(memList);
    grid.appendChild(memPanel);

    var stagePanel = el("section", "lt-panel lt-stage");
    var stageH = el("h3", "lt-h", "—");
    stagePanel.appendChild(stageH);
    var stageSvg = document.createElementNS(SVGNS, "svg");
    stageSvg.setAttribute("viewBox", "0 0 " + W + " " + H);
    stageSvg.setAttribute("class", "lt-svg");
    stagePanel.appendChild(stageSvg);
    grid.appendChild(stagePanel);

    var right = el("div", "lt-right");
    var scrPanel = el("section", "lt-panel");
    scrPanel.appendChild(el("h3", "lt-h", "Render target"));
    var scrSvg = document.createElementNS(SVGNS, "svg");
    scrSvg.setAttribute("class", "lt-screen");
    scrPanel.appendChild(scrSvg);
    right.appendChild(scrPanel);

    var factsPanel = el("section", "lt-panel");
    factsPanel.appendChild(el("h3", "lt-h", "State"));
    var facts = el("dl", "lt-facts");
    factsPanel.appendChild(facts);
    right.appendChild(factsPanel);
    grid.appendChild(right);

    wrap.appendChild(grid);

    var foot = el("div", "lt-foot");
    var say = el("p", "lt-say");
    var more = el("a", "lt-more");
    foot.appendChild(say);
    foot.appendChild(more);
    wrap.appendChild(foot);

    host.appendChild(wrap);

    /* --- render --- */

    function renderBands(n) {
      memList.innerHTML = "";
      var shown = BANDS.filter(function (b) { return n >= b.at; });
      if (!shown.length) {
        memList.appendChild(el("p", "lt-empty", "nothing mapped yet"));
        return;
      }
      shown.forEach(function (b) {
        var row = el("div", "lt-band " + b.k);
        if (b.at === n) row.classList.add("fresh");
        row.appendChild(el("span", "lt-addr", b.a));
        row.appendChild(el("span", "lt-name", b.n));
        row.appendChild(el("span", "lt-sz", b.sz));
        memList.appendChild(row);
      });
    }

    function renderFacts(n) {
      var f = [];
      f.push(["guest mapped", BANDS.filter(function (b) { return n >= b.at; }).length + " regions"]);
      f.push(["imports", n < 7 ? "not read" : n < 8 ? "found" : "resolved"]);
      f.push(["guest code", n < 10 ? "not running" : "running natively"]);
      f.push(["threads", n < 11 ? "1 (host)" : "1 host + 4 guest"]);
      f.push(["shaders", n < 15 ? "—" : n === 15 ? "translating" : "2 SPIR-V modules"]);
      f.push(["pipeline", n < 16 ? "—" : n === 16 ? "compiling (miss)" : "ready"]);
      f.push(["semaphore", n < 20 ? "0" : "1 — frame done"]);
      facts.innerHTML = "";
      f.forEach(function (p) {
        var dt = el("dt", null, p[0]); var dd = el("dd", null, p[1]);
        facts.appendChild(dt); facts.appendChild(dd);
      });
    }

    function renderStage(st) {
      stageSvg.innerHTML = "";
      var defs = s("defs", {});
      var mk = s("marker", { id: "lt-ah", markerWidth: 9, markerHeight: 7, refX: 8, refY: 3.5, orient: "auto" });
      mk.appendChild(s("polygon", { points: "0 0, 9 3.5, 0 7", class: "st-ahead" }));
      defs.appendChild(mk);
      stageSvg.appendChild(defs);
      var g = s("g", {});
      stageSvg.appendChild(g);
      var fn = STAGE[st.stage];
      if (fn) { try { fn(g); } catch (e) { if (window.console) console.error("stage " + st.stage, e); } }
      else g.appendChild(s("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "st-s" }, st.stage));
    }

    function go(n) {
      i = Math.max(0, Math.min(STEPS.length - 1, n));
      var st = STEPS[i];
      counter.textContent = (i + 1) + " / " + STEPS.length;
      phase.textContent = st.p;
      phase.className = "lt-phase p-" + st.p.toLowerCase();
      stageH.textContent = st.t;
      say.innerHTML = st.say;
      if (st.to) {
        more.href = st.to[0];
        more.innerHTML = '<span class="lt-more-k">Read the topic</span>' +
          '<span class="lt-more-t">' + esc(st.to[1]) + "</span><span aria-hidden=\"true\">→</span>";
        more.hidden = false;
      } else {
        more.hidden = true;
      }
      renderStage(st);
      renderBands(i);
      renderFacts(i);
      drawScreen(scrSvg, i);
      ticks.forEach(function (t, k) {
        t.classList.toggle("done", k < i);
        t.classList.toggle("now", k === i);
      });
      [memPanel, stagePanel, scrPanel].forEach(function (p) { p.classList.remove("focus"); });
      ({ mem: memPanel, stage: stagePanel, screen: scrPanel })[st.focus].classList.add("focus");
      prev.disabled = i === 0;
      next.disabled = i === STEPS.length - 1;
    }

    function stop() {
      if (playing) { clearInterval(playing); playing = null; }
      play.textContent = "▶ Play";
      play.classList.remove("on");
    }
    function start() {
      stop();
      if (i >= STEPS.length - 1) go(0);
      play.textContent = "❙❙ Pause";
      play.classList.add("on");
      playing = setInterval(function () {
        if (i >= STEPS.length - 1) { stop(); return; }
        go(i + 1);
      }, 5200);
    }

    prev.addEventListener("click", function () { stop(); go(i - 1); });
    next.addEventListener("click", function () { stop(); go(i + 1); });
    play.addEventListener("click", function () { playing ? stop() : start(); });
    reset.addEventListener("click", function () { stop(); go(0); });

    wrap.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); stop(); go(i - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(i + 1); }
    });
    wrap.tabIndex = 0;

    go(0);
    return { go: go, stop: stop };
  }

  function boot() {
    var host = document.getElementById("lifetime");
    if (!host) return;
    try { build(host); }
    catch (err) {
      host.innerHTML = '<p class="lt-empty">This animation failed to start: ' +
        esc(err.message) + " — try a hard refresh.</p>";
      if (window.console) console.error("lifetime", err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

