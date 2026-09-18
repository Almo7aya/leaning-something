(function () {
  "use strict";
  var mount = document.getElementById("guestrun");
  if (!mount || !window.KytyFlow) return;

  var NODES = {
    game: { x: 22, y: 52, w: 272, h: 618, t: "The game · frame loop", s: "its own machine code, run natively" },
    mem: { x: 332, y: 52, w: 250, h: 284, t: "Guest memory", s: "what the game allocated" },
    threads: { x: 332, y: 360, w: 250, h: 310, t: "Guest threads", s: "the game's own threads + sync" },
    hle: { x: 620, y: 52, w: 292, h: 284, t: "OS calls · the sce* API", s: "the only exit from the game's code" },
    cmd: { x: 620, y: 360, w: 292, h: 310, t: "Command buffer · AGC → PM4", s: "the game writes GPU packets" },
    gpu: { x: 950, y: 52, w: 268, h: 284, t: "Submit to the GPU", s: "sceGnmSubmitCommandBuffers" },
    out: { x: 950, y: 360, w: 268, h: 310, t: "Audio & present", s: "AudioOut · VideoOut flip" }
  };
  var WIRES = {
    g_mem: { d: "M294,150 H332", lab: "read/write heap", lx: 313, ly: 142 },
    g_thr: { d: "M294,470 H332", lab: "spawn / sync", lx: 313, ly: 462 },
    g_hle: { d: "M294,250 C420,250 500,180 620,170", lab: "call sce* [GOT]", lx: 430, ly: 205 },
    g_cmd: { d: "M294,540 C420,540 500,500 620,500", lab: "write PM4", lx: 440, ly: 528 },
    c_gpu: { d: "M912,470 C935,470 935,220 950,200", lab: "hand over ring", lx: 924, ly: 340 },
    h_out: { d: "M912,250 C935,250 935,470 950,490", lab: "audio · flip", lx: 924, ly: 250 }
  };

  // frame-loop stages shown down the game node; `stage` in each step highlights one
  var STAGES = ["read input", "update the world", "use its heap", "run worker threads", "call the OS (sce*)",
    "build a command buffer", "reference its shaders", "submit to the GPU", "fill the audio buffer",
    "request a flip", "loop →"];

  function body(id, st, H) {
    var n = NODES[id], x = n.x + 10, w = n.w - 20, k = [];
    if (id === "game") {
      k.push(H.note(x + 2, n.y + 60, "while (running) {", "op"));
      STAGES.forEach(function (s, i) {
        k.push(H.row(x + 8, n.y + 74 + i * 30, w - 12, s, null, st.stage === i ? "hot" : (st.stage > i ? "res" : "")));
      });
      k.push(H.note(x + 2, n.y + 74 + STAGES.length * 30 + 10, "}", "op"));
    } else if (id === "mem") {
      var regs = [["direct memory (heap)", "1.2 GB", st.stage === 2], ["flexible memory", "512 MB", st.stage === 2],
        ["PM4 command ring", "256 KB", st.stage === 5], ["RDNA 2 shader binaries", "compiled", st.stage === 6], ["render targets", "GPU-visible", st.stage === 7]];
      regs.forEach(function (r, i) { k.push(H.row(x, n.y + 58 + i * 30, w, r[0], r[1], r[2] ? "hot" : "seg")); });
      k.push(H.note(x, n.y + 58 + regs.length * 30 + 6, "the game thinks pages are 16 KB", "sm"));
    } else if (id === "threads") {
      k.push(H.row(x, n.y + 56, w, "main / game thread", "running", "cy"));
      k.push(H.row(x, n.y + 84, w, "worker 0 (physics)", st.stage >= 3 ? "running" : "—", st.stage === 3 ? "hot" : "cy"));
      k.push(H.row(x, n.y + 112, w, "worker 1 (streaming)", st.stage >= 3 ? "running" : "—", st.stage === 3 ? "hot" : "cy"));
      k.push(H.note(x, n.y + 150, "sync = mutex / condvar", "hd"));
      k.push(H.row(x, n.y + 158, w, "scePthreadMutexLock", "→ umtx wait/wake", st.stage === 3 ? "hot" : ""));
      k.push(H.note(x, n.y + 200, "each guest thread is a real", "sm"));
      k.push(H.note(x, n.y + 214, "host pthread — no scheduler", "sm"));
    } else if (id === "hle") {
      var calls = [["sceKernelAllocateDirectMemory", "memory"], ["sceKernelCreateThread", "threads"],
        ["scePthreadMutexLock", "sync"], ["sceGnmSubmitCommandBuffers", "gpu"], ["sceAudioOutOutput", "audio"], ["sceVideoOutSubmitFlip", "flip"]];
      calls.forEach(function (c, i) {
        var hot = (st.call || "").indexOf(c[1]) >= 0;
        k.push(H.row(x, n.y + 58 + i * 34, w, c[0], "GOT", hot ? "hot" : "res"));
      });
      k.push(H.note(x, n.y + 58 + calls.length * 34 + 4, "one call [GOT+n] → native C++", "sm"));
    } else if (id === "cmd") {
      var pkts = [["IT_SET_CONTEXT_REG", "render targets, blend"], ["IT_SET_SH_REG", "shader GPU address"],
        ["IT_SET_UCONFIG_REG", "primitive type"], ["IT_INDEX_BASE", "index buffer"], ["IT_DRAW_INDEX", "N indices"], ["IT_EVENT_WRITE_EOP", "fence + flip"]];
      pkts.forEach(function (pp, i) {
        var lit = st.stage === 5 && i <= (st.pk == null ? 5 : st.pk);
        k.push(H.row(x, n.y + 58 + i * 34, w, pp[0], pp[1], lit ? "hot" : (st.stage >= 5 ? "seg" : "")));
      });
      k.push(H.note(x, n.y + 58 + pkts.length * 34 + 4, "written into the ring in guest memory", "sm"));
    } else if (id === "gpu") {
      if (st.stage < 7) return [H.note(x, n.y + 70, "— waiting for a submit —", "sm")];
      k.push(H.note(x, n.y + 62, "sceGnmSubmitCommandBuffers", "op"));
      k.push(H.note(x, n.y + 88, "hands the ring's address + size", "sm"));
      k.push(H.note(x, n.y + 106, "to the command processor", "sm"));
      k.push(H.row(x, n.y + 124, w, "on real HW", "kick the CP", "cy"));
      k.push(H.row(x, n.y + 152, w, "here", "wake GPU thread", "hot"));
      k.push(H.note(x, n.y + 196, "the game may keep going", "sm"));
      k.push(H.note(x, n.y + 210, "(double-buffered) or wait on", "sm"));
      k.push(H.note(x, n.y + 224, "a GPU label / fence", "sm"));
    } else if (id === "out") {
      k.push(H.note(x, n.y + 58, "AUDIO", "hd"));
      k.push(H.row(x, n.y + 64, w, "sceAudioOutOutput", "~256 samples", st.stage === 8 ? "hot" : (st.stage > 8 ? "res" : "")));
      k.push(H.note(x, n.y + 100, "written to the audio ring", "sm"));
      k.push(H.note(x, n.y + 134, "PRESENT", "hd"));
      k.push(H.row(x, n.y + 140, w, "sceVideoOutSubmitFlip", "buffer id", st.stage === 9 ? "hot" : (st.stage > 9 ? "res" : "")));
      k.push(H.note(x, n.y + 176, "shown at the next vblank", "sm"));
      k.push(H.note(x, n.y + 210, "then the loop repeats — the game", "sm"));
      k.push(H.note(x, n.y + 224, "believes it is a PS5", "sm"));
    }
    return k;
  }

  var STEPS = [
    { t: "The frame loop", on: ["game"], w: [], stage: 0,
      cap: "The game's <code>main()</code> is a loop — read input, update, render, present, forever. <b>Everything in this diagram is the game's own machine code running natively on a host CPU thread.</b> The emulator only gets involved when the game reaches out to the OS or the GPU." },
    { t: "Update the world", on: ["game", "mem"], w: ["g_mem"], stage: 1,
      cap: "The game reads input and steps its simulation — physics, AI, animation — entirely in its own code. There is no interpreter and no per-instruction cost: it is x86-64 executing directly on your CPU." },
    { t: "Use its heap", on: ["game", "mem"], w: ["g_mem"], stage: 2,
      cap: "It reads and writes the heap it reserved at startup with <code>sceKernelAllocateDirectMemory</code> and flexible memory. The game addresses memory exactly as it would on a console — and it assumes pages are <b>16 KB</b>." },
    { t: "Its own threads", on: ["game", "threads", "hle"], w: ["g_thr", "g_hle"], stage: 3, call: "sync",
      cap: "The game spawned worker threads with <code>sceKernelCreateThread</code>; they coordinate with mutexes and condition variables that become <code>umtx</code> wait/wake. Each guest thread is a real host <code>pthread</code> — there is no scheduler to emulate." },
    { t: "Call the OS", on: ["game", "hle"], w: ["g_hle"], stage: 4, call: "memory",
      cap: "When the game needs the operating system it calls a <code>sce*</code> function through the GOT — <code>sceKernel…</code>, <code>scePthread…</code>. That <code>call [GOT+n]</code> is the <b>only</b> moment control leaves the game's code and enters the emulator's native C++." },
    { t: "Build a command buffer", on: ["game", "cmd"], w: ["g_cmd"], stage: 5, pk: 5,
      cap: "To draw, the game uses AGC to fill a command buffer: it sets GPU registers and writes <b>PM4 packets</b> — set-context-reg, set-shader-address, draw-index, event-write — into a ring buffer that lives in its <b>own</b> memory." },
    { t: "Reference its shaders", on: ["game", "cmd", "mem"], w: ["g_cmd"], stage: 6,
      cap: "The draw packets reference the game's own compiled <b>RDNA 2 shader binaries</b> by GPU address. The game never compiles a shader at run time — it ships the binaries and just points the GPU at them." },
    { t: "Submit to the GPU", on: ["cmd", "gpu"], w: ["g_cmd", "c_gpu"], stage: 7,
      cap: "The game calls <code>sceGnmSubmitCommandBuffers</code>, handing the ring's address and size to the GPU. On real hardware this simply kicks the command processor; in the emulator it wakes the GPU submit thread, which will decode those same PM4 packets." },
    { t: "Fill the audio buffer", on: ["game", "out"], w: ["h_out"], stage: 8, call: "audio",
      cap: "In parallel the game fills a small audio buffer — a few hundred samples per frame — and calls <code>sceAudioOutOutput</code>. The mixer thread on the emulator side will pick it up." },
    { t: "Request a flip", on: ["game", "out"], w: ["h_out"], stage: 9, call: "flip",
      cap: "It calls <code>sceVideoOutSubmitFlip</code> to show the finished buffer at the next vertical blank, then may wait on a GPU label or fence before reusing its buffers for the next frame." },
    { t: "Loop — and never know", on: ["game"], w: [], stage: 10,
      cap: "Back to input and update. From the game's side the machine <b>is</b> a PS5: it allocates direct memory, spawns threads, writes PM4 and flips buffers. It has no idea any of it is faked — and that indifference is exactly what high-level emulation buys you. Now see the <a href='host-run.html'>host side</a> service all of this." }
  ];

  KytyFlow(mount, { viewBox: "0 0 1240 720", aria: "How the guest game runs", nodes: NODES, wires: WIRES, steps: STEPS, body: body });
})();
