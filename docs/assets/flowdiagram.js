/* Reusable stepped SVG flow-diagram engine. window.KytyFlow(mount, cfg)
   cfg = { viewBox, aria, nodes:{id:{x,y,w,h,t,s}}, wires:{id:{d,lab,lx,ly}},
           steps:[{t,cap,on:[ids],w:[ids],...state}], body(nodeId, state, H) } */
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";

  function nidHash(name) {
    var h = 2166136261, a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-";
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    var s = "", x = h >>> 0;
    for (var k = 0; k < 11; k++) { s += a[x & 63]; x = (x >>> 6) ^ (h << (k % 5)); }
    return s;
  }

  window.KytyFlow = function (mount, cfg) {
    if (!mount) return;
    function e(tag, attrs, kids) {
      var n = document.createElementNS(SVGNS, tag);
      if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (kids != null) { if (Array.isArray(kids)) kids.forEach(function (c) { if (c) n.appendChild(c); }); else n.textContent = kids; }
      return n;
    }
    // body-building helpers passed to cfg.body
    var H = {
      e: e,
      C: { c: "#55c5de", a: "#f0b849", k: "#ec668b", g: "#75d49a", ink: "#eaf0f5", ink2: "#b2bfca", ink3: "#718092" },
      nid: nidHash,
      row: function (x, y, w, label, val, cls) {
        var g = e("g", { class: "fd-row " + (cls || "") });
        g.appendChild(e("rect", { x: x, y: y, width: w, height: 20, rx: 4, class: "fd-rrect" }));
        g.appendChild(e("text", { x: x + 8, y: y + 14, class: "fd-rl" }, label));
        if (val != null) g.appendChild(e("text", { x: x + w - 8, y: y + 14, class: "fd-rv", "text-anchor": "end" }, val));
        return g;
      },
      note: function (x, y, txt, cls) { return e("text", { x: x, y: y, class: "fd-note " + (cls || "") }, txt); },
      band: function (x, y, w, label, val, cls) {
        var g = e("g");
        g.appendChild(e("rect", { x: x, y: y, width: w, height: 26, rx: 5, class: "fd-band " + (cls || "") }));
        g.appendChild(e("text", { x: x + 10, y: y + 17, class: "fd-bl" }, label));
        if (val != null) g.appendChild(e("text", { x: x + w - 10, y: y + 17, class: "fd-bv", "text-anchor": "end" }, val));
        return g;
      }
    };

    var svg = e("svg", { viewBox: cfg.viewBox, class: "fd-svg", role: "img", "aria-label": cfg.aria || "flow diagram" });
    var defs = e("defs");
    defs.appendChild(e("marker", { id: "fd-arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
      [e("path", { d: "M0,0 L10,5 L0,10 z", fill: "#3a4b61" })]));
    defs.appendChild(e("marker", { id: "fd-arrow-on", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
      [e("path", { d: "M0,0 L10,5 L0,10 z", fill: "currentColor" })]));
    svg.appendChild(defs);

    var wireEls = {};
    Object.keys(cfg.wires || {}).forEach(function (id) {
      var w = cfg.wires[id];
      var path = e("path", { d: w.d, class: "fd-wire", fill: "none", "marker-end": "url(#fd-arrow)" });
      var grp = e("g", { class: "fd-wg", "data-w": id }, [path]);
      if (w.lab) grp.appendChild(e("text", { x: w.lx, y: w.ly, class: "fd-wire-lab" }, w.lab));
      svg.appendChild(grp);
      wireEls[id] = { grp: grp, path: path };
    });

    var bodyEls = {};
    Object.keys(cfg.nodes).forEach(function (id) {
      var n = cfg.nodes[id];
      var g = e("g", { class: "fd-node", "data-n": id });
      g.appendChild(e("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 10, class: "fd-frame" }));
      g.appendChild(e("text", { x: n.x + 12, y: n.y + 22, class: "fd-title" }, n.t));
      if (n.s) g.appendChild(e("text", { x: n.x + 12, y: n.y + 38, class: "fd-sub" }, n.s));
      var body = e("g", { class: "fd-body" });
      g.appendChild(body);
      svg.appendChild(g);
      bodyEls[id] = body;
      g.addEventListener("click", function () { focusNode(id); });
    });
    mount.appendChild(svg);

    var STEPS = cfg.steps, cur = 0, playing = false, timer = null;
    function stateOf(i) { var s = STEPS[i], st = {}; for (var k in s) st[k] = s[k]; st.step = i; return st; }

    function render(i) {
      cur = Math.max(0, Math.min(STEPS.length - 1, i));
      var st = stateOf(cur);
      Object.keys(cfg.nodes).forEach(function (id) {
        svg.querySelector('[data-n="' + id + '"]').classList.toggle("on", (st.on || []).indexOf(id) >= 0);
      });
      Object.keys(cfg.wires || {}).forEach(function (id) {
        var on = (st.w || []).indexOf(id) >= 0;
        wireEls[id].grp.classList.toggle("on", on);
        wireEls[id].path.setAttribute("marker-end", on ? "url(#fd-arrow-on)" : "url(#fd-arrow)");
      });
      Object.keys(cfg.nodes).forEach(function (id) {
        var kids = cfg.body(id, st, H) || [];
        bodyEls[id].replaceChildren.apply(bodyEls[id], kids);
      });
      cap.innerHTML = "<b>" + (cur + 1) + " / " + STEPS.length + " · " + st.t + "</b> " + st.cap;
      Array.prototype.forEach.call(rail.children, function (m, k) { m.classList.toggle("on", k === cur); m.classList.toggle("done", k < cur); });
      pos.textContent = (cur + 1) + " / " + STEPS.length;
    }
    function focusNode(id) { for (var i = 0; i < STEPS.length; i++) if ((STEPS[i].on || []).indexOf(id) >= 0) { stop(); render(i); return; } }

    /* controls */
    var bar = document.createElement("div"); bar.className = "fd-bar";
    var cap = document.createElement("div"); cap.className = "fd-cap";
    var ctl = document.createElement("div"); ctl.className = "fd-ctl";
    function btn(txt, fn, cls) { var b = document.createElement("button"); b.type = "button"; b.className = "fd-btn " + (cls || ""); b.textContent = txt; b.onclick = fn; return b; }
    var playBtn = btn("▶ Play", function () { toggle(); }, "pri");
    var pos = document.createElement("span"); pos.className = "fd-pos";
    ctl.appendChild(btn("‹ Prev", function () { stop(); render(cur - 1); }));
    ctl.appendChild(playBtn);
    ctl.appendChild(btn("Next ›", function () { stop(); render(cur + 1); }));
    ctl.appendChild(pos);
    var rail = document.createElement("div"); rail.className = "fd-rail";
    STEPS.forEach(function (s, i) {
      var m = document.createElement("button"); m.type = "button"; m.className = "fd-mark"; m.title = (i + 1) + ". " + s.t;
      m.onclick = function () { stop(); render(i); };
      rail.appendChild(m);
    });
    bar.appendChild(cap); bar.appendChild(ctl); bar.appendChild(rail);
    mount.appendChild(bar);

    function stop() { playing = false; playBtn.textContent = "▶ Play"; if (timer) { clearInterval(timer); timer = null; } }
    function toggle() {
      if (playing) { stop(); return; }
      playing = true; playBtn.textContent = "❚❚ Pause";
      if (cur >= STEPS.length - 1) render(0);
      timer = setInterval(function () { if (cur >= STEPS.length - 1) { stop(); return; } render(cur + 1); }, 4200);
    }
    mount.addEventListener("keydown", function () {});
    document.addEventListener("keydown", function (ev) {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      var r = mount.getBoundingClientRect();
      if (r.bottom < 0 || r.top > (window.innerHeight || 900)) return;   // only when on screen
      if (ev.key === "ArrowRight") { stop(); render(cur + 1); }
      else if (ev.key === "ArrowLeft") { stop(); render(cur - 1); }
    });

    render(0);
    return { render: render };
  };
})();
