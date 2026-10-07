/* ============================================================
   KytyPS5 Playground — tools that work on YOUR artifacts.
   Tables follow the pinned source. Supported parsing boundaries
   and model limitations are stated in the interface.
   ============================================================ */
(function () {
  "use strict";
  var A = window.KYTY_ARTIFACTS;
  function showError(out, err) { out.innerHTML = '<p class="pg-hint pg-warntext" role="alert">' + esc(err.message) + "</p>"; }

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hex(n, w) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < (w || 8)) s = "0" + s;
    return "0x" + s;
  }
  function hex64(lo, hi) {
    var s = (hi >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = "0" + s;
    var t = (lo >>> 0).toString(16).toUpperCase();
    while (t.length < 8) t = "0" + t;
    return "0x" + s + t;
  }

  /* ============================================================
     1. PM4 packet decoder
     Encoding from src/graphics/guest_gpu/pm4.h
       cmd = 0xC0000000
           | (((len - 2) & 0x3FFF) << 16)
           | ((op & 0xFF) << 8)
           | ((r & (R_NUM-1)) << 2)     // R_NUM = 0x40  (pm4.h)
     ============================================================ */

  var IT = A.data.pm4;

  var IT_NOTE = {
    0x2D: "Draw non-indexed. Vertex count in the next dword; the vertex shader " +
          "synthesises indices from gl_VertexIndex.",
    0x27: "Draw indexed. Index count + index base come from the payload.",
    0x69: "Write one or more CONTEXT registers. Payload dword 0 is the register " +
          "offset; the rest are values written consecutively.",
    0x76: "Write SH registers — this is how shader resource pointers (the SRT / user " +
          "data SGPRs) reach the shader.",
    0x79: "Write UCONFIG registers (index type, primitive type, viewport bits).",
    0x49: "Release memory / signal. This is the packet the CPU waits on for GPU " +
          "completion; KytyPS5 maps it onto a Vulkan timeline semaphore.",
    0x43: "Cache flush + invalidate. Drives the CB/DB → GL2 writeback that the " +
          "coherency layer needs before the CPU can read a render target.",
    0x15: "Compute dispatch. Payload carries the threadgroup counts in X/Y/Z.",
    0x10: "No-op — but the payload length still advances the parser, so emulators " +
          "must honour it. Also used as padding to align packets."
  };

  function decodePm4(words) { return A.decodePm4(words).map(function(r) { r.note = IT_NOTE[r.op] || null; return r; }); }
  var parseDwords = A.parseWords;
  var encodePm4 = A.encodePm4;

  var PM4_PRESETS = {
    draw: {
      label: "Non-indexed draw packet",
      text: "C0012D00 00000003 00000002\nC0001000 00000000",
      why: "IT_DRAW_INDEX_AUTO (0x2D) with len 3: header + vertex count + draw-initiator. " +
           "Then a NOP. This is a packet-shape example. Rendering also needs shaders, targets, descriptors and valid register state."
    },
    ctx: {
      label: "Two CONTEXT register writes",
      text: "C0026900 000000C0 3F800000 00000000",
      why: "IT_SET_CONTEXT_REG (0x69), len 4: one register offset (0xC0) followed by " +
           "two values written to consecutive registers."
    },
    release: {
      label: "Release-mem header example",
      text: "C0044900 00000004 40000000 DEADBEEF 00000001 00000000",
      why: "IT_RELEASE_MEM (0x49), illustrative header and payload. This does not establish a valid fence or " +
           "completion signal."
    },
    mixed: {
      label: "Synthetic packet stream",
      text:
        "C0001000 00000000\n" +
        "C0027900 00000242 00000004 00000000\n" +
        "C0026900 000000C0 3F800000 00000000\n" +
        "C0012D00 00000003 00000002\n" +
        "C0044900 00000004 40000000 CAFEBABE 00000001 00000000",
      why: "NOP, a UCONFIG write, a CONTEXT write, the draw, then the release. " +
           "Illustrative payloads only: packet boundaries are not proof of valid GPU state or command semantics."
    }
  };

  function toolPm4(root) {
    root.innerHTML =
      '<div class="pg-controls">' +
      '<div class="pg-row"><label class="pg-lab" for="pm4-in">Command buffer dwords (hex)</label>' +
      '<textarea id="pm4-in" class="pg-ta" spellcheck="false" rows="5"></textarea></div>' +
      '<div class="pg-row pg-presets" id="pm4-presets"></div>' +
      '<div class="pg-row"><label class="pg-lab">Or build one</label>' +
      '<div class="pg-inline">' +
      '<select id="pm4-op" class="pg-sel"></select>' +
      '<label class="pg-mini">len <input id="pm4-len" class="pg-num" type="number" min="2" max="16" value="3"></label>' +
      '<label class="pg-mini">r <input id="pm4-r" class="pg-num" type="number" min="0" max="63" value="0"></label>' +
      '<button type="button" class="pg-btn" id="pm4-build">Encode →</button>' +
      '</div></div></div>' +
      '<div class="pg-out" id="pm4-out"></div>' +
      '<p class="pg-src">Encoding from <code>src/graphics/guest_gpu/pm4.h</code>; ' +
      'opcode table from <code>pm4.h</code>.</p>';

    var inp = $("#pm4-in", root), out = $("#pm4-out", root);

    var sel = $("#pm4-op", root);
    Object.keys(IT).map(Number).sort(function (a, b) { return a - b; }).forEach(function (op) {
      var o = el("option", null, IT[op] + "  (" + hex(op, 2) + ")");
      o.value = op;
      if (op === 0x2d) o.selected = true;
      sel.appendChild(o);
    });

    var pres = $("#pm4-presets", root);
    Object.keys(PM4_PRESETS).forEach(function (k) {
      var b = el("button", "pg-chip", PM4_PRESETS[k].label);
      b.type = "button";
      b.addEventListener("click", function () {
        inp.value = PM4_PRESETS[k].text;
        render(PM4_PRESETS[k].why);
      });
      pres.appendChild(b);
    });

    $("#pm4-build", root).addEventListener("click", function () {
      var op = +sel.value, len = +$("#pm4-len", root).value, r = +$("#pm4-r", root).value;
      var cmd; try { cmd = encodePm4(len, op, r); } catch (err) { showError(out, err); return; }
      var pad = [];
      for (var i = 0; i < len - 1; i++) pad.push("00000000");
      inp.value = hex(cmd).slice(2) + (pad.length ? " " + pad.join(" ") : "");
      render("Encoded " + (IT[op] || hex(op, 2)) + " with len " + len + " → " + hex(cmd) +
        ". Payload dwords are zeroed; edit them above and it re-decodes.");
    });

    function render(why) {
      var dw, recs; try { dw = parseDwords(inp.value); recs = decodePm4(dw); } catch (err) { showError(out, err); return; }
      if (!dw.length) {
        out.innerHTML = '<p class="pg-hint">Paste hex dwords, pick a preset, or encode a packet above.</p>';
        return;
      }

      var html = why ? '<p class="pg-why">' + esc(why) + "</p>" : "";
      html += '<table class="pg-table"><thead><tr><th>#</th><th>header</th><th>packet</th>' +
        "<th>len</th><th>payload</th></tr></thead><tbody>";
      recs.forEach(function (r) {
        var cls = r.bad ? ' class="pg-bad"' : r.short ? ' class="pg-warn"' : "";
        html += "<tr" + cls + "><td class=\"pg-dim\">" + r.at + "</td><td><code>" + hex(r.raw) +
          "</code></td><td><strong>" + esc(r.name) + "</strong>" +
          (r.type === 3 ? '<span class="pg-tag">r=' + r.r + "</span>" : "") +
          (r.note ? '<div class="pg-note">' + esc(r.note) + "</div>" : "") +
          "</td><td>" + r.len + "</td><td><code class=\"pg-pay\">" +
          (r.payload.length ? r.payload.map(function (p) { return hex(p); }).join(" ") : "—") +
          "</code>" + (r.short ? '<div class="pg-note">truncated — the buffer ends before ' +
            'this packet\'s declared length</div>' : "") + "</td></tr>";
      });
      html += "</tbody></table>";

      var bad = recs.filter(function (r) { return r.bad || r.short; }).length;
      html += '<p class="pg-sum">' + recs.length + " packet" + (recs.length === 1 ? "" : "s") +
        " over " + dw.length + " dwords" +
        (bad ? " · <span class=\"pg-warntext\">" + bad + " look malformed</span>" : " · packet boundaries valid; payload semantics not validated") +
        "</p>";
      out.innerHTML = html;
    }

    inp.addEventListener("input", function () { render(null); });
    inp.value = PM4_PRESETS.mixed.text;
    render(PM4_PRESETS.mixed.why);
  }

  /* ============================================================
     2. Module / library ID encoder  (EncodeId64)
     Verbatim from src/loader/runtimeLinker.cpp
     ============================================================ */

  var ID64_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";

  var encodeId64 = A.encodeId64;
  var decodeId64 = A.decodeId64;

  function toolId64(root) {
    root.innerHTML =
      '<div class="pg-controls">' +
      '<div class="pg-inline">' +
      '<label class="pg-mini" style="flex:1">Numeric id (0–65535)' +
      '<input id="id-num" class="pg-num" type="number" min="0" max="65535" value="0"></label>' +
      '<span class="pg-arrow">→</span>' +
      '<label class="pg-mini" style="flex:1">Encoded' +
      '<input id="id-str" class="pg-txt" spellcheck="false" value="A"></label>' +
      '</div>' +
      '<div class="pg-row"><input id="id-range" class="pg-range" type="range" min="0" max="65535" value="0"></div>' +
      '</div>' +
      '<div class="pg-out" id="id-out"></div>' +
      '<p class="pg-src">Verbatim from <code>src/loader/runtimeLinker.cpp</code>. ' +
      'This is how the 16-bit module and library ids packed into Sony dynamic entries become ' +
      'the short strings you see inside symbol names.</p>';

    var num = $("#id-num", root), str = $("#id-str", root), rng = $("#id-range", root), out = $("#id-out", root);

    function show(id) {
      var enc = encodeId64(id);
      var band = id < 0x40 ? "1 char (id &lt; 0x40)" :
                 id < 0x1000 ? "2 chars (0x40 ≤ id &lt; 0x1000)" :
                 "3 chars (id ≥ 0x1000)";
      var rows = "";
      if (id < 0x40) {
        rows = "<tr><td>id &amp; 0x3F</td><td>" + (id & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[id & 0x3f]) + "</code></td></tr>";
      } else if (id < 0x1000) {
        rows =
          "<tr><td>(id &gt;&gt; 6) &amp; 0x3F</td><td>" + ((id >> 6) & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[(id >> 6) & 0x3f]) + "</code></td></tr>" +
          "<tr><td>id &amp; 0x3F</td><td>" + (id & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[id & 0x3f]) + "</code></td></tr>";
      } else {
        rows =
          "<tr><td>(id &gt;&gt; 12) &amp; 0x3F</td><td>" + ((id >> 12) & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[(id >> 12) & 0x3f]) + "</code></td></tr>" +
          "<tr><td>(id &gt;&gt; 6) &amp; 0x3F</td><td>" + ((id >> 6) & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[(id >> 6) & 0x3f]) + "</code></td></tr>" +
          "<tr><td>id &amp; 0x3F</td><td>" + (id & 0x3f) + "</td><td><code>" + esc(ID64_ALPHA[id & 0x3f]) + "</code></td></tr>";
      }
      out.innerHTML =
        '<div class="pg-big"><code>' + esc(enc) + "</code></div>" +
        '<p class="pg-why">' + hex(id, 4) + " takes the <strong>" + band + "</strong> branch.</p>" +
        '<table class="pg-table pg-narrow"><thead><tr><th>expression</th><th>value</th><th>char</th></tr></thead><tbody>' +
        rows + "</tbody></table>" +
        '<p class="pg-sum">In a symbol name this appears as <code>&lt;nid&gt;#' + esc(enc) +
        "#&lt;library&gt;</code> — the linker matches on those ids, never on a readable name.</p>";
    }

    function fromNum() {
      try { var v = Number(num.value); if (!num.value.trim()) throw new Error("Enter an ID."); str.value = encodeId64(v); rng.value=v; show(v); }
      catch(err) { showError(out,err); }
    }
    function fromStr() {
      try { var v=decodeId64(str.value.trim()); num.value=v; rng.value=v; show(v); }
      catch(err) { showError(out,err); }
    }

    num.addEventListener("input", fromNum);
    rng.addEventListener("input", function () { num.value = rng.value; fromNum(); });
    str.addEventListener("input", fromStr);
    num.value = 4200; fromNum();
  }

  /* ============================================================
     3. ELF / SELF inspector — drop a real module from your dumps
     Sony constants from src/loader/elf.h
     ============================================================ */

  var PT = {
    0: "PT_NULL", 1: "PT_LOAD", 2: "PT_DYNAMIC", 3: "PT_INTERP", 4: "PT_NOTE",
    5: "PT_SHLIB", 6: "PT_PHDR", 7: "PT_TLS",
    0x6474e550: "PT_GNU_EH_FRAME", 0x6474e551: "PT_GNU_STACK", 0x6474e552: "PT_GNU_RELRO",
    0x61000000: "PT_OS_DYNLIBDATA", 0x61000001: "PT_OS_PROCPARAM", 0x61000010: "PT_OS_RELRO"
  };
  var PT_WHY = {
    0x61000000: "Sony's replacement for a normal dynamic section. Everything the runtime " +
                "linker needs — symbol table, string table, relocations — lives in here, " +
                "which is why a stock ELF reader shows a module with no imports.",
    0x61000001: "Process parameters: SDK version, entry behaviour.",
    0x61000010: "Read-only-after-relocation segment.",
    7: "Thread-local storage template. The emulator has to allocate this per guest thread " +
       "and wire up fs: so guest TLS accesses land somewhere valid.",
    2: "Standard dynamic section. On PS5 modules the interesting tags are the DT_OS_* ones."
  };

  var DT_OS = {
    0x61000013: "DT_OS_EXPORT_LIB", 0x61000047: "DT_OS_EXPORT_LIB_1",
    0x61000017: "DT_OS_EXPORT_LIB_ATTR", 0x61000007: "DT_OS_FINGERPRINT",
    0x61000025: "DT_OS_HASH", 0x6100003d: "DT_OS_HASHSZ",
    0x61000015: "DT_OS_IMPORT_LIB", 0x61000049: "DT_OS_IMPORT_LIB_1",
    0x61000019: "DT_OS_IMPORT_LIB_ATTR", 0x61000029: "DT_OS_JMPREL",
    0x61000011: "DT_OS_MODULE_ATTR", 0x6100000d: "DT_OS_MODULE_INFO",
    0x61000043: "DT_OS_MODULE_INFO_1", 0x6100000f: "DT_OS_NEEDED_MODULE",
    0x61000045: "DT_OS_NEEDED_MODULE_1", 0x61000009: "DT_OS_ORIGINAL_FILENAME",
    0x61000041: "DT_OS_ORIGINAL_FILENAME_1", 0x61000027: "DT_OS_PLTGOT",
    0x6100002b: "DT_OS_PLTREL", 0x6100002d: "DT_OS_PLTRELSZ",
    0x6100002f: "DT_OS_RELA", 0x61000033: "DT_OS_RELAENT",
    0x61000031: "DT_OS_RELASZ", 0x61000037: "DT_OS_STRSZ",
    0x61000035: "DT_OS_STRTAB", 0x6100003b: "DT_OS_SYMENT",
    0x61000039: "DT_OS_SYMTAB", 0x6100003f: "DT_OS_SYMTABSZ"
  };

  var ET = {
    0: "ET_NONE", 1: "ET_REL", 2: "ET_EXEC", 3: "ET_DYN", 4: "ET_CORE",
    0xfe00: "ET_SCE_EXEC", 0xfe04: "ET_SCE_REPLAY_EXEC", 0xfe0c: "ET_SCE_RELEXEC",
    0xfe10: "ET_DYNEXEC (KytyPS5)", 0xfe18: "ET_DYNAMIC (KytyPS5)", 0xfe1c: "Sony type 0xFE1C"
  };

  function flagStr(f) {
    return ((f & 4) ? "R" : "-") + ((f & 2) ? "W" : "-") + ((f & 1) ? "X" : "-");
  }

  var parseElf = A.parseElf;

  function renderElf(e, name, out) {
    var h = "";
    h += '<div class="pg-file">' + esc(name) + "</div>";

    if (e.selfHdr) {
      h += '<p class="pg-why">This is a <strong>SELF</strong> container (magic ' + e.selfHdr.magic +
        "). Found a readable ELF header at offset " + hex(e.elfOffset) + " inside it. This does not establish that its segment payloads are unencrypted.</p>";
    }

    h += '<table class="pg-table pg-narrow"><tbody>';
    h += "<tr><td>e_type</td><td><code>" + hex(e.type, 4) + "</code> " +
      (ET[e.type] ? "<strong>" + ET[e.type] + "</strong>" : "<em>unknown</em>") + "</td></tr>";
    h += "<tr><td>e_machine</td><td><code>" + hex(e.machine, 4) + "</code> " +
      (e.machine === 0x3e ? "x86-64" : "other") + "</td></tr>";
    h += "<tr><td>e_entry</td><td><code>" + hex64(e.entryLo, e.entryHi) + "</code></td></tr>";
    h += "<tr><td>program headers</td><td>" + e.phnum + " × " + e.phentsize + " bytes @ " +
      hex(e.phoff) + "</td></tr>";
    h += "</tbody></table>";

    e.warnings.forEach(function(w) { h += '<p class="pg-hint pg-warntext">' + esc(w) + "</p>"; });
    if (e.type === 0xfe10 || e.type === 0xfe18) {
      h += '<p class="pg-why">The project-specific executable/shared type identifies this ' +
        "as a Sony module. The labels here follow the pinned loader/elf.h.</p>";
    }

    h += "<h4>Program headers</h4>";
    h += '<table class="pg-table"><thead><tr><th>type</th><th>flags</th><th>vaddr</th>' +
      "<th>filesz</th><th>memsz</th><th>align</th></tr></thead><tbody>";
    e.phdrs.forEach(function (p) {
      var nm = PT[p.type] || hex(p.type);
      var sony = p.type >= 0x61000000 && p.type < 0x62000000;
      h += "<tr" + (sony ? ' class="pg-hl"' : "") + "><td><strong>" + esc(nm) + "</strong>" +
        (PT_WHY[p.type] ? '<div class="pg-note">' + esc(PT_WHY[p.type]) + "</div>" : "") +
        '</td><td><code>' + flagStr(p.flags) + "</code></td><td><code>" +
        hex64(p.vaddrLo, p.vaddrHi) + "</code></td><td>" + p.filesz.toLocaleString() +
        "</td><td>" + p.memsz.toLocaleString() + "</td><td>" +
        (p.align ? p.align.toLocaleString() : "—") + "</td></tr>";
    });
    h += "</tbody></table>";

    if (e.dyn.length) {
      var sonyTags = e.dyn.filter(function (d) { return DT_OS[d.tagLo] && d.tagHi === 0; });
      h += "<h4>Dynamic tags <span class=\"pg-dim\">(" + e.dyn.length + " entries, " +
        sonyTags.length + " Sony-specific)</span></h4>";
      h += '<table class="pg-table"><thead><tr><th>tag</th><th>value</th></tr></thead><tbody>';
      e.dyn.slice(0, 80).forEach(function (d) {
        var nm = d.tagHi === 0 && DT_OS[d.tagLo] ? DT_OS[d.tagLo] : null;
        h += "<tr" + (nm ? ' class="pg-hl"' : "") + "><td><code>" +
          hex64(d.tagLo, d.tagHi) + "</code>" + (nm ? " <strong>" + esc(nm) + "</strong>" : "") +
          "</td><td><code>" + hex64(d.valLo, d.valHi) + "</code></td></tr>";
      });
      h += "</tbody></table>";
      if (e.dyn.length > 80) h += '<p class="pg-sum">…and ' + (e.dyn.length - 80) + " more.</p>";
    }

    var totalMem = e.phdrs.filter(function (p) { return p.type === 1; })
      .reduce(function (a, p) { return a + BigInt(p.memsz); }, 0n);
    h += '<p class="pg-sum">Loadable footprint: <strong>' +
      totalMem.toLocaleString() + " bytes</strong> across " +
      e.phdrs.filter(function (p) { return p.type === 1; }).length +
      " PT_LOAD segments. This is the sum of PT_LOAD memory sizes; it excludes address gaps and is not the reserved " +
      "address span. Header inspection does not establish that the module will load or execute.</p>";

    out.innerHTML = h;
  }

  // A tiny synthetic PS5-flavoured module so the tool demos with no file.
  function demoElf() {
    var buf = new ArrayBuffer(0x28800);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    u8[0] = 0x7f; u8[1] = 0x45; u8[2] = 0x4c; u8[3] = 0x46;
    u8[4] = 2; u8[5] = 1; u8[6] = 1; u8[7] = 0;
    dv.setUint16(16, 0xfe10, true);   // ET_DYNEXEC in the pinned KytyPS5 loader
    dv.setUint32(20, 1, true);
    dv.setUint16(52, 64, true);
    dv.setUint16(18, 0x3e, true);     // x86-64
    dv.setUint32(24, 0x00081000, true); dv.setUint32(28, 0, true); // entry
    dv.setUint32(32, 64, true); dv.setUint32(36, 0, true);         // phoff
    dv.setUint16(54, 56, true);       // phentsize
    dv.setUint16(56, 5, true);        // phnum

    var segs = [
      { t: 1,          f: 5, va: 0x00080000, fs: 0x21000, ms: 0x21000, al: 0x4000, off: 0x0 },
      { t: 1,          f: 6, va: 0x000a1000, fs: 0x03000, ms: 0x05000, al: 0x4000, off: 0x21000 },
      { t: 2,          f: 4, va: 0x000a3000, fs: 0x100,   ms: 0x100,   al: 8,      off: 0x22000 },
      { t: 7,          f: 4, va: 0x000a4000, fs: 0x40,    ms: 0x80,    al: 16,     off: 0x300 },
      { t: 0x61000000, f: 4, va: 0,          fs: 0x4800,  ms: 0x4800,  al: 16,     off: 0x24000 }
    ];
    segs.forEach(function (s, i) {
      var p = 64 + i * 56;
      dv.setUint32(p, s.t, true);
      dv.setUint32(p + 4, s.f, true);
      dv.setUint32(p + 8, s.off, true); dv.setUint32(p + 12, 0, true);
      dv.setUint32(p + 16, s.va, true); dv.setUint32(p + 20, 0, true);
      dv.setUint32(p + 32, s.fs, true); dv.setUint32(p + 36, 0, true);
      dv.setUint32(p + 40, s.ms, true); dv.setUint32(p + 44, 0, true);
      dv.setUint32(p + 48, s.al, true); dv.setUint32(p + 52, 0, true);
    });

    // A few dynamic entries at file offset 0x22000, incl. real Sony tags.
    var dyn = [
      [0x6100000d, 0x00000001], // DT_OS_MODULE_INFO
      [0x61000015, 0x00010000], // DT_OS_IMPORT_LIB
      [0x61000039, 0x00000240], // DT_OS_SYMTAB
      [0x61000035, 0x00000980], // DT_OS_STRTAB
      [0x6100002f, 0x00001100], // DT_OS_RELA
      [0x61000029, 0x00002400], // DT_OS_JMPREL
      [0x00000000, 0x00000000]
    ];
    dyn.forEach(function (d, i) {
      var p = 0x22000 + i * 16;
      dv.setUint32(p, d[0], true); dv.setUint32(p + 4, 0, true);
      dv.setUint32(p + 8, d[1], true); dv.setUint32(p + 12, 0, true);
    });
    return buf;
  }

  function toolElf(root) {
    root.innerHTML =
      '<div class="pg-drop" id="elf-drop" tabindex="0" role="button">' +
      '<div class="pg-drop-i">⇩</div>' +
      "<div><strong>Drop a module here</strong><br>" +
      '<span class="pg-dim">.elf · .prx · .sprx · .self · eboot.bin — or click to pick one</span></div>' +
      '<input type="file" id="elf-file" hidden></div>' +
      '<div class="pg-row"><button type="button" class="pg-btn pg-demo" id="elf-demo">▶ Run demo (no file needed)</button></div>' +
      '<div class="pg-out" id="elf-out"><p class="pg-hint">Nothing loaded. Everything is parsed ' +
      "locally in your browser — no file leaves this page.</p></div>" +
      '<p class="pg-src">Sony segment and dynamic-tag constants from ' +
      "<code>src/loader/elf.h</code>.</p>";

    var drop = $("#elf-drop", root), file = $("#elf-file", root), out = $("#elf-out", root);

    function handle(buf, name) {
      try { renderElf(parseElf(buf), name, out); }
      catch (err) {
        out.innerHTML = '<p class="pg-hint pg-warntext"><strong>Could not parse it.</strong> ' +
          esc(err.message) + "</p>";
      }
    }
    function pick(f) {
      if (!f) return;
      if(f.size > A.MAX_FILE) { showError(out,new Error("File exceeds the 64 MiB interactive limit. Extract a smaller artifact.")); return; }
      var r = new FileReader();
      r.onload = function () { handle(r.result, f.name); };
      r.onerror = function () {
        out.innerHTML = '<p class="pg-hint pg-warntext">Could not read that file.</p>';
      };
      r.readAsArrayBuffer(f);
    }

    drop.addEventListener("click", function(e) { if(e.target !== file) file.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    file.addEventListener("change", function () { pick(file.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("pg-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("pg-over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });
    $("#elf-demo", root).addEventListener("click", function () {
      handle(demoElf(), "demo-module.sprx  (synthetic)");
    });
  }

  /* ============================================================
     4. Log triage — drop your own _kyty.txt
     ============================================================ */

  var LOG_RULES = A.LOG_RULES;
  var analyseLog = A.analyseLog;

  function renderLog(res, name, out) {
    var h = '<div class="pg-file">' + esc(name) + ' <span class="pg-dim">· ' +
      res.lines.toLocaleString() + " lines</span></div>";

    var any = false;
    h += '<div class="pg-stats">';
    LOG_RULES.forEach(function (r) {
      var b = res.buckets[r.key];
      var total = Object.keys(b.counts).reduce(function (a, k) { return a + b.counts[k]; }, 0);
      if (total) any = true;
      h += '<div class="pg-stat"><div class="pg-stat-n">' + total.toLocaleString() +
        '</div><div class="pg-stat-l">' + esc(r.label) + "</div></div>";
    });
    h += "</div>";

    if (!any) {
      h += '<p class="pg-why">Nothing matched the triage patterns — either this is a very clean ' +
        "run, an unsupported message format, or the wrong log. No matches is not proof of success. Try running with " +
        "<code>--printf-direction File</code>.</p>";
      out.innerHTML = h;
      return;
    }

    LOG_RULES.forEach(function (r) {
      var b = res.buckets[r.key];
      var keys = Object.keys(b.counts).sort(function (a, c) { return b.counts[c] - b.counts[a]; });
      if (!keys.length) return;
      h += "<h4>" + esc(r.label) + ' <span class="pg-dim">· ' + keys.length +
        " distinct</span></h4>";
      h += '<p class="pg-note">' + esc(r.why) + "</p>";
      h += '<table class="pg-table"><thead><tr><th>×</th><th>message</th></tr></thead><tbody>';
      keys.slice(0, 15).forEach(function (k) {
        h += "<tr><td class=\"pg-dim\">" + b.counts[k] + "</td><td><code class=\"pg-pay\">" +
          esc(k) + "</code></td></tr>";
      });
      h += "</tbody></table>";
      if (keys.length > 15) h += '<p class="pg-sum">…and ' + (keys.length - 15) + " more distinct messages.</p>";
    });

    h += '<p class="pg-sum">' + res.unmatched + ' nonempty lines did not match these heuristics.</p>';
    h += '<details class="pg-evidence"><summary>Inspect original evidence with line numbers</summary><pre>' + esc(LOG_RULES.flatMap(function(r) { return res.buckets[r.key].hits; }).sort(function(a,b) { return a.n-b.n; }).map(function(hit) { return hit.n + ': ' + hit.t; }).join('\n')) + '</pre><p>Up to 400 matching lines per category. Refer to the original file for surrounding context.</p></details>';
    var nidKeys = Object.keys(res.nids);
    if (nidKeys.length) {
      h += "<h4>Candidate NIDs <span class=\"pg-dim\">· " + nidKeys.length + "</span></h4>";
      h += '<p class="pg-note">Tokens near symbol-resolution messages that match the shape of an ' +
        "encoded NID. Not every one is real — but a repeated token here is a good place to start " +
        "when investigating why the lookup failed.</p>";
      h += '<div class="pg-nids">' + nidKeys.slice(0, 60).map(function (k) {
        return '<code class="pg-nid">' + esc(k) + "</code>";
      }).join("") + "</div>";
    }

    out.innerHTML = h;
  }

  var DEMO_LOG = [
    "[  0.000] Synthetic teaching log — invented messages, not a captured run",
    "[  0.014] loader: mapping eboot.bin at 0x0000000000080000 (0x21000 bytes, R-X)",
    "[  0.015] loader: mapping segment 1 at 0x00000000000a1000 (0x5000 bytes, RW-)",
    "[  0.021] runtimeLinker: module libkernel needs 4 libraries",
    "[  0.033] runtimeLinker: unresolved symbol pt2fEBBpEJk#v#v (Graphics5Driver)",
    "[  0.033] runtimeLinker: unresolved symbol xeH4Ry1ZfBg#v#v (Graphics5Driver)",
    "[  0.034] runtimeLinker: unresolved symbol pt2fEBBpEJk#v#v (Graphics5Driver)",
    "[  0.041] libKernel: sceKernelMapDirectMemory unimplemented, returning 0",
    "[  0.042] libKernel: sceKernelMapDirectMemory unimplemented, returning 0",
    "[  0.055] graphics: pm4 unknown packet 0x00000073 at dword 412",
    "[  0.061] graphics: submitting command buffer 0 (3184 dwords)",
    "[  0.088] shader: translating PS 0x00000000000c4400 -> SPIR-V (144 instructions)",
    "[  0.090] shader: unhandled IR opcode V_MED3_F32, falling back",
    "[  0.101] warning: descriptor set 2 binding 4 has no backing resource",
    "[  0.102] warning: descriptor set 2 binding 4 has no backing resource",
    "[  0.140] renderer: created pipeline 0x00000000019ac220",
    "[  0.166] error: vkQueueSubmit returned VK_ERROR_DEVICE_LOST",
    "[  0.166] graphics: command processor stalled waiting on fence 0x0000000000000004",
    "[  0.170] libSystemService: sceSystemServiceGetStatus stub",
    "[  0.221] warning: HTile depth address inactive, ignoring",
    "[  0.240] runtimeLinker: unresolved symbol Xn8fNPP4L1M#v#v (libSceAudioOut)"
  ].join("\n");

  function toolLog(root) {
    root.innerHTML =
      '<div class="pg-drop" id="log-drop" tabindex="0" role="button">' +
      '<div class="pg-drop-i">⇩</div>' +
      "<div><strong>Drop your <code>_kyty.txt</code> here</strong><br>" +
      '<span class="pg-dim">or click to pick a log file</span></div>' +
      '<input type="file" id="log-file" accept=".txt,.log,text/plain" hidden></div>' +
      '<div class="pg-row"><button type="button" class="pg-btn pg-demo" id="log-demo">▶ Run demo (synthetic log)</button>' +
      '<button type="button" class="pg-btn" id="log-paste">Paste text instead</button></div>' +
      '<textarea id="log-ta" class="pg-ta" rows="6" spellcheck="false" hidden ' +
      'placeholder="Paste log lines here…"></textarea>' +
      '<div class="pg-out" id="log-out"><p class="pg-hint">Generate one by running the emulator ' +
      "with <code>--printf-direction File --printf-output-file _kyty.txt</code>. " +
      "Parsed locally; nothing is uploaded.</p></div>";

    var out = $("#log-out", root), drop = $("#log-drop", root), file = $("#log-file", root);
    var ta = $("#log-ta", root);

    function run(text, name) { try { renderLog(analyseLog(text), name, out); } catch(err) { showError(out,err); } }

    function pick(f) {
      if (!f) return;
      if(f.size > A.MAX_TEXT) { showError(out,new Error("Text file exceeds the 2 MiB interactive limit. Extract a smaller artifact.")); return; }
      var r = new FileReader();
      r.onload = function () { run(String(r.result), f.name); };
      r.onerror = function () { showError(out,new Error("Could not read that file.")); };
      r.readAsText(f);
    }
    drop.addEventListener("click", function(e) { if(e.target !== file) file.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    file.addEventListener("change", function () { pick(file.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("pg-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("pg-over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });

    $("#log-demo", root).addEventListener("click", function () {
      run(DEMO_LOG, "sample-run.txt  (demo)");
    });
    $("#log-paste", root).addEventListener("click", function () {
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    ta.addEventListener("input", function () {
      run(ta.value, "pasted text");
    });
  }

  /* ============================================================
     A. C++ primer — struct layout lab
     Alignment: the x86-64 ABI pads each member to its alignment
     (usually its own size) and rounds sizeof up to the largest
     member alignment. #pragma pack(1) forces alignment 1
     everywhere — the trick behind VaList (vaContext.h) and the
     machine-code structs (jit.h). static_assert(sizeof(...)==N)
     is how the tree locks these layouts (kernel/memory.h).
     ============================================================ */

  var LAYOUT_TYPES = [
    { id: "u8",    label: "u8 (1)",    size: 1,  align: 1 },
    { id: "char",  label: "char (1)",  size: 1,  align: 1 },
    { id: "u16",   label: "u16 (2)",   size: 2,  align: 2 },
    { id: "u32",   label: "u32 (4)",   size: 4,  align: 4 },
    { id: "float", label: "float (4)", size: 4,  align: 4 },
    { id: "u64",   label: "u64 (8)",   size: 8,  align: 8 },
    { id: "double",label: "double (8)",size: 8,  align: 8 },
    { id: "ptr",   label: "void* (8)", size: 8,  align: 8 },
    { id: "u8x16", label: "u8[16] (16, align 1)", size: 16, align: 1 }
  ];
  var LAYOUT_TYPE_MAP = {};
  LAYOUT_TYPES.forEach(function (t) { LAYOUT_TYPE_MAP[t.id] = t; });

  var LAYOUT_PRESETS = [
    { id: "trap",    label: "The padding trap — u8, u64, u32, u8",
      members: ["u8", "u64", "u32", "u8"], pack: false,
      why: "u8 at 0, then seven bytes of padding so the u64 lands on an 8-byte boundary. sizeof is 24, not the 14 you might guess." },
    { id: "natural", label: "Two ints + pointer — natural alignment",
      members: ["u32", "u32", "ptr"], pack: false,
      why: "Two u32 members occupy offsets 0 and 4. The pointer begins at offset 8, already aligned: no padding is needed, and sizeof is 16." },
    { id: "valist",  label: "VaList — the real packed struct (vaContext.h)",
      members: ["u32", "u32", "ptr", "ptr"], pack: true,
      why: "4 + 4 + 8 + 8 = 24 bytes in either mode for this member order. Packing changes the struct alignment from 8 to 1; it does not shrink this particular layout." },
    { id: "jit",     label: "JmpRax — machine code as bytes (jit.h)",
      members: ["u8x16"], pack: true,
      why: "A 16-byte array containing mov rax,imm64; jmp rax plus zero padding. SetFunc writes the eight-byte address at &code[2]; array elements are contiguous." }
  ];

  function computeLayout(memberIds, pack) {
    var off = 0, rows = [], maxAlign = 1;
    memberIds.forEach(function (id, i) {
      var t = LAYOUT_TYPE_MAP[id];
      var al = pack ? 1 : t.align;
      if (al > maxAlign) maxAlign = al;
      var pad = (off % al) ? (al - (off % al)) : 0;
      rows.push({ type: t, offset: off + pad, pad: pad, align: al });
      off = off + pad + t.size;
    });
    var structAlign = pack ? 1 : maxAlign;
    var trailing = (off % structAlign) ? (structAlign - (off % structAlign)) : 0;
    return { rows: rows, size: Math.max(1, off + trailing), structAlign: structAlign, trailing: trailing };
  }

  function toolLayout(root) {
    var state = { members: ["u8", "u64", "u32", "u8"], pack: false };
    var cur = LAYOUT_PRESETS[0];

    root.innerHTML =
      '<div class="pg-controls">' +
      '<label class="pg-mini" style="flex:2">Preset' +
      '<select id="ly-preset" class="pg-sel"></select></label>' +
      '<label class="pg-mini" style="flex:1;justify-content:flex-end"><input type="checkbox" id="ly-pack" ' +
      'class="pg-check"> <code>#pragma pack(1)</code></label>' +
      '</div>' +
      '<div class="pg-row" id="ly-members"></div>' +
      '<div class="pg-row"><button type="button" class="pg-btn" id="ly-add">+ Add member</button>' +
      '<button type="button" class="pg-btn pg-demo" id="ly-reset">↺ Reset preset</button></div>' +
      '<div class="pg-out" id="ly-out"></div>' +
      '<p class="pg-src">Alignment rules as the x86-64 ABI applies them; the packing switch is ' +
      '<code>#pragma pack(1)</code>. Compare <code>src/kernel/memory.h</code> (bitfields + ' +
      '<code>static_assert(sizeof(...) == 72)</code>), <code>src/libs/vaContext.h</code> and ' +
      '<code>src/loader/jit.h</code>.</p>';

    var preset = $("#ly-preset", root), pack = $("#ly-pack", root);
    var membersEl = $("#ly-members", root), out = $("#ly-out", root);
    var curExpect = null;

    LAYOUT_PRESETS.forEach(function (p) {
      var option = el("option", null, p.label);
      option.value = p.id;
      preset.appendChild(option);
    });

    function renderMembers() {
      membersEl.innerHTML = "";
      state.members.forEach(function (id, i) {
        var row = el("div", "ly-row");
        var sel = el("select", "pg-sel");
        LAYOUT_TYPES.forEach(function (t) {
          var o = el("option", null, t.label);
          o.value = t.id;
          if (t.id === id) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () {
          state.members[i] = sel.value; renderMembers(); render();
        });
        var rm = el("button", "pg-btn", "✕");
        rm.type = "button"; rm.title = "Remove member";
        rm.addEventListener("click", function () {
          state.members.splice(i, 1); renderMembers(); render();
        });
        row.appendChild(sel); row.appendChild(rm);
        membersEl.appendChild(row);
      });
    }

    preset.addEventListener("change", function () {
      cur = LAYOUT_PRESETS[preset.selectedIndex];
      curExpect = null;
      state.members = cur.members.slice();
      state.pack = cur.pack;
      pack.checked = cur.pack;
      renderMembers(); render();
    });
    pack.addEventListener("change", function () { state.pack = pack.checked; render(); });
    $("#ly-add", root).addEventListener("click", function () {
      state.members.push("u32"); renderMembers(); render();
    });
    $("#ly-reset", root).addEventListener("click", function () {
      preset.selectedIndex = LAYOUT_PRESETS.indexOf(cur);
      preset.dispatchEvent(new Event("change"));
    });

    function render() {
      var L = computeLayout(state.members, state.pack);
      var N = Math.min(L.size, 96);
      var strip = "", scale = "";
      for (var i = 0; i < N; i++) {
        var owner = -1;
        for (var k = 0; k < L.rows.length; k++) {
          var r = L.rows[k];
          if (i >= r.offset && i < r.offset + r.type.size) { owner = k; break; }
        }
        var cls = owner < 0 ? "pad" : (owner % 2 ? "m2" : "m1");
        var tip = owner < 0 ? "padding byte" :
          L.rows[owner].type.label + " at offset " + L.rows[owner].offset;
        strip += '<span class="ly-byte ' + cls + '" title="byte ' + i + " — " + tip + '"></span>';
        scale += '<span class="ly-off">' + (i % 8 === 0 ? i : "") + "</span>";
      }
      var big = L.size > 96 ? '<p class="pg-dim" style="margin-top:6px">Layout is ' + L.size +
        ' bytes — diagram shows the first 96.</p>' : "";

      var rows = "<tr><th>member</th><th>offset</th><th>size</th><th>align</th><th>padding before</th></tr>";
      L.rows.forEach(function (r) {
        rows += "<tr" + (r.pad ? ' class="pg-warn"' : "") + "><td><code>" + esc(r.type.label) +
          "</code></td><td>" + r.offset + "</td><td>" + r.type.size + "</td><td>" +
          r.align + "</td><td>" + (r.pad ? "<strong>" + r.pad + "</strong>" : "—") + "</td></tr>";
      });

      if (curExpect == null) curExpect = L.size;
      var want = curExpect;
      function assertion(expected) {
        if (!Number.isInteger(expected) || expected < 1 || expected > 4096) return '<p class="pg-hint pg-warntext">Enter an integer size from 1 to 4096.</p>';
        var ok = expected === L.size;
        return '<div class="pg-hint' + (ok ? "" : " pg-warntext") + '"><code>static_assert(' +
          "sizeof(MyStruct) == " + expected + ')</code> → <strong>' + (ok ? "PASS" : "FAIL") +
          "</strong>" + (ok ? " — the layout is exactly " + expected + " bytes." :
            " — sizeof is actually " + L.size + ", not " + expected +
            ". The tree uses this to guarantee ABI layouts (memory.h).") + "</div>";
      }

      out.innerHTML =
        '<div class="ly-wrap"><div class="ly-strip">' + strip + "</div><div class='ly-scale'>" + scale + "</div></div>" + big +
        '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">sizeof</span>' +
        '<span class="pg-stat-n">' + L.size + "</span></div>" +
        '<div class="pg-stat"><span class="pg-stat-l">struct align</span>' +
        '<span class="pg-stat-n">' + L.structAlign + "</span></div>" +
        '<div class="pg-stat"><span class="pg-stat-l">trailing padding</span>' +
        '<span class="pg-stat-n">' + L.trailing + "</span></div></div>" +
        '<table class="pg-table pg-narrow"><tbody>' + rows + "</tbody></table>" +
        '<div class="pg-row" style="margin-top:10px"><label class="pg-mini">Assert exact size' +
        '<input id="ly-expect" class="pg-num" type="number" min="1" max="4096" value="' + (Number.isFinite(want) ? want : '') + '"></label></div>' +
        '<div id="ly-assert">' + assertion(want) + "</div>" +
        '<p class="pg-why"><strong>Preset reference:</strong> ' + esc(cur.why) + '</p>' +
        '<p class="pg-why"><strong>Read the strip left to right.</strong> Grey = a real member; ' +
        'hollow = padding. Packing lowers member alignment to one and can reduce sizeof when padding exists. ' +
        'An empty C++ struct still occupies one byte. This model covers the listed scalar types on x86-64; ' +
        'verify real layouts with sizeof, alignof and offsetof on your compiler.</p>';

      var ne = $("#ly-expect", root);
      ne.addEventListener("input", function () { curExpect = ne.value === '' ? NaN : Number(ne.value); $("#ly-assert", root).innerHTML = assertion(curExpect); });
    }

    renderMembers();
    preset.selectedIndex = 0;
    render();
  }

  /* ============================================================
     B. C++ primer — machine-code patch calculator
     The arithmetic in src/loader/jit.h. A relative jump/call is
     `target - address_of_next_instruction`, stored little-endian
     as a signed 32-bit displacement. SetFunc() writes it with
     *reinterpret_cast<uint32_t*>(&code[N]) = offset32;
     ============================================================ */

  var JIT_STUBS = {
    call9: {
      label: "Call9 — rex.w call rel32; mov rax,rax (jit.h, 9 bytes)",
      opName: "call", op: "E8", opByte: 2, ripByte: 6, nops: 0,
      prefix: "48 E8 ", total: 9,
      suffix: " 48 89 C0"
    },
    tls: {
      label: "TlsRegStub — sub rsp; push rax; call rel32 … (jit.h, 32 bytes)",
      opName: "call", op: "E8", opByte: 9, ripByte: 13, nops: 7,
      prefix: "48 81 EC 80 00 00 00 50 E8 ",
      suffix: " 48 89 C0 58 48 81 C4 80 00 00 00 C3",
      total: 32
    }
  };

  function toolJit(root) {
    root.innerHTML =
      '<div class="pg-controls">' +
      '<label class="pg-mini" style="flex:2">Stub template' +
      '<select id="jit-stub" class="pg-sel"></select></label>' +
      '<label class="pg-mini" style="flex:1">rip — address of the next instruction' +
      '<input id="jit-rip" class="pg-txt" spellcheck="false" value="0x0000000100000000"></label>' +
      '<label class="pg-mini" style="flex:1">target — handler address' +
      '<input id="jit-func" class="pg-txt" spellcheck="false" value="0x0000000100000020"></label>' +
      "</div>" +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="jit-demo-f">▶ Demo: small forward</button>' +
      '<button type="button" class="pg-btn" id="jit-demo-b">Demo: backward</button>' +
      '<button type="button" class="pg-btn" id="jit-demo-far">Demo: far (overflow)</button></div>' +
      '<div class="pg-out" id="jit-out"></div>' +
      '<p class="pg-src">The math is <code>src/loader/jit.h</code> verbatim: ' +
      '<code>auto offset32 = static_cast&lt;uint32_t&gt;(static_cast&lt;uint64_t&gt;(' +
      'func_addr - rip_addr) &amp; 0xffffffffu);</code> then ' +
      '<code>*reinterpret_cast&lt;uint32_t*&gt;(&amp;code[' + "</code>" + '<i>N</i>' +
      '<code>]) = offset32;</code></p>';

    var stubSel = $("#jit-stub", root), rip = $("#jit-rip", root), func = $("#jit-func", root), out = $("#jit-out", root);
    Object.keys(JIT_STUBS).forEach(function (id) {
      var o = el("option", null, JIT_STUBS[id].label); o.value = id; stubSel.appendChild(o);
    });

    function render() {
      try {
        var stub=JIT_STUBS[stubSel.value],r=A.parseAddress(rip.value),t=A.parseAddress(func.value),patch=A.relativePatch(rip.value,func.value);
        out.innerHTML='<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">displacement</span><span class="pg-stat-n">'+patch.displacement+'</span></div>'+
          '<div class="pg-stat"><span class="pg-stat-l">fits signed rel32?</span><span class="pg-stat-n">'+(patch.inRange?'yes':'NO')+'</span></div></div>'+
          '<p class="pg-why">target − next instruction = '+A.hex(t,16)+' − '+A.hex(r,16)+' = '+patch.displacement+'. Exact 64-bit integer arithmetic.</p>'+
          (patch.inRange?'':'<p class="pg-hint pg-warntext">This target cannot be reached by this relative call. The bytes below are the truncated low 32 bits, not a valid call to the requested target.</p>')+
          '<pre data-lang="text">'+esc(stub.prefix.trim()+' '+patch.bytes.join(' ')+(stub.suffix?' '+stub.suffix.trim():'')+(stub.nops?' '+Array(stub.nops).fill('90').join(' '):''))+'</pre>'+
          '<table class="pg-table"><tbody><tr><td>operand starts at</td><td>code['+stub.opByte+']</td></tr><tr><td>next instruction address</td><td>code['+stub.ripByte+']</td></tr><tr><td>signed low 32 bits</td><td>'+patch.signed+'</td></tr></tbody></table>'+
          '<p class="pg-sum">Use the address after the complete call instruction, including its displacement. This calculator does not allocate or execute machine code.</p>';
      } catch(err) { showError(out,err); }
    }

    stubSel.addEventListener("change", render);
    rip.addEventListener("input", render);
    func.addEventListener("input", render);
    $("#jit-demo-f", root).addEventListener("click", function () {
      rip.value = "0x0000000100000000"; func.value = "0x0000000100000020"; render();
    });
    $("#jit-demo-b", root).addEventListener("click", function () {
      rip.value = "0x0000000100001000"; func.value = "0x0000000100000000"; render();
    });
    $("#jit-demo-far", root).addEventListener("click", function () {
      rip.value = "0x0000000100000000"; func.value = "0x0000000180000000"; render();
    });
    render();
  }

  /* ============================================================
     C. C++ primer — crash-log reader
     Parses the forensic dump written by KytyExceptionHandler
     (src/loader/runtimeLinker.cpp) and annotates each
     block. The faulting address is usually a symptom; the stack
     trace at the bottom supplies leads for investigating the cause.
     ============================================================ */

  var NATIVE_CODES = {
    c0000005: "STATUS_ACCESS_VIOLATION",
    c000001d: "STATUS_ILLEGAL_INSTRUCTION",
    c0000094: "STATUS_INTEGER_DIVIDE_BY_ZERO",
    c00000fd: "STATUS_STACK_OVERFLOW",
    c0000409: "STATUS_STACK_BUFFER_OVERRUN"
  };

  var parseCrash = A.parseCrash;

  function renderCrash(o, out) {
    if (!o.summary.addr && !o.summary.fatal && !o.trace.length && !o.summary.thread) {
      out.innerHTML = '<p class="pg-hint pg-warntext">No crash-log lines recognised. ' +
        "Look for a <code>--- Guest fault context ---</code> block.</p>";
      return;
    }
    var h = "";

    var nativeName = NATIVE_CODES[o.summary.native] || "unknown";
    h += '<div class="pg-stats">';
    h += '<div class="pg-stat"><span class="pg-stat-l">' + (o.summary.thread ? "faulting thread" : "faulting module") + '</span><span class="pg-stat-n">' +
      esc(o.summary.thread || o.summary.module || "—") + "</span></div>";
    h += '<div class="pg-stat"><span class="pg-stat-l">access</span><span class="pg-stat-n">' +
      esc(o.summary.av_type || o.summary.type || "—") + "</span></div>";
    h += '<div class="pg-stat"><span class="pg-stat-l">address touched</span><span class="pg-stat-n">' +
      esc(o.summary.av_addr || "—") + "</span></div>";
    h += '<div class="pg-stat"><span class="pg-stat-l">native code</span><span class="pg-stat-n">' +
      (o.summary.native ? esc(o.summary.native) + " · " + esc(nativeName) : "—") + "</span></div>";
    h += "</div>";
    if (o.summary.fatal) h += '<p class="pg-why pg-warntext">' + esc(o.summary.fatal) + "</p>";
    if (o.unpatched) {
      h += '<div class="callout k" style="margin:10px 0"><span class="lbl">Unpatched object</span>' +
        "<p>The write landed on the special <code>g_invalid_memory</code> address — a diagnostic address for a failure " +
        "involving a patched object. The active instruction and patch record " +
        "need inspection before assigning a cause.</p></div>";
    }

    h += '<p class="pg-why"><strong>Cause vs symptom:</strong> the exception happened at ' +
      "<code>" + esc(o.summary.addr || "?") + "</code> because of a " +
      esc(o.summary.av_type || "?") + " to <code>" + esc(o.summary.av_addr || "?") +
      "</code>. To investigate how execution reached it, inspect callers and data flow. Stack words that fall " +
      "inside a loaded module are only candidate return addresses. A <code>Stack trace</code> block, where the " +
      "emulator prints one, supplies frame addresses resolved to module and offset; it still does not identify the cause by itself.</p>";

    if (o.code.length) {
      h += "<h4>Faulting instruction</h4><p class='pg-big' style='font-size:14px'><code>" +
        o.code.map(function (b, i) { return i === o.codeFault ? "<mark>" + esc(b) + "</mark>" : esc(b); }).join(" ") + "</code></p>" +
        '<p class="pg-dim">' + (o.codeFault >= 0
          ? "The 96-byte code window, <code>pc-48 .. pc+48</code>; the highlighted byte is the first byte of the instruction that faulted. Feed the bytes from there onward "
          : "Bytes around the fault. Feed these ") +
        "to any disassembler to recover the exact instruction that died.</p>";
    }

    if (o.stack.length && o.codeFault >= 0) {
      h += "<h4>Stack words</h4><p class='pg-big' style='font-size:12px'><code>" +
        o.stack.map(function (v) { return /^0000000[89A-F]/.test(v) ? "<mark>" + esc(v) + "</mark>" : esc(v); }).join(" ") + "</code></p>" +
        '<p class="pg-dim">32 qwords read upward from <code>rsp</code>. Highlighted values sit in the guest module band ' +
        "(<code>0x8…</code>–<code>0xF…</code>). This is only a range heuristic: validate candidates against loaded executable segments and call instructions.</p>";
    }

    if (o.regs.length) {
      h += "<h4>Registers</h4><table class='pg-table pg-narrow'><tbody>";
      o.regs.forEach(function (r) { h += "<tr><td>" + r.name + "</td><td><code>" + esc(r.value) + "</code></td></tr>"; });
      h += "</tbody></table>";
    }

    if (o.guest.length) {
      h += "<h4>Registers read as guest pointers</h4><table class='pg-table'><thead><tr>" +
        "<th>register</th><th>addr</th><th>offset</th><th>module</th></tr></thead><tbody>";
      o.guest.forEach(function (g) {
        h += "<tr" + (/^\?+$/.test(g.module) ? ' class="pg-warn"' : "") + "><td><code>" + esc(g.reg) +
          "</code></td><td><code>" + esc(g.addr) + "</code></td><td><code>" + esc(g.off) +
          "</code></td><td>" + esc(g.module) + "</td></tr>";
      });
      h += "</tbody></table>";
      h += '<p class="pg-dim">Each register was treated as a pointer into a loaded module. "???" ' +
        "means it did not resolve to a loaded module; it may still be data or another valid address.</p>";
    }

    if (o.trace.length) {
      h += "<h4>Stack trace <span class='pg-dim'>— inspect the callers</span></h4>" +
        "<table class='pg-table'><thead><tr><th>frame</th><th>addr</th><th>offset</th><th>module</th></tr></thead><tbody>";
      o.trace.forEach(function (fr) {
        h += "<tr><td>" + fr.frame + "</td><td><code>" + esc(fr.addr) + "</code></td><td><code>" +
          esc(fr.off) + "</code></td><td>" + esc(fr.module) + "</td></tr>";
      });
      h += "</tbody></table>";
      h += '<p class="pg-sum">Translate a module + offset with the linker map file or a ' +
        "disassembler to get the function names. The first frame is where it crashed; the rest " +
        "are who called it.</p>";
    }

    out.innerHTML = h;
  }

  var DEMO_CRASH = [
    "--- Guest fault context ---",
    "thread: GameMainThread",
    "rax=0000000000000050 rbx=000000090009e000 rcx=0000000000000050 rdx=00000009000a3b40",
    "rsi=0000000900abcd00 rdi=0000000000000000 rbp=0000000900c80000 rsp=0000000900c7f800",
    "r8 =0000000900c7f820 r9 =0000000000000001 r10=0000000900c7f810 r11=0000000000000000",
    "r12=0000000000000000 r13=0000000900c7f830 r14=0000000900c80000 r15=0000000900c80040",
    "code (pc-48 .. pc+48, fault at byte 48):",
    " 55 48 89 e5 48 83 ec 50 48 89 7d f8 48 8b 45 f8 48 8b 5c 24 50 48 8b 03 48 8b 04 18 48 89 04 24",
    " 48 8b 7d f8 48 85 ff 74 08 48 8b 45 e8 48 89 07 48 89 07 48 83 c4 50 5d c3 90 90 90 90 90 90 90",
    " 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90",
    "stack:",
    " 000000090009e000 0000000900c01234 0000000900c7f830 0000000000000050",
    " 0000000900c10000 0000000000000000 0000000900c7f870 0000000000000001",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    " 0000000000000000 0000000000000000 0000000000000000 0000000000000000",
    "--- Error ---",
    "Unhandled host exception: type=1 code=3221225477 pc=0x00000009000a3b4c access=2 address=0x0000000000000000"
  ].join("\n");

  function toolCrash(root) {
    root.innerHTML =
      '<div class="pg-drop" id="crash-drop" tabindex="0" role="button">' +
      '<div class="pg-drop-i">⇩</div>' +
      "<div><strong>Drop a crash log here</strong><br>" +
      '<span class="pg-dim">or click to pick a file</span></div>' +
      '<input type="file" id="crash-file" accept=".txt,.log,text/plain" hidden></div>' +
      '<div class="pg-row"><button type="button" class="pg-btn pg-demo" id="crash-demo">▶ Run demo (sample crash)</button>' +
      '<button type="button" class="pg-btn" id="crash-paste">Paste text instead</button></div>' +
      '<textarea id="crash-ta" class="pg-ta" rows="8" spellcheck="false" hidden ' +
      'placeholder="Paste the crash block of your log here…"></textarea>' +
      '<div class="pg-out" id="crash-out"><p class="pg-hint">Crash logs are free — the emulator ' +
      "writes one whenever guest code faults. Run a title until it dies and copy the block from " +
      "<code>--- Guest fault context ---</code> down to the <code>Unhandled host exception</code> line.</p></div>";

    var out = $("#crash-out", root), drop = $("#crash-drop", root), file = $("#crash-file", root), ta = $("#crash-ta", root);

    function run(text) { try { renderCrash(parseCrash(text), out); } catch(err) { showError(out,err); } }
    function pick(f) {
      if (!f) return;
      if(f.size > A.MAX_TEXT) { showError(out,new Error("Text file exceeds the 2 MiB interactive limit. Extract a smaller artifact.")); return; }
      var r = new FileReader();
      r.onload = function () { run(String(r.result)); };
      r.onerror = function () { showError(out,new Error("Could not read that file.")); };
      r.readAsText(f);
    }
    drop.addEventListener("click", function(e) { if(e.target !== file) file.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    file.addEventListener("change", function () { pick(file.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("pg-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("pg-over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });
    $("#crash-demo", root).addEventListener("click", function () { run(DEMO_CRASH); });
    $("#crash-paste", root).addEventListener("click", function () {
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    ta.addEventListener("input", function () {
      run(ta.value);
    });
  }

  /* ============================================================
     D. C++ primer — RDNA2 shader ISA decoder
     A partial decoder transcribed from the tree's own dispatch
     (src/graphics/shader/recompiler/frontend/decode/ShaderDecoder.cpp)
     and the opcode tables in ScalarAluOps.cpp / VectorAluOps.cpp /
     MemoryOps.cpp / ExportOps.cpp. Covers the common encodings;
     rare encodings are reported with their family + raw fields.
     ============================================================ */



  function rdFmt(r, pc) {
    var s = "0x" + ("00000000" + (pc >>> 0).toString(16)).slice(-8) + ": " + r.name;
    if (r.operands.length) s += "  " + r.operands.join(", ");
    if (r.family === "UNKNOWN") s += "  <unsupported>";
    return s;
  }

  function toolIsa(root) {
    root.innerHTML =
      '<div class="pg-controls">' +
      '<label class="pg-mini" style="flex:1">32-bit instruction words (hex, one per line)<br>' +
      '<textarea id="isa-ta" class="pg-ta" rows="10" spellcheck="false" ' +
      'placeholder="0xBE800380&#10;0x7E0602F2&#10;…"></textarea></label>' +
      "</div>" +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="isa-demo">▶ Run demo shader</button>' +
      '<button type="button" class="pg-btn" id="isa-paste">Paste from .rdna2/.bin hex</button></div>' +
      '<div class="pg-out" id="isa-out"><p class="pg-hint">Words from a shader\'s input ISA — grab the raw dwords from a ' +
      "<code>--shader-log-direction File</code> dump, or decode a word you're curious about. " +
      "Layouts transcribed from <code>ShaderDecoder.cpp</code> + the opcode tables in the decompiler.</p></div>";

    var ta = $("#isa-ta", root), out = $("#isa-out", root), selIdx = 0;

    var parseWords = A.parseWords;

    function render() {
      var ws, rows; try { ws = parseWords(ta.value); rows = A.decodeIsa(ws); } catch(err) { showError(out,err); return; }
      if (!ws.length) {
        out.innerHTML = '<p class="pg-hint pg-warntext">No 32-bit hex words found.</p>';
        return;
      }


      if (selIdx >= rows.length) selIdx = 0;
      var last = rows[rows.length-1];
      var h = '<p class="pg-sum">Inspected ' + rows.length + ' encoding record(s) from ' + ws.length + ' words. Select a row for fields. Register-pair widths, implicit operands and execution semantics are not expanded.</p>';
      if (last.dec.stop) h += '<p class="pg-hint pg-warntext">Stopped at byte ' + last.pc + ': ' + esc(last.dec.warning) + ' Remaining words are not decoded.</p>';
      h += '<table class="pg-table" id="isa-rows"><thead><tr><th>pc</th><th>raw words</th><th>family</th><th>decoded</th></tr></thead><tbody>';
      rows.forEach(function (r, k) {
        h += '<tr data-k="' + k + '"' + (k === selIdx ? ' class="pg-hl"' : "") + "><td>" + r.pc + '</td><td><code>' +
          r.raw.map(function (w) { return "0x" + ("00000000" + w.toString(16)).slice(-8); }).join(" ") +
          "</code></td><td>" + esc(r.dec.family) + "</td><td><code>" + esc(rdFmt(r.dec, r.pc)) + "</code></td></tr>";
      });
      h += "</tbody></table>";

      var d = rows[selIdx].dec;
      h += '<div class="pg-why">' + esc(d.dispatch) + "</div>";
      h += '<h4>Bit fields — ' + esc(d.family) + " · " + esc(d.name) + "</h4>";
      h += '<table class="pg-table pg-narrow"><tbody>';
      h += "<tr><td>raw</td><td><code>" + rows[selIdx].raw.map(function (w) { return "0x" + ("00000000" + w.toString(16)).slice(-8); }).join(" ") + "</code></td></tr>";
      d.fields.forEach(function (f) {
        h += "<tr><td>" + esc(f.n) + " <span class='pg-dim'>(bits " + esc(f.b) + ")</span></td><td>" + esc(String(f.v)) + "</td></tr>";
      });
      h += "</tbody></table>";
      h += '<p class="pg-src">Dispatch logic from <code>ShaderDecoder.cpp</code>; opcode tables from ' +
        "<code>ScalarAluOps.cpp</code>, <code>VectorAluOps.cpp</code>, <code>MemoryOps.cpp</code>, <code>ExportOps.cpp</code>. " +
        "This tool decodes base scalar/vector ALU fields and literal words. Extended and memory families stop with an explicit scope message; use the recompiler’s decoded log for complete instructions.</p>";

      out.innerHTML = h;
      Array.prototype.forEach.call(out.querySelectorAll("#isa-rows tbody tr"), function (tr) {
        tr.tabIndex = 0; tr.setAttribute("aria-label", "Inspect instruction at byte " + rows[+tr.dataset.k].pc);
        function select() { selIdx = +tr.dataset.k; render(); out.querySelectorAll("#isa-rows tbody tr")[selIdx].focus({preventScroll:true}); }
        tr.addEventListener("click", select);
        tr.addEventListener("keydown", function(e) { if(e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
      });
    }

    $("#isa-demo", root).addEventListener("click", function () {
      ta.value = [
        "0xBE800380", // s_mov_b32 s0, 0        (SOP1, inline 0)
        "0xBE820304", // s_mov_b32 s2, s4
        "0x7E0602F2", // v_mov_b32 v3, 1.0 (inline selector 242)
        "0x06000200", // v_add_f32 v0, v0, v1   (VOP2)
        "0x10040200", // v_mul_f32 v2, v0, v1
        "0x7C020200", // v_cmp_lt_f32 vcc, v0, v1 (VOPC)
        "0xBF820001", // s_branch +4            (SOPP)
        "0xBF810000"  // s_endpgm
      ].join("\n");
      render();
    });
    $("#isa-paste", root).addEventListener("click", function () {
      render(); ta.focus();
    });
    ta.addEventListener("input", render);
    $("#isa-demo", root).click();
  }

  /* ============================================================
     E. C++ primer — shader artifact reader
     Accepts current binary artifacts, decoded log excerpts and imported text:
       .rdna2  decoded input ISA text (or the corresponding run-log excerpt)
       .spvasm disassembly produced by an external SPIR-V tool
       .spv    the SPIR-V binary
       raw 32-bit ISA words
     ============================================================ */

  var SPV_OPS = A.data.spirv;

  function renderTop(list, n) {
    var h = "<h4>Top " + n + " " + (list.length === 1 ? "op" : "ops") + "</h4>";
    h += '<table class="pg-table pg-narrow"><tbody>';
    list.slice(0, n).forEach(function (e) {
      h += "<tr><td>" + esc(e.name) + "</td><td><code>" + e.n + "</code></td></tr>";
    });
    h += "</tbody></table>";
    return h;
  }
  function freqCount(counts) {
    var arr = Object.keys(counts).map(function (k) { return { name: k, n: counts[k] }; });
    arr.sort(function (a, b) { return b.n - a.n; });
    return arr;
  }

  function summaryRdna2(text) {
    var counts = {}, total = 0, control = 0, memory = 0;
    text.split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*0x[0-9a-f]{8}:\s*([a-z_][a-z0-9_]*)/i);
      if (!m) return;
      var op = m[1].toLowerCase();
      counts[op] = (counts[op] || 0) + 1; total++;
      if (/^(s_branch|s_cbranch)/.test(op)) control++;
      if (/^(buffer_|image_|ds_|flat_|tbuffer_|s_buffer_|s_load|s_store|s_scratch)/.test(op)) memory++;
    });
    var h = '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">instructions</span>' +
      '<span class="pg-stat-n">' + total + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">control flow</span><span class="pg-stat-n">' + control + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">memory ops</span><span class="pg-stat-n">' + memory + "</span></div></div>";
    h += '<p class="pg-why">This is the <strong>decoded input ISA</strong> (a recompiler log excerpt or imported <code>*.rdna2</code>) — what the recompiler ' +
      "starts from. Control-flow instructions (<code>s_branch*</code>) are the reason the structuriser has to " +
      "recover block structure; memory ops are the ones that need descriptors.</p>";
    if (total) h += renderTop(freqCount(counts), 10);
    return h;
  }

  function summarySpvasm(text) {
    var counts = {}, total = 0, funcs = 0, labels = 0, entry = 0;
    text.split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*(?:%[A-Za-z0-9_]+\s*=\s*)?(Op[A-Za-z0-9]+)\b/);
      if (!m) return;
      var op = m[1];
      counts[op] = (counts[op] || 0) + 1; total++;
      if (op === "OpFunction") funcs++;
      if (op === "OpLabel") labels++;
      if (op === "OpEntryPoint") entry++;
    });
    var h = '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">ops</span>' +
      '<span class="pg-stat-n">' + total + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">functions</span><span class="pg-stat-n">' + funcs + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">labels (blocks)</span><span class="pg-stat-n">' + labels + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">entry points</span><span class="pg-stat-n">' + entry + "</span></div></div>";
    h += '<p class="pg-why">This is the <strong>SPIR-V disassembly</strong> (<code>*.spvasm</code>) — what Vulkan will ' +
      "receive as compiler input. Labels identify basic blocks; compare them with the branches in the " +
      "input ISA while following how the recompiler restructures control flow. Counts alone do not establish correctness.</p>";
    if (total) h += renderTop(freqCount(counts), 12);
    return h;
  }

  function summarySpvBin(words) {
    var parsed=A.parseSpirv(words),counts={};
    parsed.instructions.forEach(function(i) { var name=SPV_OPS[i.opcode] || 'Op_'+i.opcode; counts[name]=(counts[name]||0)+1; });
    return '<p class="pg-sum">SPIR-V '+parsed.version+' · ID bound '+parsed.bound+' · '+parsed.instructions.length+' instructions</p>' +
      '<p>Instruction headers store word count in the high 16 bits and opcode in the low 16 bits. Structural inspection does not validate types, control flow or Vulkan compatibility.</p>'+renderTop(freqCount(counts),12);
  }
  function summaryWords(text) {
    var ws=Array.isArray(text)?text:A.parseWords(text),rows=A.decodeIsa(ws);
    if(!ws.length)throw new Error('No hex words found.');
    var last=rows[rows.length-1],h='<p class="pg-sum">'+rows.length+' encoding record(s) inspected.</p>';
    if(last.dec.stop)h+='<p class="pg-hint pg-warntext">Stopped at byte '+last.pc+': '+esc(last.dec.warning)+'</p>';
    return h+'<table class="pg-table"><thead><tr><th>Byte offset</th><th>Encoding</th></tr></thead><tbody>'+rows.map(function(r) { return '<tr><td>'+r.pc+'</td><td>'+esc(rdFmt(r.dec,r.pc))+'</td></tr>'; }).join('')+'</tbody></table>';
  }

  var DEMO_SPVASM = [
    "; SPIR-V",
    "OpCapability Shader",
    "%1 = OpExtInstImport \"GLSL.std.450\"",
    "OpMemoryModel Logical GLSL450",
    "OpEntryPoint Vertex %main \"main\" %POSITION %outUV %gl_VertexIndex",
    "OpSource GLSL 450",
    "OpName %main \"main\"",
    "OpDecorate %gl_VertexIndex BuiltIn VertexIndex",
    "OpDecorate %POSITION Location 0",
    "%void = OpTypeVoid",
    "%fn = OpTypeFunction %void",
    "%float = OpTypeFloat 32",
    "%v4 = OpTypeVector %float 4",
    "%v2 = OpTypeVector %float 2",
    "%int = OpTypeInt 32 1",
    "%ptr_in = OpTypePointer Input %v4",
    "%POSITION = OpVariable %ptr_in Input",
    "%ptr_idx = OpTypePointer Input %int",
    "%gl_VertexIndex = OpVariable %ptr_idx Input",
    "%ptr_v2out = OpTypePointer Output %v2",
    "%outUV = OpVariable %ptr_v2out Output",
    "%main = OpFunction %void None %fn",
    "%entry = OpLabel",
    "%ix = OpLoad %int %gl_VertexIndex",
    "OpReturn",
    "OpFunctionEnd"
  ].join("\n");

  var DEMO_RDNA2 = [
    "0x00000000: s_mov_b32 s0, 0 ; family=SOP1 opcode=0x03 raw=[0xbe800380]",
    "0x00000004: v_mov_b32 v3, 1.0 ; family=VOP1 opcode=0x01 raw=[0x7e0602f2]",
    "0x00000008: v_add_f32 v0, v0, v1 ; family=VOP2 opcode=0x03 raw=[0x06000200]",
    "0x0000000c: v_mul_f32 v2, v0, v1 ; family=VOP2 opcode=0x08 raw=[0x10040200]",
    "0x00000010: v_cmp_lt_f32 vcc, v0, v1 ; family=VOPC opcode=0x01 raw=[0x7c020200]",
    "0x00000014: s_cbranch_vccz 0x0000001c ; family=SOPP opcode=0x06 raw=[0xbf860001]",
    "0x00000018: s_endpgm ; family=SOPP opcode=0x01 raw=[0xbf810000]",
    "0x0000001c: exp mrt0, v0, v1, v2, v3 done ; family=EXP target=0x00 raw=[0xf8001c01 0x00020100]"
  ].join("\n");

  function toolShaderLog(root) {
    root.innerHTML =
      '<div class="pg-drop" id="shl-drop" tabindex="0" role="button">' +
      '<div class="pg-drop-i">⇩</div>' +
      "<div><strong>Drop a shader artifact here</strong><br>" +
      '<span class="pg-dim">.bin · .spv · decoded ISA text · .spvasm · raw hex words</span></div>' +
      '<input type="file" id="shl-file" accept=".bin,.rdna2,.spvasm,.spv,.txt,.log,text/plain" hidden></div>' +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="shl-demo-isa">▶ Demo: decoded ISA</button>' +
      '<button type="button" class="pg-btn" id="shl-demo-spv">Demo: .spvasm</button>' +
      '<button type="button" class="pg-btn" id="shl-demo-words">Demo: raw words</button>' +
      '<button type="button" class="pg-btn" id="shl-paste">Paste text</button></div>' +
      '<textarea id="shl-ta" class="pg-ta" rows="6" spellcheck="false" hidden ' +
      'placeholder="Paste a shader artifact here…"></textarea>' +
      '<div class="pg-out" id="shl-out"><p class="pg-hint">Generate these with ' +
      "<code>--graphics-debug-dump true --shader-log-direction File --shader-log-folder _Shaders</code> " +
      "— binary SPIR-V goes to <code>_Shaders/</code>, input ISA to <code>_Shaders/original/*.bin</code>. Decoded ISA and IR appear in the run log; SPIR-V text can be produced with spirv-dis.</p></div>";

    var out = $("#shl-out", root), drop = $("#shl-drop", root), file = $("#shl-file", root), ta = $("#shl-ta", root);

    function runText(text, name) {
      try {
      if(text.length>A.MAX_TEXT)throw new Error("Text exceeds the 2 MiB interactive limit.");
      if(!text.trim()){out.textContent="Paste a shader artifact or choose a demo.";return;}
      var t = text.slice(0, 1200);
      var h = '<div class="pg-file">' + esc(name || "pasted text") + "</div>";
      if (/^\s*(?:%[A-Za-z0-9_]+\s*=\s*)?Op[A-Za-z0-9]+\b/m.test(t)) h += summarySpvasm(text);
      else if (/^\s*0x[0-9a-f]{8}:\s*[a-z_][a-z0-9_]*/im.test(t)) h += summaryRdna2(text);
      else h += summaryWords(text);

      out.innerHTML = h;
      } catch(err) { showError(out,err); }
    }
    function runBuf(buf, name, isIsa) {
      try { var words=A.wordsFromBuffer(buf,!isIsa); out.innerHTML='<div class="pg-file">'+esc(name)+'</div>'+(isIsa?summaryWords(words):summarySpvBin(words)); }
      catch(err) { showError(out,err); }
    }

    function pick(f) {
      if (!f) return;
      if(f.size > A.MAX_FILE) { showError(out,new Error("File exceeds the 64 MiB interactive limit. Extract a smaller artifact.")); return; }
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      var limit = ext === 'spv' || ext === 'bin' ? A.MAX_WORDS * 4 : A.MAX_TEXT;
      if(f.size > limit) { showError(out,new Error('Shader artifact exceeds the interactive limit ('+limit+' bytes). Extract a smaller text block or use offline tools.')); return; }
      if (ext === "spv" || ext === "bin") {
        var r = new FileReader();
        r.onload = function () { runBuf(r.result, f.name, ext === "bin"); };
        r.onerror = function () { showError(out,new Error("Could not read that file.")); };
        r.readAsArrayBuffer(f);
      } else {
        var r2 = new FileReader();
        r2.onload = function () { runText(String(r2.result), f.name); };
        r2.onerror = function () { showError(out,new Error("Could not read that file.")); };
        r2.readAsText(f);
      }
    }
    drop.addEventListener("click", function(e) { if(e.target !== file) file.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    file.addEventListener("change", function () { pick(file.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("pg-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("pg-over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });
    $("#shl-demo-isa", root).addEventListener("click", function () { runText(DEMO_RDNA2, "decoded ISA with raw annotations (synthetic)"); });
    $("#shl-demo-spv", root).addEventListener("click", function () { runText(DEMO_SPVASM, "sample-vs.spvasm (demo)"); });
    $("#shl-demo-words", root).addEventListener("click", function () { runText("0xBE800380 0x7E0602F2 0x06000200 0x10040200 0x7C020200 0xBF820001 0xBF810000", "raw words (demo)"); });
    $("#shl-paste", root).addEventListener("click", function () {
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    ta.addEventListener("input", function () { runText(ta.value, "pasted text"); });
  }

  /* ============================================================
     F. C++ primer — buffer & sampler descriptor decoder
     V# (buffer) layout verified against SrtWalker.cpp (stride =
     (hi>>16)&0x3fff); S# (sampler), fields from shaderBindings.h and enums from gpu_defs.h.
     ============================================================ */

  var CLAMPS = ["kWrap", "kMirror", "kClampLastTexel", "kMirrorOnceLastTexel", "kClampHalfBorder", "kMirrorOnceHalfBorder", "kClampBorder", "kMirrorOnceBorder"];
  var ANISO = ["kOne", "kTwo", "kFour", "kEight", "kSixteen"];
  var SFILT = ["kPoint", "kBilinear", "kAnisoPoint", "kAnisoLinear"];
  var MFILT = ["kNone", "kPoint", "kLinear"];
  var BCOL = ["kTransBlack", "kOpaqueBlack", "kOpaqueWhite", "kFromTable"];

  function toolDesc(root) {
    root.innerHTML='<div class="pg-controls"><label class="pg-mini">Descriptor kind<select id="dc-kind" class="pg-sel"><option value="V">V# — buffer</option><option value="S">S# — sampler</option></select></label>'+
      '<div class="pg-descriptor-words">'+[0,1,2,3].map(function(i){return '<label class="pg-mini">WORD'+i+'<input id="dc-w'+i+'" class="pg-txt" spellcheck="false" value="00000000"></label>';}).join('')+'</div></div>'+
      '<div class="pg-row"><button type="button" class="pg-btn" id="dc-demo-v">Demo: V# vertex buffer</button> <button type="button" class="pg-btn" id="dc-demo-t">Demo: S# sampler</button></div><div class="pg-out" id="dc-out"></div>'+
      '<p class="pg-src">Fields follow <code>src/graphics/shader/shaderBindings.h</code>, <code>ShaderBufferResource</code> / <code>ShaderSamplerResource</code>. Names come from <code>gpu_defs.h</code>. T# images use eight words and are outside this four-word inspector.</p>';
    var kindSel=$('#dc-kind',root),out=$('#dc-out',root),inputs=[0,1,2,3].map(function(i){return $('#dc-w'+i,root);});
    function name(table,id){return table[id]||'reserved / unknown ('+id+')';}
    function render(){
      try {
        var w=inputs.map(function(input){if(!/^(?:0x)?[0-9a-f]{1,8}$/i.test(input.value.trim()))throw new Error('Enter one 32-bit hex word per field.');return Number(A.parseAddress(input.value))>>>0;}),rows=[],intro;
        if(kindSel.value==='V'){
          var d=A.bufferDescriptor(w);
          intro='Base '+A.hex(d.base,12)+' · '+d.size.toLocaleString()+' bytes';
          rows=[['base address','W0 + W1[0:15]',A.hex(d.base,12)],['stride','W1[16:29]',d.stride+' bytes'],['records','all 32 bits of W2',d.records],['byte range','stride == 0 ? records : stride × records',d.size],['format','W3[12:18]',name(A.data.bufferFormats,d.format)],['type','W3[30:31]',d.type],['out-of-bounds selector','W3[28:29]',d.outOfBounds],['swizzle enabled','W1[31]',d.swizzle?'yes':'no']];
        }else{
          var d=A.samplerDescriptor(w);intro='Clamp '+name(CLAMPS,d.clamp[0])+' · magnification '+name(SFILT,d.mag);
          rows=[['clamp X / Y / Z','W0[0:2] / [3:5] / [6:8]',d.clamp.map(function(x){return name(CLAMPS,x);}).join(' / ')],['anisotropy','W0[9:11]',name(ANISO,d.aniso)],['comparison function','W0[12:14]',d.compare],['magnification / minification','W2[20:21] / [22:23]',name(SFILT,d.mag)+' / '+name(SFILT,d.min)],['mip filter','W2[26:27]',name(MFILT,d.mip)],['LOD range (raw U4.8)','W1[0:11] / [12:23]',d.minLod+' / '+d.maxLod+' → '+(d.minLod/256)+' / '+(d.maxLod/256)],['border color','W3[30:31]',name(BCOL,d.border)]];
        }
        out.innerHTML='<p class="pg-why">'+esc(intro)+'</p><table class="pg-table"><thead><tr><th>Field</th><th>Bits / rule</th><th>Value</th></tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(v){return '<td>'+esc(String(v))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>'+
          '<p class="pg-sum">These are decoded fields, not proof that the descriptor is legal, mapped, bound or safe to use. Buffer addressing also depends on instruction modes, swizzling and bounds rules; a sampler contains filtering state, not an image address.</p>';
      }catch(err){showError(out,err);}
    }
    kindSel.addEventListener('change',render);inputs.forEach(function(i){i.addEventListener('input',render);});
    function preset(kind,words){kindSel.value=kind;inputs.forEach(function(i,n){i.value=A.hex(words[n]);});render();}
    $('#dc-demo-v',root).onclick=function(){preset('V',[0x80000000,0x00200001,300,0x00038000]);};
    $('#dc-demo-t',root).onclick=function(){preset('S',[0x00000204,0x00400000,0x08500000,0x40000000]);};
    $('#dc-demo-v',root).click();
  }


  var TOOLS = {
    "pg-pm4": toolPm4,
    "pg-id64": toolId64,
    "pg-elf": toolElf,
    "pg-log": toolLog,
    "pg-layout": toolLayout,
    "pg-jit": toolJit,
    "pg-crash": toolCrash,
    "pg-isa": toolIsa,
    "pg-shl": toolShaderLog,
    "pg-desc": toolDesc
  };

  function boot() {
    Object.keys(TOOLS).forEach(function (id) {
      var n = document.getElementById(id);
      if (!n) return;
      try { TOOLS[id](n); }
      catch (err) {
        n.innerHTML = '<p class="pg-hint pg-warntext">This tool failed to start: ' +
          esc(err.message) + " — try a hard refresh (Ctrl+Shift+R).</p>";
        if (window.console) console.error(id, err);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
