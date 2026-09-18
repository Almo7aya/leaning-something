/* ============================================================
   KytyPS5 Learning Platform — app shell.
   Renders the single sidebar, progress, palette, prev/next and
   the Explain-this affordance. One shell for every page.
   ============================================================ */
(function () {
  "use strict";

  var LS_THEME = "kyty.theme";
  var LS_DONE = "kyty.done";      // { topicId: true }  topic marked complete
  var LS_CHECK = "kyty.check";    // { "topic:idx": true }  individual checkboxes

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function readJSON(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var TOPICS = window.KYTY_TOPICS || [];
  var LIST = TOPICS.filter(function (t) { return !t.part; });

  function currentFile() {
    var p = location.pathname.replace(/\/+$/, "");
    return p.slice(p.lastIndexOf("/") + 1) || "index.html";
  }
  function currentTopic() {
    var f = currentFile();
    for (var i = 0; i < LIST.length; i++) if (LIST[i].file === f) return LIST[i];
    return null;
  }

  /* ---------------- theme ---------------- */

  function stored() { try { return localStorage.getItem(LS_THEME); } catch (e) { return null; } }
  function sysTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function theme() { return stored() || sysTheme(); }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(stored());

  var themeBtn = null;
  function syncThemeBtn() {
    if (!themeBtn) return;
    var d = theme() === "dark";
    themeBtn.textContent = d ? "☀" : "☾";
    themeBtn.title = d ? "Switch to light" : "Switch to dark";
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  function toggleTheme() {
    var next = theme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(LS_THEME, next); } catch (e) {}
    applyTheme(next); syncThemeBtn();
  }

  /* ---------------- progress ---------------- */

  function done() { return readJSON(LS_DONE, {}); }
  function isDone(id) { return !!done()[id]; }
  function setDone(id, v) {
    var d = done();
    if (v) d[id] = true; else delete d[id];
    writeJSON(LS_DONE, d);
  }
  function progress() {
    var d = done(), n = 0;
    var real = LIST.filter(function (t) { return t.id !== "playground" && t.id !== "lifetime" && t.id !== "machine" && t.id !== "system-explorer" && t.id !== "browser-emulator"; });
    real.forEach(function (t) { if (d[t.id]) n++; });
    return { done: n, total: real.length, pct: real.length ? Math.round(n / real.length * 100) : 0 };
  }

  /* ---------------- sidebar ---------------- */

  var sideNav = null;

  function buildShell() {
    var here = currentFile();

    var app = el("div", "app");

    /* --- sidebar --- */
    var side = el("aside", "side");
    side.setAttribute("aria-label", "Course");

    var top = el("div", "side-top");
    var brand = el("a", "side-brand");
    brand.href = "index.html";
    brand.appendChild(el("span", "side-dot"));
    brand.appendChild(el("span", null, "KytyPS5"));
    top.appendChild(brand);
    var sub = el("p", "side-sub", "Learning platform");
    top.appendChild(sub);

    var filter = el("input", "side-search");
    filter.type = "search";
    filter.placeholder = "Filter topics…";
    filter.setAttribute("aria-label", "Filter topics");
    top.appendChild(filter);
    side.appendChild(top);

    sideNav = el("nav", "side-nav");
    renderNav(sideNav, here, "");
    side.appendChild(sideNav);

    filter.addEventListener("input", function () {
      renderNav(sideNav, here, filter.value.trim().toLowerCase());
    });

    var foot = el("div", "side-foot");
    var pr = progress();
    var pw = el("div", "side-prog");
    var tr = el("div", "side-prog-track");
    var fi = el("div", "side-prog-fill");
    fi.style.width = pr.pct + "%";
    tr.appendChild(fi);
    pw.appendChild(tr);
    pw.appendChild(el("span", "side-prog-l", pr.done + " of " + pr.total + " topics done"));
    foot.appendChild(pw);

    themeBtn = el("button", "icon-btn");
    themeBtn.type = "button";
    themeBtn.addEventListener("click", toggleTheme);
    foot.appendChild(themeBtn);
    syncThemeBtn();
    side.appendChild(foot);

    var scrim = el("div", "side-scrim");
    scrim.addEventListener("click", function () {
      document.documentElement.classList.remove("side-open");
    });

    var toggle = el("button", "side-toggle", "☰");
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Open navigation");
    toggle.addEventListener("click", function () {
      document.documentElement.classList.toggle("side-open");
    });

    /* --- main --- */
    var main = el("div", "main");

    var bar = el("div", "topbar");
    var t = currentTopic();
    var crumb = el("div", "crumb", t ? (partOf(t) + " · " + t.title) : "Home");
    bar.appendChild(crumb);

    var right = el("div", "topbar-right");
    var searchBtn = el("button", "btn");
    searchBtn.type = "button";
    searchBtn.innerHTML = '⌕ Search <kbd class="kbd">' +
      (navigator.platform.indexOf("Mac") === 0 ? "⌘" : "Ctrl ") + "K</kbd>";
    searchBtn.addEventListener("click", function () { openPalette(); });
    right.appendChild(searchBtn);

    var ask = el("button", "btn btn-primary", "Ask AI");
    ask.type = "button";
    ask.id = "pf-ask";
    right.appendChild(ask);
    bar.appendChild(right);
    main.appendChild(bar);

    // move existing body content into main
    var holder = document.querySelector("[data-app-content]") || document.querySelector("main");
    if (holder) {
      holder.parentNode.removeChild(holder);
      main.appendChild(holder);
    }

    app.appendChild(side);
    app.appendChild(main);
    document.body.insertBefore(app, document.body.firstChild);
    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(toggle, document.body.firstChild);

    if (holder) addPager(holder);
  }

  function partOf(topic) {
    var p = "";
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i].part) p = TOPICS[i].part;
      if (TOPICS[i] === topic) return p;
    }
    return p;
  }

  function renderNav(root, here, q) {
    root.innerHTML = "";
    var d = done();
    var pendingPart = null;
    TOPICS.forEach(function (t) {
      if (t.part) { pendingPart = t.part; return; }
      if (q && t.title.toLowerCase().indexOf(q) < 0 && (t.n || "").indexOf(q) < 0) return;
      if (pendingPart) {
        root.appendChild(el("div", "side-part", pendingPart));
        pendingPart = null;
      }
      var a = el("a", "side-link");
      a.href = t.ready ? t.file : "#";
      if (!t.ready) {
        a.style.opacity = ".42";
        a.style.pointerEvents = "none";
        a.title = "Not written yet";
      }
      if (t.file === here) a.setAttribute("aria-current", "page");
      a.appendChild(el("span", "side-n", t.n));
      a.appendChild(el("span", null, t.title));
      if (d[t.id]) a.appendChild(el("span", "side-done", "✓"));
      root.appendChild(a);
    });
  }

  /* ---------------- prev / next ---------------- */

  function addPager(holder) {
    var t = currentTopic();
    if (!t) return;
    var real = LIST.filter(function (x) { return x.id !== "playground"; });
    var i = real.indexOf(t);
    if (i < 0) return;

    // nearest built neighbours
    function nearest(dir) {
      for (var j = i + dir; j >= 0 && j < real.length; j += dir) {
        if (real[j].ready) return real[j];
      }
      return null;
    }
    var prev = nearest(-1), next = nearest(1);
    if (!prev && !next) return;

    var p = el("nav", "pager");
    p.setAttribute("aria-label", "Topic navigation");
    if (prev) {
      var a = el("a", "prev");
      a.href = prev.file;
      a.innerHTML = '<span class="dir">← Previous</span><span class="ttl">' + esc(prev.title) + "</span>";
      p.appendChild(a);
    }
    if (next) {
      var b = el("a", "next");
      b.href = next.file;
      b.innerHTML = '<span class="dir">Next →</span><span class="ttl">' + esc(next.title) + "</span>";
      p.appendChild(b);
    }
    holder.appendChild(p);
  }

  /* ---------------- checkpoints ---------------- */

  function wireCheckpoints() {
    var t = currentTopic();
    if (!t) return;
    var saved = readJSON(LS_CHECK, {});
    var boxes = document.querySelectorAll(".check-item input[type=checkbox]");
    boxes.forEach(function (b, i) {
      var key = t.id + ":" + i;
      if (!b.id) { b.id = "chk-" + t.id + "-" + i; }
      var lab = b.nextElementSibling;
      if (lab && lab.tagName === "LABEL" && !lab.htmlFor) lab.htmlFor = b.id;
      b.checked = !!saved[key];
      b.addEventListener("change", function () {
        var s = readJSON(LS_CHECK, {});
        if (b.checked) s[key] = true; else delete s[key];
        writeJSON(LS_CHECK, s);
        // topic counts as done when every box is ticked
        var all = document.querySelectorAll(".check-item input[type=checkbox]");
        var allDone = Array.prototype.every.call(all, function (x) { return x.checked; });
        setDone(t.id, allDone && all.length > 0);
        renderNav(sideNav, currentFile(), "");
        var fill = document.querySelector(".side-prog-fill");
        var lbl = document.querySelector(".side-prog-l");
        var pr = progress();
        if (fill) fill.style.width = pr.pct + "%";
        if (lbl) lbl.textContent = pr.done + " of " + pr.total + " topics done";
      });
    });
  }

  /* ---------------- home dashboard ---------------- */

  function renderHome() {
    var slot = document.getElementById("resume-slot");
    var grid = document.getElementById("pgrid");
    if (!slot && !grid) return;
    // idempotent: safe to call again after progress changes
    if (slot) slot.innerHTML = "";
    if (grid) grid.innerHTML = "";

    var d = done();
    var real = LIST.filter(function (t) { return t.id !== "playground" && t.id !== "lifetime" && t.id !== "machine" && t.id !== "system-explorer" && t.id !== "browser-emulator"; });
    var built = real.filter(function (t) { return t.ready; });

    // Next thing to do: first built topic not yet finished, else the first built one.
    var next = null;
    for (var i = 0; i < built.length; i++) {
      if (!d[built[i].id]) { next = built[i]; break; }
    }
    var anyDone = built.some(function (t) { return d[t.id]; });
    var allDone = built.length > 0 && !next;
    if (!next) next = built[0];

    if (slot && next) {
      var card = el("div", "resume");
      var left = el("div", "resume-l");
      left.appendChild(el("p", "resume-k",
        allDone ? "Everything written so far is done" : anyDone ? "Pick up where you left off" : "Start here"));
      left.appendChild(el("p", "resume-t", next.n + " · " + next.title));
      if (next.blurb) left.appendChild(el("p", "resume-d", next.blurb));
      card.appendChild(left);

      var go = el("a", "resume-btn", (anyDone && !allDone ? "Resume" : allDone ? "Revisit" : "Begin") + "  →");
      go.href = next.file;
      card.appendChild(go);
      slot.appendChild(card);
    }

    if (grid) {
      var here = currentFile();
      real.forEach(function (t) {
        var cls = "pcell " + (d[t.id] ? "done" : t.ready ? "ready" : "soon");
        if (t.file === here) cls += " here";
        var node;
        if (t.ready) { node = el("a", cls, t.n); node.href = t.file; }
        else { node = el("span", cls, t.n); }
        node.title = t.title + (t.ready ? "" : " — not written yet");
        grid.appendChild(node);
      });
      var lbl = document.getElementById("pgrid-l");
      if (lbl) {
        var nDone = built.filter(function (t) { return d[t.id]; }).length;
        // Only mention how many are written while some still aren't.
        var pending = built.length < real.length
          ? " · " + built.length + " of " + real.length + " written so far"
          : "";
        lbl.innerHTML = nDone + " of " + built.length + " topics done" + pending +
          ' · <a href="playground.html">Playground →</a>';
      }
    }
  }

  /* ---------------- search palette ---------------- */

  var palEl = null, resEl = null, inEl = null, act = 0, hits = [];

  function index() {
    var idx = (window.KYTY_INDEX || []).slice();
    // topics themselves are always findable
    LIST.forEach(function (t) {
      if (!t.ready) return;
      idx.push({ t: t.title, f: t.file, a: "", s: t.n === "→" ? "TOOL" : "TOPIC" });
    });
    var here = currentFile();
    document.querySelectorAll("h2[id],h3[id],h4[id]").forEach(function (h) {
      idx.push({
        t: (h.textContent || "").replace(/Explain this/, "").replace(/\s+/g, " ").trim(),
        f: here, a: h.id, s: "THIS PAGE"
      });
    });
    return idx;
  }

  function score(e, q) {
    var t = e.t.toLowerCase(), i = t.indexOf(q);
    if (i < 0) return 0;
    if (i === 0) return 100;
    if (/\W/.test(t[i - 1])) return 60;
    return 25;
  }

  function hl(txt, q) {
    var t = txt.toLowerCase(), i = t.indexOf(q);
    if (i < 0) return esc(txt);
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + q.length)) + "</mark>" + esc(txt.slice(i + q.length));
  }

  function openPalette() {
    if (palEl) return;
    var idx = index();

    var ov = el("div", "pal-overlay");
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) closePalette(); });

    var box = el("div", "pal");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    inEl = el("input", "pal-in");
    inEl.type = "search";
    inEl.placeholder = "Search topics and sections…";
    box.appendChild(inEl);

    resEl = el("div", "pal-res");
    box.appendChild(resEl);

    var f = el("div", "pal-foot");
    f.innerHTML = '<span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> move</span>' +
      '<span><kbd class="kbd">↵</kbd> open</span><span><kbd class="kbd">esc</kbd> close</span>' +
      '<span style="margin-left:auto">' + idx.length + " entries</span>";
    box.appendChild(f);

    ov.appendChild(box);
    document.body.appendChild(ov);
    palEl = ov;

    function render() {
      var q = inEl.value.trim().toLowerCase();
      hits = q
        ? idx.map(function (e) { return { e: e, s: score(e, q) }; })
            .filter(function (r) { return r.s > 0; })
            .sort(function (a, b) { return b.s - a.s; })
            .slice(0, 40).map(function (r) { return r.e; })
        : LIST.filter(function (t) { return t.ready; })
              .map(function (t) { return { t: t.title, f: t.file, a: "", s: "TOPIC" }; });
      act = 0;
      if (!hits.length) {
        resEl.innerHTML = '<div class="pal-empty">Nothing matches “' + esc(q) + '”.</div>';
        return;
      }
      resEl.innerHTML = hits.map(function (h, i) {
        return '<a class="pal-item" data-i="' + i + '" data-active="' + (i === 0 ? 1 : 0) +
          '" href="' + esc(h.f) + (h.a ? "#" + esc(h.a) : "") + '">' +
          '<span class="pal-t">' + hl(h.t, q) + "</span>" +
          '<span class="pal-s">' + esc(h.s || "") + "</span></a>";
      }).join("");
    }

    function move(d) {
      var nodes = resEl.querySelectorAll(".pal-item");
      if (!nodes.length) return;
      nodes[act] && nodes[act].setAttribute("data-active", "0");
      act = (act + d + nodes.length) % nodes.length;
      nodes[act].setAttribute("data-active", "1");
      nodes[act].scrollIntoView({ block: "nearest" });
    }

    inEl.addEventListener("input", render);
    ov.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var n = resEl.querySelectorAll(".pal-item")[act];
        if (n) { closePalette(); location.href = n.getAttribute("href"); }
      }
    });
    render();
    inEl.focus();
  }

  function closePalette() {
    if (palEl) { palEl.remove(); palEl = null; resEl = null; inEl = null; }
  }

  /* ---------------- explain this ---------------- */

  function sectionText(h) {
    var lvl = +h.tagName.slice(1), out = [h.textContent.replace("Explain this", "").trim()];
    var n = h.nextElementSibling, budget = 2600;
    while (n && budget > 0) {
      if (/^H[1-6]$/.test(n.tagName) && +n.tagName.slice(1) <= lvl) break;
      var t = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim();
      if (t) { out.push(t.slice(0, budget)); budget -= t.length; }
      n = n.nextElementSibling;
    }
    return out.join("\n\n");
  }

  function addExplain() {
    document.querySelectorAll(".topic h1, .topic h3, .topic h4, .prose h3, .prose h4").forEach(function (h) {
      if (h.querySelector(".explain")) return;
      var txt = h.textContent.replace(/\s+/g, " ").trim();
      if (!txt || txt.length > 140) return;
      var b = el("button", "explain", "Explain this");
      b.type = "button";
      b.setAttribute("aria-label", "Ask the tutor to explain: " + txt);
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        PF.ask({ heading: txt, context: sectionText(h),
                 question: "Explain this section to me. I'm new to emulation." });
      });
      h.appendChild(b);
    });
  }

  /* ---------------- public ---------------- */

  var PF = window.PF = {
    topics: TOPICS, list: LIST,
    currentFile: currentFile, currentTopic: currentTopic,
    progress: progress, openPalette: openPalette, theme: theme,
    esc: esc, el: el,
    pageTitle: function () { var t = currentTopic(); return t ? t.title : (document.title || "Home"); },
    ask: function (p) { PF._pendingAsk = p; },
    renderHome: function () { return renderHome(); }
  };

  /* ---------------- boot ---------------- */

  function boot() {
    if (!document.body) return;
    buildShell();
    // Each step is independent: one throwing must not take the rest of the
    // shell down with it.
    [renderHome, addExplain, wireCheckpoints].forEach(function (step) {
      try { step(); }
      catch (err) { if (window.console) console.error("app: " + step.name + " failed", err); }
    });

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        palEl ? closePalette() : openPalette();
      } else if (e.key === "/" && !palEl) {
        var t = e.target, tag = t && t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
        e.preventDefault(); openPalette();
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

