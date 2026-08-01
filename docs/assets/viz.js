/* ============================================================
   viz.js — shared visualisations for the KytyPS5 documents
   Mount by putting <figure data-viz="NAME"></figure> in the page.
   Names: pipeline · gotplt · coherency · wave · tiling · threads · shaderflow
   No dependencies. Respects prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVGNS = "http://www.w3.org/2000/svg";
  var REG = {};

  /* ---------------- helpers ---------------- */

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function frame(el, title, hint, note) {
    el.classList.add("viz");
    el.innerHTML =
      '<div class="viz-head"><span>' + title + "</span><span>" + hint + "</span></div>" +
      '<div class="viz-body"></div>' +
      (note ? '<div class="viz-note">' + note + "</div>" : "");
    return el.querySelector(".viz-body");
  }

  function svg(w, h, label) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "viz-stage");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("role", "img");
    if (label) s.setAttribute("aria-label", label);
    return s;
  }

  function mk(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /** A node box with a title and optional subtitle. Returns {rect, g}. */
  function box(parent, x, y, w, h, side, title, sub) {
    var g = mk("g", {});
    var r = mk("rect", { x: x, y: y, width: w, height: h, rx: 3, "class": "nd " + (side || "") });
    g.appendChild(r);
    var ty = sub ? y + h / 2 - 3 : y + h / 2 + 4;
    g.appendChild(mk("text", { x: x + w / 2, y: ty, "class": "t", "text-anchor": "middle" }, title));
    if (sub) g.appendChild(mk("text", { x: x + w / 2, y: y + h / 2 + 13, "class": "s", "text-anchor": "middle" }, sub));
    parent.appendChild(g);
    return { rect: r, g: g };
  }

  function arrowDefs(s) {
    var d = mk("defs", {});
    var m = mk("marker", { id: "vz-ah", markerWidth: 9, markerHeight: 7, refX: 8, refY: 3.5, orient: "auto" });
    m.appendChild(mk("polygon", { points: "0 0, 9 3.5, 0 7", "class": "ahead" }));
    d.appendChild(m);
    s.appendChild(d);
  }

  /**
   * Controls + stage driver. stages = array of caption HTML strings.
   * onStage(i) is called on every change. Auto-advances unless reduced motion.
   */
  function driver(body, stages, onStage, msPerStage) {
    var ctl = document.createElement("div");
    ctl.className = "viz-ctl";
    ctl.innerHTML =
      '<button type="button" data-a="play"></button>' +
      '<button type="button" data-a="prev">← Back</button>' +
      '<button type="button" data-a="next">Next →</button>' +
      '<span class="viz-pos"></span>';
    var cap = document.createElement("div");
    cap.className = "viz-cap";
    body.appendChild(ctl);
    body.appendChild(cap);

    var i = 0, timer = null, userPaused = REDUCED, visible = false;
    var playBtn = ctl.querySelector('[data-a="play"]');
    var pos = ctl.querySelector(".viz-pos");

    function show(n) {
      i = (n + stages.length) % stages.length;
      cap.innerHTML = stages[i];
      pos.textContent = "step " + (i + 1) + " / " + stages.length;
      onStage(i);
    }
    function run() {
      if (timer) return;
      timer = setInterval(function () { show(i + 1); }, msPerStage || 2600);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function label() { playBtn.textContent = userPaused ? "Play" : "Pause"; }
    /** Keep the timer in sync with intent (userPaused) and visibility. */
    function sync() {
      if (!userPaused && visible) run(); else stop();
      label();
    }

    ctl.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var a = b.dataset.a;
      if (a === "play") { userPaused = !userPaused; }
      if (a === "next") { userPaused = true; show(i + 1); }
      if (a === "prev") { userPaused = true; show(i - 1); }
      sync();
    });

    show(0);

    // Only animate while on screen — and resume when the reader comes back,
    // unless they pressed Pause themselves.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { visible = en.isIntersecting; });
        sync();
      }, { threshold: 0.15 }).observe(body.parentElement || body);
    } else {
      visible = true;
    }
    sync();

    return {
      show: show,
      pause: function () { userPaused = true; sync(); }
    };
  }

  function litOnly(nodes, idx) {
    nodes.forEach(function (n, k) { n.rect.classList.toggle("lit", k === idx); });
  }

  /* ============================================================
     1 · pipeline — game code to pixels on screen
     ============================================================ */
  REG.pipeline = function (el) {
    var body = frame(el, "From game code to pixels on screen", "the whole path, animated",
      "Nothing in this chain is a function call the emulator can simply intercept. The game writes command packets into its own memory; everything after that is Kyty reading those packets and rebuilding the work in Vulkan.");

    var W = 760, H = 250;
    var s = svg(W, H, "Animated data flow from game code through PM4 packets to the screen");
    arrowDefs(s);

    var STEPS = [
      { t: "Game / engine", sub: "calls AGC", side: "g" },
      { t: "AGC builders", sub: "agc.cpp writes dwords", side: "k" },
      { t: "Command buffer", sub: "in guest memory", side: "g" },
      { t: "Gpu::Submit", sub: "copy + enqueue", side: "k" },
      { t: "Command processor", sub: "parse PM4", side: "k" },
      { t: "HW registers", sub: "state accumulates", side: "k" },
      { t: "Draw", sub: "shaders + pipeline", side: "h" },
      { t: "Screen", sub: "swapchain blit", side: "h" }
    ];

    // snake layout: 4 across the top (l→r), 4 across the bottom (r→l)
    var bw = 158, bh = 54, gapx = 34, x0 = 16, yTop = 26, yBot = 150;
    var nodes = [], centres = [];
    STEPS.forEach(function (st, i) {
      var top = i < 4, col = top ? i : 7 - i;
      var x = x0 + col * (bw + gapx), y = top ? yTop : yBot;
      nodes.push(box(s, x, y, bw, bh, st.side, st.t, st.sub));
      // order number — the bottom row runs right-to-left, so without these the
      // sequence is ambiguous to anyone reading the diagram statically
      s.appendChild(mk("circle", { cx: x + 13, cy: y + 13, r: 8.5, "class": "ord" }));
      s.appendChild(mk("text", { x: x + 13, y: y + 16.5, "class": "ordt", "text-anchor": "middle" }, i + 1));
      centres.push({ x: x + bw / 2, y: y + bh / 2, top: top });
    });

    // route: along the top, down the right edge, back along the bottom
    var d = "M" + centres[0].x + " " + centres[0].y;
    for (var i = 1; i < 4; i++) d += " L" + centres[i].x + " " + centres[i].y;
    d += " C" + (centres[3].x + 70) + " " + centres[3].y + "," + (centres[4].x + 70) + " " + centres[4].y + "," + centres[4].x + " " + centres[4].y;
    for (var j = 5; j < 8; j++) d += " L" + centres[j].x + " " + centres[j].y;
    var wire = mk("path", { d: d, "class": "wire" });
    s.insertBefore(wire, s.firstChild.nextSibling);

    var tok = mk("circle", { r: 5.5, "class": "tok", cx: centres[0].x, cy: centres[0].y });
    s.appendChild(tok);

    var CAPS = [
      "<b>The game calls AGC</b> — the PS5's low-level graphics API, called <code>Gen5</code> in this codebase. This looks like a normal API call, but it is not one.",
      "<b>AGC functions are builders.</b> They do not draw anything. They write 32-bit words into a buffer the game owns. Kyty reimplements them to emit byte-identical output, because the game may inspect and patch that buffer afterwards.",
      "<b>The result is a PM4 command stream</b> sitting in guest memory: a sequence of packets, each with an opcode and a body. This is the same binary format a real AMD command processor reads.",
      "<b>The game submits the buffer.</b> Kyty immediately <em>copies</em> it — games reuse that memory sooner than a strict reading allows — and pushes it onto one of 57 queues: one graphics, plus seven compute pipes of eight.",
      "<b>The GPU thread parses packets.</b> Kyty implements a command processor in software: a jump table indexed by opcode, one handler per packet type.",
      "<b>Most packets are register writes.</b> They accumulate into <code>HW::Context</code>, <code>HW::Shader</code> and <code>HW::UserConfig</code> — render targets, blend modes, viewports, shader addresses. A draw packet carries almost no information; the state arrived earlier.",
      "<b>A draw packet arrives.</b> Now the work happens: resolve render targets, recompile the RDNA&nbsp;2 shaders to SPIR-V if they are not cached, materialise descriptors, build a Vulkan pipeline from the accumulated register state, and record <code>vkCmdDraw</code>.",
      "<b>Finally a flip.</b> The guest asked for a buffer to be scanned out; Kyty blits it into the swapchain image and presents. One frame."
    ];

    var drv = driver(body, CAPS, function (i) {
      litOnly(nodes, i);
      // ease the token toward the active node
      var target = centres[i], start = { x: +tok.getAttribute("cx"), y: +tok.getAttribute("cy") };
      if (REDUCED) { tok.setAttribute("cx", target.x); tok.setAttribute("cy", target.y); return; }
      var t0 = performance.now(), dur = 520;
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        tok.setAttribute("cx", start.x + (target.x - start.x) * e);
        tok.setAttribute("cy", start.y + (target.y - start.y) * e);
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    }, 3000);

    body.insertBefore(s, body.firstChild);
    var key = document.createElement("div");
    key.className = "viz-key";
    key.innerHTML =
      '<span><i style="background:var(--guest)"></i>guest — the PS5 and its software</span>' +
      '<span><i style="background:var(--kyty)"></i>kyty — the translation layer</span>' +
      '<span><i style="background:var(--host)"></i>host — the real PC and GPU</span>';
    body.insertBefore(key, s.nextSibling);
    return drv;
  };

  /* ============================================================
     2 · gotplt — how a console call lands in emulator code
     ============================================================ */
  REG.gotplt = function (el) {
    var body = frame(el, "How a console function call reaches emulator code", "the core HLE trick",
      "The game's own machine code is never modified for this. Only one pointer changes — the Global Offset Table entry the call reads through. That single indirection is what the entire high-level-emulation design rests on.");

    var W = 760, H = 236;
    var s = svg(W, H, "Diagram showing a guest call routed through the PLT and GOT into an emulator function");
    arrowDefs(s);

    var guest = box(s, 14, 88, 150, 56, "g", "Guest code", "call ...@plt");
    var plt = box(s, 214, 88, 130, 56, "g", "PLT stub", "jmp [GOT+n]");
    var got = box(s, 394, 88, 140, 56, "k", "GOT slot", "one pointer");
    var stub = box(s, 588, 26, 158, 52, "k", "Lazy thunk", "returns 0 if unresolved");
    var impl = box(s, 588, 152, 158, 52, "h", "Kyty C++", "KYTY_SYSV_ABI");

    var w1 = mk("path", { d: "M164 116 L210 116", "class": "wire", "marker-end": "url(#vz-ah)" });
    var w2 = mk("path", { d: "M344 116 L390 116", "class": "wire", "marker-end": "url(#vz-ah)" });
    var wUp = mk("path", { d: "M534 106 C 560 100, 560 56, 584 52", "class": "wire", "marker-end": "url(#vz-ah)" });
    var wDn = mk("path", { d: "M534 126 C 560 132, 560 174, 584 178", "class": "wire", "marker-end": "url(#vz-ah)" });
    [w1, w2, wUp, wDn].forEach(function (w) { s.appendChild(w); });

    var note = mk("text", { x: 394, y: 74, "class": "s" }, "");
    s.appendChild(note);
    var resolveTxt = mk("text", { x: 14, y: 26, "class": "s" }, "");
    s.appendChild(resolveTxt);

    var CAPS = [
      "<b>Before anything is loaded</b>, <code>Libs::InitAll()</code> registers thousands of NID → C++ function-pointer records. Each <code>LIB_FUNC(\"nid\", func)</code> adds one. Nothing from the game exists yet.",
      "<b>The game imports a function by NID</b> — an 11-character hash, qualified by library and module: <code>nid#Pad#Pad</code>. Its relocation table says: write the resolved address into this GOT slot.",
      "<b>Resolution searches the HLE database first.</b> If Kyty implements that NID, the address of its own C++ function is written into the GOT slot. If not, the slot gets a generated 162-byte lazy thunk instead.",
      "<b>The call now flows through.</b> Guest code jumps to its PLT stub, the stub jumps through the GOT slot, and execution lands in Kyty's C++ — with arguments already in System&nbsp;V registers, which is exactly what <code>KYTY_SYSV_ABI</code> prepared that function for.",
      "<b>If the NID was never implemented</b>, the thunk runs instead: it preserves all six argument registers and all eight vector registers, retries resolution now that more modules are loaded, and on failure returns zero and hopes the game copes. That is why a stubbed import produces odd behaviour rather than a clean crash."
    ];

    var drv = driver(body, CAPS, function (i) {
      [guest, plt, got, stub, impl].forEach(function (n) { n.rect.classList.remove("lit"); });
      [w1, w2, wUp, wDn].forEach(function (w) { w.classList.remove("on"); w.setAttribute("stroke-dasharray", "4 3"); });
      note.textContent = "";
      resolveTxt.textContent = "";

      if (i === 0) {
        resolveTxt.textContent = 'SymbolDatabase.Add("nid#Pad#Pad" -> &PadReadState)';
        impl.rect.classList.add("lit");
      } else if (i === 1) {
        guest.rect.classList.add("lit");
        got.rect.classList.add("lit");
        note.textContent = "R_X86_64_JUMP_SLOT -> this slot";
      } else if (i === 2) {
        got.rect.classList.add("lit");
        resolveTxt.textContent = 'RuntimeLinker::Resolve("nid#Pad#Pad") -> found in HLE database';
        wDn.classList.add("on"); wDn.removeAttribute("stroke-dasharray");
        impl.rect.classList.add("lit");
        note.textContent = "slot := &Kyty C++";
      } else if (i === 3) {
        [guest, plt, got, impl].forEach(function (n) { n.rect.classList.add("lit"); });
        [w1, w2, wDn].forEach(function (w) { w.classList.add("on"); w.removeAttribute("stroke-dasharray"); });
        note.textContent = "guest code unmodified";
      } else {
        [guest, plt, got, stub].forEach(function (n) { n.rect.classList.add("lit"); });
        [w1, w2, wUp].forEach(function (w) { w.classList.add("on"); w.removeAttribute("stroke-dasharray"); });
        note.textContent = "slot := &thunk";
      }
    }, 3400);

    body.insertBefore(s, body.firstChild);
    return drv;
  };

  /* ============================================================
     3 · coherency — page faults keep CPU and GPU in step
     ============================================================ */
  REG.coherency = function (el) {
    var body = frame(el, "Keeping CPU and GPU copies in step", "page faults as a notification channel",
      "On the console, CPU and GPU share one pool of memory, so a game contains no synchronisation for this at all. On a PC the Vulkan resource is a copy. With no recompiler to instrument guest code, the only way to notice a write is to make it fault — so the page fault <em>is</em> the notification.");

    var N = 8;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-family:var(--mono);font-size:11px;color:var(--muted)">' +
      '<span>guest memory — one box per 16 KB page</span></div>' +
      '<div class="viz-pages"></div>' +
      '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;margin-top:4px">' +
      '<div id="vzc-cpu" style="border:1px solid var(--rule);border-radius:3px;padding:8px 12px;font-family:var(--mono);font-size:11.5px;text-align:center;background:var(--surface-2)">CPU (guest thread)</div>' +
      '<div id="vzc-dir" style="font-family:var(--mono);font-size:16px;color:var(--faint);text-align:center;min-width:3em"></div>' +
      '<div id="vzc-gpu" style="border:1px solid var(--rule);border-radius:3px;padding:8px 12px;font-family:var(--mono);font-size:11.5px;text-align:center;background:var(--surface-2)">Vulkan image (host GPU)</div>' +
      "</div>";
    var strip = wrap.querySelector(".viz-pages");
    var pgs = [];
    for (var i = 0; i < N; i++) {
      var d = document.createElement("div");
      d.className = "viz-pg";
      d.innerHTML = '<span class="ic">·</span>' + i;
      strip.appendChild(d); pgs.push(d);
    }
    var cpuEl = wrap.querySelector("#vzc-cpu"), gpuEl = wrap.querySelector("#vzc-gpu"), dirEl = wrap.querySelector("#vzc-dir");

    var key = document.createElement("div");
    key.className = "viz-key";
    key.innerHTML =
      '<span><i style="background:var(--kyty)"></i>dirty — needs copying</span>' +
      '<span><i style="background:color-mix(in srgb,var(--host) 50%,var(--surface))"></i>write-protected</span>' +
      '<span><i style="background:var(--host)"></i>faulting now</span>' +
      '<span><i style="background:color-mix(in srgb,var(--guest) 40%,var(--surface))"></i>copying</span>';
    wrap.appendChild(key);

    var CAPS = [
      "<b>The game writes texture data with the CPU.</b> Ordinary stores. Nothing tells the emulator this happened.",
      "<b>The memory tracker records which pages changed.</b> Pages 2 and 3 are marked CPU-dirty. Granularity is the guest's 16 KB page, so a write anywhere in a page dirties all of it.",
      "<b>A draw needs the texture.</b> <code>ForEachUploadRange</code> reports only the dirty sub-ranges, and just those are copied into the Vulkan image — not the whole 4K surface.",
      "<b>Then the pages are write-protected.</b> <code>ApplyGpuProtection</code> arms the trap. The GPU now owns this data, and any CPU write has to be noticed.",
      "<b>Later, the game writes to page 5.</b> The page is protected, so the CPU raises an access violation instead of completing the store.",
      "<b>The fault lands in <code>KytyExceptionHandler</code></b>, which calls <code>Memory::HandleGpuFault</code>. It marks page 5 CPU-dirty, removes the protection, and returns <code>true</code>. Execution resumes and the store completes — the game never knew.",
      "<b>The next draw uploads page 5 only.</b> One page, because the tracker knows precisely which one changed. This is the whole loop, and it runs without a single line of cooperation from the game."
    ];

    function reset() {
      pgs.forEach(function (p) { p.className = "viz-pg"; p.querySelector(".ic").textContent = "·"; });
      dirEl.textContent = "";
      cpuEl.style.borderColor = "var(--rule)";
      gpuEl.style.borderColor = "var(--rule)";
    }
    function set(idx, cls, icon) {
      idx.forEach(function (i) {
        pgs[i].className = "viz-pg " + cls;
        if (icon) pgs[i].querySelector(".ic").textContent = icon;
      });
    }

    var drv = driver(body, CAPS, function (i) {
      reset();
      if (i === 0) { cpuEl.style.borderColor = "var(--guest)"; }
      else if (i === 1) { set([2, 3], "dirty", "W"); cpuEl.style.borderColor = "var(--guest)"; }
      else if (i === 2) { set([2, 3], "moving", "→"); dirEl.textContent = "→"; gpuEl.style.borderColor = "var(--guest)"; }
      else if (i === 3) { set([0, 1, 2, 3, 4, 5, 6, 7], "locked", "🔒"); gpuEl.style.borderColor = "var(--host)"; }
      else if (i === 4) {
        set([0, 1, 2, 3, 4, 5, 6, 7], "locked", "🔒"); set([5], "fault", "!");
        cpuEl.style.borderColor = "var(--host)";
      } else if (i === 5) {
        set([0, 1, 2, 3, 4, 6, 7], "locked", "🔒"); set([5], "dirty", "W");
      } else {
        set([0, 1, 2, 3, 4, 6, 7], "locked", "🔒"); set([5], "moving", "→");
        dirEl.textContent = "→"; gpuEl.style.borderColor = "var(--guest)";
      }
    }, 3000);

    body.insertBefore(wrap, body.firstChild);
    return drv;
  };

  /* ============================================================
     4 · wave — an if executing across 64 lanes
     ============================================================ */
  REG.wave = function (el) {
    var body = frame(el, "Watch an <code>if</code> execute on 64 shader lanes", "step through it",
      "Notice what never happens: no lane jumps somewhere different from its neighbours. There is one program counter for the whole wave. The only thing that changes is which lanes are listening — and that is why there is no branch structure left for the recompiler to read back out, only arithmetic on a mask.");

    var intro = document.createElement("p");
    intro.style.cssText = "font-size:14.5px;color:var(--muted);max-width:64ch;margin:0 0 16px;font-family:var(--serif);line-height:1.55";
    intro.innerHTML = "Each square is one lane, holding its own value of <code>x</code>. Blue means the lane is <b>active</b> and its results are kept; gold marks the lanes active in the <em>else</em> path. Faded lanes are still executing every instruction — their results are simply discarded.";

    var asmEl = document.createElement("div"); asmEl.className = "viz-asm";
    var grid = document.createElement("div"); grid.className = "viz-lanes";
    var mask = document.createElement("div"); mask.className = "viz-mask";
    mask.innerHTML = '<span><b>EXEC</b> <span class="hex"></span></span><span><b>active</b> <span class="n"></span> / 64</span>';

    var ASM = [
      "  ; wave starts — all 64 lanes enabled",
      "v_cmp_gt_f32       vcc, v0, 0     ; compare in every lane -> 64-bit mask",
      "s_and_saveexec_b64 s[0:1], vcc    ; save exec, keep only passing lanes",
      "  ; ... body of the THEN branch ...",
      "s_andn2_b64        exec, s[0:1], exec  ; flip to the other lanes",
      "  ; ... body of the ELSE branch ...",
      "s_mov_b64          exec, s[0:1]   ; restore — all lanes enabled"
    ];
    var CAPS = [
      "Every lane is active and holds its own value of <code>x</code>. There is <b>one</b> program counter for all 64 of them.",
      "The compare runs in every lane at once. It does not branch — it produces a 64-bit mask in <code>vcc</code>, one bit per lane, recording which lanes passed.",
      "<b>This is the branch.</b> The old mask is saved into <code>s[0:1]</code> and <code>EXEC</code> becomes <code>old &amp; vcc</code>. The faded lanes will still execute every following instruction; their writes are discarded.",
      "The <em>then</em> body runs. Only the blue lanes keep results — but the time is paid by all 64 lanes regardless.",
      "<code>s_andn2_b64</code> computes <code>saved &amp; ~exec</code>: exactly the lanes that failed. No jump occurred. The mask was recomputed.",
      "The <em>else</em> body runs for the gold lanes. Both branches have now executed, one after the other. <b>This is what divergence costs.</b>",
      "<code>EXEC</code> is restored and the wave continues with all lanes. Nowhere in this sequence is there a merge block, a join point, or any structure — only arithmetic. Reconstructing what SPIR-V demands from this is the recompiler's hardest job."
    ];

    var vals = [], cells = [];
    for (var i = 0; i < 64; i++) {
      var c = document.createElement("div");
      c.className = "viz-lane"; c.title = "lane " + i;
      grid.appendChild(c); cells.push(c);
    }
    function shuffle() { vals = []; for (var i = 0; i < 64; i++) vals.push(Math.floor(Math.random() * 19) - 9); }
    function cond(i) { return vals[i] > 0; }
    function activeAt(st, i) {
      if (st <= 1) return true;
      if (st === 2 || st === 3) return cond(i);
      if (st === 4 || st === 5) return !cond(i);
      return true;
    }
    function hexMask(st) {
      var hi = 0, lo = 0;
      for (var i = 0; i < 32; i++) if (activeAt(st, i)) lo |= (1 << i);
      for (var j = 32; j < 64; j++) if (activeAt(st, j)) hi |= (1 << (j - 32));
      function h(v) { var t = (v >>> 0).toString(16).toUpperCase(); while (t.length < 8) t = "0" + t; return t; }
      return "0x" + h(hi) + h(lo);
    }

    shuffle();
    body.appendChild(intro);
    body.appendChild(asmEl);
    body.appendChild(grid);
    body.appendChild(mask);

    var drv = driver(body, CAPS, function (st) {
      asmEl.innerHTML = ASM.map(function (l, k) {
        return '<div class="' + (k === st ? "cur" : "") + '">' + esc(l) + "</div>";
      }).join("");
      var n = 0;
      for (var i = 0; i < 64; i++) {
        var on = activeAt(st, i); if (on) n++;
        cells[i].className = "viz-lane " + (on ? ((st === 4 || st === 5) ? "alt" : "on") : "off");
        cells[i].textContent = vals[i];
      }
      mask.querySelector(".hex").textContent = hexMask(st);
      mask.querySelector(".n").textContent = n;
    }, 3200);

    var extra = document.createElement("button");
    extra.type = "button"; extra.textContent = "New random data";
    extra.style.cssText = "font-family:var(--mono);font-size:12px;padding:5px 12px;border:1px solid var(--rule);background:var(--surface-2);color:var(--ink-2);border-radius:2px;cursor:pointer";
    extra.addEventListener("click", function () { shuffle(); drv.show(0); drv.pause(); });
    body.querySelector(".viz-ctl").appendChild(extra);
    return drv;
  };

  /* ============================================================
     5 · tiling — why textures are not stored in rows
     ============================================================ */
  REG.tiling = function (el) {
    var body = frame(el, "Why textures are not stored row by row", "memory order walking the image",
      "<b>This is a simplified illustration.</b> It uses 2×2 Morton-style ordering to make the idea visible. The real families in <code>tile.cpp</code> use block sizes that vary with bytes-per-element, a per-block XOR of coordinates to spread blocks across memory channels and banks, separate schemes for depth and render targets, and a packed tail for small mips. The principle is the one shown here; the arithmetic is considerably worse.");

    var intro = document.createElement("p");
    intro.style.cssText = "font-size:14.5px;color:var(--muted);max-width:66ch;margin:0 0 16px;font-family:var(--serif);line-height:1.55";
    intro.innerHTML = "Both panels are the same 8×8 patch of one texture. The number in each texel is <b>its position in memory</b>. Watch where consecutive memory lands on screen.";

    var tiles = document.createElement("div");
    tiles.className = "viz-tiles";
    tiles.innerHTML =
      '<div><h5>Linear — row by row</h5><div class="viz-grid8" data-p="lin"></div></div>' +
      '<div><h5>Tiled — 2×2 blocks first</h5><div class="viz-grid8" data-p="swz"></div></div>';
    var lin = tiles.querySelector('[data-p="lin"]'), swz = tiles.querySelector('[data-p="swz"]');

    var W = 8, H = 8, N = 64;
    function swizzleIndex(x, y) {
      var bx = x >> 1, by = y >> 1, ix = x & 1, iy = y & 1;
      return (by * (W / 2) + bx) * 4 + (iy * 2 + ix);
    }
    var linCells = [], swzCells = [], linIdx = [], swzIdx = [], blkFlag = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var a = document.createElement("div"); a.className = "viz-tc";
        a.textContent = y * W + x; linIdx.push(y * W + x); lin.appendChild(a); linCells.push(a);
        var sIdx = swizzleIndex(x, y);
        var blk = (((x >> 1) + (y >> 1)) % 2 === 0);
        var b = document.createElement("div"); b.className = "viz-tc" + (blk ? " blk" : "");
        b.textContent = sIdx; swzIdx.push(sIdx); blkFlag.push(blk); swz.appendChild(b); swzCells.push(b);
      }
    }

    var CAPS = [
      "Memory offset <b>0</b>. Both layouts start at the top-left texel.",
      "Now walking forward through memory. In the <b>linear</b> layout consecutive memory is a horizontal run — the texel directly <em>below</em> the one you just read is 8 texels away here, and 4096 away on a real 4K texture. Certainly a different cache line.",
      "In the <b>tiled</b> layout, consecutive memory fills a small 2D block before moving on. Four texels in a 2×2 square are adjacent in memory.",
      "<b>That is the whole motivation.</b> A shader sampling with bilinear filtering reads a 2×2 neighbourhood. Tiled, all four land in one cache line; linear, they straddle two rows and two cache lines.",
      "The cost of this is that guest memory no longer matches what Vulkan expects, so every upload and download has to convert — which is why Kyty ships a compute shader per layout family."
    ];

    var m = 0, timer = null;
    function paint() {
      for (var i = 0; i < N; i++) {
        linCells[i].className = "viz-tc" + (linIdx[i] === m ? " now" : (linIdx[i] < m ? " past" : ""));
        swzCells[i].className = "viz-tc" + (blkFlag[i] ? " blk" : "") + (swzIdx[i] === m ? " now" : (swzIdx[i] < m ? " past" : ""));
      }
    }
    function runTo(limit, speed) {
      if (timer) { clearInterval(timer); timer = null; }
      if (REDUCED) { m = limit; paint(); return; }
      timer = setInterval(function () {
        if (m >= limit) { clearInterval(timer); timer = null; return; }
        m++; paint();
      }, speed || 90);
    }

    body.appendChild(intro);
    body.appendChild(tiles);

    var drv = driver(body, CAPS, function (i) {
      var targets = [0, 10, 16, 34, 63];
      if (i === 0) { m = 0; paint(); if (timer) { clearInterval(timer); timer = null; } }
      else { runTo(targets[i], 80); }
    }, 3600);

    return drv;
  };

  /* ============================================================
     6 · threads — who runs what, and when
     ============================================================ */
  REG.threads = function (el) {
    var body = frame(el, "Which thread runs what", "the process has three main actors",
      "The main thread never runs game code, and the guest thread never touches the window. That separation is required — macOS and Windows both insist window creation and event pumping happen on the process's first thread — and it has a useful side effect: a hung game does not freeze the window.");

    var W = 760, H = 220;
    var s = svg(W, H, "Timeline showing the main, guest and GPU threads over the life of the process");
    arrowDefs(s);

    var LANES = [
      { n: "main thread", side: "h", y: 34 },
      { n: "guest thread", side: "g", y: 96 },
      { n: "GPU thread", side: "k", y: 158 }
    ];
    var x0 = 118, x1 = 744;
    LANES.forEach(function (L) {
      s.appendChild(mk("text", { x: 12, y: L.y + 22, "class": "t" }, L.n));
      s.appendChild(mk("line", { x1: x0, y1: L.y + 17, x2: x1, y2: L.y + 17, "class": "wire", "stroke-dasharray": "3 4" }));
    });

    // blocks: [lane, startFrac, widthFrac, label, appearsAtStage]
    var BLK = [
      [0, 0.00, 0.16, "subsystem init", 0],
      [0, 0.17, 0.10, "load ELF", 1],
      [0, 0.28, 0.72, "WindowRun — SDL event loop", 3],
      [1, 0.28, 0.12, "relocate", 2],
      [1, 0.41, 0.14, "module init", 2],
      [1, 0.56, 0.44, "game code (native x86-64)", 4],
      [2, 0.00, 0.27, "created, idle", 3],
      [2, 0.28, 0.72, "parse PM4 · draw · flip", 5]
    ];
    var rects = [];
    BLK.forEach(function (b) {
      var L = LANES[b[0]];
      var x = x0 + b[1] * (x1 - x0), w = b[2] * (x1 - x0);
      var g = mk("g", { opacity: 0 });
      g.appendChild(mk("rect", { x: x, y: L.y, width: w, height: 34, rx: 3, "class": "nd " + L.side }));
      g.appendChild(mk("text", { x: x + 8, y: L.y + 21, "class": "s" }, b[3]));
      s.appendChild(g);
      rects.push({ g: g, at: b[4] });
    });

    var CAPS = [
      "<code>main()</code> brings up the core and thread subsystems, parses the command line, then initialises the remaining nine subsystems in dependency order.",
      "Still on the main thread: mount <code>/app0</code>, register every HLE NID, and load <code>eboot.bin</code> into guest memory. Nothing has executed yet — not even module initialisers.",
      "<code>Execute()</code> spawns the <b>guest thread</b>. It preloads adjacent modules, resolves every relocation, applies any game patches, then runs module initialisers.",
      "Meanwhile the original main thread enters <code>WindowRun()</code> and <b>never returns</b>. It owns the SDL window and pumps input for the rest of the process's life. The GPU thread has also been created by now.",
      "The guest thread calls the game's entry point on a guest stack. From here the CPU is executing the game's own code natively — the emulator is purely reactive.",
      "As the game submits command buffers, the <b>GPU thread</b> picks them up: parse PM4, update registers, translate draws into Vulkan, flip. Three threads, three completely different jobs."
    ];

    body.insertBefore(s, body.firstChild);
    var drv = driver(body, CAPS, function (i) {
      rects.forEach(function (r) {
        r.g.setAttribute("opacity", r.at <= i ? 1 : 0.38);
        var rc = r.g.querySelector("rect");
        rc.classList.toggle("lit", r.at === i);
      });
    }, 3200);
    return drv;
  };

  /* ============================================================
     7 · shaderflow — RDNA 2 machine code becoming SPIR-V
     ============================================================ */
  REG.shaderflow = function (el) {
    var body = frame(el, "RDNA 2 machine code becoming SPIR-V", "what each stage produces",
      "Eleven passes in the real pipeline; five shown here. The form of the data at each step is the useful thing to remember — the compiler never guesses, it only ever rewrites one representation into a slightly more structured one.");

    var W = 760, H = 150;
    var s = svg(W, H, "Five stages transforming shader machine code into SPIR-V");
    arrowDefs(s);

    var ST = [
      { t: "Machine code", sub: "64-bit words", side: "g" },
      { t: "Instructions", sub: "typed + operands", side: "k" },
      { t: "CFG", sub: "blocks + dominators", side: "k" },
      { t: "IR", sub: "several hundred ops", side: "k" },
      { t: "SPIR-V", sub: "structured, typed", side: "h" }
    ];
    var bw = 130, bh = 50, gap = 27, x = 16, y = 20;
    var nodes = [];
    ST.forEach(function (st, i) {
      nodes.push(box(s, x + i * (bw + gap), y, bw, bh, st.side, st.t, st.sub));
      if (i) {
        var ax = x + i * (bw + gap) - gap + 2;
        s.appendChild(mk("path", { d: "M" + (ax - 21) + " " + (y + bh / 2) + " L" + (ax - 4) + " " + (y + bh / 2), "class": "wire", "marker-end": "url(#vz-ah)" }));
      }
    });

    var form = mk("text", { x: 16, y: 110, "class": "t" }, "");
    var formSub = mk("text", { x: 16, y: 130, "class": "s" }, "");
    s.appendChild(form); s.appendChild(formSub);

    var FORMS = [
      ["0x0A00_0304  0xD1C2_0008 …", "just bits — no types, no structure, no function boundaries"],
      ["VOP2 VMulF32  dst v4  src0 v0  src1 v3", "opcode and operands recovered, with every modifier bit"],
      ["block 3: preds [2]  succ [4,7]  loop_header", "control flow as a graph — but branching is still mask arithmetic"],
      ["MulF32 v4, v0, v3     ; pc 0x18", "machine-close IR: deliberately not an optimising representation"],
      ["%r = OpFMul %float %a %b", "typed, structured, capability-declared — what Vulkan accepts"]
    ];
    var CAPS = [
      "<b>The input is a blob of bits</b> found at some address in guest memory. There are no types, no variables, no function boundaries — just instruction words operating on 106 scalar and 256 vector registers.",
      "<b>Decode.</b> Each word is matched to an encoding family (SOP, VOP, SMEM, MUBUF, MIMG, FLAT, DS, EXP) and unpacked into a typed instruction with its operands and its considerable pile of modifier bits.",
      "<b>Build the control-flow graph</b>, then try to <em>structurise</em> it: compute the merge and continue blocks SPIR-V requires. This is the stage most likely to fail, and failure is a supported outcome — the dispatcher fallback emits one loop around a switch on a program counter.",
      "<b>Lower to IR.</b> Close to the machine on purpose; this is a translator, not an optimiser. Staying close keeps the mapping auditable when a shader renders incorrectly.",
      "<b>Emit SPIR-V.</b> The largest stage, about 516 KB of emitter. Declare types and capabilities, then lower every IR instruction — including everything the hardware got for free, like bounds-checked buffer access and image format conversion."
    ];

    body.insertBefore(s, body.firstChild);
    var drv = driver(body, CAPS, function (i) {
      litOnly(nodes, i);
      form.textContent = FORMS[i][0];
      formSub.textContent = FORMS[i][1];
    }, 3400);
    return drv;
  };

  /* ---------------- public API ----------------
     Exposed so a second file (atlas.js) can register more widgets and reuse
     the helpers. Both files are loaded with `defer`, so they execute in order
     and everything is registered before DOMContentLoaded mounts it. */
  window.VIZ = {
    register: function (name, fn) { REG[name] = fn; },
    frame: frame, svg: svg, mk: mk, box: box, arrowDefs: arrowDefs,
    driver: driver, litOnly: litOnly, esc: esc,
    get REDUCED() { return REDUCED; }
  };

  /* ---------------- mount everything ---------------- */
  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-viz]"), function (el) {
      var f = REG[el.dataset.viz];
      if (!f) return;
      try { f(el); } catch (err) {
        el.innerHTML = '<div class="viz-note">This visualisation failed to load.</div>';
        if (window.console) console.error("viz:" + el.dataset.viz, err);
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);   // let a later-loaded file register first
})();
