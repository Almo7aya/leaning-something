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
     Verbatim from src/loader/runtimeLinker.cpp:1015-1029
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
      '<p class="pg-src">Verbatim from <code>src/loader/runtimeLinker.cpp:1015–1029</code>. ' +
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

  /* ---------------- boot ---------------- */

  var TOOLS = {
    "pg-pm4": toolPm4,
    "pg-id64": toolId64,
    "pg-elf": toolElf,
    "pg-log": toolLog
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
