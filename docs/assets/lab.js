/* ============================================================
   lab.js — interactive tools for the KytyPS5 Lab
   Requires viz.js (loaded first) only for window.VIZ.register().
   Every widget here is driven by user input and computes real results.

   Registers: cpustep · vaddr · regdecode · memflow · allocator
              wavelab · isa2spirv · tileaddr · pm4build · timeline · pipekey
   ============================================================ */
(function () {
  "use strict";
  if (!window.VIZ || !window.VIZ.register) {
    // viz.js is missing or is an older cached copy without the register() API.
    // Say so on the page rather than leaving silent blank gaps.
    document.addEventListener("DOMContentLoaded", function () {
      Array.prototype.forEach.call(document.querySelectorAll("[data-viz]"), function (el) {
        if (el.children.length) return;
        el.innerHTML = '<div style="border:1px solid #c00;border-radius:3px;padding:12px;' +
          'font-family:monospace;font-size:12px">Interactive piece unavailable — the shared ' +
          'script is out of date. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) to fix.</div>';
      });
    });
    return;
  }
  var reg = window.VIZ.register;
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- tiny DOM + number helpers ---------------- */
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function hx(v, w) { var s = (v >>> 0).toString(16).toUpperCase(); while (s.length < (w || 0)) s = "0" + s; return s; }
  function hx64(n, w) { var s = n.toString(16).toUpperCase(); while (s.length < (w || 0)) s = "0" + s; return s; }
  function parseHex(s, dflt) {
    if (s == null) return dflt;
    var t = String(s).trim().replace(/^0[xX]/, "").replace(/[^0-9a-fA-F]/g, "");
    if (!t.length) return dflt;
    var v = parseInt(t, 16);
    return isNaN(v) ? dflt : v;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** Standard frame: header, body, optional footnote. */
  function frame(host, title, hint, note) {
    host.classList.add("lab");
    host.innerHTML =
      '<div class="lab-head"><b>' + title + "</b><span>" + hint + "</span></div>" +
      '<div class="lab-body"></div>' +
      (note ? '<div class="lab-note">' + note + "</div>" : "");
    return host.querySelector(".lab-body");
  }
  function ctlRow(body) { var r = h("div", "lab-ctl"); body.appendChild(r); return r; }
  function label(row, text) { row.appendChild(h("span", "lab-lb", text)); }
  function input(row, cls, value, size) {
    var i = h("input", "lab-in " + (size || "w-hex"));
    i.type = "text"; i.value = value; i.spellcheck = false; i.autocomplete = "off";
    row.appendChild(i); return i;
  }
  function button(row, text, cls) {
    var b = h("button", "lab-btn " + (cls || ""), text);
    b.type = "button"; row.appendChild(b); return b;
  }
  function select(row, options, value) {
    var s = h("select", "lab-sel");
    options.forEach(function (o) {
      var op = h("option", null, o.label);
      op.value = o.value;
      s.appendChild(op);
    });
    if (value != null) s.value = value;
    row.appendChild(s); return s;
  }
  function spacer(row) { row.appendChild(h("span", "lab-sp")); }
  function status(row) { var s = h("span", "lab-status"); row.appendChild(s); return s; }

  /**
   * Self-running demo. Every tool gets one so it can be understood without
   * typing anything first; the controls stay live throughout, and starting to
   * poke at them mid-demo just means you take over.
   * steps = [{ say: "narration", run: fn, ms: optional override }]
   */
  function demoRunner(row, steps, ms) {
    var btn = h("button", "lab-btn demo", "▶ Run demo");
    btn.type = "button";
    row.appendChild(btn);
    var bar = h("div", "lab-demo");
    bar.hidden = true;
    row.parentNode.insertBefore(bar, row.nextSibling);

    var i = 0, timer = null;
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      btn.textContent = "▶ Run demo";
      btn.classList.remove("on");
      bar.hidden = true;
    }
    function tick() {
      if (i >= steps.length) {
        bar.innerHTML = '<span class="n">done</span>Now change anything above — it is all live.';
        timer = setTimeout(stop, 3200);
        return;
      }
      var s = steps[i++];
      try { if (s.run) s.run(); } catch (err) { if (window.console) console.error("demo step", err); }
      bar.innerHTML = '<span class="n">' + i + " / " + steps.length + "</span>" + s.say;
      timer = setTimeout(tick, s.ms || ms || 2400);
    }
    btn.addEventListener("click", function () {
      if (timer) { stop(); return; }
      i = 0; bar.hidden = false;
      btn.textContent = "■ Stop"; btn.classList.add("on");
      tick();
    });
    // stop if the reader scrolls away
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) {
        e.forEach(function (en) { if (!en.isIntersecting && timer) stop(); });
      }, { threshold: 0 }).observe(row.parentNode);
    }
    return { stop: stop };
  }
  /** Fire the events a control would fire if a person had touched it. */
  function setInput(el, v) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
  function setSelect(el, v) { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }

  /**
   * 32-bit ruler. fields = [{name, shift, width, cls}]. Clicking a bit toggles it
   * and calls onToggle with the new value.
   */
  function bitRuler(container, value, fields, onToggle) {
    container.innerHTML = "";
    var strip = h("div", "lab-bits");
    for (var i = 31; i >= 0; i--) {
      var cls = "lab-bit";
      for (var f = 0; f < fields.length; f++) {
        var fl = fields[f];
        if (i >= fl.shift && i < fl.shift + fl.width) { cls += " f" + (fl.cls != null ? fl.cls : (f % 4)); break; }
      }
      var d = h("div", cls, String((value >>> i) & 1));
      d.title = "bit " + i;
      d.dataset.bit = i;
      strip.appendChild(d);
    }
    container.appendChild(strip);
    var scale = h("div", "lab-bitscale");
    for (var k = 31; k >= 0; k--) scale.appendChild(h("span", null, (k % 4 === 0) ? String(k) : ""));
    container.appendChild(scale);
    if (onToggle) {
      strip.addEventListener("click", function (e) {
        var b = e.target.closest("[data-bit]"); if (!b) return;
        onToggle((value ^ (1 << (+b.dataset.bit))) >>> 0);
      });
    }
  }

  /* ============================================================
     1 · cpustep — step a real guest function call
     ============================================================ */
  reg("cpustep", function (host) {
    var body = frame(host,
      "Step a guest function call",
      "edit the arguments · switch the callee's ABI",
      "This is a real interpreter for a handful of x86-64 instructions, running in your browser. On the actual emulator no interpreter exists — the host CPU executes these very instructions directly. The point here is to watch <em>which register holds what</em>, because that is the whole calling-convention problem: flip the callee's ABI and the same register file is read completely differently.");

    var SYSV = ["rdi", "rsi", "rdx", "rcx", "r8", "r9"];
    var MSX = ["rcx", "rdx", "r8", "r9"];
    var ORDER = ["rax", "rbx", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "r10", "r11"];

    var top = ctlRow(body);
    label(top, "arg values (hex)");
    var argIn = [];
    ["11", "22", "33", "44", "55", "66"].forEach(function (v) {
      argIn.push(input(top, null, v, "w-num"));
    });
    var row2 = ctlRow(body);
    label(row2, "callee reads args as");
    var abiSel = select(row2, [
      { value: "sysv", label: "System V  (KYTY_SYSV_ABI — correct)" },
      { value: "ms", label: "Microsoft x64  (attribute missing — wrong)" }
    ], "sysv");
    spacer(row2);
    var stepBtn = button(row2, "Step →");
    var runBtn = button(row2, "Run all", "pri");
    var rstBtn = button(row2, "Reset");
    var st = status(row2);

    var split = h("div", "lab-2 wide-l");
    var left = h("div"), right = h("div");
    left.appendChild(h("div", "lab-h", "program (guest side)"));
    var codeEl = h("div", "lab-code"); left.appendChild(codeEl);
    left.appendChild(h("div", "lab-h", "what the callee sees"));
    var seesEl = h("div", "lab-fields"); left.appendChild(seesEl);
    right.appendChild(h("div", "lab-h", "register file"));
    var regsEl = h("div", "lab-regs"); right.appendChild(regsEl);
    split.appendChild(left); split.appendChild(right);
    body.appendChild(split);

    var R, pc, wrote, read, prog;

    function build() {
      var a = argIn.map(function (i) { return parseHex(i.value, 0); });
      prog = SYSV.map(function (r, k) {
        return { txt: "mov    " + r + ", 0x" + hx(a[k]), reg: r, val: a[k] };
      });
      prog.push({ txt: "call   scePadReadState@plt", call: true });
      prog.push({ txt: "; jmp through GOT -> Kyty C++", note: true });
    }
    function reset() {
      R = {}; ORDER.forEach(function (r) { R[r] = 0; });
      pc = 0; wrote = null; read = null;
      build(); render();
    }
    function step() {
      if (pc >= prog.length) return;
      var ins = prog[pc];
      wrote = null; read = null;
      if (ins.reg) { R[ins.reg] = ins.val; wrote = ins.reg; }
      pc++;
      render();
    }
    function render() {
      codeEl.innerHTML = prog.map(function (ins, k) {
        var cls = k === pc ? "cur" : (k < pc ? "done" : "");
        return '<div class="' + cls + '"><span class="pc">' + hx(k * 7, 3) + "</span><span>" + ins.txt + "</span></div>";
      }).join("");

      var callReached = pc >= prog.length - 1;
      var abi = abiSel.value, regs = abi === "sysv" ? SYSV : MSX;
      regsEl.innerHTML = ORDER.map(function (r) {
        var cls = "lab-reg";
        if (r === wrote) cls += " wrote";
        else if (callReached && regs.indexOf(r) >= 0) cls += " read";
        if (!R[r]) cls += " zero";
        return '<div class="' + cls + '"><span class="rn">' + r + '</span><span class="rv">0x' + hx(R[r], 2) + "</span></div>";
      }).join("");

      var names = ["handle", "index", "flags", "buffer", "size", "userdata"];
      seesEl.innerHTML = names.map(function (n, k) {
        var src = k < regs.length ? regs[k] : "stack";
        var got = k < regs.length ? R[regs[k]] : null;
        var want = parseHex(argIn[k].value, 0);
        var bad = callReached && (got === null || got !== want);
        return '<div class="' + (bad ? "hi" : "") + '">' +
          '<span class="fn">' + n + "</span>" +
          '<span class="fb">' + src + "</span>" +
          '<span class="fv" style="' + (bad ? "color:var(--host)" : "") + '">' +
          (callReached ? (got === null ? "&lt;not passed&gt;" : "0x" + hx(got, 2)) : "&mdash;") + "</span></div>";
      }).join("");

      if (!callReached) { st.className = "lab-status"; st.textContent = "step " + pc + " / " + prog.length; }
      else if (abi === "sysv") { st.className = "lab-status ok"; st.textContent = "all six arguments correct"; }
      else { st.className = "lab-status err"; st.textContent = "every argument wrong — and two were never passed"; }
    }

    stepBtn.addEventListener("click", step);
    runBtn.addEventListener("click", function () { while (pc < prog.length) { var i = prog[pc]; if (i.reg) R[i.reg] = i.val; pc++; } wrote = null; render(); });
    rstBtn.addEventListener("click", reset);
    abiSel.addEventListener("change", render);
    argIn.forEach(function (i) { i.addEventListener("input", function () { reset(); }); });
    reset();

    demoRunner(row2, [
      { say: "Six arguments to pass. The guest sets them one register at a time.",
        run: function () { ["A1", "B2", "C3", "D4", "E5", "F6"].forEach(function (v, k) { setInput(argIn[k], v); }); setSelect(abiSel, "sysv"); } },
      { say: "Stepping the first three <code>mov</code> instructions — watch <code>rdi</code>, <code>rsi</code> and <code>rdx</code> fill.",
        run: function () { step(); step(); step(); } },
      { say: "And the rest: <code>rcx</code>, <code>r8</code>, <code>r9</code>. The call is now set up.",
        run: function () { step(); step(); step(); step(); } },
      { say: "The callee has <code>KYTY_SYSV_ABI</code>, so it reads System&nbsp;V registers. <b>All six arguments arrive correctly.</b>",
        run: function () { setSelect(abiSel, "sysv"); }, ms: 3000 },
      { say: "Now suppose someone forgot the attribute. Same registers, read as <b>Microsoft x64</b> instead…",
        run: function () { setSelect(abiSel, "ms"); }, ms: 3400 },
      { say: "<b>Every argument is wrong.</b> <code>handle</code> is now the <code>buffer</code> pointer, and the last two were never passed at all — they would be read from the stack as garbage.",
        ms: 4200 },
      { say: "Put the attribute back and the two worlds line up again.",
        run: function () { setSelect(abiSel, "sysv"); }, ms: 2600 }
    ]);
  });

  /* ============================================================
     2 · vaddr — guest address translation walker
     ============================================================ */
  reg("vaddr", function (host) {
    var body = frame(host,
      "Translate a guest address",
      "type any address · updates as you type",
      "The band boundaries and the module layout constants are the real ones from <code>memoryAddressSpace.inc</code> and <code>runtimeLinker.cpp</code>. This is why a guest pointer is recognisable on sight: <code>0x9…</code> is module code, <code>0x1…</code> is guest heap, and anything above <code>0x7000_0000_0000</code> is the emulator's own image.");

    var SYSTEM_RESERVED = 0x800000000, CODE_BASE_OFFSET = 0x100000000, CODE_BASE_INCR = 0x10000000;
    var MODULE_BASE = SYSTEM_RESERVED + CODE_BASE_OFFSET;           // 0x900000000
    var GUEST_PAGE = 0x4000, HOST_PAGE = 0x1000;
    var BANDS = [
      { lo: 0x0000040000, hi: 0x07FFFFBFFF, n: "system managed", who: "host OS, emulator image, Qt, SDL, Vulkan driver", k: "host" },
      { lo: 0x07FFFFC000, hi: 0x0FFFFFFFFF, n: "system reserved", who: "loaded guest modules and generated PLT tables", k: "kyty" },
      { lo: 0x1000000000, hi: 0xFBFFFFFFFF, n: "user area", who: "every guest allocation: direct, flexible, pooled, stacks", k: "guest" },
      { lo: 0xFC00000000, hi: 0xFFFFFFFFFFFF, n: "host high", who: "the emulator binary, linked deliberately high", k: "host" }
    ];
    var MODULES = [
      { n: "eboot.bin", base: MODULE_BASE, size: 0x0A40000 },
      { n: "libSceNgs2.prx", base: MODULE_BASE + CODE_BASE_INCR, size: 0x0180000 },
      { n: "libSceAudio.prx", base: MODULE_BASE + CODE_BASE_INCR * 2, size: 0x00C0000 }
    ];

    var row = ctlRow(body);
    label(row, "guest address");
    var addrIn = input(row, null, "0x900012F40", "w-wide");
    label(row, "presets");
    [["module code", "0x900012F40"], ["second module", "0x910000080"],
     ["guest heap", "0x1000A34000"], ["emulator", "0x700000001234"]].forEach(function (p) {
      var b = button(row, p[0]);
      b.addEventListener("click", function () { addrIn.value = p[1]; update(); });
    });

    // The band/module facts are wide-format text, so they get the full width
    // rather than being squeezed into a column beside the bit ruler.
    body.appendChild(h("div", "lab-h", "which band, and what lives there"));
    var bandEl = h("div", "lab-fields two"); body.appendChild(bandEl);

    var out = h("div", "lab-2");
    var oL = h("div"), oR = h("div");
    oL.appendChild(h("div", "lab-h", "page decomposition"));
    var pageEl = h("div", "lab-steps"); oL.appendChild(pageEl);
    oR.appendChild(h("div", "lab-h", "low 32 bits — page index vs offset"));
    var ruler = h("div"); oR.appendChild(ruler);
    oR.appendChild(h("div", "lab-h", "host pages this guest page covers"));
    var hostEl = h("div", "lab-pagerow"); oR.appendChild(hostEl);
    var keyEl = h("div", "lab-key",
      '<span><i style="background:color-mix(in srgb,var(--guest) 50%,transparent)"></i>guest page index</span>' +
      '<span><i style="background:color-mix(in srgb,var(--kyty) 50%,transparent)"></i>offset within the 16 KB page</span>');
    oR.appendChild(keyEl);
    out.appendChild(oL); out.appendChild(oR);
    body.appendChild(out);

    function update() {
      var addr = parseHex(addrIn.value, 0);
      var band = null;
      for (var i = 0; i < BANDS.length; i++) if (addr >= BANDS[i].lo && addr <= BANDS[i].hi) { band = BANDS[i]; break; }

      var mod = null;
      for (var m = 0; m < MODULES.length; m++) {
        if (addr >= MODULES[m].base && addr < MODULES[m].base + MODULES[m].size) { mod = MODULES[m]; break; }
      }

      var rows = [];
      rows.push(['<span class="fn">address</span><span class="fv">0x' + hx64(addr, 10) + "</span>", false]);
      rows.push(['<span class="fn">band</span><span class="fv">' +
        (band ? band.n : "outside every known band") + "</span>", !band]);
      if (band) {
        rows.push(['<span class="fn">band range</span><span class="fv">0x' +
          hx64(band.lo, 10) + " – 0x" + hx64(band.hi, 10) + "</span>", false]);
        rows.push(['<span class="fn">owner</span><span class="fv" style="color:var(--muted)">' + band.who + "</span>", false]);
      }
      if (mod) {
        rows.push(['<span class="fn">module</span><span class="fv">' + mod.n + "</span>", false]);
        rows.push(['<span class="fn">module base</span><span class="fv">0x' + hx64(mod.base, 10) + "</span>", false]);
        rows.push(['<span class="fn">offset in module</span><span class="fv">+0x' + hx64(addr - mod.base, 0) + "</span>", false]);
      } else if (band && band.k === "kyty") {
        rows.push(['<span class="fn">module</span><span class="fv" style="color:var(--muted)">no module loaded at this address</span>', false]);
      }
      bandEl.innerHTML = rows.map(function (r) { return '<div class="' + (r[1] ? "hi" : "") + '">' + r[0] + "</div>"; }).join("");

      var pageIdx = Math.floor(addr / GUEST_PAGE);
      var pageOff = addr % GUEST_PAGE;
      var pageBase = pageIdx * GUEST_PAGE;
      pageEl.innerHTML =
        '<div><span>guest page size</span><span class="sv">0x4000  (16 KB)</span></div>' +
        '<div><span>guest page index &nbsp;addr / 0x4000</span><span class="sv">' + pageIdx.toLocaleString() + "</span></div>" +
        '<div><span>page base address</span><span class="sv">0x' + hx64(pageBase, 10) + "</span></div>" +
        '<div><span>offset within page &nbsp;addr &amp; 0x3FFF</span><span class="sv">0x' + hx(pageOff, 4) + "</span></div>" +
        '<div class="total"><span>host 4 KB pages covered</span><span class="sv">4</span></div>';

      // ruler over the low 32 bits: bits 0..13 = offset, 14..31 = page index
      bitRuler(ruler, addr >>> 0, [
        { name: "offset", shift: 0, width: 14, cls: 1 },
        { name: "page index", shift: 14, width: 18, cls: 0 }
      ], null);

      hostEl.innerHTML = "";
      for (var p = 0; p < 4; p++) {
        var hb = pageBase + p * HOST_PAGE;
        var inThis = (addr >= hb && addr < hb + HOST_PAGE);
        hostEl.appendChild(h("div", "lab-pg " + (inThis ? "cpu" : ""),
          "0x" + hx64(hb, 10).slice(-7) + (inThis ? "<br>← here" : "<br>&nbsp;")));
      }
    }
    addrIn.addEventListener("input", update);
    update();

    demoRunner(row, [
      { say: "Start inside the main executable, at <code>0x900012F40</code>. The band is <b>system reserved</b> and the module is <code>eboot.bin</code>.",
        run: function () { setInput(addrIn, "0x900012F40"); }, ms: 3200 },
      { say: "Add <code>0x10000000</code> — 256 MB, the spacing the loader uses. We land in the <b>next module</b>.",
        run: function () { setInput(addrIn, "0x910000080"); }, ms: 3200 },
      { say: "Change only the last few digits and watch the bit ruler: <b>just the low 14 bits move</b>, because a guest page is <code>0x4000</code> bytes.",
        run: function () { setInput(addrIn, "0x910003FFF"); }, ms: 3400 },
      { say: "One more byte and the page index increments — a new 16 KB page, and four new host pages.",
        run: function () { setInput(addrIn, "0x910004000"); }, ms: 3400 },
      { say: "Jump to the <b>user area</b>. This is where every guest allocation lives: direct, flexible, pooled, and thread stacks.",
        run: function () { setInput(addrIn, "0x1000A34000"); }, ms: 3200 },
      { say: "And here is the emulator's own image, linked far above anything the guest can reach — which is why a guest pointer and a host pointer can never be confused by value alone.",
        run: function () { setInput(addrIn, "0x700000001234"); }, ms: 4000 }
    ]);
  });

  /* ============================================================
     3 · regdecode — hardware register bit-field lab
     ============================================================ */
  reg("regdecode", function (host) {
    var body = frame(host,
      "Decode a hardware register",
      "click any bit to flip it",
      "Every shift and mask here is copied from <code>pm4.h</code>, and the enum names from <code>gpu_defs.h</code>. This is exactly the work <code>pm4Handlers.cpp</code> does for thousands of registers — unpack bit fields into a typed struct so the renderer can read them by name.");

    var FMT = { 0: "kInvalid", 1: "8", 2: "16", 3: "8_8", 4: "32", 5: "16_16", 6: "11_11_10", 9: "10_10_10_2", 10: "8_8_8_8", 11: "32_32", 12: "16_16_16_16", 14: "32_32_32_32", 16: "5_6_5", 17: "5_5_5_1", 19: "4_4_4_4", 35: "kBc1", 36: "kBc2", 37: "kBc3" };
    var NUMT = { 0: "kUNorm", 1: "kSNorm", 4: "kUInt", 5: "kSInt", 6: "kSrgb", 7: "kFloat" };
    var SWAP = { 0: "kStandard (RGBA)", 1: "kAlt", 2: "kReversed (ABGR)", 3: "kAltReversed (BGRA)" };
    var CMP = { 0: "never", 1: "less", 2: "equal", 3: "less or equal", 4: "greater", 5: "not equal", 6: "greater or equal", 7: "always" };
    var TILE = { 0: "kLinear", 1: "kStandard256B", 5: "kStandard4KB", 9: "kStandard64KB", 17: "kPrt", 24: "kDepth", 27: "kRenderTarget" };

    var REGS = {
      CB_COLOR0_INFO: {
        preset: 0x0000280A,
        f: [
          { n: "FORMAT", s: 2, w: 5, e: FMT },
          { n: "NUMBER_TYPE", s: 8, w: 3, e: NUMT },
          { n: "COMP_SWAP", s: 11, w: 2, e: SWAP },
          { n: "FAST_CLEAR", s: 13, w: 1 },
          { n: "COMPRESSION", s: 14, w: 1 },
          { n: "BLEND_CLAMP", s: 15, w: 1 },
          { n: "BLEND_BYPASS", s: 16, w: 1 },
          { n: "ROUND_MODE", s: 18, w: 1 },
          { n: "CMASK_IS_LINEAR", s: 19, w: 1 },
          { n: "FMASK_COMPRESSION_DISABLE", s: 26, w: 1 },
          { n: "FMASK_COMPRESS_1FRAG_ONLY", s: 27, w: 1 }
        ]
      },
      DB_DEPTH_CONTROL: {
        preset: 0x00000047,
        f: [
          { n: "STENCIL_ENABLE", s: 0, w: 1 },
          { n: "Z_ENABLE", s: 1, w: 1 },
          { n: "Z_WRITE_ENABLE", s: 2, w: 1 },
          { n: "DEPTH_BOUNDS_ENABLE", s: 3, w: 1 },
          { n: "ZFUNC", s: 4, w: 3, e: CMP },
          { n: "BACKFACE_ENABLE", s: 7, w: 1 },
          { n: "STENCILFUNC", s: 8, w: 3, e: CMP },
          { n: "STENCILFUNC_BF", s: 20, w: 3, e: CMP },
          { n: "COLOR_WRITES_ON_DEPTH_FAIL", s: 30, w: 1 },
          { n: "NO_COLOR_WRITES_ON_DEPTH_PASS", s: 31, w: 1 }
        ]
      },
      "T# dword 3 (image descriptor)": {
        preset: 0x9002FAC0,
        f: [
          { n: "dst_sel_x", s: 0, w: 3 }, { n: "dst_sel_y", s: 3, w: 3 },
          { n: "dst_sel_z", s: 6, w: 3 }, { n: "dst_sel_w", s: 9, w: 3 },
          { n: "base_level", s: 12, w: 4 }, { n: "last_level", s: 16, w: 4 },
          { n: "tiling_idx", s: 20, w: 5, e: TILE }, { n: "bc_swizzle", s: 25, w: 3 },
          { n: "type", s: 28, w: 4, e: { 8: "1D", 9: "2D", 10: "3D", 11: "Cube", 12: "1D array", 13: "2D array", 14: "2D MSAA", 15: "2D MSAA array" } }
        ]
      },
      "V# dword 3 (buffer descriptor)": {
        preset: 0x00027FAC,
        f: [
          { n: "dst_sel_x", s: 0, w: 3 }, { n: "dst_sel_y", s: 3, w: 3 },
          { n: "dst_sel_z", s: 6, w: 3 }, { n: "dst_sel_w", s: 9, w: 3 },
          { n: "data_format", s: 12, w: 7 },
          { n: "index_stride", s: 21, w: 2 }, { n: "add_tid_enable", s: 23, w: 1 },
          { n: "out_of_bounds", s: 28, w: 2 },
          { n: "type", s: 30, w: 2, e: { 1: "buffer", 2: "sampler", 3: "unused" } }
        ]
      }
    };

    var row = ctlRow(body);
    label(row, "register");
    var sel = select(row, Object.keys(REGS).map(function (k) { return { value: k, label: k }; }), "CB_COLOR0_INFO");
    label(row, "value");
    var valIn = input(row, null, "0x0000280A", "w-hex");
    var rnd = button(row, "Random");
    var zero = button(row, "Zero");

    var ruler = h("div"); body.appendChild(ruler);
    body.appendChild(h("div", "lab-h", "decoded fields"));
    var fieldsEl = h("div", "lab-fields"); body.appendChild(fieldsEl);

    var cur = 0;
    function render() {
      var def = REGS[sel.value];
      var flds = def.f.map(function (f, i) { return { name: f.n, shift: f.s, width: f.w, cls: i % 4 }; });
      bitRuler(ruler, cur, flds, function (nv) { cur = nv; valIn.value = "0x" + hx(cur, 8); render(); });
      fieldsEl.innerHTML = def.f.map(function (f) {
        var mask = f.w >= 32 ? 0xFFFFFFFF : ((1 << f.w) - 1);
        var v = (cur >>> f.s) & mask;
        var shown = f.e ? (f.e[v] != null ? f.e[v] + "  (" + v + ")" : v + "  &lt;unknown&gt;")
          : (f.w === 1 ? (v ? "true" : "false") : v + "  0x" + hx(v, 1));
        return "<div>" +
          '<span class="fn">' + f.n + "</span>" +
          '<span class="fb">' + (f.w === 1 ? "bit " + f.s : "bits " + (f.s + f.w - 1) + ":" + f.s) + "</span>" +
          '<span class="fv">' + shown + "</span></div>";
      }).join("");
    }
    function fromInput() { cur = parseHex(valIn.value, 0) >>> 0; render(); }
    valIn.addEventListener("input", fromInput);
    sel.addEventListener("change", function () { cur = REGS[sel.value].preset >>> 0; valIn.value = "0x" + hx(cur, 8); render(); });
    rnd.addEventListener("click", function () { cur = (Math.random() * 0xFFFFFFFF) >>> 0; valIn.value = "0x" + hx(cur, 8); render(); });
    zero.addEventListener("click", function () { cur = 0; valIn.value = "0x00000000"; render(); });
    fromInput();

    function flip(bit) { cur = (cur ^ (1 << bit)) >>> 0; valIn.value = "0x" + hx(cur, 8); render(); }
    demoRunner(row, [
      { say: "<code>CB_COLOR0_INFO</code> describes a render target. Bits 6:2 are the surface format — right now <b>16</b>.",
        run: function () { setSelect(sel, "CB_COLOR0_INFO"); setInput(valIn, "0x0000280A"); }, ms: 3200 },
      { say: "Flip bit 3 and the format becomes something else entirely. <b>One bit changes what the render target is.</b>",
        run: function () { flip(3); }, ms: 3200 },
      { say: "Bit 13 is <code>FAST_CLEAR</code>. Turning it off means the surface can no longer be cleared through metadata alone.",
        run: function () { flip(13); }, ms: 3000 },
      { say: "Now <code>DB_DEPTH_CONTROL</code>. <code>Z_ENABLE</code> and <code>Z_WRITE_ENABLE</code> are on, and <code>ZFUNC</code> is a three-bit compare function.",
        run: function () { setSelect(sel, "DB_DEPTH_CONTROL"); setInput(valIn, "0x00000047"); }, ms: 3400 },
      { say: "Set <code>ZFUNC</code> to 7 — <b>always</b>. Depth testing that never rejects anything, which is a common way to lose all depth sorting.",
        run: function () { setInput(valIn, "0x00000077"); }, ms: 3600 },
      { say: "The same machinery decodes GPU resource descriptors. This is dword 3 of a <b>T#</b> — an image — carrying its mip range, tiling mode and dimensionality.",
        run: function () { setSelect(sel, "T# dword 3 (image descriptor)"); }, ms: 3600 },
      { say: "And a <b>V#</b> buffer descriptor. Note bits 31:30: the type field is how the emulator tells a buffer from a sampler.",
        run: function () { setSelect(sel, "V# dword 3 (buffer descriptor)"); }, ms: 3600 },
      { say: "Random values mostly decode to nonsense — a decent intuition for why the real handlers assert so hard on fields they do not recognise.",
        run: function () { rnd.click(); }, ms: 3000 }
    ]);
  });

  /* ============================================================
     4 · memflow — guest memory and its Vulkan copy, byte by byte
     ============================================================ */
  reg("memflow", function (host) {
    var body = frame(host,
      "Guest memory and its GPU copy",
      "click any byte to write it as the CPU",
      "Eight rows, one per guest page. The whole loop runs with <em>no cooperation from the game</em>: on a console CPU and GPU share one pool of memory, so nothing in the guest's code says when a texture changed. Write-protecting the pages turns each write into a fault, and the fault is the notification.");

    var PAGES = 8, PERPAGE = 8, N = PAGES * PERPAGE;
    var cpu = [], gpu = [], pstate = [];   // pstate: clean | cpu | gpu | lock
    var moving = {};

    function reset() {
      cpu = []; gpu = []; pstate = [];
      for (var i = 0; i < N; i++) { cpu.push((i * 17 + 3) & 0xFF); gpu.push(null); }
      for (var p = 0; p < PAGES; p++) pstate.push("clean");
      moving = {}; log("Guest memory allocated. Nothing uploaded yet — the GPU has no copy.");
      render();
    }

    var row = ctlRow(body);
    var drawBtn = button(row, "Draw → upload dirty pages", "pri");
    var gpuBtn = button(row, "GPU writes a render target");
    var readBtn = button(row, "CPU reads it back");
    var rstBtn = button(row, "Reset");
    spacer(row);
    var st = status(row);

    var split = h("div", "lab-2");
    var gL = h("div"), gR = h("div");
    gL.appendChild(h("div", "lab-h", "guest memory (what the game sees)"));
    var cpuEl = h("div", "lab-hex"); gL.appendChild(cpuEl);
    gR.appendChild(h("div", "lab-h", "Vulkan image (host GPU memory)"));
    var gpuEl = h("div", "lab-hex"); gR.appendChild(gpuEl);
    split.appendChild(gL); split.appendChild(gR);
    body.appendChild(split);

    var keyEl = h("div", "lab-key",
      '<span><i style="background:color-mix(in srgb,var(--kyty) 60%,transparent)"></i>CPU-dirty — needs uploading</span>' +
      '<span><i style="background:color-mix(in srgb,var(--host) 55%,transparent)"></i>GPU-dirty — needs downloading</span>' +
      '<span><i style="background:var(--guest)"></i>copying now</span>' +
      '<span><i style="border:1px dashed var(--rule-2)"></i>write-protected</span>');
    body.appendChild(keyEl);

    var logEl = h("div", "lab-steps"); body.appendChild(h("div", "lab-h", "event log"));
    body.appendChild(logEl);
    var lines = [];
    function log(s) { lines.unshift(s); if (lines.length > 6) lines.pop(); logEl.innerHTML = lines.map(function (l, i) { return "<div" + (i === 0 ? ' class="total"' : "") + "><span>" + l + "</span><span class='sv'></span></div>"; }).join(""); }

    function grid(target, data, side) {
      target.innerHTML = "";
      for (var p = 0; p < PAGES; p++) {
        var r = h("div", "lab-hexrow");
        r.appendChild(h("span", "off", "page " + p));
        for (var b = 0; b < PERPAGE; b++) {
          var idx = p * PERPAGE + b;
          var v = data[idx];
          var cls = "lab-cell";
          if (v == null) { cls += ""; }
          else {
            cls += " set";
            if (side === "cpu") {
              if (pstate[p] === "cpu") cls += " cpu";
              else if (pstate[p] === "gpu") cls += " gpu";
              if (pstate[p] === "lock") cls += " locked";
            }
          }
          if (moving[side + idx]) cls += " moved";
          var c = h("div", cls, v == null ? "··" : hx(v, 2));
          c.dataset.i = idx; c.dataset.side = side;
          c.title = side === "cpu" ? "click to write as the CPU" : "";
          r.appendChild(c);
        }
        target.appendChild(r);
      }
    }
    function render() {
      grid(cpuEl, cpu, "cpu");
      grid(gpuEl, gpu, "gpu");
      var d = pstate.filter(function (s) { return s === "cpu"; }).length;
      var g = pstate.filter(function (s) { return s === "gpu"; }).length;
      var l = pstate.filter(function (s) { return s === "lock"; }).length;
      st.className = "lab-status" + (d ? " err" : (g ? " err" : " ok"));
      st.textContent = d + " CPU-dirty · " + g + " GPU-dirty · " + l + " protected";
    }
    function flash(side, idxs, then) {
      if (REDUCED) { if (then) then(); render(); return; }
      idxs.forEach(function (i) { moving[side + i] = true; });
      render();
      setTimeout(function () {
        idxs.forEach(function (i) { delete moving[side + i]; });
        if (then) then();
        render();
      }, 420);
    }

    cpuEl.addEventListener("click", function (e) {
      var c = e.target.closest("[data-i]"); if (!c) return;
      var idx = +c.dataset.i, p = Math.floor(idx / PERPAGE);
      cpu[idx] = (cpu[idx] + 0x40 + Math.floor(Math.random() * 60)) & 0xFF;
      if (pstate[p] === "lock") {
        log("Page " + p + " was write-protected → CPU faulted. HandleGpuFault marked it dirty, lifted protection, and execution resumed.");
        pstate[p] = "cpu";
      } else if (pstate[p] === "gpu") {
        log("Page " + p + " held GPU-written data and has now been overwritten by the CPU.");
        pstate[p] = "cpu";
      } else {
        pstate[p] = "cpu";
        log("CPU wrote byte " + idx + " in page " + p + ". Granularity is the page, so the whole 16 KB counts as dirty.");
      }
      render();
    });

    drawBtn.addEventListener("click", function () {
      var dirty = [];
      for (var p = 0; p < PAGES; p++) if (pstate[p] === "cpu" || gpu[p * PERPAGE] == null) dirty.push(p);
      if (!dirty.length) { log("Nothing to upload — no page is CPU-dirty. The cached image is already current."); return; }
      var idxs = [];
      dirty.forEach(function (p) { for (var b = 0; b < PERPAGE; b++) idxs.push(p * PERPAGE + b); });
      log("ForEachUploadRange reported " + dirty.length + " dirty page(s): " + dirty.join(", ") + ". Copying only those.");
      flash("gpu", idxs, function () {
        idxs.forEach(function (i) { gpu[i] = cpu[i]; });
        for (var p = 0; p < PAGES; p++) pstate[p] = "lock";
        log("Upload done. ApplyGpuProtection write-protected every page — the GPU owns this data now.");
      });
    });

    gpuBtn.addEventListener("click", function () {
      var p = 3;
      if (gpu[p * PERPAGE] == null) { log("Upload something first — the GPU has no image to write into yet."); return; }
      var idxs = [];
      for (var b = 0; b < PERPAGE; b++) { idxs.push(p * PERPAGE + b); gpu[p * PERPAGE + b] = (0xA0 + b * 7) & 0xFF; }
      pstate[p] = "gpu";
      log("The GPU wrote page " + p + " as a render target. It is now GPU-dirty: guest memory is the stale copy.");
      flash("gpu", idxs);
    });

    readBtn.addEventListener("click", function () {
      var g = [];
      for (var p = 0; p < PAGES; p++) if (pstate[p] === "gpu") g.push(p);
      if (!g.length) { log("Nothing to download — no page is GPU-dirty."); return; }
      var idxs = [];
      g.forEach(function (p) { for (var b = 0; b < PERPAGE; b++) idxs.push(p * PERPAGE + b); });
      log("ForEachDownloadRange found " + g.length + " GPU-dirty page(s). Copying back so the CPU reads current data.");
      flash("cpu", idxs, function () {
        idxs.forEach(function (i) { cpu[i] = gpu[i]; });
        g.forEach(function (p) { pstate[p] = "lock"; });
        log("Download done. Guest memory matches the image again.");
      });
    });

    rstBtn.addEventListener("click", reset);
    reset();

    function clickByte(idx) {
      var c = cpuEl.querySelector('[data-i="' + idx + '"]');
      if (c) c.click();
    }
    demoRunner(row, [
      { say: "Guest memory on the left, the GPU's copy on the right — empty, because nothing has been uploaded yet.",
        run: reset, ms: 2800 },
      { say: "The game writes a texture with the CPU. Two bytes, in two different pages.",
        run: function () { clickByte(9); clickByte(34); }, ms: 3000 },
      { say: "A draw needs that texture. <b>Only the dirty pages are copied</b> — read the log for how many it found.",
        run: function () { drawBtn.click(); }, ms: 3600 },
      { say: "Upload done, and every page is now <b>write-protected</b>. The GPU owns this data.",
        ms: 3000 },
      { say: "The game writes again — and this time the page is protected, so the CPU <b>faults</b>.",
        run: function () { clickByte(50); }, ms: 3800 },
      { say: "The handler marked the page dirty, lifted protection and resumed. The store completed and <b>the game never knew any of it happened</b>.",
        ms: 4000 },
      { say: "Next draw re-uploads that one page. Not the whole surface — just what changed.",
        run: function () { drawBtn.click(); }, ms: 3400 },
      { say: "Now the other direction: the GPU writes a render target, so guest memory becomes the stale copy.",
        run: function () { gpuBtn.click(); }, ms: 3400 },
      { say: "The CPU reads it, and the download path copies it back. Same machinery, running the other way.",
        run: function () { readBtn.click(); }, ms: 3400 }
    ]);
  });

  /* ============================================================
     5 · allocator — the guest allocator, driven by you
     ============================================================ */
  reg("allocator", function (host) {
    var body = frame(host,
      "Allocate guest memory",
      "pick a size and a kind, then watch the user area fill",
      "Three allocation models, because games use all three. <b>Direct</b> memory is a reservation out of physical memory identified by a physical offset, and mapping it to a virtual address is a separate step — so it gets two columns here. <b>Flexible</b> memory draws on a fixed per-title budget from <code>param.json</code>. <b>Pooled</b> memory is reserve-then-commit.");

    var USER_LO = 0x1000000000;
    var SPAN = 512;                     // MB of address space shown
    var FLEX_BUDGET = 128;              // MB
    var allocs = [];                    // {start, size, kind, name, phys}
    var nextPhys = 0, sel = -1, counter = 0;

    var row = ctlRow(body);
    label(row, "size");
    var sizeIn = input(row, null, "32", "w-num");
    label(row, "MB");
    var kindSel = select(row, [
      { value: "direct", label: "direct — physical reservation + map" },
      { value: "flexible", label: "flexible — from the title budget" },
      { value: "pooled", label: "pooled — reserve then commit" }
    ], "direct");
    var addBtn = button(row, "Allocate", "pri");
    var freeBtn = button(row, "Free selected");
    var rstBtn = button(row, "Reset");
    spacer(row);
    var st = status(row);

    body.appendChild(h("div", "lab-h", "user area — 0x1000000000 upward"));
    var strip = h("div", "lab-strip"); body.appendChild(strip);
    var budWrap = h("div");
    budWrap.appendChild(h("div", "lab-h", "flexible memory budget"));
    var bud = h("div", "lab-budget", "<div></div>"); budWrap.appendChild(bud);
    var budTxt = h("div", "lab-status"); budWrap.appendChild(budTxt);
    body.appendChild(budWrap);

    var split = h("div", "lab-2");
    var sL = h("div"), sR = h("div");
    sL.appendChild(h("div", "lab-h", "allocations"));
    var listEl = h("div", "lab-fields"); sL.appendChild(listEl);
    sR.appendChild(h("div", "lab-h", "what the guest can query"));
    var qEl = h("div", "lab-steps"); sR.appendChild(qEl);
    split.appendChild(sL); split.appendChild(sR);
    body.appendChild(split);

    function flexUsed() { return allocs.filter(function (a) { return a.kind === "flexible"; }).reduce(function (s, a) { return s + a.size; }, 0); }
    function firstFit(size) {
      var sorted = allocs.slice().sort(function (a, b) { return a.start - b.start; });
      var at = 0;
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].start - at >= size) return at;
        at = Math.max(at, sorted[i].start + sorted[i].size);
      }
      return (at + size <= SPAN) ? at : -1;
    }
    function gaps() {
      var sorted = allocs.slice().sort(function (a, b) { return a.start - b.start; });
      var out = [], at = 0;
      sorted.forEach(function (a) { if (a.start > at) out.push({ start: at, size: a.start - at }); at = Math.max(at, a.start + a.size); });
      if (at < SPAN) out.push({ start: at, size: SPAN - at });
      return out;
    }

    function render() {
      var parts = [], at = 0;
      allocs.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (a) {
        if (a.start > at) parts.push({ free: true, size: a.start - at, start: at });
        parts.push(a); at = a.start + a.size;
      });
      if (at < SPAN) parts.push({ free: true, size: SPAN - at, start: at });

      strip.innerHTML = "";
      parts.forEach(function (p) {
        var d = h("div", "lab-alloc " + (p.free ? "free" : p.kind) + (p === allocs[sel] ? " sel" : ""),
          p.free ? (p.size >= 40 ? p.size + " MB free" : "") : (p.size >= 30 ? p.name : ""));
        d.style.flex = "0 0 " + (p.size / SPAN * 100) + "%";
        d.title = p.free ? (p.size + " MB free at +0x" + hx64(p.start * 0x100000, 0))
          : (p.name + " · " + p.size + " MB · " + p.kind + " · 0x" + hx64(USER_LO + p.start * 0x100000, 10));
        if (!p.free) { d.dataset.id = allocs.indexOf(p); }
        strip.appendChild(d);
      });

      var used = flexUsed();
      bud.firstChild.style.width = (used / FLEX_BUDGET * 100) + "%";
      budTxt.textContent = used + " of " + FLEX_BUDGET + " MB used" + (used >= FLEX_BUDGET ? " — budget exhausted" : "");
      budTxt.className = "lab-status" + (used >= FLEX_BUDGET ? " err" : "");

      listEl.innerHTML = allocs.length ? allocs.map(function (a, i) {
        return '<div class="' + (i === sel ? "hi" : "") + '" data-pick="' + i + '" style="cursor:pointer">' +
          '<span class="fn">' + a.name + "</span>" +
          '<span class="fb">' + a.kind + "</span>" +
          '<span class="fv">0x' + hx64(USER_LO + a.start * 0x100000, 10) + "  " + a.size + " MB</span></div>";
      }).join("") : '<div><span class="fn" style="color:var(--faint)">nothing allocated yet</span><span class="fb"></span><span class="fv"></span></div>';

      var g = gaps(), largest = g.reduce(function (m, x) { return Math.max(m, x.size); }, 0);
      var totalFree = g.reduce(function (s, x) { return s + x.size; }, 0);
      var a = sel >= 0 ? allocs[sel] : null;
      qEl.innerHTML =
        '<div><span>allocations</span><span class="sv">' + allocs.length + "</span></div>" +
        '<div><span>free space</span><span class="sv">' + totalFree + " MB</span></div>" +
        '<div><span>largest free block</span><span class="sv">' + largest + " MB</span></div>" +
        '<div><span>free blocks (fragmentation)</span><span class="sv">' + g.length + "</span></div>" +
        (a
          ? '<div class="total"><span>sceKernelVirtualQuery(0x' + hx64(USER_LO + a.start * 0x100000, 10) + ")</span><span class='sv'></span></div>" +
            '<div><span>&nbsp;&nbsp;name</span><span class="sv">' + a.name + "</span></div>" +
            '<div><span>&nbsp;&nbsp;is_direct / is_flexible / is_pooled</span><span class="sv">' +
              (a.kind === "direct" ? "1 / 0 / 0" : a.kind === "flexible" ? "0 / 1 / 0" : "0 / 0 / 1") + "</span></div>" +
            (a.phys != null ? '<div><span>&nbsp;&nbsp;physical offset</span><span class="sv">0x' + hx64(a.phys, 8) + "</span></div>" : "")
          : '<div class="total"><span>select an allocation to query it</span><span class="sv"></span></div>');
    }

    addBtn.addEventListener("click", function () {
      var size = clamp(parseInt(sizeIn.value, 10) || 0, 1, SPAN);
      var kind = kindSel.value;
      if (kind === "flexible" && flexUsed() + size > FLEX_BUDGET) {
        st.className = "lab-status err";
        st.textContent = "SCE_KERNEL_ERROR_ENOMEM — flexible budget is " + FLEX_BUDGET + " MB";
        return;
      }
      var at = firstFit(size);
      if (at < 0) {
        st.className = "lab-status err";
        st.textContent = "no free block of " + size + " MB — the space is fragmented";
        return;
      }
      counter++;
      var a = { start: at, size: size, kind: kind, name: kind.slice(0, 4) + "_" + counter };
      if (kind === "direct") { a.phys = nextPhys; nextPhys += size * 0x100000; }
      allocs.push(a); sel = allocs.length - 1;
      st.className = "lab-status ok";
      st.textContent = (kind === "direct"
        ? "AllocateDirectMemory then MapDirectMemory — two steps"
        : kind === "flexible" ? "MapFlexibleMemory" : "MemoryPoolReserve then Commit") +
        " → 0x" + hx64(USER_LO + at * 0x100000, 10);
      render();
    });
    freeBtn.addEventListener("click", function () {
      if (sel < 0) { st.className = "lab-status err"; st.textContent = "select an allocation first"; return; }
      var a = allocs[sel];
      allocs.splice(sel, 1); sel = -1;
      st.className = "lab-status";
      st.textContent = "freed " + a.name + " — note the hole it left behind";
      render();
    });
    rstBtn.addEventListener("click", function () { allocs = []; sel = -1; nextPhys = 0; counter = 0; st.textContent = ""; render(); });
    strip.addEventListener("click", function (e) {
      var d = e.target.closest("[data-id]"); if (!d) return;
      sel = +d.dataset.id; render();
    });
    listEl.addEventListener("click", function (e) {
      var d = e.target.closest("[data-pick]"); if (!d) return;
      sel = +d.dataset.pick; render();
    });
    render();

    function alloc(kind, size) { setSelect(kindSel, kind); setInput(sizeIn, String(size)); addBtn.click(); }
    demoRunner(row, [
      { say: "Empty user area, 512 MB of it. Watch it fill.", run: function () { rstBtn.click(); }, ms: 2400 },
      { say: "Seven <b>direct</b> allocations of 64 MB. Direct memory is a physical reservation that then gets mapped — note the physical offset on the selected one.",
        run: function () { for (var k = 0; k < 7; k++) alloc("direct", 64); }, ms: 3600 },
      { say: "Free the second and the fourth. Two 64 MB holes.",
        run: function () { sel = 1; freeBtn.click(); sel = 2; freeBtn.click(); }, ms: 3200 },
      { say: "Now ask for 128 MB. There is <b>plenty</b> of free space — but no single hole is big enough. <b>That is fragmentation</b>, and it is a real failure mode.",
        run: function () { alloc("direct", 128); }, ms: 4400 },
      { say: "64 MB fits, though, because it matches a hole exactly.",
        run: function () { alloc("direct", 64); }, ms: 3000 },
      { say: "<b>Flexible</b> memory is different: it comes from a fixed per-title budget declared in <code>param.json</code>, not from whatever is free.",
        run: function () { rstBtn.click(); alloc("flexible", 96); }, ms: 3600 },
      { say: "Ask for another 96 MB and it fails with <code>ENOMEM</code> — even though the address space is almost entirely empty.",
        run: function () { alloc("flexible", 96); }, ms: 4200 },
      { say: "The same request as <b>pooled</b> memory succeeds, because it draws on a different pool entirely.",
        run: function () { alloc("pooled", 96); }, ms: 3400 }
    ]);
  });

  /* ============================================================
     6 · wavelab — a working wave simulator
     ============================================================ */
  reg("wavelab", function (host) {
    var body = frame(host,
      "Run a shader across a whole wave",
      "choose a program and the lane data, then step it",
      "A real interpreter for a small slice of the RDNA&nbsp;2 scalar and vector instruction set. Watch <code>EXEC</code>: it is an ordinary register, and every branch in the program is arithmetic on it. That is the reason the recompiler has to <em>reconstruct</em> structure that was never there — and why the SPIR-V it emits needs merge blocks that this code never had.");

    var PROGS = {
      "if / else": {
        src: "y = x > 0 ? x * 2 : -x",
        code: [
          { t: "v_cmp_gt_f32   vcc, v0, 0", op: "cmp" },
          { t: "s_and_saveexec_b64 s[0:1], vcc", op: "saveexec" },
          { t: "v_mul_f32      v1, v0, 2.0", op: "mul", d: 1, a: 0, imm: 2 },
          { t: "s_andn2_b64    exec, s[0:1], exec", op: "andn2" },
          { t: "v_mul_f32      v1, v0, -1.0", op: "mul", d: 1, a: 0, imm: -1 },
          { t: "s_mov_b64      exec, s[0:1]", op: "restore" },
          { t: "s_endpgm", op: "end" }
        ]
      },
      "nested if": {
        src: "if (x > 0) { y = x; if (x > 4) y = 100 }",
        code: [
          { t: "v_cmp_gt_f32   vcc, v0, 0", op: "cmp" },
          { t: "s_and_saveexec_b64 s[0:1], vcc", op: "saveexec" },
          { t: "v_mov_b32      v1, v0", op: "mov", d: 1, a: 0 },
          { t: "v_cmp_gt_f32   vcc, v0, 4", op: "cmp", th: 4 },
          { t: "s_and_saveexec_b64 s[2:3], vcc", op: "saveexec", sv: 2 },
          { t: "v_mov_b32      v1, 100", op: "movi", d: 1, imm: 100 },
          { t: "s_mov_b64      exec, s[2:3]", op: "restore", sv: 2 },
          { t: "s_mov_b64      exec, s[0:1]", op: "restore" },
          { t: "s_endpgm", op: "end" }
        ]
      },
      "early exit": {
        src: "if (x <= 0) return; y = x * x",
        code: [
          { t: "v_cmp_gt_f32   vcc, v0, 0", op: "cmp" },
          { t: "s_and_saveexec_b64 s[0:1], vcc", op: "saveexec" },
          { t: "s_cbranch_execz  END", op: "execz", target: 5 },
          { t: "v_mul_f32      v1, v0, v0", op: "square", d: 1, a: 0 },
          { t: "s_mov_b64      exec, s[0:1]", op: "restore" },
          { t: "s_endpgm  ; END", op: "end" }
        ]
      }
    };

    var row = ctlRow(body);
    label(row, "wave");
    var wSel = select(row, [{ value: "32", label: "wave32" }, { value: "64", label: "wave64" }], "64");
    label(row, "program");
    var pSel = select(row, Object.keys(PROGS).map(function (k) { return { value: k, label: k }; }), "if / else");
    label(row, "lane data");
    var dSel = select(row, [
      { value: "rand", label: "random −9…9" },
      { value: "ramp", label: "ramp −N/2…N/2" },
      { value: "half", label: "first half positive" },
      { value: "alt", label: "alternating" },
      { value: "allpos", label: "all positive (no divergence)" }
    ], "rand");
    var row2 = ctlRow(body);
    var stepBtn = button(row2, "Step →", "pri");
    var runBtn = button(row2, "Run");
    var rstBtn = button(row2, "Reset");
    spacer(row2);
    var st = status(row2);

    var split = h("div", "lab-2 wide-l");
    var wL = h("div"), wR = h("div");
    wL.appendChild(h("div", "lab-h", "program"));
    var codeEl = h("div", "lab-code"); wL.appendChild(codeEl);
    var srcEl = h("div", "lab-status"); wL.appendChild(srcEl);
    wL.appendChild(h("div", "lab-h", "scalar registers"));
    var sgprEl = h("div", "lab-regs"); wL.appendChild(sgprEl);
    wR.appendChild(h("div", "lab-h", "v0 — the input, one value per lane"));
    var v0El = h("div", "lab-lanes"); wR.appendChild(v0El);
    wR.appendChild(h("div", "lab-h", "v1 — the result being written"));
    var v1El = h("div", "lab-lanes"); wR.appendChild(v1El);
    var maskEl = h("div", "lab-mask"); wR.appendChild(maskEl);
    split.appendChild(wL); split.appendChild(wR);
    body.appendChild(split);

    var N, v0, v1, exec, vcc, saved, pc, code, justWrote;

    function makeData(kind, n) {
      var out = [];
      for (var i = 0; i < n; i++) {
        if (kind === "rand") out.push(Math.floor(Math.random() * 19) - 9);
        else if (kind === "ramp") out.push(i - Math.floor(n / 2));
        else if (kind === "half") out.push(i < n / 2 ? (i % 9) + 1 : -((i % 9) + 1));
        else if (kind === "alt") out.push(i % 2 === 0 ? (i % 7) + 1 : -((i % 7) + 1));
        else out.push((i % 9) + 1);
      }
      return out;
    }
    function reset() {
      N = +wSel.value;
      code = PROGS[pSel.value].code;
      v0 = makeData(dSel.value, N);
      v1 = new Array(N).fill(null);
      exec = new Array(N).fill(true);
      vcc = new Array(N).fill(false);
      saved = {};
      pc = 0; justWrote = [];
      render();
    }
    function maskHex(m) {
      var out = "", chunks = Math.ceil(N / 32);
      for (var c = chunks - 1; c >= 0; c--) {
        var v = 0;
        for (var b = 0; b < 32; b++) { var i = c * 32 + b; if (i < N && m[i]) v |= (1 << b); }
        out += hx(v, 8);
      }
      return "0x" + out;
    }
    function popcount(m) { return m.reduce(function (s, x) { return s + (x ? 1 : 0); }, 0); }

    function step() {
      if (pc >= code.length) return;
      var ins = code[pc]; justWrote = [];
      switch (ins.op) {
        case "cmp":
          for (var i = 0; i < N; i++) vcc[i] = exec[i] && (v0[i] > (ins.th || 0));
          break;
        case "saveexec":
          saved[ins.sv || 0] = exec.slice();
          exec = exec.map(function (e, k) { return e && vcc[k]; });
          break;
        case "andn2":
          var sv = saved[ins.sv || 0] || exec;
          exec = sv.map(function (e, k) { return e && !exec[k]; });
          break;
        case "restore":
          exec = (saved[ins.sv || 0] || exec).slice();
          break;
        case "mul":
          for (var m = 0; m < N; m++) if (exec[m]) { v1[m] = v0[m] * ins.imm; justWrote.push(m); }
          break;
        case "square":
          for (var q = 0; q < N; q++) if (exec[q]) { v1[q] = v0[q] * v0[q]; justWrote.push(q); }
          break;
        case "mov":
          for (var o = 0; o < N; o++) if (exec[o]) { v1[o] = v0[o]; justWrote.push(o); }
          break;
        case "movi":
          for (var p2 = 0; p2 < N; p2++) if (exec[p2]) { v1[p2] = ins.imm; justWrote.push(p2); }
          break;
        case "execz":
          if (popcount(exec) === 0) { pc = ins.target; render(); return; }
          break;
      }
      pc++;
      render();
    }

    function lanes(target, data, active) {
      target.className = "lab-lanes w" + N;
      var out = "";
      for (var i = 0; i < N; i++) {
        var cls = "lab-lane " + (active[i] ? (justWrote.indexOf(i) >= 0 ? "just" : "on") : "off");
        out += '<div class="' + cls + '" title="lane ' + i + '">' + (data[i] == null ? "·" : data[i]) + "</div>";
      }
      target.innerHTML = out;
    }
    function render() {
      srcEl.textContent = "source it came from:  " + PROGS[pSel.value].src;
      codeEl.innerHTML = code.map(function (ins, k) {
        return '<div class="' + (k === pc ? "cur" : (k < pc ? "done" : "")) + '"><span class="pc">' +
          hx(k * 4, 2) + "</span><span>" + ins.t + "</span></div>";
      }).join("");
      lanes(v0El, v0, exec);
      lanes(v1El, v1, exec);
      maskEl.innerHTML =
        "<span><b>EXEC</b> <span class='hx'>" + maskHex(exec) + "</span></span>" +
        "<span><b>VCC</b> <span class='hx'>" + maskHex(vcc) + "</span></span>" +
        "<span><b>active</b> " + popcount(exec) + " / " + N + "</span>";
      var sk = Object.keys(saved);
      sgprEl.innerHTML = sk.length
        ? sk.map(function (k) {
            return '<div class="lab-reg"><span class="rn">s[' + k + ":" + (+k + 1) + ']</span><span class="rv">' + maskHex(saved[k]) + "</span></div>";
          }).join("")
        : '<div class="lab-reg zero"><span class="rn">s[0:1]</span><span class="rv">nothing saved yet</span></div>';
      if (pc >= code.length) {
        var done = v1.filter(function (x) { return x != null; }).length;
        st.className = "lab-status ok";
        st.textContent = "finished — " + done + " of " + N + " lanes produced a result";
      } else {
        st.className = "lab-status";
        st.textContent = "pc " + pc + " / " + code.length + " · both branches will execute in sequence";
      }
    }

    stepBtn.addEventListener("click", step);
    runBtn.addEventListener("click", function () { var guard = 0; while (pc < code.length && guard++ < 200) step(); });
    rstBtn.addEventListener("click", reset);
    [wSel, pSel, dSel].forEach(function (s) { s.addEventListener("change", reset); });
    reset();

    demoRunner(row2, [
      { say: "64 lanes, each holding its own value of <code>x</code>. One program counter for all of them.",
        run: function () { setSelect(wSel, "64"); setSelect(pSel, "if / else"); setSelect(dSel, "half"); }, ms: 3000 },
      { say: "<code>v_cmp_gt_f32</code> compares in <b>every lane at once</b>. It does not branch — it fills a 64-bit mask in <code>VCC</code>.",
        run: step, ms: 3400 },
      { say: "<b>This instruction is the branch.</b> <code>s_and_saveexec_b64</code> saves the old mask and narrows <code>EXEC</code> to the lanes that passed. No jump happened.",
        run: step, ms: 4200 },
      { say: "The <em>then</em> body runs. Only the blue lanes keep their result — but all 64 lanes spent the time.",
        run: step, ms: 3400 },
      { say: "<code>s_andn2_b64</code> flips <code>EXEC</code> to exactly the lanes that failed. Again: arithmetic, not a jump.",
        run: step, ms: 3400 },
      { say: "The <em>else</em> body runs for those. <b>Both branches have now executed, one after the other.</b> That is what divergence costs.",
        run: step, ms: 4000 },
      { say: "<code>EXEC</code> is restored and the wave continues whole. Nowhere in that sequence was there a merge point — which is precisely what the recompiler has to invent for SPIR-V.",
        run: function () { step(); step(); }, ms: 4400 },
      { say: "With <b>no divergence</b> — every lane positive — the else body still executes, with <code>EXEC</code> at zero, writing nothing.",
        run: function () { setSelect(dSel, "allpos"); runBtn.click(); }, ms: 4000 },
      { say: "A <b>nested</b> if needs a second saved mask. Watch the scalar registers: that nesting is what the structuriser has to rebuild as nested merge blocks.",
        run: function () { setSelect(pSel, "nested if"); runBtn.click(); }, ms: 4200 },
      { say: "And <code>s_cbranch_execz</code> is the one place a <b>real jump</b> happens — only because every single lane failed the test.",
        run: function () { setSelect(pSel, "early exit"); setSelect(dSel, "alt"); runBtn.click(); }, ms: 4000 }
    ]);
  });

  /* ============================================================
     7 · isa2spirv — one instruction, four representations
     ============================================================ */
  reg("isa2spirv", function (host) {
    var body = frame(host,
      "One instruction, all four forms",
      "pick an instruction · toggle its modifiers",
      "The four panes are the four things the recompiler holds in turn. Notice how much of the work is <em>modifiers</em>: RDNA&nbsp;2 folds negation, absolute value, clamping and output scaling into the instruction encoding, and every one of those has to become explicit SPIR-V.");

    var INS = {
      "v_add_f32": {
        fam: "VOP2", enc: 0x06, irOp: "AddF32",
        fields: [{ n: "src0", s: 0, w: 9, v: 256 }, { n: "vsrc1", s: 9, w: 8, v: 3 }, { n: "vdst", s: 17, w: 8, v: 4 }, { n: "op", s: 25, w: 6, v: 0x03 }, { n: "enc", s: 31, w: 1, v: 0 }],
        asm: "v_add_f32  v4, v0, v3",
        ir: "AddF32   dst=v4  src0=v0  src1=v3",
        spv: "%a = OpLoad %float %v0\n%b = OpLoad %float %v3\n%r = OpFAdd %float %a %b\nOpStore %v4 %r"
      },
      "v_mul_f32": {
        fam: "VOP2", enc: 0x08, irOp: "MulF32",
        fields: [{ n: "src0", s: 0, w: 9, v: 256 }, { n: "vsrc1", s: 9, w: 8, v: 3 }, { n: "vdst", s: 17, w: 8, v: 4 }, { n: "op", s: 25, w: 6, v: 0x08 }, { n: "enc", s: 31, w: 1, v: 0 }],
        asm: "v_mul_f32  v4, v0, v3",
        ir: "MulF32   dst=v4  src0=v0  src1=v3",
        spv: "%a = OpLoad %float %v0\n%b = OpLoad %float %v3\n%r = OpFMul %float %a %b\nOpStore %v4 %r"
      },
      "v_cmp_gt_f32": {
        fam: "VOPC", enc: 0x14, irOp: "CompareMaskGtF32",
        fields: [{ n: "src0", s: 0, w: 9, v: 256 }, { n: "vsrc1", s: 9, w: 8, v: 1 }, { n: "op", s: 17, w: 8, v: 0x14 }, { n: "enc", s: 25, w: 7, v: 0x3E }],
        asm: "v_cmp_gt_f32  vcc, v0, v1",
        ir: "CompareMaskGtF32   dst=vcc  src0=v0  src1=v1",
        spv: "%a = OpLoad %float %v0\n%b = OpLoad %float %v1\n%c = OpFOrdGreaterThan %bool %a %b\n; -> ballot into the 64-bit VCC mask\n%m = OpGroupNonUniformBallot %v4uint %Subgroup %c"
      },
      "s_and_saveexec_b64": {
        fam: "SOP1", enc: 0x20, irOp: "SaveexecB64",
        fields: [{ n: "ssrc0", s: 0, w: 8, v: 106 }, { n: "op", s: 8, w: 8, v: 0x20 }, { n: "sdst", s: 16, w: 7, v: 0 }, { n: "enc", s: 23, w: 9, v: 0x17D }],
        asm: "s_and_saveexec_b64  s[0:1], vcc",
        ir: "SaveexecB64   dst=s[0:1]  src=vcc  mode=And",
        spv: "; no direct equivalent — this IS the branch.\n; structured path: becomes OpSelectionMerge + OpBranchConditional\n; fallback path: EXEC becomes a value and each\n;   invocation tests its own bit"
      },
      "buffer_load_dword": {
        fam: "MUBUF", enc: 0x38, irOp: "BufferLoadDword",
        fields: [{ n: "offset", s: 0, w: 12, v: 0x40 }, { n: "offen", s: 12, w: 1, v: 1 }, { n: "idxen", s: 13, w: 1, v: 0 }, { n: "glc", s: 14, w: 1, v: 0 }, { n: "op", s: 18, w: 7, v: 0x14 }, { n: "enc", s: 26, w: 6, v: 0x38 }],
        asm: "buffer_load_dword  v2, v1, s[8:11], 0 offen offset:64",
        ir: "BufferLoadDword   dst=v2  voffset=v1  srd=s[8:11]  offset=64",
        spv: "; bounds check the hardware gives free, SPIR-V does not:\n%i  = OpUDiv %uint %byteoff %uint_4\n%ok = OpULessThan %bool %i %num_records\nOpSelectionMerge %m None\nOpBranchConditional %ok %in %oob\n%in:  %p = OpAccessChain %ptr %buf %i\n      %v = OpLoad %uint %p"
      },
      "image_sample": {
        fam: "MIMG", enc: 0x3C, irOp: "ImageSample",
        fields: [{ n: "dmask", s: 8, w: 4, v: 0xF }, { n: "unrm", s: 12, w: 1, v: 0 }, { n: "op", s: 18, w: 7, v: 0x20 }, { n: "vaddr", s: 32, w: 8, v: 4 }, { n: "enc", s: 26, w: 6, v: 0x3C }],
        asm: "image_sample  v[0:3], v[4:5], s[12:19], s[20:23] dmask:0xf",
        ir: "ImageSample   dst=v[0:3]  coord=v[4:5]  image=T#  sampler=S#  dmask=0xF",
        spv: "%img = OpLoad %image %t12\n%smp = OpLoad %sampler %s20\n%si  = OpSampledImage %sampled %img %smp\n%uv  = OpLoad %v2float %v4\n%rgba= OpImageSampleImplicitLod %v4float %si %uv"
      },
      "exp (mrt0)": {
        fam: "EXP", enc: 0x3E, irOp: "Export",
        fields: [{ n: "en", s: 0, w: 4, v: 0xF }, { n: "target", s: 4, w: 6, v: 0 }, { n: "compr", s: 10, w: 1, v: 0 }, { n: "done", s: 11, w: 1, v: 1 }, { n: "vm", s: 12, w: 1, v: 1 }, { n: "enc", s: 26, w: 6, v: 0x3E }],
        asm: "exp  mrt0, v0, v1, v2, v3 done vm",
        ir: "Export   target=Mrt  index=0  en=0xF  done=true",
        spv: "; the shader's only output path\n%r = OpLoad %v4float %tmp\nOpStore %out_color0 %r"
      }
    };

    var row = ctlRow(body);
    label(row, "instruction");
    var iSel = select(row, Object.keys(INS).map(function (k) { return { value: k, label: k }; }), "v_add_f32");
    label(row, "modifiers");
    var negBtn = button(row, "neg src0"); negBtn.setAttribute("aria-pressed", "false");
    var absBtn = button(row, "abs src1"); absBtn.setAttribute("aria-pressed", "false");
    var clampBtn = button(row, "clamp"); clampBtn.setAttribute("aria-pressed", "false");

    var ruler = h("div"); body.appendChild(ruler);
    var panes = h("div", "lab-panes"); body.appendChild(panes);
    var keyEl = h("div", "lab-key",
      '<span><i style="background:color-mix(in srgb,var(--guest) 50%,transparent)"></i>operands</span>' +
      '<span><i style="background:color-mix(in srgb,var(--kyty) 50%,transparent)"></i>opcode</span>' +
      '<span><i style="background:color-mix(in srgb,var(--host) 50%,transparent)"></i>encoding class</span>');
    body.appendChild(keyEl);

    function toggle(b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
        render();
      });
    }
    [negBtn, absBtn, clampBtn].forEach(toggle);

    function render() {
      var d = INS[iSel.value];
      var word = 0;
      d.fields.forEach(function (f) {
        if (f.s >= 32) return;
        var mask = f.w >= 32 ? 0xFFFFFFFF : ((1 << f.w) - 1);
        word |= ((f.v & mask) << f.s);
      });
      word = word >>> 0;
      bitRuler(ruler, word, d.fields.filter(function (f) { return f.s < 32; }).map(function (f) {
        return { name: f.n, shift: f.s, width: Math.min(f.w, 32 - f.s), cls: f.n === "op" ? 1 : (f.n === "enc" ? 2 : 0) };
      }), null);

      var neg = negBtn.getAttribute("aria-pressed") === "true";
      var abs = absBtn.getAttribute("aria-pressed") === "true";
      var clp = clampBtn.getAttribute("aria-pressed") === "true";

      var asm = d.asm, ir = d.ir, spv = d.spv;
      if (neg) { asm = asm.replace(/(v0|s\[8:11\]|v\[4:5\])/, "-$1"); ir += "  neg(src0)"; }
      if (abs) { asm = asm.replace(/(v1|v3)/, "|$1|"); ir += "  abs(src1)"; }
      if (clp) { asm += " clamp"; ir += "  clamp"; }

      if (neg) spv = "%na = OpFNegate %float %a      ; neg modifier\n" + spv;
      if (abs) spv = "%ab = OpExtInst %float %glsl FAbs %b   ; abs modifier\n" + spv;
      if (clp) spv = spv + "\n%cl = OpExtInst %float %glsl FClamp %r %f0 %f1   ; clamp modifier";

      var decoded =
        "family      " + d.fam + "\n" +
        "opcode_id   0x" + hx(d.enc, 2) + "\n" +
        d.fields.map(function (f) {
          return (f.n + "            ").slice(0, 12) + f.v + (f.v > 255 ? "   (inline constant)" : "");
        }).join("\n") +
        (neg ? "\nnegate      true" : "") + (abs ? "\nabsolute    true" : "") + (clp ? "\nclamp       true" : "");

      panes.innerHTML =
        '<div class="lab-pane g"><div class="t">1 · machine code</div><pre>0x' + hx(word, 8) +
          "\n\n" + asm + "</pre></div>" +
        '<div class="lab-pane g"><div class="t">2 · Decoder::Instruction</div><pre>' + decoded + "</pre></div>" +
        '<div class="lab-pane k"><div class="t">3 · IR</div><pre>' + ir + "</pre></div>" +
        '<div class="lab-pane h"><div class="t">4 · emitted SPIR-V</div><pre>' + spv + "</pre></div>";
    }
    iSel.addEventListener("change", render);
    render();

    function press(b, on) { if ((b.getAttribute("aria-pressed") === "true") !== on) b.click(); }
    demoRunner(row, [
      { say: "<code>v_add_f32</code> — the easy case. Raw bits, decoded instruction, IR, SPIR-V: almost one to one.",
        run: function () { setSelect(iSel, "v_add_f32"); press(negBtn, false); press(absBtn, false); press(clampBtn, false); }, ms: 3400 },
      { say: "RDNA&nbsp;2 folds modifiers into the encoding. Turn on <b>clamp</b> and SPIR-V needs an extra explicit instruction.",
        run: function () { press(clampBtn, true); }, ms: 3400 },
      { say: "Add <b>neg</b> and <b>abs</b> — three folded modifiers, three more SPIR-V instructions the emitter has to generate.",
        run: function () { press(negBtn, true); press(absBtn, true); }, ms: 3800 },
      { say: "Now a buffer load. The hardware bounds-checks it <b>for free</b>…",
        run: function () { press(negBtn, false); press(absBtn, false); press(clampBtn, false); setSelect(iSel, "buffer_load_dword"); }, ms: 3200 },
      { say: "…but SPIR-V does not, so the emitter has to produce a comparison <em>and a branch</em>. This is exactly why such an instruction cannot sit in a loop header — it would split the block.",
        ms: 4600 },
      { say: "<code>s_and_saveexec_b64</code> has <b>no SPIR-V equivalent at all</b>. It <em>is</em> the control flow, and what it becomes depends entirely on whether structurisation succeeded.",
        run: function () { setSelect(iSel, "s_and_saveexec_b64"); }, ms: 4600 },
      { say: "Image sampling maps fairly cleanly — as long as the T# and S# descriptors have already been recovered, which is its own problem.",
        run: function () { setSelect(iSel, "image_sample"); }, ms: 3600 },
      { say: "And <code>exp</code> — the only way a shader outputs anything at all.",
        run: function () { setSelect(iSel, "exp (mrt0)"); }, ms: 3200 }
    ]);
  });

  /* ============================================================
     8 · tileaddr — work out where a texel lives
     ============================================================ */
  reg("tileaddr", function (host) {
    var body = frame(host,
      "Where does texel (x, y) actually live?",
      "click a texel or type coordinates",
      "<b>The tiled model here is a simplified one</b> — a 2×2 block interleave, chosen so the arithmetic stays followable. The real families in <code>tile.cpp</code> vary block size with bytes-per-element, apply a per-block XOR of coordinates to spread blocks across memory channels and banks, use separate schemes for depth and render targets, and pack small mips into a shared tail. The <em>shape</em> of the calculation is what this shows.");

    var W = 8, H = 8;
    var row = ctlRow(body);
    label(row, "x");
    var xIn = input(row, null, "3", "w-num");
    label(row, "y");
    var yIn = input(row, null, "2", "w-num");
    label(row, "bytes/texel");
    var bppSel = select(row, [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "4", label: "4 (RGBA8)" }, { value: "8", label: "8" }, { value: "16", label: "16" }], "4");
    label(row, "layout");
    var mSel = select(row, [{ value: "linear", label: "linear" }, { value: "tiled", label: "tiled 2×2 (simplified)" }], "tiled");
    label(row, "texture width");
    var pIn = input(row, null, "256", "w-num");

    var split = h("div", "lab-2");
    var tL = h("div"), tR = h("div");
    tL.appendChild(h("div", "lab-h", "an 8×8 window into the texture — number is the byte offset"));
    var gridEl = h("div", "lab-tg8"); tL.appendChild(gridEl);
    var keyEl = h("div", "lab-key",
      '<span><i style="background:var(--kyty)"></i>selected texel</span>' +
      '<span><i style="background:color-mix(in srgb,var(--guest) 40%,transparent)"></i>same cache line (64 B)</span>');
    tL.appendChild(keyEl);
    tR.appendChild(h("div", "lab-h", "the calculation, step by step"));
    var stepsEl = h("div", "lab-steps"); tR.appendChild(stepsEl);
    split.appendChild(tL); split.appendChild(tR);
    body.appendChild(split);

    function offsetOf(x, y, bpp, mode, pitch) {
      if (mode === "linear") return (y * pitch + x) * bpp;
      var bx = x >> 1, by = y >> 1, ix = x & 1, iy = y & 1;
      var blocksPerRow = pitch >> 1;
      var blockIdx = by * blocksPerRow + bx;
      var within = iy * 2 + ix;
      return (blockIdx * 4 + within) * bpp;
    }

    function render() {
      var x = clamp(parseInt(xIn.value, 10) || 0, 0, W - 1);
      var y = clamp(parseInt(yIn.value, 10) || 0, 0, H - 1);
      var bpp = +bppSel.value, mode = mSel.value, pitch = clamp(parseInt(pIn.value, 10) || 256, W, 4096);
      var off = offsetOf(x, y, bpp, mode, pitch);
      var line = Math.floor(off / 64);

      var out = "";
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
        var o = offsetOf(xx, yy, bpp, mode, pitch);
        var isSel = (xx === x && yy === y);
        var same = !isSel && Math.floor(o / 64) === line;
        var blk = mode === "tiled" && (((xx >> 1) + (yy >> 1)) % 2 === 0);
        out += '<div class="lab-tx' + (blk ? " blk" : "") + (isSel ? " sel" : (same ? " same" : "")) +
          '" data-x="' + xx + '" data-y="' + yy + '" title="(' + xx + ", " + yy + ") → +" + o + '">' + o + "</div>";
      }
      gridEl.innerHTML = out;

      var rows = [];
      if (mode === "linear") {
        rows.push(["row stride = pitch × bpp", pitch + " × " + bpp + " = " + (pitch * bpp) + " B"]);
        rows.push(["y × stride", y + " × " + (pitch * bpp) + " = " + (y * pitch * bpp)]);
        rows.push(["x × bpp", x + " × " + bpp + " = " + (x * bpp)]);
      } else {
        rows.push(["block coords &nbsp;bx = x&gt;&gt;1, by = y&gt;&gt;1", (x >> 1) + ", " + (y >> 1)]);
        rows.push(["within block &nbsp;ix = x&amp;1, iy = y&amp;1", (x & 1) + ", " + (y & 1)]);
        rows.push(["blocks per row &nbsp;pitch&gt;&gt;1", (pitch >> 1)]);
        rows.push(["block index &nbsp;by × bpr + bx", (y >> 1) + " × " + (pitch >> 1) + " + " + (x >> 1) + " = " + ((y >> 1) * (pitch >> 1) + (x >> 1))]);
        rows.push(["texel in block &nbsp;iy × 2 + ix", ((y & 1) * 2 + (x & 1))]);
        rows.push(["texels before it &nbsp;blk × 4 + within", (((y >> 1) * (pitch >> 1) + (x >> 1)) * 4 + ((y & 1) * 2 + (x & 1)))]);
      }
      rows.push(["byte offset", "+" + off + "  (0x" + hx(off, 2) + ")"]);

      // neighbourhood locality — the actual point of tiling
      var nb = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].filter(function (p) { return p[0] < W && p[1] < H; });
      var lines = {};
      nb.forEach(function (p) { lines[Math.floor(offsetOf(p[0], p[1], bpp, mode, pitch) / 64)] = 1; });
      var nlines = Object.keys(lines).length;

      // A narrow texture fits inside a couple of cache lines whatever the layout,
      // so tiling only starts paying off once a row is wider than a line.
      var rowBytes = pitch * bpp;
      var tooNarrow = rowBytes <= 64;

      stepsEl.innerHTML = rows.map(function (r, i) {
        return '<div class="' + (i === rows.length - 1 ? "total" : "") + '"><span>' + r[0] + '</span><span class="sv">' + r[1] + "</span></div>";
      }).join("") +
        '<div><span>row stride</span><span class="sv">' + rowBytes + " B</span></div>" +
        '<div><span>cache line (64 B)</span><span class="sv">#' + line + "</span></div>" +
        '<div><span>a 2×2 bilinear fetch touches</span><span class="sv" style="color:' +
          (nlines === 1 ? "var(--guest)" : "var(--host)") + '">' + nlines + " cache line" + (nlines === 1 ? "" : "s") + "</span></div>" +
        (tooNarrow
          ? '<div><span style="color:var(--muted)">this texture is narrow enough that a whole row fits in one cache line, so both layouts behave identically — tiling only pays off once a row is wider than 64 bytes</span><span class="sv"></span></div>'
          : "");
    }
    gridEl.addEventListener("click", function (e) {
      var t = e.target.closest("[data-x]"); if (!t) return;
      xIn.value = t.dataset.x; yIn.value = t.dataset.y; render();
    });
    [xIn, yIn, pIn].forEach(function (i) { i.addEventListener("input", render); });
    [bppSel, mSel].forEach(function (s) { s.addEventListener("change", render); });
    render();

    demoRunner(row, [
      { say: "Texel (3, 2) in a 256-wide RGBA8 texture, stored <b>linearly</b>. Row stride is 1024 bytes, so the offset is 2·1024 + 3·4 = 2060.",
        run: function () { setInput(xIn, "3"); setInput(yIn, "2"); setInput(pIn, "256"); setSelect(bppSel, "4"); setSelect(mSel, "linear"); }, ms: 4000 },
      { say: "Look at the bottom line: a 2×2 bilinear fetch — the four texels any filtered sample reads — touches <b>two cache lines</b>, because the row below is 1024 bytes away.",
        ms: 4400 },
      { say: "Switch to <b>tiled</b>. The offset changes to 2068, and the four texels of that same fetch now share <b>one cache line</b>. <b>That is the entire reason tiling exists.</b>",
        run: function () { setSelect(mSel, "tiled"); }, ms: 4800 },
      { say: "The highlighted texels are the ones sharing your cache line — see how they form a 2D block instead of a horizontal run.",
        ms: 3600 },
      { say: "At 16 bytes per texel fewer of them fit in a line, so the benefit shrinks. Layout choice depends on format, which is why <code>tile.cpp</code> has a family per bytes-per-element.",
        run: function () { setSelect(bppSel, "16"); }, ms: 4400 },
      { say: "And a warning worth knowing: make the texture narrow enough that a whole row fits in one cache line and <b>both layouts behave identically</b>. Tiling only pays off at scale.",
        run: function () { setSelect(bppSel, "4"); setInput(pIn, "8"); setSelect(mSel, "linear"); }, ms: 4800 },
      { say: "Back to a realistic size.",
        run: function () { setInput(pIn, "256"); setSelect(mSel, "tiled"); }, ms: 2600 }
    ]);
  });

  /* ============================================================
     9 · pm4build — assemble your own command buffer
     ============================================================ */
  reg("pm4build", function (host) {
    var body = frame(host,
      "Build a command buffer and run it",
      "append packets · then press Run",
      "The dword encodings are produced by the real <code>KYTY_PM4</code> macro: <code>0xC0000000 | ((len-2)&lt;&lt;16) | (op&lt;&lt;8) | (r&lt;&lt;2)</code>. A draw packet carries only an index count and flags — everything else has to have arrived as register writes first, which is exactly what the errors below are telling you.");

    var PKTS = {
      "SET_CONTEXT_REG · render target": { op: 0x69, n: 2, sets: ["CB_COLOR0_BASE", "CB_COLOR0_INFO"] },
      "SET_CONTEXT_REG · depth": { op: 0x69, n: 2, sets: ["DB_Z_INFO", "DB_DEPTH_CONTROL"] },
      "SET_SH_REG · vertex shader": { op: 0x76, n: 2, sets: ["SPI_SHADER_PGM_LO_VS", "USER_DATA_VS"] },
      "SET_SH_REG · pixel shader": { op: 0x76, n: 2, sets: ["SPI_SHADER_PGM_LO_PS", "USER_DATA_PS"] },
      "SET_UCONFIG_REG · primitive": { op: 0x79, n: 1, sets: ["VGT_PRIMITIVE_TYPE"] },
      "DRAW_INDEX_AUTO": { op: 0x2D, n: 2, draw: true },
      "RELEASE_MEM · fence": { op: 0x49, n: 5, fence: true },
      "NOP · R_FLIP": { op: 0x10, n: 1, r: 0x17, flip: true }
    };
    var REQUIRED = ["CB_COLOR0_BASE", "CB_COLOR0_INFO", "SPI_SHADER_PGM_LO_VS", "SPI_SHADER_PGM_LO_PS", "VGT_PRIMITIVE_TYPE"];

    var row = ctlRow(body);
    label(row, "append");
    var pal = h("div", "lab-pal"); row.appendChild(pal);
    Object.keys(PKTS).forEach(function (k) {
      var b = h("button", "lab-btn", k.split(" · ")[1] || k.split(" · ")[0]);
      b.type = "button"; b.title = k; b.dataset.k = k;
      pal.appendChild(b);
    });
    var row2 = ctlRow(body);
    var runBtn = button(row2, "Run buffer", "pri");
    var presetBtn = button(row2, "Load a valid frame");
    var clrBtn = button(row2, "Clear");
    spacer(row2);
    var st = status(row2);

    var split = h("div", "lab-2 wide-l");
    var pL = h("div"), pR = h("div");
    pL.appendChild(h("div", "lab-h", "command buffer"));
    var bufEl = h("div", "lab-buf"); pL.appendChild(bufEl);
    pR.appendChild(h("div", "lab-h", "register file"));
    var regEl = h("div", "lab-cache"); pR.appendChild(regEl);
    pR.appendChild(h("div", "lab-h", "result"));
    var fbEl = h("div", "lab-fb"); pR.appendChild(fbEl);
    split.appendChild(pL); split.appendChild(pR);
    body.appendChild(split);

    var buf = [], regs = {}, runTo = -1, drew = false, flipped = false;

    function encode(p) {
      var len = p.n + 2;
      return (0xC0000000 | (((len - 2) & 0x3fff) << 16) | ((p.op & 0xff) << 8) | (((p.r || 0) & 0x3f) << 2)) >>> 0;
    }
    function render() {
      bufEl.innerHTML = buf.length ? buf.map(function (b, i) {
        var p = PKTS[b];
        return '<div class="lab-pkt' + (i === runTo ? " cur" : "") + '">' +
          '<span class="ix">' + i + '</span><span class="dw">0x' + hx(encode(p), 8) + "</span>" +
          '<span class="op">' + b + "</span>" +
          '<span class="x" data-del="' + i + '" title="remove">✕</span></div>';
      }).join("") : '<div class="lab-pkt"><span class="ix"></span><span class="dw"></span><span class="op" style="color:var(--faint)">empty — append packets above</span><span></span></div>';

      var keys = Object.keys(regs);
      regEl.innerHTML = keys.length ? keys.map(function (k) {
        return '<div class="lab-ce hit"><span>' + k + "</span><span>set</span></div>";
      }).join("") : '<div class="lab-ce"><span>nothing set</span><span>defaults</span></div>';

      if (drew && flipped) {
        fbEl.innerHTML = '<svg viewBox="0 0 160 100"><rect width="160" height="100" fill="#12171c"/>' +
          '<polygon points="80,18 140,84 20,84" fill="' + (regs.DB_DEPTH_CONTROL ? "#4A8AC8" : "#BE8A22") + '"/>' +
          '<text x="80" y="96" font-size="6" fill="#8A97A4" text-anchor="middle" font-family="monospace">presented</text></svg>';
      } else if (drew) {
        fbEl.innerHTML = '<div class="empty">drew, but never flipped —<br>nothing reaches the screen</div>';
      } else {
        fbEl.innerHTML = '<div class="empty">no valid draw yet</div>';
      }
    }
    function run() {
      regs = {}; drew = false; flipped = false;
      var problems = [];
      for (var i = 0; i < buf.length; i++) {
        var p = PKTS[buf[i]];
        runTo = i;
        if (p.sets) p.sets.forEach(function (r) { regs[r] = 1; });
        if (p.draw) {
          var missing = REQUIRED.filter(function (r) { return !regs[r]; });
          if (missing.length) problems.push("packet " + i + ": draw with no " + missing.join(", "));
          else drew = true;
        }
        if (p.flip) {
          if (!drew) problems.push("packet " + i + ": flip before any successful draw");
          else flipped = true;
        }
      }
      runTo = -1;
      if (problems.length) { st.className = "lab-status err"; st.textContent = problems[0]; }
      else if (drew && flipped) { st.className = "lab-status ok"; st.textContent = "valid frame — " + buf.length + " packets, " + Object.keys(regs).length + " registers"; }
      else if (!buf.length) { st.className = "lab-status"; st.textContent = "buffer is empty"; }
      else { st.className = "lab-status err"; st.textContent = drew ? "drew but never flipped" : "no draw packet in the buffer"; }
      render();
    }
    pal.addEventListener("click", function (e) {
      var b = e.target.closest("[data-k]"); if (!b) return;
      buf.push(b.dataset.k); render();
    });
    bufEl.addEventListener("click", function (e) {
      var d = e.target.closest("[data-del]"); if (!d) return;
      buf.splice(+d.dataset.del, 1); render();
    });
    runBtn.addEventListener("click", run);
    clrBtn.addEventListener("click", function () { buf = []; regs = {}; drew = flipped = false; st.textContent = ""; render(); });
    presetBtn.addEventListener("click", function () {
      buf = ["SET_CONTEXT_REG · render target", "SET_CONTEXT_REG · depth",
             "SET_SH_REG · vertex shader", "SET_SH_REG · pixel shader",
             "SET_UCONFIG_REG · primitive", "DRAW_INDEX_AUTO",
             "RELEASE_MEM · fence", "NOP · R_FLIP"];
      run();
    });
    render();

    function add(name) {
      var b = null;
      [].slice.call(pal.querySelectorAll("[data-k]")).forEach(function (x) { if (x.dataset.k === name) b = x; });
      if (b) b.click();
    }
    demoRunner(row2, [
      { say: "An empty command buffer. We will build a frame packet by packet.",
        run: function () { clrBtn.click(); }, ms: 2600 },
      { say: "Start with just a <b>draw</b>. Run it.",
        run: function () { add("DRAW_INDEX_AUTO"); runBtn.click(); }, ms: 3400 },
      { say: "It fails, and the error names exactly what is missing. <b>A draw packet carries only an index count and flags</b> — everything else must already be in the register file.",
        ms: 4400 },
      { say: "Add a render target and try again. Better, but still not enough.",
        run: function () { clrBtn.click(); add("SET_CONTEXT_REG · render target"); add("DRAW_INDEX_AUTO"); runBtn.click(); }, ms: 4000 },
      { say: "Add both shaders and the primitive type. Now the draw is valid…",
        run: function () { clrBtn.click(); add("SET_CONTEXT_REG · render target"); add("SET_CONTEXT_REG · depth"); add("SET_SH_REG · vertex shader"); add("SET_SH_REG · pixel shader"); add("SET_UCONFIG_REG · primitive"); add("DRAW_INDEX_AUTO"); runBtn.click(); }, ms: 4200 },
      { say: "…but nothing reaches the screen, because we never flipped. Rendering and presenting are separate on this hardware.",
        ms: 3800 },
      { say: "Add an end-of-pipe fence and a flip. <b>That is a complete frame</b> — eight packets.",
        run: function () { add("RELEASE_MEM · fence"); add("NOP · R_FLIP"); runBtn.click(); }, ms: 4200 },
      { say: "The dwords on the left are real encodings from the <code>KYTY_PM4</code> macro — the count field genuinely holds <code>len − 2</code>.",
        ms: 3800 }
    ]);
  });

  /* ============================================================
     10 · timeline — fences, ticks and resource lifetime
     ============================================================ */
  reg("timeline", function (host) {
    var body = frame(host,
      "Command buffers, fences and resource lifetime",
      "submit work · complete it on the GPU",
      "Eight command buffers in rotation, each with a fence, plus a timeline semaphore giving a monotonically increasing tick. Anything that must outlive a submission is registered against its buffer and released only when that fence signals — which is why a staging buffer or a descriptor set cannot simply be freed when the draw is recorded.");

    var SLOTS = 8;
    var slots = [], tick = 0, seq = 0, cur = 0;
    function reset() {
      slots = []; tick = 0; seq = 0; cur = 0;
      for (var i = 0; i < SLOTS; i++) slots.push({ state: "free", tick: 0, res: 0 });
      slots[0].state = "recording";
      lines = [];
      log("Scheduler idle. Buffer 0 is open for recording; the semaphore has not ticked yet.");
      render();
    }

    var row = ctlRow(body);
    var recBtn = button(row, "Record a draw (+1 resource)");
    var subBtn = button(row, "Submit buffer", "pri");
    var cmpBtn = button(row, "GPU completes oldest");
    var rstBtn = button(row, "Reset");
    spacer(row);
    var st = status(row);

    var head = h("div", "lab-ctl");
    head.appendChild(h("span", "lab-lb", "semaphore tick"));
    var tickEl = h("span", "lab-tick", "0"); head.appendChild(tickEl);
    head.appendChild(h("span", "lab-lb", "resources awaiting a fence"));
    var resEl = h("span", "lab-tick", "0"); head.appendChild(resEl);
    body.appendChild(head);

    var tl = h("div", "lab-tl"); body.appendChild(tl);
    var logEl = h("div", "lab-steps"); body.appendChild(h("div", "lab-h", "what just happened"));
    body.appendChild(logEl);
    var lines = [];
    function log(s) { lines.unshift(s); if (lines.length > 5) lines.pop(); logEl.innerHTML = lines.map(function (l, i) { return "<div" + (i === 0 ? ' class="total"' : "") + "><span>" + l + "</span><span class='sv'></span></div>"; }).join(""); }

    function render() {
      tl.innerHTML = slots.map(function (s, i) {
        var label = s.state === "free" ? "free" : s.state === "recording" ? "recording" : s.state === "inflight" ? "in flight" : "retired";
        return '<div class="lab-slot ' + s.state + '">' +
          "<span>buffer " + i + "</span>" +
          "<span>" + label + "</span>" +
          "<span>" + (s.tick ? "waits for tick " + s.tick : "&nbsp;") + "</span>" +
          '<span class="res">' + (s.res ? s.res + " held" : "&nbsp;") + "</span></div>";
      }).join("");
      tickEl.textContent = tick;
      resEl.textContent = slots.reduce(function (a, s) { return a + (s.state === "inflight" ? s.res : 0); }, 0);
      var inflight = slots.filter(function (s) { return s.state === "inflight"; }).length;
      st.className = "lab-status" + (inflight >= SLOTS - 1 ? " err" : "");
      st.textContent = inflight >= SLOTS - 1
        ? "every buffer is in flight — the next submit must block until a fence signals"
        : inflight + " in flight · recording into buffer " + cur;
    }

    recBtn.addEventListener("click", function () {
      if (slots[cur].state !== "recording") { log("No buffer is recording — submit or reset first."); return; }
      slots[cur].res++;
      log("Recorded a draw into buffer " + cur + ". Its staging buffer and descriptor set are now retained against this buffer's fence.");
      render();
    });
    subBtn.addEventListener("click", function () {
      if (slots[cur].state !== "recording") { log("Nothing to submit."); return; }
      tick++; seq++;
      slots[cur].state = "inflight"; slots[cur].tick = tick;
      log("Submitted buffer " + cur + ". Timeline semaphore will reach " + tick + " when the GPU finishes it.");
      var next = -1;
      for (var k = 1; k <= SLOTS; k++) { var c = (cur + k) % SLOTS; if (slots[c].state === "free" || slots[c].state === "retired") { next = c; break; } }
      if (next < 0) { log("All eight buffers are in flight — CommandScheduler would block here waiting on a fence."); }
      else { cur = next; slots[cur] = { state: "recording", tick: 0, res: 0 }; }
      render();
    });
    cmpBtn.addEventListener("click", function () {
      var oldest = -1, best = Infinity;
      slots.forEach(function (s, i) { if (s.state === "inflight" && s.tick < best) { best = s.tick; oldest = i; } });
      if (oldest < 0) { log("Nothing in flight."); return; }
      var freed = slots[oldest].res;
      slots[oldest].state = "retired"; slots[oldest].res = 0;
      log("Fence for buffer " + oldest + " signalled at tick " + best + ". Released " + freed +
          " retained resource" + (freed === 1 ? "" : "s") + " — buffers retired, descriptor sets recycled.");
      render();
    });
    rstBtn.addEventListener("click", reset);
    reset();

    demoRunner(row, [
      { say: "Eight command buffers, one recording, nothing in flight, semaphore at zero.",
        run: reset, ms: 2800 },
      { say: "Record two draws into buffer 0. Each retains a staging buffer and a descriptor set against that buffer's fence.",
        run: function () { recBtn.click(); recBtn.click(); }, ms: 3400 },
      { say: "Submit it. The semaphore will reach tick 1 when the GPU finishes — and <b>those resources cannot be freed until then</b>, because the GPU is still reading them.",
        run: function () { subBtn.click(); }, ms: 4200 },
      { say: "Keep going. Record and submit until the rotation is nearly used up.",
        run: function () { for (var k = 0; k < 5; k++) { recBtn.click(); subBtn.click(); } }, ms: 3800 },
      { say: "Two more, and every one of the eight is in flight.",
        run: function () { recBtn.click(); subBtn.click(); recBtn.click(); subBtn.click(); }, ms: 3600 },
      { say: "<b>Now the scheduler would block.</b> There is no free buffer to record into, so the CPU has to wait for a fence — this is back-pressure from the GPU, and it is how a game gets paced.",
        ms: 4600 },
      { say: "The GPU finishes the oldest. Its fence signals, and its retained resources are released all at once.",
        run: function () { cmpBtn.click(); }, ms: 4000 },
      { say: "Complete two more and the rotation frees up. Note the tick only ever increases — that monotonic counter is what a timeline semaphore gives you.",
        run: function () { cmpBtn.click(); cmpBtn.click(); }, ms: 4000 }
    ]);
  });

  /* ============================================================
     11 · pipekey — why state changes multiply pipelines
     ============================================================ */
  reg("pipekey", function (host) {
    var body = frame(host,
      "The pipeline cache key",
      "toggle any state and watch the key change",
      "Vulkan bakes fixed-function state into the immutable <code>VkPipeline</code>, so every distinct combination needs its own object. Kyty packs the whole lot into one <code>#pragma pack(1)</code> struct and hashes it byte by byte — which is also why there is a <code>static_assert</code> on its exact size: a padding byte would be uninitialised, so identical states could hash differently and quietly multiply the cache.");

    var FIELDS = [
      { k: "topology", label: "topology", vals: ["triangle list", "triangle strip", "rect list"], v: 0 },
      { k: "blend", label: "blend enable", bool: true, v: 0 },
      { k: "srcblend", label: "src blend factor", vals: ["one", "src alpha", "zero"], v: 0, dep: "blend" },
      { k: "depthtest", label: "depth test", bool: true, v: 1 },
      { k: "depthwrite", label: "depth write", bool: true, v: 1, dep: "depthtest" },
      { k: "zfunc", label: "depth compare", vals: ["less", "lequal", "greater", "always"], v: 0, dep: "depthtest" },
      { k: "cullback", label: "cull back faces", bool: true, v: 1 },
      { k: "samples", label: "sample count", vals: ["1", "2", "4", "8"], v: 0 },
      { k: "colorfmt", label: "colour format", vals: ["B8G8R8A8_SRGB", "R8G8B8A8_UNORM", "R16G16B16A16_SFLOAT"], v: 0 },
      { k: "depthfmt", label: "depth format", vals: ["D32_SFLOAT", "D16_UNORM", "none"], v: 0 }
    ];
    var state = {};
    FIELDS.forEach(function (f) { state[f.k] = f.v; });
    var cache = [];    // {hash, n}
    var lastBytes = null;

    var tg = h("div", "lab-toggles"); body.appendChild(h("div", "lab-h", "static pipeline state"));
    body.appendChild(tg);

    var row = ctlRow(body);
    var lookBtn = button(row, "Look up in the cache", "pri");
    var clrBtn = button(row, "Empty the cache");
    spacer(row);
    var st = status(row);

    var split = h("div", "lab-2");
    var kL = h("div"), kR = h("div");
    kL.appendChild(h("div", "lab-h", "packed key bytes (changed ones highlighted)"));
    var bytesEl = h("div", "lab-bytes32"); kL.appendChild(bytesEl);
    var hashEl = h("div", "lab-status"); kL.appendChild(hashEl);
    kR.appendChild(h("div", "lab-h", "pipeline cache"));
    var cacheEl = h("div", "lab-cache"); kR.appendChild(cacheEl);
    split.appendChild(kL); split.appendChild(kR);
    body.appendChild(split);

    function pack() {
      var b = [];
      FIELDS.forEach(function (f) {
        var active = !f.dep || state[f.dep];
        b.push(active ? (state[f.k] & 0xFF) : 0);
        b.push(active ? 0x01 : 0x00);
      });
      // stand-ins for the viewport floats and blend constants the real struct carries
      [0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3F].forEach(function (x) { b.push(x); });
      return b;
    }
    function hash(bytes) {
      var hv = 0;
      bytes.forEach(function (x) { hv = ((hv ^ (x + 0x9E3779B9 + ((hv << 6) | 0) + (hv >>> 2))) | 0); });
      return hv >>> 0;
    }
    function render(marks) {
      tg.innerHTML = FIELDS.map(function (f) {
        var active = !f.dep || state[f.dep];
        var on = f.bool ? !!state[f.k] : true;
        var body2 = f.bool
          ? '<input type="checkbox" ' + (state[f.k] ? "checked" : "") + '><span>' + f.label + "</span>"
          : '<span>' + f.label + '</span><select class="lab-sel" style="margin-left:auto;font-size:10px;padding:2px 4px">' +
            f.vals.map(function (v, i) { return '<option value="' + i + '"' + (state[f.k] === i ? " selected" : "") + ">" + v + "</option>"; }).join("") + "</select>";
        return '<label class="lab-tg' + (f.bool && on ? " on" : "") + '" data-k="' + f.k + '" style="opacity:' + (active ? 1 : .42) + '">' + body2 + "</label>";
      }).join("");

      var bytes = pack();
      bytesEl.innerHTML = bytes.map(function (x, i) {
        var chg = marks && lastBytes && lastBytes[i] !== x;
        return '<div class="lab-b' + (chg ? " chg" : "") + '">' + hx(x, 2) + "</div>";
      }).join("");
      var hv = hash(bytes);
      hashEl.textContent = bytes.length + " bytes · hash 0x" + hx(hv, 8);
      lastBytes = bytes;

      cacheEl.innerHTML = cache.length ? cache.map(function (c) {
        return '<div class="lab-ce ' + (c.hash === hv ? "hit" : "") + '"><span>0x' + hx(c.hash, 8) +
          "</span><span>" + c.desc + "</span></div>";
      }).join("") : '<div class="lab-ce"><span>empty</span><span>0 pipelines</span></div>';
      return hv;
    }
    tg.addEventListener("change", function (e) {
      var l = e.target.closest("[data-k]"); if (!l) return;
      var f = FIELDS.filter(function (x) { return x.k === l.dataset.k; })[0];
      if (f.bool) state[f.k] = e.target.checked ? 1 : 0;
      else state[f.k] = +e.target.value;
      render(true);
      st.className = "lab-status";
      st.textContent = "key changed — press look up to see whether a pipeline already exists";
    });
    lookBtn.addEventListener("click", function () {
      var hv = render(false);
      var found = cache.filter(function (c) { return c.hash === hv; })[0];
      if (found) { st.className = "lab-status ok"; st.textContent = "cache HIT — reusing an existing VkPipeline"; }
      else {
        cache.push({ hash: hv, desc: "created #" + (cache.length + 1) });
        st.className = "lab-status err";
        st.textContent = "cache MISS — vkCreateGraphicsPipelines, and this can take milliseconds";
      }
      render(false);
    });
    clrBtn.addEventListener("click", function () { cache = []; st.textContent = ""; render(false); });
    render(false);

    function set(k, v) { state[k] = v; render(true); }
    demoRunner(row, [
      { say: "An empty pipeline cache and one state configuration. Look it up.",
        run: function () { clrBtn.click(); }, ms: 2800 },
      { say: "<b>Miss</b> — so Vulkan has to create a pipeline. On a real driver that is milliseconds, and it happens mid-frame.",
        run: function () { lookBtn.click(); }, ms: 3600 },
      { say: "Look up the identical state again: <b>hit</b>. This is the common case, and it is free.",
        run: function () { lookBtn.click(); }, ms: 3200 },
      { say: "Turn blend on. One toggle, and the packed key bytes change — the changed ones are highlighted.",
        run: function () { set("blend", 1); }, ms: 3400 },
      { say: "Another miss, another pipeline. <b>Two now.</b>",
        run: function () { lookBtn.click(); }, ms: 3200 },
      { say: "Change the depth compare, and the topology. Each distinct combination is its own immutable object.",
        run: function () { set("zfunc", 2); lookBtn.click(); set("topology", 2); lookBtn.click(); }, ms: 4000 },
      { say: "Four pipelines from three toggles. Multiply that by every material in a game and you have the first-encounter stutter people complain about.",
        ms: 4200 },
      { say: "Now turn <b>depth test off</b>. The fields that depend on it grey out and <b>zero in the key</b> — state that cannot affect the result must not affect the hash, or you get duplicate pipelines that are actually identical.",
        run: function () { set("depthtest", 0); }, ms: 5000 },
      { say: "Turn it back on with the same compare function and you land on an existing entry again: <b>hit</b>.",
        run: function () { set("depthtest", 1); lookBtn.click(); }, ms: 4000 }
    ]);
  });
})();


