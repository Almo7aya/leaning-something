/* ============================================================
   KytyPS5 Learning Platform — shell
   Injects nav, theme, command palette, progress, "Explain this".
   Exposes window.PF for tutor.js / playground.js / page scripts.
   ============================================================ */
(function () {
  "use strict";

  // Ordered the way you'd actually work through them.
  var PAGES = [
    { file: "index.html", label: "Home", short: "HOME", blurb: "Where everything is" },
    { file: "tour.html", label: "Tour", short: "TOUR", blurb: "The short orientation read" },
    { file: "atlas.html", label: "Atlas", short: "ATLAS", blurb: "Watch it work" },
    { file: "lab.html", label: "Lab", short: "LAB", blurb: "Play with the concepts" },
    { file: "playground.html", label: "Playground", short: "PLAY", blurb: "Tools on your own files" },
    { file: "examples.html", label: "Examples", short: "EXAMPLES", blurb: "Worked end to end" },
    { file: "course.html", label: "Course", short: "COURSE", blurb: "The deep reference read" },
    { file: "path.html", label: "Path", short: "PATH", blurb: "Track what you've done" }
  ];

  var LS_THEME = "kyty.theme";
  var LS_SEEN = "kyty.seen";
  var LS_TASKS = "kyty.path.tasks"; // written by the learning path page

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function readJSON(key, dflt) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota / private mode */ }
  }

  function currentFile() {
    var p = location.pathname.replace(/\/+$/, "");
    var f = p.slice(p.lastIndexOf("/") + 1);
    return f || "index.html";
  }

  /* ---------------- theme ---------------- */

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  function storedTheme() {
    try { return localStorage.getItem(LS_THEME); } catch (e) { return null; }
  }
  function effectiveTheme() { return storedTheme() || systemTheme(); }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  function toggleTheme() {
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(LS_THEME, next); } catch (e) {}
    applyTheme(next);
    updateThemeButton();
  }
  var themeBtn = null;
  function updateThemeButton() {
    if (!themeBtn) return;
    var dark = effectiveTheme() === "dark";
    themeBtn.textContent = dark ? "☀" : "☾";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.title = themeBtn.getAttribute("aria-label");
  }

  applyTheme(storedTheme()); // before first paint where possible

  /* ---------------- progress ---------------- */

  // Progress = learning-path tasks done (weighted 70%) + pages visited (30%).
  function progress() {
    var tasks = readJSON(LS_TASKS, null);
    var doneTasks = 0, totalTasks = 0;
    if (tasks && typeof tasks === "object") {
      Object.keys(tasks).forEach(function (k) {
        totalTasks++;
        if (tasks[k]) doneTasks++;
      });
    }
    var seen = readJSON(LS_SEEN, {});
    var seenCount = 0;
    PAGES.forEach(function (p) { if (seen[p.file]) seenCount++; });

    var taskPart = totalTasks ? doneTasks / totalTasks : 0;
    var seenPart = seenCount / PAGES.length;
    var pct = totalTasks ? taskPart * 0.7 + seenPart * 0.3 : seenPart;
    return {
      pct: Math.round(pct * 100),
      doneTasks: doneTasks,
      totalTasks: totalTasks,
      seen: seenCount,
      pages: PAGES.length
    };
  }

  function markSeen() {
    var seen = readJSON(LS_SEEN, {});
    var f = currentFile();
    if (!seen[f]) { seen[f] = Date.now(); writeJSON(LS_SEEN, seen); }
  }

  /* ---------------- nav ---------------- */

  function buildNav() {
    var here = currentFile();
    var nav = el("nav", "pf-nav");
    nav.setAttribute("aria-label", "Platform");

    var brand = el("a", "pf-brand");
    brand.href = "index.html";
    brand.appendChild(el("span", "pf-brand-dot"));
    var bt = el("span", null, "KytyPS5");
    brand.appendChild(bt);
    nav.appendChild(brand);

    var links = el("div", "pf-links");
    PAGES.forEach(function (p) {
      if (p.file === "index.html") return; // brand covers home
      var a = el("a", "pf-link", p.label);
      a.href = p.file;
      if (p.file === here) a.setAttribute("aria-current", "page");
      links.appendChild(a);
    });
    nav.appendChild(links);

    var right = el("div", "pf-nav-right");

    var prog = progress();
    var pa = el("a", "pf-progress");
    pa.href = "kytyps5-learning-path.html";
    pa.title = prog.totalTasks
      ? prog.doneTasks + " of " + prog.totalTasks + " tasks done · " + prog.seen + "/" + prog.pages + " pages visited"
      : prog.seen + " of " + prog.pages + " pages visited";
    var track = el("span", "pf-progress-track");
    var fill = el("span", "pf-progress-fill");
    fill.style.width = prog.pct + "%";
    track.appendChild(fill);
    pa.appendChild(track);
    pa.appendChild(el("span", null, prog.pct + "%"));
    right.appendChild(pa);

    var search = el("button", "pf-btn");
    search.type = "button";
    search.innerHTML = '<span aria-hidden="true">⌕</span> Search <kbd class="pf-kbd">' +
      (navigator.platform.indexOf("Mac") === 0 ? "⌘" : "Ctrl ") + "K</kbd>";
    search.addEventListener("click", function () { openPalette(); });
    right.appendChild(search);

    themeBtn = el("button", "pf-btn");
    themeBtn.type = "button";
    themeBtn.style.padding = "5px 9px";
    themeBtn.addEventListener("click", toggleTheme);
    right.appendChild(themeBtn);
    updateThemeButton();

    var ask = el("button", "pf-btn pf-primary");
    ask.type = "button";
    ask.id = "pf-ask";
    ask.textContent = "Ask AI";
    right.appendChild(ask);

    nav.appendChild(right);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  /* ---------------- search index ---------------- */

  // window.KYTY_INDEX is provided by search-index.js (generated).
  // Headings on the current page are merged in live so search always works.
  function buildIndex() {
    var idx = (window.KYTY_INDEX || []).slice();
    var here = currentFile();
    var seen = {};
    idx.forEach(function (e) { seen[e.f + "#" + e.a] = 1; });
    document.querySelectorAll("h1[id], h2[id], h3[id]").forEach(function (h) {
      var key = here + "#" + h.id;
      if (seen[key]) return;
      idx.push({ t: (h.textContent || "").replace(/\s+/g, " ").trim(), f: here, a: h.id, s: shortFor(here) });
    });
    return idx;
  }

  function shortFor(file) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].file === file) return PAGES[i].short;
    return "DOC";
  }

  function score(entry, q) {
    var t = entry.t.toLowerCase();
    var i = t.indexOf(q);
    if (i < 0) {
      // subsequence fallback so "vkpipe" finds "Vulkan pipeline"
      var qi = 0;
      for (var c = 0; c < t.length && qi < q.length; c++) if (t[c] === q[qi]) qi++;
      return qi === q.length ? 1 : 0;
    }
    if (i === 0) return 100;
    if (/\W/.test(t[i - 1])) return 60;
    return 30;
  }

  function highlight(text, q) {
    var t = text.toLowerCase();
    var i = t.indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) +
      "</mark>" + esc(text.slice(i + q.length));
  }

  /* ---------------- command palette ---------------- */

  var paletteEl = null, resultsEl = null, inputEl = null, active = 0, hits = [];

  function openPalette(prefill) {
    if (paletteEl) return;
    var index = buildIndex();

    var overlay = el("div", "pf-overlay");
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) closePalette();
    });

    var box = el("div", "pf-palette");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Search the platform");

    inputEl = el("input", "pf-palette-input");
    inputEl.type = "search";
    inputEl.placeholder = "Search every section — memory, PM4, shader, thread…";
    inputEl.setAttribute("aria-label", "Search");
    box.appendChild(inputEl);

    resultsEl = el("div", "pf-results");
    box.appendChild(resultsEl);

    var foot = el("div", "pf-palette-foot");
    foot.innerHTML =
      '<span><kbd class="pf-kbd">↑</kbd><kbd class="pf-kbd">↓</kbd> navigate</span>' +
      '<span><kbd class="pf-kbd">↵</kbd> open</span>' +
      '<span><kbd class="pf-kbd">esc</kbd> close</span>' +
      '<span style="margin-left:auto">' + index.length + " sections</span>";
    box.appendChild(foot);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    paletteEl = overlay;

    function render() {
      var q = inputEl.value.trim().toLowerCase();
      if (!q) {
        hits = index.slice(0, 12);
      } else {
        hits = index
          .map(function (e) { return { e: e, s: score(e, q) }; })
          .filter(function (r) { return r.s > 0; })
          .sort(function (a, b) { return b.s - a.s; })
          .slice(0, 40)
          .map(function (r) { return r.e; });
      }
      active = 0;
      if (!hits.length) {
        resultsEl.innerHTML = '<div class="pf-empty">No section matches “' + esc(q) + '”.</div>';
        return;
      }
      resultsEl.innerHTML = hits.map(function (h, i) {
        return '<a class="pf-result" data-i="' + i + '" data-active="' + (i === 0 ? 1 : 0) +
          '" href="' + esc(h.f) + (h.a ? "#" + esc(h.a) : "") + '">' +
          '<span class="pf-result-title">' + highlight(h.t, q) + "</span>" +
          '<span class="pf-result-src">' + esc(h.s || shortFor(h.f)) + "</span></a>";
      }).join("");
    }

    function move(d) {
      if (!hits.length) return;
      var nodes = resultsEl.querySelectorAll(".pf-result");
      nodes[active] && nodes[active].setAttribute("data-active", "0");
      active = (active + d + hits.length) % hits.length;
      var n = nodes[active];
      if (n) { n.setAttribute("data-active", "1"); n.scrollIntoView({ block: "nearest" }); }
    }

    inputEl.addEventListener("input", render);
    box.addEventListener("mousemove", function (e) {
      var r = e.target.closest ? e.target.closest(".pf-result") : null;
      if (!r) return;
      var i = +r.getAttribute("data-i");
      if (i === active) return;
      var nodes = resultsEl.querySelectorAll(".pf-result");
      nodes[active] && nodes[active].setAttribute("data-active", "0");
      active = i;
      r.setAttribute("data-active", "1");
    });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var n = resultsEl.querySelectorAll(".pf-result")[active];
        if (n) { closePalette(); location.href = n.getAttribute("href"); }
      }
    });

    if (prefill) inputEl.value = prefill;
    render();
    inputEl.focus();
    inputEl.select();
  }

  function closePalette() {
    if (!paletteEl) return;
    paletteEl.remove();
    paletteEl = null; resultsEl = null; inputEl = null; hits = []; active = 0;
  }

  /* ---------------- "Explain this" on headings ---------------- */

  function sectionText(h) {
    // Collect prose following the heading, up to the next heading of same/higher rank.
    var lvl = +h.tagName.slice(1);
    var out = [h.textContent.trim()];
    var n = h.nextElementSibling;
    var budget = 2600;
    while (n && budget > 0) {
      if (/^H[1-6]$/.test(n.tagName) && +n.tagName.slice(1) <= lvl) break;
      var t = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim();
      if (t) { out.push(t.slice(0, budget)); budget -= t.length; }
      n = n.nextElementSibling;
    }
    return out.join("\n\n");
  }

  function addExplainButtons() {
    var hs = document.querySelectorAll("h1, h2, h3");
    hs.forEach(function (h) {
      if (h.closest(".pf-nav") || h.closest(".pf-palette") || h.closest("#pf-tutor")) return;
      if (h.querySelector(".pf-explain")) return;
      var txt = h.textContent.replace(/\s+/g, " ").trim();
      if (!txt || txt.length > 140) return;
      var b = el("button", "pf-explain", "Explain this");
      b.type = "button";
      b.setAttribute("aria-label", "Ask the AI tutor to explain: " + txt);
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        PF.ask({
          heading: txt,
          context: sectionText(h),
          question: "Explain this section to me. I'm new to emulation."
        });
      });
      h.appendChild(b);
    });
  }

  /* ---------------- public API ---------------- */

  var PF = window.PF = {
    pages: PAGES,
    currentFile: currentFile,
    progress: progress,
    openPalette: openPalette,
    closePalette: closePalette,
    theme: effectiveTheme,
    toggleTheme: toggleTheme,
    esc: esc,
    el: el,
    readJSON: readJSON,
    writeJSON: writeJSON,
    // Overridden by tutor.js once it loads.
    ask: function (payload) {
      PF._pendingAsk = payload;
      console.warn("[PF] tutor not loaded yet; queued", payload);
    },
    // Page title for tutor context.
    pageTitle: function () {
      var f = currentFile();
      for (var i = 0; i < PAGES.length; i++) if (PAGES[i].file === f) return PAGES[i].label;
      return document.title || f;
    }
  };

  /* ---------------- boot ---------------- */

  function boot() {
    if (!document.body) return;
    markSeen();
    buildNav();
    addExplainButtons();

    document.addEventListener("keydown", function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        paletteEl ? closePalette() : openPalette();
      } else if (e.key === "/" && !paletteEl) {
        var t = e.target;
        var tag = t && t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
        e.preventDefault();
        openPalette();
      }
    });

    // React to theme changes from other tabs.
    window.addEventListener("storage", function (e) {
      if (e.key === LS_THEME) { applyTheme(storedTheme()); updateThemeButton(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
