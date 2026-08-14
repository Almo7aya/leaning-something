/* ============================================================
   highlight.js — syntax highlighting for the code blocks.

   Written rather than vendored for one specific reason: 88 of the
   119 code blocks on this site already contain markup. The book
   author used <b> to draw the eye to a token and <i> for trailing
   comments. Every drop-in highlighter works by replacing a block's
   innerHTML, which would throw all of that away.

   So this walks TEXT NODES only, leaves existing elements alone,
   and never touches the DOM structure it did not create. Tokens are
   emitted as <span class="tk-*"> and coloured from the same palette
   as everything else.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- language tables ---------------- */

  var CPP_KW = wordSet(
    "alignas alignof asm auto break case catch class concept const consteval " +
    "constexpr constinit const_cast continue co_await co_return co_yield decltype " +
    "default delete do else enum explicit export extern false for friend goto if " +
    "inline mutable namespace new noexcept nullptr operator private protected " +
    "public reinterpret_cast requires return sizeof static static_assert " +
    "static_cast struct switch template this thread_local throw true try typedef " +
    "typeid typename union using virtual volatile while and or not xor");

  var CPP_TYPE = wordSet(
    "bool char char8_t char16_t char32_t double float int long short signed " +
    "unsigned void wchar_t size_t ssize_t ptrdiff_t nullptr_t " +
    "int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t " +
    "intptr_t uintptr_t std string string_view vector array span deque map " +
    "unordered_map set optional variant tuple pair function atomic mutex " +
    "unique_ptr shared_ptr weak_ptr jthread thread " +
    "Elf64_Word Elf64_Addr Elf64_Half Elf64_Xword Elf64_Sxword Elf64_Rela");

  var SHELL_KW = wordSet(
    "cd echo export set if then else fi for do done while function return " +
    "rg grep cat ls cmake ninja make git node python powershell pwsh");

  var ASM_REG = /^(?:r[a-z0-9]{1,3}|e[a-z]{2}|[a-d][lhx]|si|di|bp|sp|xmm\d+|[vs]\d+|[vs]gpr\d+|exec|vcc|m0)$/i;

  function wordSet(s) {
    var o = Object.create(null);
    s.split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
    return o;
  }

  /* ---------------- language detection ----------------
     None of the blocks carry a language class, so guess from the
     content. Ordering matters: shell and asm are checked first
     because they are narrow, and C-like is the fallback. */

  function detect(text) {
    var t = text.slice(0, 1200);

    if (/(^|\n)\s*(?:\.\\|PS>|\$ |#!\/)/.test(t) ||
        /kyty_emulator|--game\b|--printf-direction|--shader-log|--command-buffer-dump/.test(t) ||
        /(^|\n)\s*(?:rg|grep|cmake|ninja|git|ls|cd)\s+\S/.test(t)) {
      return "shell";
    }
    if (/(^|\n)\s*(?:v_|s_|buffer_|ds_|flat_)\w+\s/.test(t) ||
        /(^|\n)\s*(?:mov|lea|call|jmp|push|pop|add|sub|cmp|test|ret)\s+[a-z%\[]/i.test(t)) {
      return "asm";
    }
    if (/^\s*[{[]/.test(t) && /"\s*:/.test(t)) return "json";
    return "cpp";
  }

  /* ---------------- tokenisers ----------------
     Each returns an array of {t: text, c: class|null}. A single
     master regex per language keeps ordering unambiguous: whatever
     alternative matches first at a position wins, so comments and
     strings always beat keywords inside them. */

  var RX_CPP = new RegExp([
    "(\\/\\/[^\\n]*)",                         // 1 line comment
    "(\\/\\*[\\s\\S]*?\\*\\/)",                // 2 block comment
    "(\"(?:\\\\.|[^\"\\\\\\n])*\"?)",          // 3 string
    "('(?:\\\\.|[^'\\\\\\n])*'?)",             // 4 char
    "(^[ \\t]*#\\s*\\w+)",                     // 5 preprocessor
    "(<[A-Za-z0-9_./]+>)",                     // 6 include target
    "(\\b0[xX][0-9a-fA-F']+[uUlL]*\\b|\\b\\d[\\d']*\\.?\\d*(?:[eE][-+]?\\d+)?[uUlLfF]*\\b)", // 7 number
    "([A-Za-z_]\\w*)"                          // 8 word
  ].join("|"), "gm");

  function cpp(text) {
    var out = [], last = 0, m;
    RX_CPP.lastIndex = 0;
    while ((m = RX_CPP.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1] || m[2]) out.push({ t: m[0], c: "tk-c" });
      else if (m[3] || m[4] || m[6]) out.push({ t: m[0], c: "tk-s" });
      else if (m[5]) out.push({ t: m[0], c: "tk-p" });
      else if (m[7]) out.push({ t: m[0], c: "tk-n" });
      else {
        var w = m[8];
        if (CPP_KW[w]) out.push({ t: w, c: "tk-k" });
        else if (CPP_TYPE[w] || /_t$/.test(w)) out.push({ t: w, c: "tk-t" });
        else out.push({ t: w });
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  var RX_SH = new RegExp([
    "(#[^\\n]*)",                              // 1 comment
    "(\"(?:\\\\.|[^\"\\\\])*\"?|'(?:[^'])*'?)",// 2 string
    "(\\s--?[A-Za-z][\\w-]*)",                 // 3 flag
    "(\\$\\w+|\\$\\{[^}]*\\})",                // 4 variable
    "(\\b\\d+\\b)",                            // 5 number
    "([A-Za-z_][\\w.-]*)"                      // 6 word
  ].join("|"), "gm");

  function shell(text) {
    var out = [], last = 0, m;
    RX_SH.lastIndex = 0;
    while ((m = RX_SH.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1]) out.push({ t: m[0], c: "tk-c" });
      else if (m[2]) out.push({ t: m[0], c: "tk-s" });
      else if (m[3]) out.push({ t: m[0], c: "tk-a" });
      else if (m[4]) out.push({ t: m[0], c: "tk-t" });
      else if (m[5]) out.push({ t: m[0], c: "tk-n" });
      else out.push(SHELL_KW[m[6]] ? { t: m[0], c: "tk-k" } : { t: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  var RX_ASM = new RegExp([
    "([;#][^\\n]*)",                           // 1 comment
    "(\\b0[xX][0-9a-fA-F]+\\b|\\b\\d+\\b)",    // 2 number
    "(^[ \\t]*[A-Za-z_][\\w.]*)",              // 3 mnemonic at line start
    "([A-Za-z_][\\w.]*)"                       // 4 word
  ].join("|"), "gm");

  function asm(text) {
    var out = [], last = 0, m;
    RX_ASM.lastIndex = 0;
    while ((m = RX_ASM.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1]) out.push({ t: m[0], c: "tk-c" });
      else if (m[2]) out.push({ t: m[0], c: "tk-n" });
      else if (m[3]) out.push({ t: m[0], c: "tk-k" });
      else out.push(ASM_REG.test(m[4]) ? { t: m[0], c: "tk-t" } : { t: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  var RX_JSON = /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+\.?\d*(?:[eE][-+]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;

  function json(text) {
    var out = [], last = 0, m;
    RX_JSON.lastIndex = 0;
    while ((m = RX_JSON.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      if (m[1]) {
        out.push({ t: m[1], c: m[2] ? "tk-t" : "tk-s" });
        if (m[2]) out.push({ t: m[2] });
      } else if (m[3]) out.push({ t: m[0], c: "tk-n" });
      else out.push({ t: m[0], c: "tk-k" });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }

  var LANG = { cpp: cpp, shell: shell, asm: asm, json: json };

  /* ---------------- DOM pass ---------------- */

  // Text inside these is already meaningful: <b> is the author's own
  // emphasis, <i> is a comment they marked by hand, <a> is a link.
  // Re-colouring inside them would fight styling that is already correct.
  var SKIP = { B: 1, I: 1, A: 1, CODE: 1, EM: 1, STRONG: 1, MARK: 1 };

  function shouldSkip(node, root) {
    for (var n = node.parentNode; n && n !== root; n = n.parentNode) {
      if (SKIP[n.nodeName]) return true;
      if (n.classList && n.classList.contains("tk")) return true;
    }
    return false;
  }

  function highlight(pre) {
    if (pre.dataset.hl) return;               // idempotent
    var text = pre.textContent;
    if (!text || text.length > 60000) { pre.dataset.hl = "skip"; return; }

    var fn = LANG[pre.dataset.lang || detect(text)] || cpp;

    // Collect first: the walker must not see nodes we are inserting.
    var walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim() && !shouldSkip(n, pre)) nodes.push(n);
    }

    nodes.forEach(function (node) {
      var parts;
      try { parts = fn(node.nodeValue); }
      catch (err) { if (window.console) console.error("highlight", err); return; }
      if (parts.length < 2) return;

      var frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (!p.t) return;
        if (p.c) {
          var s = document.createElement("span");
          s.className = "tk " + p.c;
          s.appendChild(document.createTextNode(p.t));
          frag.appendChild(s);
        } else {
          frag.appendChild(document.createTextNode(p.t));
        }
      });
      node.parentNode.replaceChild(frag, node);
    });

    pre.dataset.hl = "1";
  }

  function run(root) {
    var pres = (root || document).querySelectorAll("pre");
    Array.prototype.forEach.call(pres, function (pre) {
      // widget-generated blocks style themselves; leave them alone
      if (pre.closest("[data-viz]")) return;
      try { highlight(pre); }
      catch (err) { if (window.console) console.error("highlight block", err); }
    });
  }

  // `_lang` is exported so the round-trip invariant (tokens must rejoin
  // into exactly the input) can be tested outside a browser.
  window.HL = { run: run, highlight: highlight, detect: detect, _lang: LANG };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { run(); }, { once: true });
  } else {
    run();
  }
})();
