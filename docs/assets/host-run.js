(function () {
  "use strict";
  var mount = document.getElementById("hostrun");
  if (!mount || !window.KytyFlow) return;

  var NODES = {
    hle: { x: 34, y: 52, w: 266, h: 188, t: "HLE dispatch", s: "the sce* call lands in native C++" },
    kmem: { x: 34, y: 260, w: 266, h: 188, t: "Kernel · memory", s: "pools + page table" },
    fault: { x: 34, y: 468, w: 266, h: 200, t: "Fault & exception handler", s: "coherency · crashes" },
    cp: { x: 336, y: 52, w: 300, h: 300, t: "Command processor", s: "decode PM4 → register state" },
    recomp: { x: 336, y: 372, w: 300, h: 296, t: "Shader recompiler", s: "RDNA 2 → SPIR-V · 2-level cache" },
    vulkan: { x: 672, y: 52, w: 544, h: 300, t: "Vulkan backend · host GPU", s: "pipelines, command buffers, submit" },
    present: { x: 672, y: 372, w: 544, h: 296, t: "Presentation", s: "flip model · swapchain" }
  };
  var WIRES = {
    in_hle: { d: "M2,120 H34", lab: "guest sce* call", lx: 4, ly: 112 },
    h_mem: { d: "M167,240 V260", lab: "alloc / map", lx: 178, ly: 252 },
    m_flt: { d: "M167,448 V468", lab: "page fault", lx: 178, ly: 460 },
    h_cp: { d: "M300,120 C318,120 318,110 336,110", lab: "wake GPU thread", lx: 300, ly: 100 },
    cp_rc: { d: "M486,352 V372", lab: "draw needs pipeline", lx: 500, ly: 364 },
    cp_vk: { d: "M636,116 H672", lab: "register state", lx: 654, ly: 108 },
    rc_vk: { d: "M636,470 C654,470 654,300 672,282", lab: "SPIR-V", lx: 648, ly: 300 },
    vk_pr: { d: "M944,352 V372", lab: "submit → flip", lx: 958, ly: 364 }
  };

  var SH = ["Decode", "CFG", "Translate", "Materialize", "Compile"];

  function body(id, st, H) {
    var n = NODES[id], x = n.x + 10, w = n.w - 20, k = [];
    if (id === "hle") {
      var d = [["sceKernelAllocate…", "Memory::Alloc", "mem"], ["sceKernelCreateThread", "Pthread::Create", "thr"],
        ["sceGnmSubmit…", "GraphicsRun::Submit", "gpu"], ["sceVideoOutSubmitFlip", "VideoOut::Flip", "flip"]];
      d.forEach(function (r, i) { k.push(H.row(x, n.y + 56 + i * 30, w, r[0], r[1], (st.act === r[2]) ? "hot" : "res")); });
      k.push(H.note(x, n.y + 176, "resolved once at load; called via GOT", "sm"));
    } else if (id === "kmem") {
      k.push(H.row(x, n.y + 54, w, "direct-memory pool", "physical", st.act === "mem" ? "hot" : "seg"));
      k.push(H.row(x, n.y + 82, w, "flexible-memory pool", "on demand", st.act === "mem" ? "hot" : "seg"));
      k.push(H.row(x, n.y + 110, w, "page table", "guest → host", ""));
      k.push(H.note(x, n.y + 148, "guest sees 16 KB pages;", "sm"));
      k.push(H.note(x, n.y + 162, "the host MMU uses 4 KB — the", "sm"));
      k.push(H.note(x, n.y + 176, "manager keeps them in step", "sm"));
    } else if (id === "fault") {
      var lit = st.act === "coh" || st.act === "exc";
      k.push(H.note(x, n.y + 52, "the host page-fault handler", "hd"));
      k.push(H.row(x, n.y + 58, w, "CPU writes a GPU page", "→ upload dirty", st.act === "coh" ? "hot" : ""));
      k.push(H.note(x, n.y + 92, "three exception branches:", "hd"));
      k.push(H.row(x, n.y + 98, w, "illegal instruction", "emulate (SSE4a)", st.act === "exc" ? "hot" : ""));
      k.push(H.row(x, n.y + 126, w, "GPU fault", "HandleGpuFault", ""));
      k.push(H.row(x, n.y + 154, w, "crash", "dump + EXIT", st.act === "exc" ? "stub" : ""));
    } else if (id === "cp") {
      if (st.act !== "cp" && !st.cpDone) return [H.note(x, n.y + 70, "— waiting for a submit —", "sm")];
      k.push(H.note(x, n.y + 58, "pull PM4 ring · graphicsRun.cpp", "op"));
      var pk = [["IT_SET_CONTEXT_REG", "→ hw context"], ["IT_SET_SH_REG", "→ shader addr"], ["IT_INDEX_BASE", "→ index buf"], ["IT_DRAW_INDEX", "→ draw"], ["IT_EVENT_WRITE_EOP", "→ fence"]];
      pk.forEach(function (pp, i) { k.push(H.row(x, n.y + 72 + i * 30, w, pp[0], pp[1], st.act === "cp" ? "hot" : "seg")); });
      k.push(H.note(x, n.y + 232, "register writes accumulate into a", "sm"));
      k.push(H.note(x, n.y + 246, "hardware-context struct (the key)", "sm"));
    } else if (id === "recomp") {
      if (!st.rc && !st.rcDone) return [H.note(x, n.y + 70, "cache lookup by shader hash", "sm"), H.note(x, n.y + 90, "hit → reuse; miss → compile", "sm")];
      // stage bars
      SH.forEach(function (s, i) {
        var cls = st.rcDone ? "res" : (st.rcStage === i ? "hot" : (st.rcStage > i ? "res" : "seg"));
        k.push(H.row(x + (i * (w / 5)), n.y + 56, w / 5 - 4, s.slice(0, 5), null, cls));
      });
      k.push(H.note(x, n.y + 96, "TranslateProgram → typed IR → SPIR-V", "sm"));
      k.push(H.row(x, n.y + 116, w, "L1 · ProgramCache", "in memory", "cy"));
      k.push(H.row(x, n.y + 144, w, "L2 · VkPipelineCache", "on disk", "cy"));
      k.push(H.note(x, n.y + 184, st.rcDone ? "pipeline ready — cached both levels" : "first-encounter compile = stutter", "sm"));
    } else if (id === "vulkan") {
      var vks = [["vkCreateShaderModule", "VS + FS SPIR-V", st.act === "rc"], ["vkCreateGraphicsPipelines", "from register state", st.act === "vk"],
        ["vkCmdBindPipeline", "0x51A0…", st.act === "vk"], ["vkCmdDraw", "N verts", st.act === "vk"], ["vkQueueSubmit", "1 cmd buffer", st.act === "submit"]];
      vks.forEach(function (v, i) { k.push(H.row(x, n.y + 56 + i * 30, w, v[0], v[1], v[2] ? "hot" : (st.act === "submit" || st.act === "present" ? "res" : ""))); });
      k.push(H.note(x, n.y + 214, "PipelineStaticParameters (125 B) is the key · VMA owns the allocations", "sm"));
      k.push(H.row(x, n.y + 232, w, "host threads", "CPU · GPU-submit · audio", "cy"));
    } else if (id === "present") {
      if (st.act !== "present" && !st.presentDone) return [H.note(x, n.y + 70, "— frame not finished —", "sm")];
      k.push(H.band(x, n.y + 58, w / 2 - 6, "swapchain image 0", st.vb % 2 === 0 ? "scanout" : "back", st.vb % 2 === 0 ? "band-g" : "band-rw"));
      k.push(H.band(x + w / 2 + 6, n.y + 58, w / 2 - 6, "swapchain image 1", st.vb % 2 === 1 ? "scanout" : "back", st.vb % 2 === 1 ? "band-g" : "band-rw"));
      k.push(H.row(x, n.y + 100, w, "VideoOutSubmitFlip", "queued for vblank", st.act === "present" ? "hot" : "res"));
      k.push(H.row(x, n.y + 128, w, "vkQueuePresentKHR", "FIFO", st.act === "present" ? "hot" : "res"));
      k.push(H.row(x, n.y + 156, w, "timeline semaphore", "release retained resources", ""));
      k.push(H.note(x, n.y + 196, "finished frame on VIDEO_OUT_0 — then the guest's next frame arrives", "sm"));
    }
    return k;
  }

  var STEPS = [
    { t: "A guest call arrives", on: ["hle"], w: ["in_hle"], act: "mem",
      cap: "Whenever the guest reaches out, its <code>call [GOT+n]</code> lands in one of KytyPS5's hand-written C++ functions. The GOT slot was filled at load time, so this is a direct jump — the emulator is now doing the work the console's OS would." },
    { t: "Serve memory & threads", on: ["hle", "kmem"], w: ["in_hle", "h_mem"], act: "mem",
      cap: "A memory request goes to the kernel memory manager, which carves it from the direct- or flexible-memory pool and updates the <b>page table</b>. The guest believes pages are 16 KB; the host MMU works in 4 KB — the manager keeps the two views consistent." },
    { t: "Coherency, by page fault", on: ["kmem", "fault"], w: ["m_flt"], act: "coh",
      cap: "CPU and GPU share memory each believes it owns. When the CPU writes a page the GPU is reading, the host raises a <b>page fault</b>; the handler catches it, uploads the now-dirty page to the GPU, and resumes the guest — coherency without the guest ever knowing." },
    { t: "The GPU thread wakes", on: ["hle", "cp"], w: ["h_cp"], act: "cp",
      cap: "A <code>sceGnmSubmitCommandBuffers</code> from the guest wakes the emulator's <b>GPU submit thread</b> (a host thread). It picks up the PM4 ring the game wrote and starts decoding it — the guest has moved on to its next frame." },
    { t: "Decode PM4 → register state", on: ["cp"], w: [], act: "cp", cpDone: 1,
      cap: "The command processor walks the ring packet by packet. Each <code>IT_SET_*_REG</code> write lands in a big <b>hardware-context struct</b>; a <code>IT_DRAW_INDEX</code> means &ldquo;draw with whatever registers are set right now.&rdquo; That accumulated register state is the pipeline's identity." },
    { t: "A draw needs a pipeline", on: ["cp", "recomp"], w: ["cp_rc"], act: "rc", cpDone: 1, rc: 1, rcStage: 2,
      cap: "The draw's register state + shader addresses hash to a pipeline key. On a cache <b>hit</b> the program is reused; on a <b>miss</b> the shader recompiler translates the guest's RDNA 2 binary — <code>TranslateProgram</code> → typed IR → <code>CompileProgram</code> → SPIR-V — caching it in the in-memory L1 and the on-disk L2." },
    { t: "Build the Vulkan pipeline", on: ["recomp", "vulkan"], w: ["rc_vk", "cp_vk"], act: "vk", cpDone: 1, rcDone: 1,
      cap: "The Vulkan backend builds a <code>VkPipeline</code> from the register state and the SPIR-V, then records <code>vkCmdBindPipeline</code> and <code>vkCmdDraw</code> into a host command buffer. The 125-byte <code>PipelineStaticParameters</code> is the cache key; VMA owns the GPU allocations." },
    { t: "Submit to the host GPU", on: ["vulkan"], w: [], act: "submit", cpDone: 1, rcDone: 1,
      cap: "<code>vkQueueSubmit</code> hands the command buffer to your real GPU. A monotonic <b>timeline semaphore</b> tracks completion; when a submission finishes, the guest resources it retained can be released and reused." },
    { t: "Present the frame", on: ["vulkan", "present"], w: ["vk_pr"], act: "present", cpDone: 1, rcDone: 1, presentDone: 1, vb: 1,
      cap: "The guest's <code>sceVideoOutSubmitFlip</code> becomes the flip model: the finished swapchain image is handed to <code>vkQueuePresentKHR</code> and scanned out at the next vertical blank. A finished frame appears on <code>VIDEO_OUT_0</code>." },
    { t: "When something breaks", on: ["fault"], w: [], act: "exc",
      cap: "If the guest hits an instruction the host lacks (SSE4a, some SHA ops) the exception handler <b>emulates</b> it and resumes; a GPU access fault is routed to the GPU handler; anything else prints the <code>--- Guest fault context ---</code> dump and <code>EXIT</code>s. That is the whole safety net — see it fire in the <a href='advanced-emulator.html'>Intro machine</a>." }
  ];

  KytyFlow(mount, { viewBox: "0 0 1240 720", aria: "How the emulator runs a frame", nodes: NODES, wires: WIRES, steps: STEPS, body: body });
})();
