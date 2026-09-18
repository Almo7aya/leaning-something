/* ============================================================
   KytyPS5 Playground — tools that work on YOUR artifacts.
   Every constant here is copied from the emulator source, not
   recalled; the source file + line is cited on each tool.
   ============================================================ */
(function () {
  "use strict";

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
     Encoding from src/graphics/guest_gpu/pm4.h:13-18
       cmd = 0xC0000000
           | (((len - 2) & 0x3FFF) << 16)
           | ((op & 0xFF) << 8)
           | ((r & (R_NUM-1)) << 2)     // R_NUM = 0x40  (pm4.h:92)
     ============================================================ */

  var IT = {
    0x10: "IT_NOP", 0x11: "IT_SET_BASE", 0x12: "IT_CLEAR_STATE",
    0x13: "IT_INDEX_BUFFER_SIZE", 0x15: "IT_DISPATCH_DIRECT",
    0x16: "IT_DISPATCH_INDIRECT", 0x20: "IT_SET_PREDICATION",
    0x22: "IT_COND_EXEC", 0x24: "IT_DRAW_INDIRECT",
    0x25: "IT_DRAW_INDEX_INDIRECT", 0x26: "IT_INDEX_BASE",
    0x27: "IT_DRAW_INDEX_2", 0x28: "IT_CONTEXT_CONTROL",
    0x2A: "IT_INDEX_TYPE", 0x2C: "IT_DRAW_INDIRECT_MULTI",
    0x2D: "IT_DRAW_INDEX_AUTO", 0x2F: "IT_NUM_INSTANCES",
    0x33: "IT_INDIRECT_BUFFER_CNST", 0x35: "IT_DRAW_INDEX_OFFSET_2",
    0x37: "IT_WRITE_DATA", 0x38: "IT_DRAW_INDEX_INDIRECT_MULTI",
    0x39: "IT_MEM_SEMAPHORE", 0x3A: "IT_DISPATCH_DRAW_PREAMBLE",
    0x3F: "IT_INDIRECT_BUFFER", 0x40: "IT_COPY_DATA", 0x41: "IT_CP_DMA",
    0x42: "IT_PFP_SYNC_ME", 0x43: "IT_SURFACE_SYNC", 0x46: "IT_EVENT_WRITE",
    0x47: "IT_EVENT_WRITE_EOP", 0x48: "IT_EVENT_WRITE_EOS",
    0x49: "IT_RELEASE_MEM", 0x50: "IT_DMA_DATA", 0x58: "IT_ACQUIRE_MEM",
    0x59: "IT_REWIND", 0x63: "IT_SET_SH_REG_INDIRECT",
    0x64: "IT_SET_UCONFIG_REG_INDIRECT", 0x68: "IT_SET_CONFIG_REG",
    0x69: "IT_SET_CONTEXT_REG", 0x76: "IT_SET_SH_REG",
    0x78: "IT_SET_QUEUE_REG", 0x79: "IT_SET_UCONFIG_REG",
    0x7A: "IT_SET_UCONFIG_REG_INDEX"
  };

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

  function decodePm4(dwords) {
    var out = [], i = 0, guard = 0;
    while (i < dwords.length && guard++ < 4096) {
      var cmd = dwords[i] >>> 0;
      var type = cmd >>> 30;
      var rec = { at: i, raw: cmd, type: type };

      if (type === 3) {
        rec.len = ((cmd >>> 16) & 0x3fff) + 2;
        rec.op = (cmd >>> 8) & 0xff;
        rec.r = (cmd >>> 2) & 0x3f;
        rec.name = IT[rec.op] || "IT_UNKNOWN_" + hex(rec.op, 2);
        rec.note = IT_NOTE[rec.op] || null;
        rec.payload = dwords.slice(i + 1, i + rec.len);
        rec.short = rec.payload.length < rec.len - 1;
        i += rec.len;
      } else if (type === 2) {
        // A bare type-2 dword is a filler/NOP. graphicsRun accepts trailing ones.
        rec.len = 1;
        rec.name = "TYPE-2 filler";
        rec.note = "Single-dword padding. Trailing type-2 packets are tolerated at " +
                   "the end of a command buffer.";
        rec.payload = [];
        i += 1;
      } else {
        rec.len = 1;
        rec.name = "TYPE-" + type + " (not used by this GPU)";
        rec.payload = [];
        i += 1;
        rec.bad = true;
      }
      out.push(rec);
    }
    return out;
  }

  function parseDwords(text) {
    var toks = String(text).split(/[^0-9a-fA-FxX]+/).filter(Boolean);
    var out = [];
    toks.forEach(function (t) {
      var v = t.replace(/^0[xX]/, "");
      if (!/^[0-9a-fA-F]{1,8}$/.test(v)) return;
      out.push(parseInt(v, 16) >>> 0);
    });
    return out;
  }

  function encodePm4(len, op, r) {
    return (0xc0000000 | (((len - 2) & 0x3fff) << 16) | ((op & 0xff) << 8) | ((r & 0x3f) << 2)) >>> 0;
  }

  var PM4_PRESETS = {
    draw: {
      label: "A minimal non-indexed draw",
      text: "C0012D00 00000003 00000002\nC0001000 00000000",
      why: "IT_DRAW_INDEX_AUTO (0x2D) with len 3: header + vertex count + draw-initiator. " +
           "Then a NOP. This is the smallest thing that puts a triangle on screen."
    },
    ctx: {
      label: "Two CONTEXT register writes",
      text: "C0026900 000000C0 3F800000 00000000",
      why: "IT_SET_CONTEXT_REG (0x69), len 4: one register offset (0xC0) followed by " +
           "two values written to consecutive registers."
    },
    release: {
      label: "Release-mem (GPU → CPU signal)",
      text: "C0044900 00000004 40000000 DEADBEEF 00000001 00000000",
      why: "IT_RELEASE_MEM (0x49). The CPU-side fence the emulator turns into a Vulkan " +
           "timeline semaphore signal."
    },
    mixed: {
      label: "A realistic little stream",
      text:
        "C0001000 00000000\n" +
        "C0027900 00000242 00000004 00000000\n" +
        "C0026900 000000C0 3F800000 00000000\n" +
        "C0012D00 00000003 00000002\n" +
        "C0044900 00000004 40000000 CAFEBABE 00000001 00000000",
      why: "NOP, a UCONFIG write, a CONTEXT write, the draw, then the release. " +
           "Roughly the shape of one real draw's worth of packets."
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
      '<p class="pg-src">Encoding from <code>src/graphics/guest_gpu/pm4.h:13–18</code>; ' +
      'opcode table from <code>pm4.h:22–64</code>.</p>';

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
      var cmd = encodePm4(len, op, r);
      var pad = [];
      for (var i = 0; i < len - 1; i++) pad.push("00000000");
      inp.value = hex(cmd).slice(2) + (pad.length ? " " + pad.join(" ") : "");
      render("Encoded " + (IT[op] || hex(op, 2)) + " with len " + len + " → " + hex(cmd) +
        ". Payload dwords are zeroed; edit them above and it re-decodes.");
    });

    function render(why) {
      var dw = parseDwords(inp.value);
      if (!dw.length) {
        out.innerHTML = '<p class="pg-hint">Paste hex dwords, pick a preset, or encode a packet above.</p>';
        return;
      }
      var recs = decodePm4(dw);
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
        (bad ? " · <span class=\"pg-warntext\">" + bad + " look malformed</span>" : " · all well-formed") +
        "</p>";
      out.innerHTML = html;
    }

    inp.addEventListener("input", function () { render(null); });
    inp.value = PM4_PRESETS.mixed.text;
    render(PM4_PRESETS.mixed.why);
  }

  /* ============================================================
     2. Module / library ID encoder  (EncodeId64)
     Verbatim from src/loader/runtimeLinker.cpp:846-860
     ============================================================ */

  var ID64_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";

  function encodeId64(id) {
    id = id & 0xffff;
    var s = "";
    if (id < 0x40) {
      s += ID64_ALPHA[id];
    } else if (id < 0x1000) {
      s += ID64_ALPHA[(id >> 6) & 0x3f];
      s += ID64_ALPHA[id & 0x3f];
    } else {
      s += ID64_ALPHA[(id >> 12) & 0x3f];
      s += ID64_ALPHA[(id >> 6) & 0x3f];
      s += ID64_ALPHA[id & 0x3f];
    }
    return s;
  }

  function decodeId64(str) {
    var v = 0;
    for (var i = 0; i < str.length; i++) {
      var d = ID64_ALPHA.indexOf(str[i]);
      if (d < 0) return null;
      v = (v << 6) | d;
    }
    return v & 0xffff;
  }

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
      '<p class="pg-src">Verbatim from <code>src/loader/runtimeLinker.cpp:846–860</code>. ' +
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
      var v = Math.max(0, Math.min(65535, +num.value || 0));
      rng.value = v; str.value = encodeId64(v); show(v);
    }
    function fromStr() {
      var v = decodeId64(str.value.trim());
      if (v == null) {
        out.innerHTML = '<p class="pg-hint pg-warntext">“' + esc(str.value) +
          '” contains a character outside the 64-symbol alphabet.</p>';
        return;
      }
      num.value = v; rng.value = v; show(v);
    }
    num.addEventListener("input", fromNum);
    rng.addEventListener("input", function () { num.value = rng.value; fromNum(); });
    str.addEventListener("input", fromStr);
    num.value = 4200; fromNum();
  }

  /* ============================================================
     3. ELF / SELF inspector — drop a real module from your dumps
     Sony constants from src/loader/elf.h:57-101
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
    0xfe10: "ET_SCE_STUBLIB", 0xfe18: "ET_SCE_DYNEXEC", 0xfe1c: "ET_SCE_DYNAMIC"
  };

  function flagStr(f) {
    return ((f & 4) ? "R" : "-") + ((f & 2) ? "W" : "-") + ((f & 1) ? "X" : "-");
  }

  function parseElf(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 64) throw new Error("File is too small to be an ELF.");

    var off = 0, selfHdr = null;
    var m0 = dv.getUint32(0, true);
    // SELF files wrap the ELF. Detect the Sony container magic and locate the ELF inside.
    if (m0 === 0x1d3d154f || m0 === 0x4f153d1d) {
      selfHdr = { magic: hex(m0) };
      // Scan for the inner ELF magic rather than trusting a header layout we can't verify.
      for (var s = 0; s < Math.min(buf.byteLength - 4, 0x4000); s += 4) {
        if (dv.getUint32(s, false) === 0x7f454c46) { off = s; break; }
      }
      if (!off) throw new Error("Looks like a SELF, but no unencrypted ELF header was found inside. " +
        "Retail SELFs are encrypted — use a decrypted/FSELF module.");
    } else if (dv.getUint32(0, false) !== 0x7f454c46) {
      throw new Error("Not an ELF: magic is " + hex(dv.getUint32(0, false)) + ", expected 0x7F454C46.");
    }

    var cls = dv.getUint8(off + 4);
    if (cls !== 2) throw new Error("Only 64-bit ELF (ELFCLASS64) is supported; this is class " + cls + ".");

    var e = {
      selfHdr: selfHdr,
      elfOffset: off,
      type: dv.getUint16(off + 16, true),
      machine: dv.getUint16(off + 18, true),
      entryLo: dv.getUint32(off + 24, true),
      entryHi: dv.getUint32(off + 28, true),
      phoff: dv.getUint32(off + 32, true) + dv.getUint32(off + 36, true) * 4294967296,
      phentsize: dv.getUint16(off + 54, true),
      phnum: dv.getUint16(off + 56, true),
      phdrs: []
    };

    for (var i = 0; i < e.phnum; i++) {
      var p = off + e.phoff + i * e.phentsize;
      if (p + 56 > buf.byteLength) break;
      e.phdrs.push({
        type: dv.getUint32(p, true),
        flags: dv.getUint32(p + 4, true),
        offset: dv.getUint32(p + 8, true) + dv.getUint32(p + 12, true) * 4294967296,
        vaddrLo: dv.getUint32(p + 16, true),
        vaddrHi: dv.getUint32(p + 20, true),
        filesz: dv.getUint32(p + 32, true) + dv.getUint32(p + 36, true) * 4294967296,
        memsz: dv.getUint32(p + 40, true) + dv.getUint32(p + 44, true) * 4294967296,
        align: dv.getUint32(p + 48, true) + dv.getUint32(p + 52, true) * 4294967296
      });
    }

    // Walk PT_DYNAMIC for the Sony DT_OS_* tags.
    e.dyn = [];
    var dynSeg = e.phdrs.filter(function (p) { return p.type === 2; })[0];
    if (dynSeg && dynSeg.filesz) {
      var d = off + dynSeg.offset, end = Math.min(d + dynSeg.filesz, buf.byteLength);
      while (d + 16 <= end) {
        var tagLo = dv.getUint32(d, true), tagHi = dv.getUint32(d + 4, true);
        var valLo = dv.getUint32(d + 8, true), valHi = dv.getUint32(d + 12, true);
        if (tagLo === 0 && tagHi === 0) break;
        e.dyn.push({ tagLo: tagLo, tagHi: tagHi, valLo: valLo, valHi: valHi });
        d += 16;
      }
    }
    return e;
  }

  function renderElf(e, name, out) {
    var h = "";
    h += '<div class="pg-file">' + esc(name) + "</div>";

    if (e.selfHdr) {
      h += '<p class="pg-why">This is a <strong>SELF</strong> container (magic ' + e.selfHdr.magic +
        "). Found an unencrypted ELF at offset " + hex(e.elfOffset) + " inside it.</p>";
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

    if (ET[e.type] && /SCE/.test(ET[e.type])) {
      h += '<p class="pg-why">The <code>ET_SCE_*</code> type is the first hard signal that this ' +
        "is a Sony module rather than a stock ELF — a normal loader would reject it outright.</p>";
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
      .reduce(function (a, p) { return a + p.memsz; }, 0);
    h += '<p class="pg-sum">Loadable footprint: <strong>' +
      (totalMem / 1024).toFixed(1) + " KB</strong> across " +
      e.phdrs.filter(function (p) { return p.type === 1; }).length +
      " PT_LOAD segments. That is what the emulator has to reserve inside the guest " +
      "address band before a single instruction runs.</p>";

    out.innerHTML = h;
  }

  // A tiny synthetic PS5-flavoured module so the tool demos with no file.
  function demoElf() {
    var buf = new ArrayBuffer(0x400);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    u8[0] = 0x7f; u8[1] = 0x45; u8[2] = 0x4c; u8[3] = 0x46;
    u8[4] = 2; u8[5] = 1; u8[6] = 1; u8[7] = 0;
    dv.setUint16(16, 0xfe18, true);   // ET_SCE_DYNEXEC
    dv.setUint16(18, 0x3e, true);     // x86-64
    dv.setUint32(24, 0x00081000, true); dv.setUint32(28, 0, true); // entry
    dv.setUint32(32, 64, true); dv.setUint32(36, 0, true);         // phoff
    dv.setUint16(54, 56, true);       // phentsize
    dv.setUint16(56, 5, true);        // phnum

    var segs = [
      { t: 1,          f: 5, va: 0x00080000, fs: 0x21000, ms: 0x21000, al: 0x4000, off: 0x0 },
      { t: 1,          f: 6, va: 0x000a1000, fs: 0x03000, ms: 0x05000, al: 0x4000, off: 0x21000 },
      { t: 2,          f: 4, va: 0x000a3000, fs: 0x100,   ms: 0x100,   al: 8,      off: 0x100 },
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

    // A few dynamic entries at file offset 0x100, incl. real Sony tags.
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
      var p = 0x100 + i * 16;
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
      "<code>src/loader/elf.h:57–101</code>.</p>";

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
      var r = new FileReader();
      r.onload = function () { handle(r.result, f.name); };
      r.onerror = function () {
        out.innerHTML = '<p class="pg-hint pg-warntext">Could not read that file.</p>';
      };
      r.readAsArrayBuffer(f);
    }

    drop.addEventListener("click", function () { file.click(); });
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

  var LOG_RULES = [
    { key: "unresolved", re: /unresolved|not found|can't resolve|cannot resolve/i,
      label: "Unresolved imports",
      why: "A NID the runtime linker could not match to an HLE implementation. Each one is a " +
           "concrete, self-contained thing you could go implement." },
    { key: "unimpl", re: /unimplemented|not implemented|stub|TODO/i,
      label: "Unimplemented calls",
      why: "The symbol resolved, but the body is a stub. These usually fail softly until " +
           "something depends on the return value." },
    { key: "unknown", re: /unknown (opcode|packet|register|format)|unhandled/i,
      label: "Unknown / unhandled",
      why: "GPU or shader work the decoder does not recognise. Cross-reference the opcode " +
           "against the PM4 decoder above." },
    { key: "error", re: /\berror\b|\bfail(ed)?\b|exception|assert/i,
      label: "Errors",
      why: "Hard failures. Read these bottom-up — the last one before a hang is usually the " +
           "real cause." },
    { key: "warn", re: /\bwarn(ing)?\b/i, label: "Warnings",
      why: "Tolerated deviations. Noisy, but a sudden spike often marks the frame where " +
           "something went wrong." }
  ];

  function analyseLog(text) {
    var lines = text.split(/\r?\n/);
    var buckets = {};
    LOG_RULES.forEach(function (r) { buckets[r.key] = { rule: r, hits: [], counts: {} }; });

    lines.forEach(function (ln, i) {
      if (!ln.trim()) return;
      for (var k = 0; k < LOG_RULES.length; k++) {
        var r = LOG_RULES[k];
        if (r.re.test(ln)) {
          var b = buckets[r.key];
          // Normalise so repeats collapse: strip hex, digits, quoted strings.
          var norm = ln.replace(/0x[0-9a-fA-F]+/g, "0x…").replace(/\b\d{2,}\b/g, "…").trim().slice(0, 190);
          b.counts[norm] = (b.counts[norm] || 0) + 1;
          if (b.hits.length < 400) b.hits.push({ n: i + 1, t: ln.trim() });
          break;
        }
      }
    });

    // Pull anything that looks like a NID (base64-ish 11-char token).
    var nids = {};
    var nidRe = /\b([A-Za-z0-9+\-]{11})\b/g, m;
    lines.forEach(function (ln) {
      if (!/unresolved|not found|nid|symbol/i.test(ln)) return;
      nidRe.lastIndex = 0;
      while ((m = nidRe.exec(ln))) nids[m[1]] = (nids[m[1]] || 0) + 1;
    });

    return { lines: lines.length, buckets: buckets, nids: nids };
  }

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
        "run, or the log is not from the emulator. Try running with " +
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

    var nidKeys = Object.keys(res.nids);
    if (nidKeys.length) {
      h += "<h4>Candidate NIDs <span class=\"pg-dim\">· " + nidKeys.length + "</span></h4>";
      h += '<p class="pg-note">Tokens near symbol-resolution messages that match the shape of an ' +
        "encoded NID. Not every one is real — but a repeated token here is a good place to start " +
        "if you want to implement a missing function.</p>";
      h += '<div class="pg-nids">' + nidKeys.slice(0, 60).map(function (k) {
        return '<code class="pg-nid">' + esc(k) + "</code>";
      }).join("") + "</div>";
    }

    out.innerHTML = h;
  }

  var DEMO_LOG = [
    "[  0.000] Kyty emulator starting, build 7a40dad",
    "[  0.014] loader: mapping eboot.bin at 0x0000000000080000 (0x21000 bytes, R-X)",
    "[  0.015] loader: mapping segment 1 at 0x00000000000a1000 (0x5000 bytes, RW-)",
    "[  0.021] runtimeLinker: module libkernel needs 4 libraries",
    "[  0.033] runtimeLinker: unresolved symbol pt2fEBBpEJk#v#v (libSceGnmDriver)",
    "[  0.033] runtimeLinker: unresolved symbol xeH4Ry1ZfBg#v#v (libSceGnmDriver)",
    "[  0.034] runtimeLinker: unresolved symbol pt2fEBBpEJk#v#v (libSceGnmDriver)",
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
      '<div class="pg-row"><button type="button" class="pg-btn pg-demo" id="log-demo">▶ Run demo (sample log)</button>' +
      '<button type="button" class="pg-btn" id="log-paste">Paste text instead</button></div>' +
      '<textarea id="log-ta" class="pg-ta" rows="6" spellcheck="false" hidden ' +
      'placeholder="Paste log lines here…"></textarea>' +
      '<div class="pg-out" id="log-out"><p class="pg-hint">Generate one by running the emulator ' +
      "with <code>--printf-direction File --printf-output-file _kyty.txt</code>. " +
      "Parsed locally; nothing is uploaded.</p></div>";

    var out = $("#log-out", root), drop = $("#log-drop", root), file = $("#log-file", root);
    var ta = $("#log-ta", root);

    function run(text, name) { renderLog(analyseLog(text), name, out); }

    function pick(f) {
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { run(String(r.result), f.name); };
      r.readAsText(f);
    }
    drop.addEventListener("click", function () { file.click(); });
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
      if (ta.value.trim()) run(ta.value, "pasted text");
    });
  }

  /* ============================================================
     A. C++ primer — struct layout lab
     Alignment: the x86-64 ABI pads each member to its alignment
     (usually its own size) and rounds sizeof up to the largest
     member alignment. #pragma pack(1) forces alignment 1
     everywhere — the trick behind VaList (vaContext.h) and the
     machine-code structs (jit.h). static_assert(sizeof(...)==N)
     is how the tree locks these layouts (kernel/memory.h:47).
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
      why: "The pointer needs 8-byte alignment, so four bytes of padding are inserted after the second u32." },
    { id: "valist",  label: "VaList — the real packed struct (vaContext.h)",
      members: ["u32", "u32", "ptr", "ptr"], pack: true,
      why: "#pragma pack(1) removes all padding: 4 + 4 + 8 + 8 = 24 bytes, exactly what the guest ABI expects." },
    { id: "jit",     label: "JmpWithIndex — machine code as bytes (jit.h)",
      members: ["u8x16"], pack: true,
      why: "A struct whose 16 bytes ARE x86 instructions. pack(1) is what makes &code[6] really point at the jmp's operand." }
  ];

  function computeLayout(memberIds, pack) {
    var off = 0, rows = [], maxAlign = 1;
    memberIds.forEach(function (id, i) {
      var t = LAYOUT_TYPE_MAP[id];
      var al = pack ? 1 : t.align;
      if (al > maxAlign) maxAlign = al;
      var pad = (off % al) ? (al - (off % al)) : 0;
      rows.push({ type: t, offset: off + pad, pad: pad });
      off = off + pad + t.size;
    });
    var structAlign = pack ? 1 : maxAlign;
    var trailing = (off % structAlign) ? (structAlign - (off % structAlign)) : 0;
    return { rows: rows, size: off + trailing, structAlign: structAlign, trailing: trailing };
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
      preset.appendChild(el("option", null, p.label));
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
          r.type.align + "</td><td>" + (r.pad ? "<strong>" + r.pad + "</strong>" : "—") + "</td></tr>";
      });

      if (curExpect == null) curExpect = L.size;
      var want = Math.max(1, Math.round(curExpect) || 1);
      var ok = want === L.size;
      var assertMsg = '<div class="pg-hint' + (ok ? "" : " pg-warntext") + '"><code>static_assert(' +
        "sizeof(MyStruct) == " + want + ')</code> → <strong>' + (ok ? "PASS" : "FAIL") +
        "</strong>" + (ok ? " — the layout is exactly " + want + " bytes." :
          " — sizeof is actually " + L.size + ", not " + want +
          ". The tree uses this to guarantee ABI layouts (memory.h:47).") + "</div>";

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
        '<input id="ly-expect" class="pg-num" type="number" min="1" max="4096" value="' + want + '"></label></div>' +
        '<div id="ly-assert">' + assertMsg + "</div>" +
        '<p class="pg-why"><strong>Read the strip left to right.</strong> Grey = a real member; ' +
        'hollow = padding the compiler inserted (or removed, under pack). The preset explains its own ' +
        'padding; toggle the checkbox and watch sizeof fall — that is exactly what pack(1) buys for ' +
        "the machine-code structs and the guest ABI structs.</p>";

      var ne = $("#ly-expect", root);
      ne.addEventListener("input", function () { curExpect = parseInt(ne.value, 10) || 0; render(); });
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
    jmp: {
      label: "JmpWithIndex — push imm32; jmp rel32 (jit.h, 16 bytes)",
      opName: "jmp", op: "E9", opByte: 6, ripByte: 10, nops: 6,
      prefix: "68 00 00 00 00 E9 ", // push <index>; jmp — operand zeroed in this demo
      total: 16
    },
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

  function patchBytes(disp) {
    var d = disp & 0xffffffff;
    var out = [];
    for (var i = 0; i < 4; i++) { out.push(("0" + ((d >> (i * 8)) & 0xff).toString(16)).slice(-2).toUpperCase()); }
    return out;
  }

  function renderByteString(prefix, operand, suffix, nops, opByte, dispBytes) {
    var spans = function (bytes, isOperand) {
      return bytes.trim().split(/\s+/).map(function (b) {
        return b ? '<span class="pg-bits' + (isOperand ? " oper" : "") + '">' + b + "</span>" : "";
      }).join("");
    };
    return spans(prefix, false) + '<span class="pg-bits oper">' + dispBytes.join(" ") + "</span>" +
      spans(suffix || "", false) +
      spans(Array(nops + 1).join("90 "), false);
  }

  function toolJit(root) {
    root.innerHTML =
      '<div class="pg-controls">' +
      '<label class="pg-mini" style="flex:2">Stub template' +
      '<select id="jit-stub" class="pg-sel"></select></label>' +
      '<label class="pg-mini" style="flex:1">rip — address after the opcode' +
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

    function parseHex(v) {
      var s = String(v).trim().replace(/^0[xX]/, "");
      if (!/^[0-9a-fA-F]{1,16}$/.test(s)) return null;
      return parseInt(s, 16);
    }
    function hx(v) {
      var s = (v >>> 0).toString(16).toUpperCase();
      while (s.length < 8) s = "0" + s;
      var t = Math.floor(v / 4294967296).toString(16).toUpperCase();
      while (t.length < 8) t = "0" + t;
      return "0x" + t + s;
    }

    function render() {
      var stub = JIT_STUBS[stubSel.value];
      var r = parseHex(rip.value), t = parseHex(func.value);
      if (r == null || t == null) {
        out.innerHTML = '<p class="pg-hint pg-warntext">Enter addresses as hex (16 hex digits, optional 0x).</p>';
        return;
      }
      var disp = t - r;
      var signed = (disp << 32 >> 32); // sign-extend to 32 bits
      var inRange = disp >= -2147483648 && disp <= 2147483647;
      var bytes = patchBytes(disp);

      var asm = "  " + stub.opName + "  0x" + (disp >>> 0).toString(16).toUpperCase();
      if (stub.opName === "jmp") asm = "  jmp   " + hx(t);

      var stubBytes = renderByteString(stub.prefix, bytes, stub.suffix || "", stub.nops, stub.opByte, bytes);

      var tail = stub.nops ? Array(stub.nops + 1).join(" 90") : "";
      var hexView = '<code>' + (stub.prefix ? stub.prefix.trim() + " " : "") + '<b>' +
        bytes.join(" ") + "</b>" + (stub.suffix || "") + tail + "</code>";

      out.innerHTML =
        '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">displacement</span>' +
        '<span class="pg-stat-n">' + (disp < 0 ? "−" : "") + Math.abs(disp) + "</span></div>" +
        '<div class="pg-stat"><span class="pg-stat-l">as signed 32-bit</span>' +
        '<span class="pg-stat-n">' + signed + "</span></div>" +
        '<div class="pg-stat"><span class="pg-stat-l">fits rel32?</span>' +
        '<span class="pg-stat-n">' + (inRange ? "yes" : "NO") + "</span></div></div>" +
        (inRange ? "" : '<p class="pg-hint pg-warntext">The target is more than ±2 GB away from rip — ' +
          "this stub cannot reach it with a rel32. That is why the loader also has " +
          "<code>JmpRax</code> (movabs rax; jmp rax), an absolute form.</p>") +
        '<p class="pg-why">distance = target − rip = ' + hx(t) + " − " + hx(r) + " = " + (disp < 0 ? "−" : "") +
        Math.abs(disp) + " (0x" + (disp >>> 0).toString(16).toUpperCase() + "). " +
        "Stored little-endian, lowest byte first:</p>" +
        '<div class="pg-big" style="font-size:15px"><code>' + hexView + "</code></div>" +
        '<table class="pg-table pg-narrow"><tbody>' +
        "<tr><td>opcode byte</td><td><code>" + stub.op + "</code> " + stub.opName + "</td></tr>" +
        "<tr><td>operand lives at</td><td><code>code[" + stub.opByte + "]</code></td></tr>" +
        "<tr><td>rip when the cpu reads it</td><td><code>code[" + stub.ripByte + "]</code> (next instruction)</td></tr>" +
        "<tr><td>4 bytes written</td><td><code>" + bytes.join(" ") + "</code></td></tr>" +
        "</tbody></table>" +
        '<p class="pg-sum">SetFunc computes this in C++ and writes it straight into the struct ' +
        "that <em>is</em> the stub — no assembler involved. This is the whole machine-code-as-data " +
        "trick from <a href=\"t-cpp-asm.html#machine-code-as-data\">topic C2</a> in one screen.</p>";
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
     (src/loader/runtimeLinker.cpp:782-844) and annotates each
     block. The faulting address is usually a symptom; the stack
     trace at the bottom is the cause.
     ============================================================ */

  var NATIVE_CODES = {
    c0000005: "STATUS_ACCESS_VIOLATION",
    c000001d: "STATUS_ILLEGAL_INSTRUCTION",
    c0000094: "STATUS_INTEGER_DIVIDE_BY_ZERO",
    c00000fd: "STATUS_STACK_OVERFLOW",
    c0000409: "STATUS_STACK_BUFFER_OVERRUN"
  };

  var EXCEPTION_TYPES = { 0: "Unknown", 1: "AccessViolation", 2: "IllegalInstruction" };
  var ACCESS_TYPES = { 0: "Unknown", 1: "Read", 2: "Write", 3: "Execute" };

  function parseCrash(text) {
    var t = String(text).replace(/\r/g, "");
    var o = { regs: [], stack: [], guest: [], trace: [], code: [], codeFault: -1, summary: {}, unpatched: false, format: "" };
    var m;
    var HEX = "[0-9a-fA-F]";

    /* ---- current format ---- */
    if (/---\s*Guest fault context\s*---/i.test(t)) o.format = "guest-fault-context";
    if ((m = t.match(/^\s*thread:\s*(.+)$/mi))) o.summary.thread = m[1].trim();
    if ((m = t.match(/Unhandled host exception:\s*type=(\d+)\s+code=(\d+)\s+pc=0x(" + HEX + "+)\s+access=(\d+)\s+address=0x(" + HEX + "+)/i)) ||
        (m = t.match(new RegExp("Unhandled host exception:\\s*type=(\\d+)\\s+code=(\\d+)\\s+pc=0x(" + HEX + "+)\\s+access=(\\d+)\\s+address=0x(" + HEX + "+)", "i")))) {
      o.format = o.format || "guest-fault-context";
      o.summary.type = EXCEPTION_TYPES[+m[1]] || ("type " + m[1]);
      o.summary.native = (+m[2]).toString(16).toLowerCase();
      o.summary.addr = m[3].toUpperCase();
      o.summary.av_type = ACCESS_TYPES[+m[4]] || ("access " + m[4]);
      o.summary.av_addr = m[5].toUpperCase();
    }
    if ((m = t.match(/code \(pc-48 \.\. pc\+48, fault at byte 48\):\s*\n((?:[ \t]*(?:[0-9a-fA-F]{2}[ \t]*)+\n?)+)/i))) {
      o.code = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 96);
      o.codeFault = 48;
    }
    if ((m = t.match(/^\s*stack:\s*\n((?:[ \t]*(?:[0-9a-fA-F]{16}[ \t]*)+\n?)+)/mi))) {
      o.stack = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 32).map(function (v) { return v.toUpperCase(); });
    }

    /* ---- legacy format ---- */
    if ((m = t.match(/kyty_exception_handler:\s*([0-9a-fA-F]+)/))) { o.summary.addr = m[1].toUpperCase(); o.format = o.format || "legacy"; }
    if ((m = t.match(/exception module:\s*(.+)/i))) o.summary.module = m[1].trim();
    if ((m = t.match(/code-32:\s*(.+)/i))) { o.code = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 32); o.codeFault = -1; }
    if ((m = t.match(/exception:\s*type=(\w+),\s*av_type=(\w+),\s*av_addr=([0-9a-fA-F]+),\s*native_code=([0-9a-fA-F_]+)/i))) {
      o.summary.type = m[1]; o.summary.av_type = m[2]; o.summary.av_addr = m[3].toUpperCase();
      o.summary.native = m[4].replace(/[^0-9a-f]/gi, "").slice(-8).toLowerCase();
    }
    var sm = t.match(/stack:\s*(\[\d+\]=.+)/i);
    if (sm) sm[1].replace(/\[\d+\]=([0-9a-fA-F]+)/gi, function (_, v) { o.stack.push(v.toUpperCase()); return ""; });
    var g = new RegExp("guest\\s+(\\S+)\\[0\\]:\\s*addr=(" + HEX + "+),\\s*off=(" + HEX + "+),\\s*(.*)", "gi");
    while ((m = g.exec(t))) o.guest.push({ reg: m[1], addr: m[2].toUpperCase(), off: m[3].toUpperCase(), module: m[4].trim() });
    if (t.indexOf("(Unpatched object)") >= 0) o.unpatched = true;
    if ((m = t.match(/Access violation:\s*(\w+)\s*\[([0-9a-fA-F]+)\]/i))) {
      o.summary.fatal = "Access violation — " + m[1] + " at " + m[2].toUpperCase();
    } else if ((m = t.match(/Unknown exception!!!\s*\(([0-9a-fA-F]+)\)/i))) {
      o.summary.fatal = "Unknown exception — " + m[1];
    }

    /* ---- common: registers and the guest stack walk (RuntimeLinker::StackTrace) ---- */
    var re = new RegExp("\\b(rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|r8|r9|r10|r11|r12|r13|r14|r15)\\s*=\\s*(" + HEX + "+)", "gi");
    while ((m = re.exec(t))) o.regs.push({ name: m[1], value: m[2].toUpperCase() });
    var tr = new RegExp("\\[(\\d+)\\]\\s+(" + HEX + "+),\\s*off=(" + HEX + "+),\\s*(.*)", "g");
    while ((m = tr.exec(t))) o.trace.push({ frame: +m[1], addr: m[2].toUpperCase(), off: m[3].toUpperCase(), module: m[4].trim() });
    return o;
  }

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
        "<p>The write landed on the special <code>g_invalid_memory</code> address — a known bug " +
        "class in the patching layer, not a game bug. The red zone patcher and the game patch " +
        "are the suspects.</p></div>";
    }

    h += '<p class="pg-why"><strong>Cause vs symptom:</strong> the exception happened at ' +
      "<code>" + esc(o.summary.addr || "?") + "</code> because of a " +
      esc(o.summary.av_type || "?") + " to <code>" + esc(o.summary.av_addr || "?") +
      "</code>. The reason it <em>got there</em> is in the callers — the stack words that fall " +
      "inside a loaded module are return addresses, and a <code>Stack trace</code> block, where the " +
      "emulator prints one, resolves them to module and offset. Fix the caller, not the address.</p>";

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
        "(<code>0x8…</code>–<code>0xF…</code>) and are the likely return addresses — the call path, newest first.</p>";
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
        "means it points nowhere useful — a strong hint it held data, not an address.</p>";
    }

    if (o.trace.length) {
      h += "<h4>Stack trace <span class='pg-dim'>— the cause</span></h4>" +
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

    function run(text) { renderCrash(parseCrash(text), out); }
    function pick(f) {
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { run(String(r.result)); };
      r.readAsText(f);
    }
    drop.addEventListener("click", function () { file.click(); });
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
      if (ta.value.trim()) run(ta.value);
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

  var RD_FAMILIES = ["Unknown", "SOP1", "SOP2", "SOPK", "SOPC", "SOPP", "VOP1", "VOP2", "VOP3", "VOP3P", "VOPC", "VINTRP", "SMEM", "MUBUF", "MTBUF", "FLAT", "DS", "MIMG", "EXP"];

  var RD = {};
  RD.SOP2 = { "0x00": "s_add_u32", "0x01": "s_sub_u32", "0x02": "s_add_i32", "0x03": "s_sub_i32", "0x04": "s_addc_u32", "0x05": "s_subb_u32", "0x06": "s_min_i32", "0x07": "s_min_u32", "0x08": "s_max_i32", "0x09": "s_max_u32", "0x0a": "s_cselect_b32", "0x0b": "s_cselect_b64", "0x0e": "s_and_b32", "0x0f": "s_and_b64", "0x10": "s_or_b32", "0x11": "s_or_b64", "0x12": "s_xor_b32", "0x13": "s_xor_b64", "0x14": "s_andn2_b32", "0x15": "s_andn2_b64", "0x16": "s_orn2_b32", "0x17": "s_orn2_b64", "0x18": "s_nand_b32", "0x19": "s_nand_b64", "0x1a": "s_nor_b32", "0x1b": "s_nor_b64", "0x1c": "s_xnor_b32", "0x1d": "s_xnor_b64", "0x1e": "s_lshl_b32", "0x1f": "s_lshl_b64", "0x20": "s_lshr_b32", "0x21": "s_lshr_b64", "0x22": "s_ashr_i32", "0x24": "s_bfm_b32", "0x25": "s_bfm_b64", "0x26": "s_mul_i32", "0x27": "s_bfe_u32", "0x29": "s_bfe_u64", "0x2e": "s_lshl1_add_u32", "0x2f": "s_lshl2_add_u32", "0x30": "s_lshl3_add_u32", "0x31": "s_lshl4_add_u32", "0x32": "s_pack_ll_b32_b16", "0x33": "s_pack_lh_b32_b16", "0x34": "s_pack_hh_b32_b16", "0x35": "s_mul_hi_u32" };
  RD.SOP1 = { "0x03": "s_mov_b32", "0x04": "s_mov_b64", "0x07": "s_not_b32", "0x08": "s_not_b64", "0x0a": "s_wqm_b64", "0x0b": "s_brev_b32", "0x0f": "s_bcnt1_i32_b32", "0x10": "s_bcnt1_i32_b64", "0x13": "s_ff1_i32_b32", "0x16": "s_flbit_i32_b64", "0x1b": "s_bitset0_b32", "0x1d": "s_bitset1_b32", "0x1f": "s_getpc_b64", "0x20": "s_setpc_b64", "0x24": "s_and_saveexec_b64", "0x28": "s_orn2_saveexec_b64", "0x34": "s_abs_i32", "0x37": "s_andn1_saveexec_b64", "0x3b": "s_bitreplicate_b64_b32", "0x3c": "s_and_saveexec_b32", "0x44": "s_andn1_saveexec_b32" };
  RD.SOPC = { "0x00": "s_cmp_eq_i32", "0x01": "s_cmp_lg_i32", "0x02": "s_cmp_gt_i32", "0x03": "s_cmp_ge_i32", "0x04": "s_cmp_lt_i32", "0x05": "s_cmp_le_i32", "0x06": "s_cmp_eq_u32", "0x07": "s_cmp_lg_u32", "0x08": "s_cmp_gt_u32", "0x09": "s_cmp_ge_u32", "0x0a": "s_cmp_lt_u32", "0x0b": "s_cmp_le_u32", "0x0c": "s_bitcmp0_b32", "0x0d": "s_bitcmp1_b32", "0x12": "s_cmp_eq_u64", "0x13": "s_cmp_lg_u64" };
  RD.SOPK = { "0x00": "s_movk_i32", "0x03": "s_cmpk_eq_i32", "0x04": "s_cmpk_lg_i32", "0x05": "s_cmpk_gt_i32", "0x06": "s_cmpk_ge_i32", "0x07": "s_cmpk_lt_i32", "0x08": "s_cmpk_le_i32", "0x09": "s_cmpk_eq_u32", "0x0a": "s_cmpk_lg_u32", "0x0b": "s_cmpk_gt_u32", "0x0c": "s_cmpk_ge_u32", "0x0d": "s_cmpk_lt_u32", "0x0e": "s_cmpk_le_u32", "0x0f": "s_addk_i32", "0x10": "s_mulk_i32", "0x13": "s_setreg_b32", "0x17": "s_waitcnt", "0x18": "s_waitcnt", "0x19": "s_waitcnt", "0x1a": "s_waitcnt" };
  RD.SOPP = { "0x00": "s_nop", "0x01": "s_endpgm", "0x02": "s_branch", "0x04": "s_cbranch_scc0", "0x05": "s_cbranch_scc1", "0x06": "s_cbranch_vccz", "0x07": "s_cbranch_vccnz", "0x08": "s_cbranch_execz", "0x09": "s_cbranch_execnz", "0x0a": "s_barrier", "0x0c": "s_waitcnt", "0x0e": "s_sleep", "0x10": "s_sendmsg", "0x16": "s_tracdata", "0x20": "s_inst_prefetch" };
  RD.VOP2 = { "0x01": "v_cndmask_b32", "0x02": "v_dot2c_f32_f16", "0x03": "v_add_f32", "0x04": "v_sub_f32", "0x05": "v_subrev_f32", "0x08": "v_mul_f32", "0x09": "v_mul_i32_i24", "0x0b": "v_mul_u32_u24", "0x0f": "v_min_f32", "0x10": "v_max_f32", "0x11": "v_min_i32", "0x12": "v_max_i32", "0x13": "v_min_u32", "0x14": "v_max_u32", "0x15": "v_lshr_b32", "0x16": "v_lshrrev_b32", "0x17": "v_ashr_i32", "0x18": "v_ashrrev_i32", "0x19": "v_lshl_b32", "0x1a": "v_lshlrev_b32", "0x1b": "v_and_b32", "0x1c": "v_or_b32", "0x1d": "v_xor_b32", "0x1e": "v_xnor_b32", "0x1f": "v_mac_f32", "0x20": "v_madmk_f32", "0x21": "v_madak_f32", "0x22": "v_bcnt_u32_b32", "0x23": "v_mbcnt_lo_u32_b32", "0x24": "v_mbcnt_hi_u32_b32", "0x25": "v_add_nc_u32", "0x26": "v_sub_nc_u32", "0x27": "v_subrev_nc_u32", "0x28": "v_addc_u32", "0x2f": "v_cvt_pkrtz_f16_f32", "0x32": "v_add_f16", "0x33": "v_sub_f16", "0x34": "v_subrev_f16", "0x35": "v_mul_f16", "0x36": "v_fmac_f16", "0x37": "v_fmamk_f16", "0x38": "v_fmaak_f16", "0x39": "v_max_f16", "0x3a": "v_min_f16", "0x3c": "v_pk_fmac_f16" };
  RD.VOP1 = { "0x00": "v_nop", "0x01": "v_mov_b32", "0x02": "v_readfirstlane_b32", "0x05": "v_cvt_f32_i32", "0x06": "v_cvt_f32_u32", "0x07": "v_cvt_u32_f32", "0x08": "v_cvt_i32_f32", "0x0a": "v_cvt_f16_f32", "0x0b": "v_cvt_f32_f16", "0x0c": "v_cvt_rpi_i32_f32", "0x0d": "v_cvt_flr_i32_f32", "0x0e": "v_cvt_off_f32_i4", "0x11": "v_cvt_f32_ubyte0", "0x12": "v_cvt_f32_ubyte1", "0x13": "v_cvt_f32_ubyte2", "0x14": "v_cvt_f32_ubyte3", "0x20": "v_fract_f32", "0x21": "v_trunc_f32", "0x22": "v_ceil_f32", "0x23": "v_rndne_f32", "0x24": "v_floor_f32", "0x25": "v_exp_f32", "0x27": "v_log_f32", "0x2a": "v_rcp_f32", "0x2e": "v_rsq_f32", "0x33": "v_sqrt_f32", "0x35": "v_sin_f32", "0x36": "v_cos_f32", "0x37": "v_not_b32", "0x38": "v_bfrev_b32", "0x39": "v_ffbh_u32", "0x3a": "v_ffbl_b32", "0x42": "v_movreld_b32", "0x43": "v_movrels_b32", "0x50": "v_cvt_f16_u16", "0x51": "v_cvt_f16_i16", "0x52": "v_cvt_u16_f16", "0x53": "v_cvt_i16_f16", "0x54": "v_rcp_f16", "0x55": "v_sqrt_f16", "0x56": "v_rsq_f16", "0x57": "v_log_f16", "0x58": "v_exp_f16", "0x5b": "v_floor_f16", "0x5c": "v_ceil_f16", "0x5d": "v_trunc_f16", "0x5e": "v_rndne_f16" };
  RD.VOPC = { "0x00": "v_cmp_f_f32", "0x01": "v_cmp_lt_f32", "0x02": "v_cmp_eq_f32", "0x03": "v_cmp_le_f32", "0x04": "v_cmp_gt_f32", "0x05": "v_cmp_lg_f32", "0x06": "v_cmp_ge_f32", "0x07": "v_cmp_o_f32", "0x08": "v_cmp_u_f32", "0x09": "v_cmp_nge_f32", "0x0a": "v_cmp_nlg_f32", "0x0b": "v_cmp_ngt_f32", "0x0c": "v_cmp_nle_f32", "0x0d": "v_cmp_neq_f32", "0x0e": "v_cmp_nlt_f32", "0x0f": "v_cmp_tru_f32", "0x80": "v_cmp_f_i32", "0x81": "v_cmp_lt_i32", "0x82": "v_cmp_eq_i32", "0x83": "v_cmp_le_i32", "0x84": "v_cmp_gt_i32", "0x85": "v_cmp_ne_i32", "0x86": "v_cmp_ge_i32", "0x87": "v_cmp_t_i32", "0x88": "v_cmp_class_f32", "0xc0": "v_cmp_f_u32", "0xc1": "v_cmp_lt_u32", "0xc2": "v_cmp_eq_u32", "0xc3": "v_cmp_le_u32", "0xc4": "v_cmp_gt_u32", "0xc5": "v_cmp_ne_u32", "0xc6": "v_cmp_ge_u32", "0xc7": "v_cmp_t_u32" };
  RD.SMEM = { "0x00": "s_load_dword", "0x01": "s_load_dwordx2", "0x02": "s_load_dwordx4", "0x03": "s_load_dwordx8", "0x04": "s_load_dwordx16", "0x05": "s_load_ubyte", "0x06": "s_load_sbyte", "0x07": "s_load_short", "0x08": "s_load_ushort", "0x09": "s_load_ubyte_dword", "0x0a": "s_load_sbyte_dword", "0x0b": "s_load_short_dword", "0x0c": "s_load_ushort_dword", "0x0d": "s_load_dword_glc", "0x10": "s_store_dword", "0x11": "s_store_dwordx2", "0x12": "s_store_dwordx4", "0x13": "s_store_dwordx8", "0x14": "s_store_dwordx16", "0x15": "s_store_ubyte", "0x16": "s_store_sbyte", "0x17": "s_store_short", "0x18": "s_store_ushort", "0x1e": "s_buffer_load_dword", "0x1f": "s_buffer_load_dwordx2", "0x20": "s_buffer_load_dwordx4", "0x21": "s_buffer_load_dwordx8", "0x22": "s_buffer_load_dwordx16", "0x23": "s_buffer_load_ubyte", "0x24": "s_buffer_load_sbyte", "0x25": "s_buffer_load_short", "0x26": "s_buffer_load_ushort", "0x30": "s_buffer_store_dword", "0x31": "s_buffer_store_dwordx2", "0x32": "s_buffer_store_dwordx4", "0x33": "s_buffer_store_dwordx8", "0x34": "s_buffer_store_dwordx16", "0x35": "s_buffer_store_ubyte", "0x36": "s_buffer_store_sbyte", "0x37": "s_buffer_store_short", "0x38": "s_buffer_store_ushort", "0x3c": "s_scratch_load_dword", "0x3e": "s_scratch_load_dwordx2", "0x40": "s_scratch_load_dwordx4", "0x50": "s_scratch_store_dword", "0x52": "s_scratch_store_dwordx2", "0x54": "s_scratch_store_dwordx4", "0x58": "s_dcache_inv_vol", "0x59": "s_memtime", "0x5a": "s_memrealtime" };

  function rdName(table, key) {
    var n = table[key];
    return n || (key === "0x3e" ? "v_cmp_* (VOPC)" : key === "0x3f" ? "v_* (VOP1)" : null);
  }
  function rdKey(n) { return "0x" + ("00" + n.toString(16)).slice(-2); }

  function scalarName(n) {
    if (n < 106) return "s" + n;
    if (n === 106) return "vcc_lo"; if (n === 107) return "vcc_hi";
    if (n === 108) return "exec_lo"; if (n === 109) return "exec_hi";
    if (n >= 110 && n <= 123) return "s" + n;
    if (n === 124) return "tba_lo"; if (n === 125) return "tba_hi";
    if (n === 126) return "tma_lo"; if (n === 127) return "tma_hi";
    if (n >= 128 && n <= 143) return "" + (n - 128);
    if (n >= 144 && n <= 159) return "" + (n - 160);
    var FRAC = { 160: "0.5", 161: "-0.5", 162: "1.0", 163: "-1.0", 164: "2.0", 165: "-2.0", 166: "4.0", 167: "-4.0", 168: "1/(2π)", 169: "1/π", 170: "2/π", 171: "1/(2√π)", 172: "1/√π", 173: "2/√π", 174: "√(2/π)", 175: "√(π/2)", 176: "1/(2π)", 177: "1/π", 178: "2/π", 179: "1/(2√π)", 180: "1/√π", 181: "2/√π", 182: "√(2/π)", 183: "√(π/2)" };
    if (FRAC[n]) return FRAC[n];
    if (n === 192) return "literal";
    if (n === 253) return "vccz"; if (n === 254) return "execz"; if (n === 255) return "scc";
    return "s" + n;
  }
  function vopSrc(n) { return n < 256 ? "v" + n : scalarName(n - 256); }

  function rdDecode(w0, w1) {
    var r = { w0: w0, w1: w1, words: 1, family: "?", name: "?", opcode: 0, operands: [], fields: [], dispatch: "?" };
    var top2 = (w0 & 0xc0000000) >>> 0;

    if ((w0 & 0x80000000) === 0) {
      r.dispatch = "bit31 = 0 → vector ALU family";
      var op = (w0 >>> 25) & 0x3f;
      var vdst = (w0 >>> 17) & 0xff, src0 = w0 & 0x1ff, vsrc1 = (w0 >>> 9) & 0xff;
      if (op === 0x3e) { // VOPC
        r.family = "VOPC"; r.opcode = (w0 >>> 17) & 0xff;
        r.name = rdName(RD.VOPC, rdKey(r.opcode)) || "v_cmp_*";
        r.operands = [vopSrc(src0), "v" + vsrc1, "→ vcc"];
        r.fields = [
          { n: "src0", b: "0–8", v: vopSrc(src0) }, { n: "vsrc1", b: "9–16", v: "v" + vsrc1 },
          { n: "opcode", b: "17–24", v: "0x" + r.opcode.toString(16) }, { n: "enc", b: "25–31", v: "0x3e (VOPC)" }
        ];
      } else if (op === 0x3f) { // VOP1
        r.family = "VOP1"; r.opcode = (w0 >>> 9) & 0xff;
        r.name = rdName(RD.VOP1, rdKey(r.opcode)) || "v_*";
        r.operands = [vopSrc(src0), "v" + vdst];
        r.fields = [
          { n: "src0", b: "0–8", v: vopSrc(src0) }, { n: "opcode", b: "9–16", v: "0x" + r.opcode.toString(16) },
          { n: "vdst", b: "17–24", v: "v" + vdst }, { n: "enc", b: "25–31", v: "0x3f (VOP1)" }
        ];
      } else { // VOP2
        r.family = "VOP2"; r.opcode = op;
        r.name = rdName(RD.VOP2, rdKey(op)) || "v_* (VOP2)";
        r.operands = [vopSrc(src0), "v" + vsrc1, "→ v" + vdst];
        r.fields = [
          { n: "src0", b: "0–8", v: vopSrc(src0) }, { n: "vsrc1", b: "9–16", v: "v" + vsrc1 },
          { n: "vdst", b: "17–24", v: "v" + vdst }, { n: "opcode", b: "25–30", v: "0x" + op.toString(16) }
        ];
      }
      return r;
    }

    if (top2 === 0x80000000) {
      r.dispatch = "top bits 10 → scalar ALU family";
      var sop = (w0 >>> 23) & 0x7f;
      var sdst = (w0 >>> 16) & 0x7f;
      if (sop === 0x7d) { // SOP1
        var sop1op = (w0 >>> 8) & 0xff, ssrc0 = w0 & 0xff;
        r.family = "SOP1"; r.opcode = sop1op;
        r.name = rdName(RD.SOP1, rdKey(sop1op)) || "s_*";
        r.operands = [scalarName(ssrc0), "→ " + scalarName(sdst)];
        r.fields = [
          { n: "ssrc0", b: "0–7", v: scalarName(ssrc0) }, { n: "opcode", b: "8–15", v: "0x" + sop1op.toString(16) },
          { n: "sdst", b: "16–22", v: scalarName(sdst) }, { n: "enc", b: "23–30", v: "0x7d (SOP1)" }
        ];
      } else if (sop === 0x7e) { // SOPC
        var sopcop = (w0 >>> 16) & 0x7f, a0 = w0 & 0xff, a1 = (w0 >>> 8) & 0xff;
        r.family = "SOPC"; r.opcode = sopcop;
        r.name = rdName(RD.SOPC, rdKey(sopcop)) || "s_cmp_*";
        r.operands = [scalarName(a0), scalarName(a1), "→ scc"];
        r.fields = [
          { n: "ssrc0", b: "0–7", v: scalarName(a0) }, { n: "ssrc1", b: "8–15", v: scalarName(a1) },
          { n: "opcode", b: "16–22", v: "0x" + sopcop.toString(16) }, { n: "enc", b: "23–30", v: "0x7e (SOPC)" }
        ];
      } else if (sop === 0x7f) { // SOPP
        var soppop = (w0 >>> 16) & 0x7f, simm = w0 & 0xffff;
        r.family = "SOPP"; r.opcode = soppop;
        r.name = rdName(RD.SOPP, rdKey(soppop)) || "s_*";
        var signed16 = simm << 16 >> 16;
        r.operands = soppop === 0x01 ? [] : [simm];
        if (soppop === 0x02 || (soppop >= 0x04 && soppop <= 0x09)) {
          r.operands = ["pc+4 + " + (signed16 * 4) + " (" + signed16 + "×4)"];
        }
        r.fields = [
          { n: "simm16", b: "0–15", v: "0x" + simm.toString(16) + " (" + signed16 + ")" },
          { n: "opcode", b: "16–22", v: "0x" + soppop.toString(16) }, { n: "enc", b: "23–30", v: "0x7f (SOPP)" }
        ];
      } else if (sop >= 0x60) { // SOPK
        var sopkop = (w0 >>> 23) & 0x1f, ksdst = (w0 >>> 16) & 0x7f, kimm = (w0 & 0xffff) << 16 >> 16;
        r.family = "SOPK"; r.opcode = sopkop;
        r.name = rdName(RD.SOPK, rdKey(sopkop)) || "s_*k_*";
        r.operands = ["" + kimm, "→ " + scalarName(ksdst)];
        r.fields = [
          { n: "simm16", b: "0–15", v: kimm }, { n: "sdst", b: "16–22", v: scalarName(ksdst) },
          { n: "opcode", b: "23–27", v: "0x" + sopkop.toString(16) }, { n: "enc", b: "28–30", v: "SOPK" }
        ];
      } else { // SOP2
        var sop2op = sop, s0 = w0 & 0xff, s1 = (w0 >>> 8) & 0xff;
        r.family = "SOP2"; r.opcode = sop2op;
        r.name = rdName(RD.SOP2, rdKey(sop2op)) || "s_*";
        r.operands = [scalarName(s0), scalarName(s1), "→ " + scalarName(sdst)];
        r.fields = [
          { n: "ssrc0", b: "0–7", v: scalarName(s0) }, { n: "ssrc1", b: "8–15", v: scalarName(s1) },
          { n: "sdst", b: "16–22", v: scalarName(sdst) }, { n: "opcode", b: "23–30", v: "0x" + sop2op.toString(16) }
        ];
      }
      return r;
    }

    // 64-bit / other families selected by bits 26-31
    r.words = 2; r.dispatch = "top bits 11 → memory / 64-bit family by bits 26–31";
    var fam = w0 >>> 26;
    if (fam === 0x35 && w1 !== undefined) { // VOP3
      r.family = "VOP3";
      r.opcode = (w0 >>> 16) & 0x3ff;
      r.name = "v_* (VOP3)";
      r.operands = [vopSrc(w1 & 0x1ff), vopSrc((w1 >>> 9) & 0x1ff), vopSrc((w1 >>> 18) & 0x1ff), "→ v" + (w0 & 0xff)];
      r.fields = [
        { n: "vdst", b: "w0 0–7", v: "v" + (w0 & 0xff) }, { n: "sdst", b: "w0 8–14", v: scalarName((w0 >>> 8) & 0x7f) },
        { n: "opcode", b: "w0 16–25", v: "0x" + r.opcode.toString(16) },
        { n: "src0", b: "w1 0–8", v: vopSrc(w1 & 0x1ff) }, { n: "src1", b: "w1 9–17", v: vopSrc((w1 >>> 9) & 0x1ff) },
        { n: "src2", b: "w1 18–26", v: vopSrc((w1 >>> 18) & 0x1ff) }
      ];
    } else if (fam === 0x3d && w1 !== undefined) { // SMEM
      r.family = "SMEM";
      r.opcode = (w0 >>> 18) & 0xff;
      r.name = rdName(RD.SMEM, rdKey(r.opcode)) || "s_*";
      r.operands = ["s[" + (w1 & 0x7f) + "]", "off " + ((w1 >>> 8) & 0x1ffff), "→ " + scalarName((w0 >>> 6) & 0x7f)];
      r.fields = [
        { n: "sdst", b: "w0 6–12", v: scalarName((w0 >>> 6) & 0x7f) }, { n: "glc", b: "w0 16", v: (w0 >>> 16) & 1 },
        { n: "opcode", b: "w0 18–25", v: "0x" + r.opcode.toString(16) },
        { n: "sbase", b: "w1 0–6", v: "s[" + (w1 & 0x7f) + "]" }, { n: "offset", b: "w1 8–24", v: (w1 >>> 8) & 0x1ffff },
        { n: "soffset", b: "w1 25–31", v: scalarName((w1 >>> 25) & 0x7f) }
      ];
    } else if (fam === 0x38 && w1 !== undefined) { // MUBUF
      r.family = "MUBUF";
      r.opcode = ((w0 >>> 18) & 0x7f) | (((w0 >>> 25) & 1) << 7);
      r.name = "buffer_*";
      r.operands = ["v" + ((w1 >>> 8) & 0xff), "s[" + ((w1 >>> 16) & 0x1f) + "]", "off " + ((w1 >>> 24) & 0xff)];
      r.fields = [
        { n: "offen/idxen", b: "w0 12–13", v: ((w0 >>> 12) & 3) }, { n: "glc", b: "w0 14", v: (w0 >>> 14) & 1 },
        { n: "opcode", b: "w0 18–25", v: "0x" + r.opcode.toString(16) },
        { n: "vaddr", b: "w1 0–7", v: "v" + (w1 & 0xff) }, { n: "vdata", b: "w1 8–15", v: "v" + ((w1 >>> 8) & 0xff) },
        { n: "srsrc", b: "w1 16–20", v: "s[" + ((w1 >>> 16) & 0x1f) + "]" }, { n: "soffset", b: "w1 24–31", v: scalarName((w1 >>> 24) & 0xff) }
      ];
    } else if (fam === 0x36 && w1 !== undefined) { // DS
      r.family = "DS";
      r.opcode = (w0 >>> 18) & 0x7f;
      r.name = "ds_*";
      r.operands = ["v" + ((w1 >>> 24) & 0xff), "s" + ((w1 >>> 16) & 0x7f), "v" + ((w1 >>> 8) & 0xff)];
      r.fields = [
        { n: "opcode", b: "w0 18–24", v: "0x" + r.opcode.toString(16) },
        { n: "data", b: "w1 8–15", v: "v" + ((w1 >>> 8) & 0xff) }, { n: "saddr", b: "w1 16–22", v: "s" + ((w1 >>> 16) & 0x7f) },
        { n: "vdst", b: "w1 24–31", v: "v" + ((w1 >>> 24) & 0xff) }
      ];
    } else if (fam === 0x37 && w1 !== undefined) { // FLAT
      r.family = "FLAT";
      r.opcode = (w0 >>> 18) & 0xff;
      r.name = "flat_*";
      r.operands = ["v" + ((w1 >>> 24) & 0xff), "v" + ((w1 >>> 8) & 0xff), "off " + ((w0 >>> 8) & 0xff)];
      r.fields = [
        { n: "offset1", b: "w0 8–15", v: (w0 >>> 8) & 0xff }, { n: "opcode", b: "w0 18–25", v: "0x" + r.opcode.toString(16) },
        { n: "data0", b: "w1 8–15", v: "v" + ((w1 >>> 8) & 0xff) }, { n: "data1", b: "w1 16–23", v: "v" + ((w1 >>> 16) & 0xff) },
        { n: "vdst", b: "w1 24–31", v: "v" + ((w1 >>> 24) & 0xff) }
      ];
    } else if (fam === 0x3e && w1 !== undefined) { // EXP
      r.family = "EXP";
      r.opcode = (w0 >>> 4) & 0x3f;
      r.name = "exp";
      r.operands = ["target " + r.opcode + (r.opcode === 0x3f ? " (null)" : ""), "en " + (w0 & 0xf), "compr " + ((w0 >>> 10) & 1)];
      r.fields = [
        { n: "en", b: "w0 0–3", v: w0 & 0xf }, { n: "target", b: "w0 4–9", v: "0x" + r.opcode.toString(16) },
        { n: "compr", b: "w0 10", v: (w0 >>> 10) & 1 }, { n: "done", b: "w0 11", v: (w0 >>> 11) & 1 }, { n: "vm", b: "w0 12", v: (w0 >>> 12) & 1 },
        { n: "vsrc0..3", b: "w1 0–31", v: ["v" + (w1 & 0xff), "v" + ((w1 >>> 8) & 0xff), "v" + ((w1 >>> 16) & 0xff), "v" + ((w1 >>> 24) & 0xff)].join(" ") }
      ];
    } else if (fam === 0x3a && w1 !== undefined) { // MTBUF
      r.family = "MTBUF";
      r.opcode = ((w0 >>> 16) & 0x7) | (((w1 >>> 21) & 1) << 3);
      r.name = "tbuffer_*";
      r.operands = ["v" + ((w1 >>> 8) & 0xff), "s[" + ((w1 >>> 16) & 0x1f) + "]", "dfmt " + ((w0 >>> 19) & 0xf), "nfmt " + ((w0 >>> 23) & 0x7)];
      r.fields = [
        { n: "opcode", b: "w0 16–18", v: "0x" + r.opcode.toString(16) }, { n: "dfmt", b: "w0 19–22", v: (w0 >>> 19) & 0xf },
        { n: "nfmt", b: "w0 23–25", v: (w0 >>> 23) & 0x7 }, { n: "vdata", b: "w1 8–15", v: "v" + ((w1 >>> 8) & 0xff) },
        { n: "srsrc", b: "w1 16–20", v: "s[" + ((w1 >>> 16) & 0x1f) + "]" }
      ];
    } else if (fam === 0x33 || fam === 0x32) { // VOP3P / VINTRP
      r.family = fam === 0x33 ? "VOP3P" : "VINTRP";
      r.opcode = (w0 >>> 16) & 0x3ff;
      r.name = fam === 0x33 ? "v_* (VOP3P)" : "v_interp_*";
      r.operands = [];
      r.fields = [{ n: "opcode", b: "w0 16–25", v: "0x" + r.opcode.toString(16) }];
    } else if (fam === 0x3c && w1 !== undefined) { // MIMG
      r.family = "MIMG";
      r.opcode = (w0 >>> 18) & 0xff;
      r.name = "image_*";
      r.operands = [];
      r.fields = [{ n: "opcode", b: "w0 18–25", v: "0x" + r.opcode.toString(16) }];
    } else {
      r.family = "UNKNOWN"; r.name = "?";
      r.fields = [{ n: "bits 26–31", b: "26–31", v: "0x" + fam.toString(16) }];
    }
    return r;
  }

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
      'placeholder="0xBE800380&#10;0x7E0602A2&#10;…"></textarea></label>' +
      "</div>" +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="isa-demo">▶ Run demo shader</button>' +
      '<button type="button" class="pg-btn" id="isa-paste">Paste from .rdna2/.bin hex</button></div>' +
      '<div class="pg-out" id="isa-out"><p class="pg-hint">Words from a shader\'s input ISA — grab the raw dwords from a ' +
      "<code>--shader-log-direction File</code> dump, or decode a word you're curious about. " +
      "Layouts transcribed from <code>ShaderDecoder.cpp</code> + the opcode tables in the decompiler.</p></div>";

    var ta = $("#isa-ta", root), out = $("#isa-out", root), selIdx = 0;

    function parseWords(text) {
      var toks = String(text).split(/[^0-9a-fA-FxX]+/).filter(Boolean);
      var ws = [];
      toks.forEach(function (t) {
        var v = t.replace(/^0[xX]/, "");
        if (!/^[0-9a-fA-F]{1,8}$/.test(v)) return;
        ws.push(parseInt(v, 16) >>> 0);
      });
      return ws;
    }

    function render() {
      var ws = parseWords(ta.value);
      if (!ws.length) {
        out.innerHTML = '<p class="pg-hint pg-warntext">No 32-bit hex words found.</p>';
        return;
      }
      var rows = [], i = 0;
      while (i < ws.length) {
        var w1 = i + 1 < ws.length ? ws[i + 1] : undefined;
        var dec = rdDecode(ws[i], w1);
        var pc = i * 4;
        rows.push({ pc: pc, dec: dec, raw: [ws[i]].concat(dec.words > 1 && w1 !== undefined ? [w1] : []) });
        i += dec.words;
      }
      if (selIdx >= rows.length) selIdx = 0;
      var h = '<p class="pg-sum">Decoded ' + rows.length + " instruction" + (rows.length === 1 ? "" : "s") +
        " (" + ws.length + " words). Click a row for the bit fields.</p>";
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
      h += '<p class="pg-src">Dispatch logic from <code>ShaderDecoder.cpp:360–393</code>; opcode tables from ' +
        "<code>ScalarAluOps.cpp</code>, <code>VectorAluOps.cpp</code>, <code>MemoryOps.cpp</code>, <code>ExportOps.cpp</code>. " +
        "SDWA/DPP modifiers and some rare encodings are elided — the family and operands are still right.</p>";

      out.innerHTML = h;
      Array.prototype.forEach.call(out.querySelectorAll("#isa-rows tbody tr"), function (tr) {
        tr.addEventListener("click", function () {
          selIdx = +tr.dataset.k; render();
        });
      });
    }

    $("#isa-demo", root).addEventListener("click", function () {
      ta.value = [
        "0xBE800380", // s_mov_b32 s0, 0        (SOP1, inline 0)
        "0xBE820304", // s_mov_b32 s2, s4
        "0x7E0603A2", // v_mov_b32 v3, 1.0      (VOP1, inline 1.0 = src0 418)
        "0x06000200", // v_add_f32 v0, v0, v1   (VOP2)
        "0x10040200", // v_mul_f32 v2, v0, v1
        "0x7C020200", // v_cmp_lt_f32 vcc, v0, v1 (VOPC)
        "0xBF820001", // s_branch +4            (SOPP)
        "0xBF810000"  // s_endpgm
      ].join("\n");
      render();
    });
    $("#isa-paste", root).addEventListener("click", function () {
      var t = ta.value;
      var m = t.match(/0x[0-9a-fA-F]{8}/g);
      if (m && m.length) { ta.value = m.join("\n"); render(); }
      else render();
    });
    ta.addEventListener("input", render);
    $("#isa-demo", root).click();
  }

  /* ============================================================
     E. C++ primer — shader artifact reader
     Accepts what --shader-log-direction File actually produces:
       .rdna2  the decoded input ISA text (shader.cpp:1402)
       .spvasm the SPIR-V disassembly (shader.cpp:1364)
       .spv    the SPIR-V binary
       raw 32-bit ISA words
     ============================================================ */

  var SPV_OPS = {
    0: "OpNop", 1: "OpUndef", 3: "OpSource", 5: "OpName", 6: "OpMemberName", 7: "OpString",
    10: "OpExtension", 11: "OpExtInstImport", 12: "OpExtInst", 14: "OpMemoryModel", 15: "OpEntryPoint",
    16: "OpExecutionMode", 17: "OpCapability", 19: "OpTypeVoid", 20: "OpTypeBool", 21: "OpTypeInt",
    22: "OpTypeFloat", 23: "OpTypeVector", 24: "OpTypeMatrix", 25: "OpTypeImage", 27: "OpTypeSampledImage",
    28: "OpTypeArray", 29: "OpTypeRuntimeArray", 30: "OpTypeStruct", 32: "OpTypePointer", 33: "OpTypeFunction",
    36: "OpConstantTrue", 37: "OpConstantFalse", 38: "OpConstant", 39: "OpConstantComposite", 41: "OpConstantNull",
    49: "OpFunction", 50: "OpFunctionParameter", 51: "OpFunctionEnd", 52: "OpFunctionCall", 53: "OpVariable",
    55: "OpLoad", 56: "OpStore", 57: "OpCopyMemory", 59: "OpAccessChain", 60: "OpInBoundsAccessChain",
    65: "OpDecorate", 66: "OpMemberDecorate", 71: "OpVectorShuffle", 73: "OpCompositeConstruct",
    74: "OpCompositeExtract", 76: "OpCopyObject", 79: "OpImageSampleImplicitLod", 80: "OpImageSampleExplicitLod",
    82: "OpImageSampleDrefExplicitLod", 87: "OpImageFetch", 88: "OpImageGather", 90: "OpImageRead", 91: "OpImageWrite",
    118: "OpIAdd", 119: "OpFAdd", 120: "OpISub", 121: "OpFSub", 122: "OpIMul", 123: "OpFMul", 124: "OpUDiv",
    126: "OpFDiv", 138: "OpDot", 158: "OpSelect", 159: "OpIEqual", 161: "OpUGreaterThan", 166: "OpSLessThan",
    169: "OpFOrdEqual", 171: "OpFOrdNotEqual", 173: "OpFOrdLessThan", 175: "OpFOrdGreaterThan",
    184: "OpBitwiseOr", 185: "OpBitwiseXor", 186: "OpBitwiseAnd", 187: "OpNot",
    227: "OpAtomicLoad", 228: "OpAtomicStore", 245: "OpPhi", 246: "OpLoopMerge", 247: "OpSelectionMerge",
    248: "OpLabel", 249: "OpBranch", 250: "OpBranchConditional", 251: "OpSwitch", 253: "OpReturn",
    254: "OpReturnValue", 255: "OpUnreachable"
  };

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
      var m = line.match(/^\s*0x[0-9a-f]{8}:\s*([a-z_][a-z0-9_]*)/);
      if (!m) return;
      var op = m[1];
      counts[op] = (counts[op] || 0) + 1; total++;
      if (/^(s_branch|s_cbranch)/.test(op)) control++;
      if (/^(buffer_|image_|ds_|flat_|tbuffer_|s_buffer_|s_load|s_store|s_scratch)/.test(op)) memory++;
    });
    var h = '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">instructions</span>' +
      '<span class="pg-stat-n">' + total + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">control flow</span><span class="pg-stat-n">' + control + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">memory ops</span><span class="pg-stat-n">' + memory + "</span></div></div>";
    h += '<p class="pg-why">This is the <strong>decoded input ISA</strong> (<code>*.rdna2</code>) — what the recompiler ' +
      "starts from. Control-flow instructions (<code>s_branch*</code>) are the reason the structuriser has to " +
      "recover block structure; memory ops are the ones that need descriptors.</p>";
    if (total) h += renderTop(freqCount(counts), 10);
    return h;
  }

  function summarySpvasm(text) {
    var counts = {}, total = 0, funcs = 0, labels = 0, entry = 0;
    text.split(/\n/).forEach(function (line) {
      var m = line.match(/\b(Op[A-Za-z0-9]+)\b/);
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
      "actually run. The labels are structured control-flow blocks; count them against the <code>s_branch</code>s in the " +
      "input ISA to see how much structure the recompiler had to recover.</p>";
    if (total) h += renderTop(freqCount(counts), 12);
    return h;
  }

  function summarySpvBin(words) {
    var version = words[1] >>> 0, bound = words[3] >>> 0;
    var ver = (version >>> 16) + "." + ((version >>> 8) & 0xff);
    var counts = {}, total = 0, i = 5, bad = 0;
    while (i < words.length) {
      var w = words[i] >>> 0;
      var wc = w & 0xffff, op = w >>> 16;
      if (wc === 0 || i + wc > words.length) { bad++; break; }
      var name = SPV_OPS[op] || "Op_" + op;
      counts[name] = (counts[name] || 0) + 1; total++;
      i += wc;
    }
    var h = '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">format</span>' +
      '<span class="pg-stat-n">SPIR-V ' + ver + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">bound</span><span class="pg-stat-n">' + bound + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">instructions</span><span class="pg-stat-n">' + total + "</span></div></div>";
    h += '<p class="pg-why">This is the <strong>SPIR-V binary</strong> (<code>*.spv</code>). Each instruction starts ' +
      "with a word whose low 16 bits are its length and high 16 its opcode — walking that stream is how Vulkan consumes it.</p>";
    if (total) h += renderTop(freqCount(counts), 12);
    return h;
  }

  function summaryWords(text) {
    var ws = [];
    String(text).split(/[^0-9a-fA-FxX]+/).forEach(function (t) {
      var v = t.replace(/^0[xX]/, "");
      if (!/^[0-9a-fA-F]{1,8}$/.test(v)) return;
      ws.push(parseInt(v, 16) >>> 0);
    });
    if (!ws.length) return '<p class="pg-hint pg-warntext">No hex words found.</p>';
    var fam = {}, names = {}, total = 0, rows = "", i = 0;
    while (i < ws.length) {
      var w1 = i + 1 < ws.length ? ws[i + 1] : undefined;
      var d = rdDecode(ws[i], w1);
      fam[d.family] = (fam[d.family] || 0) + 1;
      names[d.name] = (names[d.name] || 0) + 1; total++;
      rows += "<tr><td>" + i * 4 + '</td><td><code>' + esc(rdFmt(d, i * 4)) + "</code></td></tr>";
      i += d.words;
    }
    var h = '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">instructions</span>' +
      '<span class="pg-stat-n">' + total + "</span></div>" +
      '<div class="pg-stat"><span class="pg-stat-l">encodings</span><span class="pg-stat-n">' +
      Object.keys(fam).length + "</span></div></div>";
    h += "<h4>Encodings present</h4>";
    h += renderTop(freqCount(fam), 10);
    h += "<h4>Decoded instructions</h4><table class='pg-table pg-narrow'><tbody>" + rows + "</tbody></table>";
    return h;
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
    "0x00000004: v_mov_b32 v3, 1.0 ; family=VOP1 opcode=0x01 raw=[0x7e0603a2]",
    "0x00000008: v_add_f32 v0, v0, v1 ; family=VOP2 opcode=0x03 raw=[0x06000200]",
    "0x0000000c: v_mul_f32 v2, v0, v1 ; family=VOP2 opcode=0x08 raw=[0x10100200]",
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
      '<span class="pg-dim">.rdna2 · .spvasm · .spv · or raw ISA words</span></div>' +
      '<input type="file" id="shl-file" accept=".rdna2,.spvasm,.spv,.txt,.log,text/plain" hidden></div>' +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="shl-demo-isa">▶ Demo: .rdna2</button>' +
      '<button type="button" class="pg-btn" id="shl-demo-spv">Demo: .spvasm</button>' +
      '<button type="button" class="pg-btn" id="shl-demo-words">Demo: raw words</button>' +
      '<button type="button" class="pg-btn" id="shl-paste">Paste text</button></div>' +
      '<textarea id="shl-ta" class="pg-ta" rows="6" spellcheck="false" hidden ' +
      'placeholder="Paste a shader artifact here…"></textarea>' +
      '<div class="pg-out" id="shl-out"><p class="pg-hint">Generate these with ' +
      "<code>--graphics-debug-dump true --shader-log-direction File --shader-log-folder _Shaders</code> " +
      "— the <code>.spv</code>/<code>.spvasm</code> land in <code>_Shaders/</code>.</p></div>";

    var out = $("#shl-out", root), drop = $("#shl-drop", root), file = $("#shl-file", root), ta = $("#shl-ta", root);

    function runText(text, name) {
      var t = text.slice(0, 1200);
      var h = '<div class="pg-file">' + esc(name || "pasted text") + "</div>";
      if (/\bOp(?:Function|Capability|MemoryModel)\b/.test(t)) h += summarySpvasm(text);
      else if (/; family=/.test(t)) h += summaryRdna2(text);
      else if (/0x[0-9a-fA-F]{8}/.test(t)) h += summaryWords(text);
      else h += '<p class="pg-hint pg-warntext">Could not recognise this artifact. Expected a ' +
        "<code>.rdna2</code> ISA dump, a <code>.spvasm</code> disassembly, or hex words.</p>";
      out.innerHTML = h;
    }
    function runBuf(buf, name) {
      var dv = new DataView(buf);
      if (buf.byteLength >= 4 && dv.getUint32(0, true) === 0x07230203) {
        var words = [];
        for (var i = 0; i < buf.byteLength; i += 4) words.push(dv.getUint32(i, true));
        out.innerHTML = '<div class="pg-file">' + esc(name) + " (SPIR-V binary)</div>" + summarySpvBin(words);
      } else {
        var u8 = new Uint8Array(buf);
        var hex = [];
        for (var k = 0; k < buf.byteLength; k += 4) {
          var w = u8[k] | (u8[k + 1] << 8) | (u8[k + 2] << 16) | (u8[k + 3] << 24);
          hex.push("0x" + ("00000000" + (w >>> 0).toString(16)).slice(-8));
        }
        out.innerHTML = '<div class="pg-file">' + esc(name) + " (raw words)</div>" + summaryWords(hex.join("\n"));
      }
    }
    function pick(f) {
      if (!f) return;
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext === "spv") {
        var r = new FileReader();
        r.onload = function () { runBuf(r.result, f.name); };
        r.readAsArrayBuffer(f);
      } else {
        var r2 = new FileReader();
        r2.onload = function () { runText(String(r2.result), f.name); };
        r2.readAsText(f);
      }
    }
    drop.addEventListener("click", function () { file.click(); });
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
    $("#shl-demo-isa", root).addEventListener("click", function () { runText(DEMO_RDNA2, "sample-shader.rdna2 (demo)"); });
    $("#shl-demo-spv", root).addEventListener("click", function () { runText(DEMO_SPVASM, "sample-vs.spvasm (demo)"); });
    $("#shl-demo-words", root).addEventListener("click", function () { runText("0xBE800380 0x7E0602A2 0x06000200 0x10100200 0x7C020200 0xBF820001 0xBF810000", "raw words (demo)"); });
    $("#shl-paste", root).addEventListener("click", function () {
      ta.hidden = !ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    ta.addEventListener("input", function () { if (ta.value.trim()) runText(ta.value, "pasted text"); });
  }

  /* ============================================================
     F. C++ primer — buffer & sampler descriptor decoder
     V# (buffer) layout verified against SrtWalker.cpp (stride =
     (hi>>16)&0x3fff); T# (sampler) and the enums from gpu_defs.h.
     ============================================================ */

  var BUF_FORMATS = { 0: "kInvalid", 1: "k8UNorm", 2: "k8SNorm", 5: "k8UInt", 6: "k8SInt", 7: "k16UNorm", 8: "k16SNorm", 11: "k16UInt", 12: "k16SInt", 13: "k16Float", 14: "k8_8UNorm", 15: "k8_8SNorm", 18: "k8_8UInt", 19: "k8_8SInt", 20: "k32UInt", 21: "k32SInt", 22: "k32Float", 23: "k16_16UNorm", 24: "k16_16SNorm", 27: "k16_16UInt", 28: "k16_16SInt", 29: "k16_16Float", 30: "k11_11_10UNorm", 34: "k11_11_10UInt", 35: "k11_11_10SInt", 36: "k11_11_10Float", 43: "k10_11_11Float", 44: "k2_10_10_10UNorm", 45: "k2_10_10_10SNorm", 48: "k2_10_10_10UInt", 49: "k2_10_10_10SInt", 56: "k8_8_8_8UNorm", 57: "k8_8_8_8SNorm", 60: "k8_8_8_8UInt", 61: "k8_8_8_8SInt", 62: "k8_8_8_8Srgb", 63: "k16_16_16_16UNorm", 64: "k16_16_16_16SNorm", 67: "k16_16_16_16UInt", 68: "k16_16_16_16SInt", 69: "k16_16_16_16Float", 70: "k32_32_32_32UInt", 71: "k32_32_32_32SInt", 72: "k32_32_32_32Float", 73: "k2_10_10_10UInt" };
  var CLAMPS = ["kWrap", "kMirror", "kClampLastTexel", "kMirrorOnceLastTexel", "kClampHalfBorder", "kMirrorOnceHalfBorder", "kClampBorder", "kMirrorOnceBorder"];
  var ANISO = ["kOne", "kTwo", "kFour", "kEight", "kSixteen"];
  var SFILT = ["kPoint", "kBilinear", "kAnisoPoint", "kAnisoLinear"];
  var MFILT = ["kNone", "kPoint", "kLinear"];
  var BCOL = ["kTransBlack", "kOpaqueBlack", "kOpaqueWhite", "kFromTable"];

  function toolDesc(root) {
    var kind = "V";
    root.innerHTML =
      '<div class="pg-controls">' +
      '<label class="pg-mini" style="flex:1">Descriptor kind' +
      '<select id="dc-kind" class="pg-sel"><option value="V">V# — buffer</option>' +
      '<option value="T">T# — sampler</option></select></label>' +
      '<label class="pg-mini" style="flex:2">Four dwords (WORD0 … WORD3)<br>' +
      '<input id="dc-w0" class="pg-txt" spellcheck="false" value="0x00000000">' +
      '<input id="dc-w1" class="pg-txt" spellcheck="false" value="0x00200100">' +
      '<input id="dc-w2" class="pg-txt" spellcheck="false" value="0x0000012C">' +
      '<input id="dc-w3" class="pg-txt" spellcheck="false" value="0x80000038"></label>' +
      "</div>" +
      '<div class="pg-row">' +
      '<button type="button" class="pg-btn pg-demo" id="dc-demo-v">▶ Demo: V# vertex buffer</button>' +
      '<button type="button" class="pg-btn" id="dc-demo-t">Demo: T# sampler</button></div>' +
      '<div class="pg-out" id="dc-out"></div>' +
      '<p class="pg-src">V# layout: base (W0 + W1[0:15]), stride (W1[16:29], as read at ' +
      "<code>SrtWalker.cpp:466</code>), num_records (W2[0:29]), data_format (W3[0:5]). Enums from " +
      "<code>gpu_defs.h</code>. The T# sampler has no address — it only describes filtering.</p>";

    var kindSel = $("#dc-kind", root), w = [
      $("#dc-w0", root), $("#dc-w1", root), $("#dc-w2", root), $("#dc-w3", root)
    ], out = $("#dc-out", root);

    function parseHex(v) {
      var s = String(v).trim().replace(/^0[xX]/, "");
      if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
      return parseInt(s, 16) >>> 0;
    }

    function render() {
      var vals = w.map(function (e) { return parseHex(e.value); });
      if (vals.some(function (v) { return v == null; })) {
        out.innerHTML = '<p class="pg-hint pg-warntext">Enter four 32-bit hex words.</p>';
        return;
      }
      var kind = kindSel.value, h = "";
      if (kind === "V") {
        var base = (vals[0] | 0) + (((vals[1] & 0xffff) >>> 0) * 4294967296);
        var stride = (vals[1] >>> 16) & 0x3fff;
        var num = vals[2] & 0x3fffffff;
        var fmt = vals[3] & 0x3f;
        var type = (vals[3] >>> 30) & 1;
        var valid = (vals[3] >>> 31) & 1;
        var totalBytes = num * stride;
        h += '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">valid</span>' +
          '<span class="pg-stat-n">' + (valid ? "yes" : "NO") + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">base address</span><span class="pg-stat-n" style="font-size:11px">0x' +
          base.toString(16).toUpperCase() + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">stride × records</span><span class="pg-stat-n">' + stride + " × " + num + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">byte range</span><span class="pg-stat-n">' + totalBytes.toLocaleString() + "</span></div></div>";
        h += '<table class="pg-table pg-narrow"><tbody>' +
          "<tr><td>base address</td><td><code>W0 + W1[0:15]</code> → 0x" + base.toString(16).toUpperCase() + "</td></tr>" +
          "<tr><td>stride</td><td><code>W1[16:29]</code> → " + stride + " bytes per element</td></tr>" +
          "<tr><td>num_records</td><td><code>W2[0:29]</code> → " + num.toLocaleString() + "</td></tr>" +
          "<tr><td>data_format</td><td><code>W3[0:5]</code> → <strong>" + esc(BUF_FORMATS[fmt] || "0x" + fmt.toString(16)) + "</strong></td></tr>" +
          "<tr><td>type</td><td><code>W3[30]</code> → " + (type ? "SBUF" : "UBUF") + "</td></tr>" +
          "<tr><td>valid</td><td><code>W3[31]</code> → " + (valid ? "1" : "0") + "</td></tr>" +
          "</tbody></table>";
        h += '<p class="pg-why">' + (valid ? "" : "Invalid — the shader must not bind this (it is a hole in the SRT). ") +
          "A <code>buffer_load</code> reads element <code>i</code> at <code>base + i×stride</code>; " +
          "the driver checks <code>num_records</code> for out-of-bounds. That is the whole V# story.</p>";
      } else {
        var cx = vals[0] & 3, cy = (vals[0] >>> 2) & 3, cz = (vals[0] >>> 4) & 3;
        var aniso = (vals[0] >>> 6) & 0xf;
        var cmp = (vals[0] >>> 10) & 3;
        var mag = (vals[1] >>> 2) & 7, min = (vals[1] >>> 5) & 7, mip = (vals[1] >>> 8) & 7;
        var minLod = (vals[1] >>> 16) & 0xf, maxLod = (vals[1] >>> 20) & 0xf;
        var border = vals[2] & 3;
        h += '<div class="pg-stats"><div class="pg-stat"><span class="pg-stat-l">clamp</span>' +
          '<span class="pg-stat-n">' + (CLAMPS[cx] || cx) + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">filter</span><span class="pg-stat-n">' +
          (SFILT[mag] || mag) + " / " + (SFILT[min] || min) + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">mip filter</span><span class="pg-stat-n">' + (MFILT[mip] || mip) + "</span></div>" +
          '<div class="pg-stat"><span class="pg-stat-l">max aniso</span><span class="pg-stat-n">' + (ANISO[aniso] || aniso) + "</span></div></div>";
        h += '<table class="pg-table pg-narrow"><tbody>' +
          "<tr><td>clamp X / Y / Z</td><td>" + CLAMPS[cx] + " / " + CLAMPS[cy] + " / " + CLAMPS[cz] + "</td></tr>" +
          "<tr><td>max aniso ratio</td><td><code>W0[6:9]</code> → " + (ANISO[aniso] || "0x" + aniso.toString(16)) + "</td></tr>" +
          "<tr><td>mag / min filter</td><td><code>W1[2:4] / W1[5:7]</code> → " + (SFILT[mag] || "?") + " / " + (SFILT[min] || "?") + "</td></tr>" +
          "<tr><td>mip filter</td><td><code>W1[8:10]</code> → " + (MFILT[mip] || "?") + "</td></tr>" +
          "<tr><td>lod range</td><td><code>W1[16:19] / W1[20:23]</code> → " + minLod + " – " + maxLod + "</td></tr>" +
          "<tr><td>border color</td><td><code>W2[0:1]</code> → " + (BCOL[border] || "?") + "</td></tr>" +
          "</tbody></table>";
        h += '<p class="pg-why">A sampler has no address and no data — it only says <em>how</em> to sample: ' +
          "wrap or clamp, which filter, anisotropy, and the lod clamp. The game builds these from its own " +
          "sampler state and hands them to the shader as a T# in the SRT.</p>";
      }
      out.innerHTML = h;
    }

    kindSel.addEventListener("change", render);
    w.forEach(function (e) { e.addEventListener("input", render); });
    $("#dc-demo-v", root).addEventListener("click", function () {
      kindSel.value = "V";
      w[0].value = "0x00000000"; w[1].value = "0x00200100"; w[2].value = "0x0000012C"; w[3].value = "0x80000038";
      render();
    });
    $("#dc-demo-t", root).addEventListener("click", function () {
      kindSel.value = "T";
      w[0].value = "0x000000AA"; w[1].value = "0x00000224"; w[2].value = "0x00000000"; w[3].value = "0x00000000";
      render();
    });
    render();
  }

  /* ---------------- boot ---------------- */

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
