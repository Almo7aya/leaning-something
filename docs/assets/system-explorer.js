/* ============================================================
   system-explorer.js — an inspectable model of KytyPS5.

   Architecture, ownership and ordering follow the source tree.
   Workload sizes and timings are deliberately illustrative: this
   is a teaching model, not an emulator or a benchmark.
   ============================================================ */
(function () {
  "use strict";

  var machine = document.getElementById("machine");
  if (!machine) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var PAGES = 192;
  var RING = 48;
  var REGISTERS = 96;
  var CACHE_SLOTS = 24;

  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmt(n, digits) { return Number(n || 0).toFixed(digits == null ? 1 : digits); }
  function pct(n) { return Math.round(n * 100) + "%"; }

  /* ---------- source-grounded architecture ---------- */

  var NODES = [
    { id: "game", title: "Game / eboot.bin", sub: "PS5 program + data", kind: "guest", pos: [1, 2], cats: ["boot", "services", "graphics"],
      summary: "The title's x86-64 code and RDNA 2 assets. Kyty loads it, but the host CPU executes its ordinary instructions directly.",
      sources: ["src/emulator.cpp", "src/loader/runtimeLinker.cpp"], topic: ["t-no-cpu-emulator.html", "Why there is no CPU emulator"] },
    { id: "cpu", title: "Native guest threads", sub: "System V x86-64", kind: "guest", pos: [1, 3], cats: ["services", "memory", "graphics"],
      summary: "Guest threads are real host threads. Native execution is fast, but every ABI crossing, unsupported instruction and unsafe memory access must be handled deliberately.",
      sources: ["src/loader/runtimeLinker.cpp", "src/kernel/pthread.cpp"], topic: ["t-calling-conventions.html", "Calling conventions and the ABI wall"] },
    { id: "memory", title: "Guest memory", sub: "fixed virtual addresses", kind: "guest", pos: [1, 4], cats: ["boot", "memory", "graphics"],
      summary: "Kyty reserves the address bands the game expects, maps executable segments, and backs direct or flexible allocations while preserving guest-visible pointers.",
      sources: ["src/kernel/memory.cpp", "src/common/virtualMemory.h"], topic: ["t-address-space.html", "The guest address space"] },
    { id: "agc", title: "AGC + PM4 ring", sub: "packets, not draw calls", kind: "guest", pos: [1, 5], cats: ["graphics"],
      summary: "The game builds AMD PM4 packets in memory. State packets, draws, dispatches and synchronisation reach Kyty as a command stream.",
      sources: ["src/libs/agc.cpp", "src/graphics/guest_gpu/pm4.cpp"], topic: ["t-pm4.html", "PM4 and the command processor"] },

    { id: "loader", title: "Runtime linker", sub: "SELF / ELF / NIDs", kind: "kyty", pos: [2, 2], cats: ["boot", "memory"],
      summary: "Loads modules, maps PT_LOAD segments, builds symbol databases, applies relocations and resolves console NIDs to addresses Kyty can serve.",
      sources: ["src/loader/runtimeLinker.cpp", "src/loader/symbolDatabase.cpp"], topic: ["t-nids.html", "NIDs and the runtime linker"] },
    { id: "patcher", title: "Instruction patcher", sub: "TLS + host differences", kind: "kyty", pos: [2, 3], cats: ["boot", "services"],
      summary: "Rewrites the small set of guest instruction patterns that cannot retain their original meaning on the host, including TLS access and platform-specific red-zone handling.",
      sources: ["src/loader/runtimeLinker.cpp", "src/loader/redZonePatcher.cpp"], topic: ["t-patching.html", "Patching guest instructions"] },
    { id: "hle", title: "HLE / ABI bridge", sub: "NID → C++ function", kind: "kyty", pos: [2, 4], cats: ["boot", "services"],
      summary: "High-level emulation replaces console libraries with registered C++ implementations. The call target obeys the guest System V ABI even when host code does not.",
      sources: ["src/libs/libs.cpp", "src/libs/libKernel.cpp"], topic: ["t-hle.html", "HLE libraries"] },
    { id: "kernel", title: "Kernel services", sub: "threads, events, files", kind: "kyty", pos: [2, 5], cats: ["services", "memory"],
      summary: "Implements console-facing pthreads, semaphores, event flags, event queues, synchronisation-on-address and virtual file-system operations over host primitives.",
      sources: ["src/kernel/pthread.cpp", "src/kernel/eventQueue.cpp", "src/kernel/fileSystem.cpp"], topic: ["t-hle.html", "Kernel and HLE services"] },

    { id: "exceptions", title: "Exception + coherency", sub: "faults as notifications", kind: "kyty", pos: [3, 2], cats: ["boot", "memory", "graphics"],
      summary: "The host exception handler distinguishes unsupported guest instructions, CPU writes to protected GPU resources, and genuine crashes. Page faults are part of normal coherency control flow.",
      sources: ["src/loader/runtimeLinker.cpp", "src/graphics/host_gpu/pageManager.cpp", "src/graphics/host_gpu/memoryTracker.cpp"], topic: ["t-coherency.html", "Page faults and CPU/GPU coherency"] },
    { id: "command", title: "Command processor", sub: "decode + shadow state", kind: "kyty", pos: [3, 3], cats: ["graphics"],
      summary: "Consumes PM4 headers and payloads, dispatches opcode handlers, updates the emulated hardware register file and turns draw or dispatch packets into host work.",
      sources: ["src/graphics/guest_gpu/command_processor/pm4Dispatch.cpp", "src/graphics/guest_gpu/command_processor/pm4Handlers.cpp"], topic: ["t-pm4.html", "The command processor"] },
    { id: "shader", title: "Shader recompiler", sub: "RDNA 2 → SPIR-V", kind: "kyty", pos: [3, 4], cats: ["graphics"],
      summary: "TranslateProgram builds an immutable ResourcePlan (decode, CFG, typed IR). CompileProgram emits SPIR-V per resource specialisation. Materialise happens at draw time in the pipeline cache.",
      sources: ["src/graphics/shader/recompiler/ShaderRecompiler.cpp", "src/graphics/shader/shader.cpp"], topic: ["t-shaders.html", "Shaders: RDNA 2 to SPIR-V"] },
    { id: "vulkan", title: "Vulkan renderer", sub: "resources + pipelines", kind: "kyty", pos: [3, 5], cats: ["memory", "graphics"],
      summary: "Resolves guest resources, uploads or tiles memory, creates cached Vulkan pipelines and descriptors, records commands and manages in-flight lifetimes.",
      sources: ["src/graphics/host_gpu/renderer/renderDraw.cpp", "src/graphics/host_gpu/renderer/commandScheduler.cpp"], topic: ["t-vulkan.html", "The Vulkan backend"] },

    { id: "controller", title: "Controller HLE", sub: "DualSense-shaped state", kind: "kyty", pos: [4, 2], cats: ["services"],
      summary: "Converts host input events into the pad state and return values the title expects from the console's controller library.",
      sources: ["src/libs/controller.cpp", "src/libs/libPad.cpp"], topic: ["t-hle.html", "HLE libraries"] },
    { id: "audio", title: "Audio HLE", sub: "PCM → SDL device", kind: "kyty", pos: [4, 3], cats: ["services"],
      summary: "Implements audio-out ports and buffering, converts formats when necessary and queues PCM data to a host audio device.",
      sources: ["src/libs/audio.cpp", "src/libs/libAudio.cpp", "src/libs/libAudio2.cpp"], topic: ["t-hle.html", "HLE libraries"] },
    { id: "filesystem", title: "Virtual file system", sub: "/app0 → host path", kind: "kyty", pos: [4, 4], cats: ["boot", "services"],
      summary: "Mounts the game and sandbox directories at console paths, then translates guest file calls and filenames to host filesystem operations.",
      sources: ["src/kernel/fileSystem.cpp", "src/emulator.cpp"], topic: ["t-hle.html", "Kernel and HLE services"] },
    { id: "presentation", title: "Video out + flip", sub: "buffers and vblank", kind: "kyty", pos: [4, 5], cats: ["graphics", "services"],
      summary: "Tracks registered video buffers, flip requests and vblank timing, then presents completed images through the host swapchain.",
      sources: ["src/graphics/presentation/videoOut.cpp", "src/graphics/presentation/window/swapchain.cpp"], topic: ["t-vulkan.html", "Presentation and the flip model"] },

    { id: "hostos", title: "Host OS + SDL", sub: "memory, files, devices", kind: "host", pos: [5, 2], cats: ["boot", "services", "memory"],
      summary: "Provides virtual memory, exception delivery, files, timers, controller events and audio devices. Kyty adapts these facilities to console-visible contracts.",
      sources: ["src/common/platform/", "src/graphics/presentation/window/hostInput.cpp"], topic: ["tour.html", "Architecture tour"] },
    { id: "hostthreads", title: "Host thread primitives", sub: "scheduler + synchronisation", kind: "host", pos: [5, 3], cats: ["services"],
      summary: "The host scheduler runs guest threads. Native mutexes, condition variables and waits carry the semantics exposed through Kyty's kernel layer.",
      sources: ["src/common/threads.cpp", "src/kernel/pthread.cpp"], topic: ["t-threads.html", "Threads and TLS"] },
    { id: "gpu", title: "Vulkan driver + GPU", sub: "execute submitted work", kind: "host", pos: [5, 4], cats: ["graphics"],
      summary: "Consumes Vulkan command buffers and SPIR-V. Graphics and compute can overlap when queue dependencies allow it; fences and semaphores report completion.",
      sources: ["src/graphics/host_gpu/vulkanCommon.cpp", "src/graphics/host_gpu/renderer/commandScheduler.cpp"], topic: ["t-vulkan.html", "The Vulkan backend"] },
    { id: "window", title: "Window / display", sub: "presented host image", kind: "host", pos: [5, 5], cats: ["graphics", "services"],
      summary: "Owns the host window and swapchain surface. A successful flip is the final visible result of every earlier loader, CPU, memory and GPU boundary crossing.",
      sources: ["src/graphics/presentation/window/window.cpp", "src/graphics/presentation/window/vulkanWindow.cpp"], topic: ["t-vulkan.html", "Presentation and the flip model"] }
  ];

  var EDGES = [
    ["game", "loader"], ["loader", "memory"], ["loader", "hle"], ["loader", "patcher"],
    ["patcher", "cpu"], ["game", "cpu"], ["cpu", "hle"], ["hle", "kernel"],
    ["kernel", "hostthreads"], ["hle", "filesystem"], ["filesystem", "hostos"],
    ["cpu", "memory"], ["memory", "exceptions"], ["exceptions", "memory"],
    ["cpu", "agc"], ["agc", "command"], ["command", "shader"], ["command", "vulkan"],
    ["shader", "vulkan"], ["memory", "vulkan"], ["vulkan", "gpu"],
    ["hostos", "controller"], ["controller", "cpu"], ["cpu", "audio"], ["audio", "hostos"],
    ["gpu", "presentation"], ["presentation", "window"]
  ].map(function (e) { return { from: e[0], to: e[1], id: e[0] + ">" + e[1] }; });

  var BOOT = [
    { short: "host", title: "Host process starts", active: ["hostos"], paths: [], cost: "startup",
      body: "<code>main()</code> initialises virtual memory and threads, parses the command line and enters <code>Emulator::Run</code>. No guest instruction has run." },
    { short: "init", title: "Subsystems initialise in order", active: ["loader", "kernel", "controller", "audio", "vulkan"], paths: [], cost: "one time",
      body: "Configuration, logging, timers, pthreads, networking, memory, files, controller, audio and graphics come up in an explicit order; shutdown reverses it." },
    { short: "mount", title: "Console paths are mounted", active: ["filesystem", "hostos"], paths: ["filesystem>hostos"], cost: "I/O",
      body: "The game directory becomes <code>/app0</code> and <code>/hostapp</code>; download and temporary sandboxes receive title-specific host directories." },
    { short: "exports", title: "HLE exports are registered", active: ["hle", "kernel", "controller", "audio"], paths: ["hle>kernel"], cost: "symbol setup",
      body: "<code>Libs::InitAll</code> fills the symbol database with NID-to-function registrations for the console libraries Kyty implements." },
    { short: "ELF", title: "eboot.bin is opened and parsed", active: ["game", "loader", "filesystem"], paths: ["game>loader", "filesystem>hostos"], cost: "file read",
      body: "The runtime linker reads Sony's ELF-derived module metadata, program headers, dynamic tables, imports and exports." },
    { short: "map", title: "Segments enter guest memory", active: ["loader", "memory", "hostos"], paths: ["loader>memory"], cost: "map + protect",
      body: "Loadable segments are placed at their required virtual addresses, zero-filled where <code>memsz &gt; filesz</code>, then given guest-visible protection." },
    { short: "NIDs", title: "Imports resolve and GOT slots change", active: ["loader", "hle", "memory"], paths: ["loader>hle", "loader>memory"], cost: "relocations",
      body: "Each imported NID is matched against loaded modules or Kyty's HLE database. Resolved addresses are written into relocation targets and GOT slots." },
    { short: "patch", title: "Unsafe instruction patterns are rewritten", active: ["loader", "patcher", "memory"], paths: ["loader>patcher"], cost: "code patch",
      body: "TLS access and other host-incompatible patterns are patched before code pages become executable. The guest still runs natively afterwards." },
    { short: "faults", title: "The host exception route is armed", active: ["exceptions", "memory", "hostos"], paths: ["memory>exceptions"], cost: "handler",
      body: "Kyty installs the handler used for unsupported instructions, protected GPU-memory accesses and crash reporting." },
    { short: "thread", title: "A real host thread carries the guest", active: ["cpu", "hostthreads", "patcher"], paths: ["patcher>cpu", "kernel>hostthreads"], cost: "thread create",
      body: "TLS and a guest stack are prepared. A host thread will enter the guest with the System V calling convention." },
    { short: "entry", title: "Control jumps to the game entry point", active: ["game", "cpu"], paths: ["game>cpu"], cost: "native",
      body: "The host CPU begins executing the title's own x86-64 instructions. From here Kyty is entered only at mapped services, faults and graphics boundaries." }
  ];

  var FRAME = [
    { short: "input", title: "Host input becomes pad state", active: ["hostos", "controller", "cpu"], paths: ["hostos>controller", "controller>cpu"], key: "input",
      body: "Window events update controller state; a guest <code>scePadReadState</code>-style call sees DualSense-shaped data through HLE." },
    { short: "guest", title: "The game update runs natively", active: ["game", "cpu", "memory"], paths: ["game>cpu", "cpu>memory"], key: "cpu",
      body: "Game logic, animation and command building are ordinary x86-64 instructions scheduled by the host OS, not interpreted instructions." },
    { short: "HLE", title: "Console calls cross the ABI wall", active: ["cpu", "hle", "kernel", "hostthreads"], paths: ["cpu>hle", "hle>kernel", "kernel>hostthreads"], key: "hle",
      body: "A GOT target reaches a registered Kyty function. Arguments and return values obey the guest ABI while the implementation uses host facilities." },
    { short: "I/O", title: "Files and audio use host devices", active: ["cpu", "filesystem", "audio", "hostos"], paths: ["cpu>audio", "audio>hostos", "hle>filesystem", "filesystem>hostos"], key: "io",
      body: "Virtual paths are translated to host files, while audio blocks are converted when needed and queued to the host output device." },
    { short: "writes", title: "The CPU changes GPU-visible memory", active: ["cpu", "memory", "exceptions"], paths: ["cpu>memory", "memory>exceptions"], key: "writes",
      body: "A native store hits a protected watched region. The fault tells the memory tracker exactly which texture or buffer range became stale." },
    { short: "PM4", title: "AGC writes the command ring", active: ["cpu", "agc", "memory"], paths: ["cpu>agc"], key: "pm4",
      body: "The game emits state, draw, dispatch and synchronisation packets. Kyty sees a hardware-shaped PM4 stream rather than a friendly draw API." },
    { short: "decode", title: "The command processor consumes packets", active: ["agc", "command"], paths: ["agc>command"], key: "decode",
      body: "Packet lengths keep the stream aligned; opcode handlers update shadow registers until a draw or dispatch forces work to be materialised." },
    { short: "bind", title: "Registers resolve shaders and resources", active: ["command", "memory", "vulkan"], paths: ["command>vulkan", "memory>vulkan"], key: "bind",
      body: "User-data pointers and sharps identify buffers, images and samplers. Accumulated register state becomes Vulkan descriptors and pipeline state." },
    { short: "compile", title: "Shaders and pipelines are looked up", active: ["command", "shader", "vulkan"], paths: ["command>shader", "shader>vulkan"], key: "compile",
      body: "A cache miss recompiles RDNA 2 to SPIR-V and creates a Vulkan pipeline. A hit reuses the already translated object." },
    { short: "upload", title: "Dirty regions are made GPU-current", active: ["memory", "exceptions", "vulkan"], paths: ["exceptions>memory", "memory>vulkan"], key: "upload",
      body: "Only watched regions dirtied by the CPU are uploaded, tiled or rebound. They are protected again once the host GPU copy is current." },
    { short: "submit", title: "Vulkan work enters host queues", active: ["vulkan", "gpu"], paths: ["vulkan>gpu"], key: "submit",
      body: "Recorded commands and resource lifetimes are tied to fences and semaphores. Compute overlaps graphics when dependencies and queue use permit it." },
    { short: "draw", title: "The host GPU executes the draw", active: ["gpu"], paths: ["vulkan>gpu"], key: "draw",
      body: "SPIR-V shaders consume translated descriptors and write the render target. This is the first point where the frame has pixels." },
    { short: "flip", title: "Video out presents the completed image", active: ["gpu", "presentation", "window"], paths: ["gpu>presentation", "presentation>window"], key: "present",
      body: "A completed buffer is flipped through the host swapchain. VSync may make a frame that just misses one refresh wait for the next." }
  ];

  var DEFAULTS = {
    draws: 34, states: 8, cacheSize: 16, dirtyRate: 0.12, granKB: 64,
    hleCalls: 10, asyncCompute: true, vsync: true, missingNid: false
  };
  var P = {};
  function assignDefaults(extra) {
    Object.keys(DEFAULTS).forEach(function (k) { P[k] = DEFAULTS[k]; });
    if (extra) Object.keys(extra).forEach(function (k) { P[k] = extra[k]; });
  }
  assignDefaults();

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sim = {
    phase: "boot", step: 0, bootMax: 0, frame: 0, running: !reduceMotion, blocked: false,
    speed: 1, elapsed: 0, selected: "loader", filter: "all", preset: "balanced",
    history: [], log: [], pages: new Array(PAGES).fill("clean"), cache: [], newPipelines: [],
    report: null, ringWrite: 0, ringRead: 0, audioFill: 23, hleRecent: [],
    presentedFrames: 0, totalHle: 0, inputTick: 0
  };

  var HLE_CALLS = [
    "sceKernelGetProcessTime", "sceKernelWaitEqueue", "scePthreadMutexLock",
    "scePadReadState", "sceAudioOutOutputs", "sceKernelRead", "sceKernelGettimeofday",
    "sceVideoOutSubmitFlip", "sceKernelMapNamedDirectMemory", "sceKernelUsleep"
  ];

  function currentSequence() { return sim.phase === "boot" ? BOOT : FRAME; }
  function currentStep() { return currentSequence()[sim.step]; }
  function edgeActive(id) { return currentStep().paths.indexOf(id) >= 0; }

  /* ---------- cost and state model ---------- */

  function computeFrame() {
    var hits = 0;
    var misses = 0;
    var fresh = [];
    var keys = [];
    var i;

    for (i = 0; i < P.states; i++) keys.push("p" + i);
    keys.forEach(function (key) {
      var at = sim.cache.indexOf(key);
      if (at >= 0) {
        hits++;
        sim.cache.splice(at, 1);
        sim.cache.push(key);
      } else {
        misses++;
        fresh.push(key);
        sim.cache.push(key);
        while (sim.cache.length > P.cacheSize) sim.cache.shift();
      }
    });

    var dirty = clamp(Math.round(PAGES * P.dirtyRate), 0, PAGES);
    var uploadedMB = dirty * P.granKB / 1024;
    var cpu = 1.15 + P.hleCalls * 0.035 + P.draws * 0.018;
    var pm4 = 0.45 + P.draws * 0.022;
    var compile = misses * 1.18;
    var upload = uploadedMB * 0.34 + dirty * (P.granKB <= 16 ? 0.006 : 0.002);
    var gpu = 2.15 + P.draws * 0.055;
    var sync = P.asyncCompute ? 0.25 : 0.5 + P.draws * 0.095;
    var work = cpu + pm4 + compile + upload + gpu + sync;
    var presented = P.vsync ? Math.max(16.667, Math.ceil(work / 16.667) * 16.667) : work;
    var wait = Math.max(0, presented - work);

    sim.newPipelines = fresh;
    return {
      cpu: cpu + pm4 + sync, upload: upload, compile: compile, gpu: gpu, wait: wait,
      work: work, presented: presented, fps: 1000 / presented,
      hits: hits, misses: misses, dirty: dirty, uploadedMB: uploadedMB,
      queueDepth: clamp(Math.round(P.draws / 8 + (P.asyncCompute ? 1 : 5)), 1, 18)
    };
  }

  function eventCost(step) {
    var r = sim.report;
    if (sim.phase === "boot" || !r) return step.cost || "event";
    if (step.key === "cpu" || step.key === "hle" || step.key === "pm4") return fmt(r.cpu, 1) + " ms CPU";
    if (step.key === "compile") return r.misses ? fmt(r.compile, 1) + " ms · " + r.misses + " miss" + (r.misses === 1 ? "" : "es") : "cache hit";
    if (step.key === "upload") return fmt(r.uploadedMB, 2) + " MB";
    if (step.key === "submit") return P.asyncCompute ? "overlapped" : "serial wait";
    if (step.key === "draw") return fmt(r.gpu, 1) + " ms GPU";
    if (step.key === "present") return fmt(r.presented, 1) + " ms · " + Math.round(r.fps) + " fps";
    return "live";
  }

  function addLog(kind, text, level) {
    sim.log.unshift({
      time: sim.phase === "boot" ? "boot " + (sim.step + 1) : "f" + sim.frame + "." + (sim.step + 1),
      kind: kind, text: text, level: level || "info"
    });
    if (sim.log.length > 60) sim.log.length = 60;
  }

  function markDirtyPages(count) {
    for (var i = 0; i < count; i++) {
      var at = (sim.frame * 29 + i * 17 + Math.floor(i / 7) * 11) % PAGES;
      sim.pages[at] = "dirty";
    }
  }

  function startFrame() {
    sim.frame++;
    sim.report = computeFrame();
    sim.ringWrite = 0;
    sim.ringRead = 0;
    sim.inputTick++;
  }

  function enterStep(silent) {
    var step = currentStep();
    sim.elapsed = 0;
    if (sim.phase === "boot") sim.bootMax = Math.max(sim.bootMax, sim.step);

    if (sim.phase === "boot" && sim.step === 6 && P.missingNid) {
      sim.blocked = true;
      sim.running = false;
      if (!silent) addLog("linker", "unresolved NID mL8NDH86iQI — no loaded export or HLE implementation", "error");
    } else if (sim.phase === "frame") {
      if (step.key === "input") {
        if (!silent) addLog("input", "host event → ControllerState → guest pad data");
      } else if (step.key === "hle") {
        var n = Math.min(5, Math.max(1, Math.ceil(P.hleCalls / 8)));
        for (var h = 0; h < n; h++) {
          var call = HLE_CALLS[(sim.frame * 3 + h) % HLE_CALLS.length];
          sim.hleRecent.unshift({ name: call, frame: sim.frame });
        }
        sim.hleRecent.length = Math.min(sim.hleRecent.length, 8);
        sim.totalHle += P.hleCalls;
        if (!silent) addLog("HLE", P.hleCalls + " console calls crossed into registered C++ implementations");
      } else if (step.key === "io") {
        sim.audioFill = clamp(sim.audioFill + 4, 0, 32);
        if (!silent) addLog("I/O", "virtual files translated; PCM blocks queued to host audio");
      } else if (step.key === "writes") {
        markDirtyPages(sim.report.dirty);
        if (!silent) addLog("fault", sim.report.dirty + " watched regions dirtied by native CPU stores", sim.report.dirty > 70 ? "warn" : "info");
      } else if (step.key === "pm4") {
        sim.ringWrite = clamp(Math.round(P.draws / 2) + 10, 6, RING);
        if (!silent) addLog("guest", sim.ringWrite + " PM4 packets written to the visible ring");
      } else if (step.key === "decode") {
        sim.ringRead = Math.round(sim.ringWrite * 0.72);
        if (!silent) addLog("PM4", "packet headers decoded; register shadow updated");
      } else if (step.key === "compile") {
        if (!silent) addLog("pipeline", sim.report.misses ? sim.report.misses + " pipeline cache misses; RDNA 2 → SPIR-V" : "all pipeline keys hit the cache", sim.report.misses > 8 ? "warn" : "info");
      } else if (step.key === "upload") {
        sim.pages = sim.pages.map(function (p) { return p === "dirty" ? "uploading" : p; });
        if (!silent) addLog("memory", fmt(sim.report.uploadedMB, 2) + " MB copied for " + sim.report.dirty + " dirty regions", sim.report.upload > 8 ? "warn" : "info");
      } else if (step.key === "submit") {
        sim.pages = sim.pages.map(function (p) { return p === "uploading" ? "protected" : p; });
        if (!silent) addLog("Vulkan", P.asyncCompute ? "graphics and compute queues can overlap" : "compute serialised behind graphics", P.asyncCompute ? "info" : "warn");
      } else if (step.key === "present") {
        if (!silent) {
          sim.history.push(sim.report);
          if (sim.history.length > 90) sim.history.shift();
          sim.presentedFrames++;
          sim.audioFill = clamp(sim.audioFill - (sim.report.presented > 33.34 ? 8 : 3), 0, 32);
          addLog("flip", "frame " + sim.frame + " presented in " + fmt(sim.report.presented, 1) + " ms");
        }
      }
    }

    if (!silent && sim.phase === "boot" && !sim.blocked) addLog("boot", step.title);
    renderAll();
  }

  function advance() {
    if (sim.blocked) return;
    sim.step++;
    if (sim.step >= currentSequence().length) {
      if (sim.phase === "boot") {
        sim.phase = "frame";
        sim.step = 0;
        sim.bootMax = BOOT.length - 1;
        startFrame();
        addLog("run", "guest entry reached — continuous frame loop begins");
      } else {
        sim.step = 0;
        startFrame();
      }
    }
    enterStep(false);
  }

  function reboot() {
    sim.phase = "boot";
    sim.step = 0;
    sim.bootMax = 0;
    sim.frame = 0;
    sim.blocked = false;
    sim.running = true;
    sim.elapsed = 0;
    sim.history = [];
    sim.log = [];
    sim.pages = new Array(PAGES).fill("clean");
    sim.cache = [];
    sim.newPipelines = [];
    sim.report = null;
    sim.ringWrite = 0;
    sim.ringRead = 0;
    sim.hleRecent = [];
    sim.presentedFrames = 0;
    sim.totalHle = 0;
    enterStep(false);
  }

  function jumpToFrame() {
    sim.phase = "frame";
    sim.step = 0;
    sim.bootMax = BOOT.length - 1;
    sim.blocked = false;
    sim.running = true;
    sim.frame = 0;
    sim.history = [];
    sim.pages = new Array(PAGES).fill("clean");
    sim.cache = [];
    sim.newPipelines = [];
    startFrame();
    addLog("run", "jumped to the steady-state frame loop");
    enterStep(true);
  }

  /* ---------- architecture map ---------- */

  var map = $("mc-map");
  var links = $("mc-links");
  var nodeEls = {};
  var edgeEls = {};

  function buildMap() {
    var guestLane = make("div", "mc-lane guest", "guest");
    var kytyLane = make("div", "mc-lane kyty", "Kyty");
    var hostLane = make("div", "mc-lane host", "host");
    map.appendChild(guestLane); map.appendChild(kytyLane); map.appendChild(hostLane);

    NODES.forEach(function (n) {
      var button = make("button", "mc-node");
      button.type = "button";
      button.dataset.node = n.id;
      button.dataset.kind = n.kind;
      button.style.gridRow = n.pos[0];
      button.style.gridColumn = n.pos[1];
      button.innerHTML = "<b>" + n.title + "</b><small>" + n.sub + "</small><span class=\"mc-node-signal\"></span>";
      button.addEventListener("click", function () { sim.selected = n.id; renderInspector(); renderMapState(); });
      map.appendChild(button);
      nodeEls[n.id] = button;
    });
  }

  function drawEdges() {
    while (links.firstChild) links.removeChild(links.firstChild);
    var w = map.offsetWidth;
    var h = map.offsetHeight;
    if (!w || !h) return;
    links.setAttribute("viewBox", "0 0 " + w + " " + h);
    links.setAttribute("width", w);
    links.setAttribute("height", h);
    links.style.width = w + "px";
    links.style.height = h + "px";

    EDGES.forEach(function (edge) {
      var a = nodeEls[edge.from];
      var b = nodeEls[edge.to];
      if (!a || !b) return;
      var x1 = a.offsetLeft + a.offsetWidth / 2;
      var y1 = a.offsetTop + a.offsetHeight / 2;
      var x2 = b.offsetLeft + b.offsetWidth / 2;
      var y2 = b.offsetTop + b.offsetHeight / 2;
      var bend = Math.max(28, Math.abs(y2 - y1) * 0.42);
      var d;
      if (Math.abs(y2 - y1) < 12) {
        d = "M " + x1 + " " + y1 + " L " + x2 + " " + y2;
      } else {
        var direction = y2 > y1 ? 1 : -1;
        d = "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 + bend * direction) + ", " + x2 + " " + (y2 - bend * direction) + ", " + x2 + " " + y2;
      }
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "mc-edge");
      path.dataset.edge = edge.id;
      links.appendChild(path);
      edgeEls[edge.id] = path;
    });
    renderMapState();
  }

  function nodeMatchesFilter(node) {
    return sim.filter === "all" || node.cats.indexOf(sim.filter) >= 0;
  }

  function renderMapState() {
    var step = currentStep();
    NODES.forEach(function (n) {
      var el = nodeEls[n.id];
      el.classList.toggle("is-active", step.active.indexOf(n.id) >= 0);
      el.classList.toggle("is-selected", sim.selected === n.id);
      el.classList.toggle("is-dim", !nodeMatchesFilter(n));
      el.classList.toggle("is-error", sim.blocked && (n.id === "loader" || n.id === "hle"));
    });
    EDGES.forEach(function (edge) {
      var el = edgeEls[edge.id];
      if (!el) return;
      var active = edgeActive(edge.id);
      var from = NODES.find(function (n) { return n.id === edge.from; });
      var to = NODES.find(function (n) { return n.id === edge.to; });
      el.classList.toggle("is-active", active);
      el.classList.toggle("is-error", sim.blocked && edge.id === "loader>hle");
      el.classList.toggle("is-dim", !nodeMatchesFilter(from) || !nodeMatchesFilter(to));
    });
  }

  function liveFor(id) {
    var r = sim.report || {};
    var values = {
      game: { "execution": sim.phase === "boot" ? "not entered" : "native", "frame": sim.frame || "—" },
      cpu: { "guest threads": "4 host threads", "HLE calls/frame": P.hleCalls },
      memory: { "watched regions": PAGES, "dirty now": sim.pages.filter(function (p) { return p === "dirty"; }).length },
      agc: { "packets queued": Math.max(0, sim.ringWrite - sim.ringRead), "draws/frame": P.draws },
      loader: { "boot progress": Math.round((sim.bootMax + 1) / BOOT.length * 100) + "%", "imports": sim.blocked ? "1 unresolved" : "resolved" },
      patcher: { "phase": sim.bootMax >= 7 ? "complete" : "waiting", "guest ISA": "x86-64" },
      hle: { "calls this run": sim.totalHle, "registered layer": "Libs::InitAll" },
      kernel: { "objects": "threads · events · files", "active wait": currentStep().active.indexOf("kernel") >= 0 ? "yes" : "no" },
      exceptions: { "page state": sim.pages.some(function (p) { return p === "dirty"; }) ? "dirty" : "armed", "granularity": P.granKB + " KB" },
      command: { "ring consumed": sim.ringRead + " / " + sim.ringWrite, "registers shown": REGISTERS },
      shader: { "pipeline misses": r.misses == null ? "—" : r.misses, "output": "SPIR-V" },
      vulkan: { "cache hit rate": r.hits == null ? "—" : pct(r.hits / Math.max(1, r.hits + r.misses)), "queue depth": r.queueDepth || "—" },
      controller: { "poll": "once per frame", "input sample": sim.inputTick % 3 ? "neutral" : "cross" },
      audio: { "buffer": sim.audioFill + " / 32 blocks", "device": "SDL output" },
      filesystem: { "game mount": "/app0", "sandbox": "/download0 · /temp0" },
      presentation: { "presented": sim.presentedFrames, "VSync": P.vsync ? "on" : "off" },
      hostos: { "host facilities": "VM · files · SDL", "exception handler": sim.bootMax >= 8 ? "installed" : "pending" },
      hostthreads: { "scheduling": "host OS", "async compute": P.asyncCompute ? "enabled" : "serial" },
      gpu: { "GPU cost": r.gpu == null ? "—" : fmt(r.gpu, 1) + " ms", "work": r.queueDepth || "—" },
      window: { "resolution": "teaching viewport", "refresh result": r.fps == null ? "—" : Math.round(r.fps) + " fps" }
    };
    return values[id] || {};
  }

  function renderInspector() {
    var n = NODES.find(function (x) { return x.id === sim.selected; }) || NODES[0];
    $("mc-inspector-kind").textContent = n.kind === "kyty" ? "Kyty subsystem" : n.kind === "guest" ? "Guest-side state" : "Host facility";
    $("mc-inspector-title").textContent = n.title;
    $("mc-inspector-summary").textContent = n.summary;
    var live = $("mc-inspector-live");
    live.innerHTML = "";
    var values = liveFor(n.id);
    Object.keys(values).forEach(function (key) {
      live.appendChild(make("dt", "", key));
      live.appendChild(make("dd", "", values[key]));
    });
    var sources = $("mc-source-list");
    sources.innerHTML = "";
    n.sources.forEach(function (src) { sources.appendChild(make("code", "", src)); });
    var link = $("mc-topic-link");
    link.href = n.topic[0];
    link.textContent = n.topic[1] + " →";
  }

  /* ---------- controls ---------- */

  var PRESETS = [
    { id: "balanced", name: "Balanced", note: "Warm cache, light uploads", values: {} },
    { id: "cold", name: "Cold first scene", note: "18 new pipelines", values: { states: 18, cacheSize: 24, dirtyRate: 0.08 } },
    { id: "thrash", name: "Pipeline thrash", note: "20 keys, 4 slots", values: { states: 20, cacheSize: 4, draws: 48 } },
    { id: "uploads", name: "Upload storm", note: "coarse 1 MB regions", values: { dirtyRate: 0.42, granKB: 1024, draws: 26 } },
    { id: "serial", name: "Serial queues", note: "compute cannot overlap", values: { draws: 90, asyncCompute: false, states: 7 } },
    { id: "hle", name: "HLE-heavy", note: "60 service calls/frame", values: { hleCalls: 60, draws: 22 } },
    { id: "missing", name: "Missing export", note: "stop at NID resolution", values: { missingNid: true } }
  ];

  var CONTROL_SPECS = [
    { key: "draws", label: "Draw packets / frame", min: 4, max: 120, step: 1 },
    { key: "states", label: "Distinct pipeline keys", min: 1, max: 24, step: 1 },
    { key: "cacheSize", label: "Pipeline cache slots", min: 2, max: 24, step: 1 },
    { key: "dirtyRate", label: "CPU write rate", min: 0.02, max: 0.6, step: 0.01, format: function (v) { return Math.round(v * 100) + "%"; } },
    { key: "granKB", label: "Watch granularity", values: [4, 16, 64, 256, 1024, 4096], format: function (v) { return v >= 1024 ? (v / 1024) + " MB" : v + " KB"; } },
    { key: "hleCalls", label: "HLE calls / frame", min: 1, max: 60, step: 1 },
    { key: "asyncCompute", label: "Async compute", toggle: true },
    { key: "vsync", label: "VSync", toggle: true }
  ];

  function buildPresets() {
    var host = $("mc-presets");
    host.innerHTML = "";
    PRESETS.forEach(function (preset) {
      var b = make("button", "mc-preset");
      b.type = "button";
      b.dataset.preset = preset.id;
      b.innerHTML = "<b>" + preset.name + "</b><small>" + preset.note + "</small>";
      b.addEventListener("click", function () { applyPreset(preset.id); });
      host.appendChild(b);
    });
  }

  function renderPresetState() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
      b.classList.toggle("is-active", b.dataset.preset === sim.preset);
    });
  }

  function buildControls() {
    var host = $("mc-controls");
    host.innerHTML = "";
    CONTROL_SPECS.forEach(function (spec) {
      if (spec.toggle) {
        var toggle = make("label", "mc-control-toggle");
        toggle.appendChild(make("span", "", spec.label));
        var check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !!P[spec.key];
        check.addEventListener("change", function () {
          P[spec.key] = check.checked;
          sim.preset = "custom";
          renderAll();
        });
        toggle.appendChild(check);
        host.appendChild(toggle);
        return;
      }

      var wrap = make("label", "mc-control");
      var head = make("span", "mc-control-head");
      head.appendChild(make("b", "", spec.label));
      var out = make("output");
      head.appendChild(out);
      wrap.appendChild(head);
      var input = document.createElement("input");
      input.type = "range";
      if (spec.values) {
        input.min = 0; input.max = spec.values.length - 1; input.step = 1;
        input.value = Math.max(0, spec.values.indexOf(P[spec.key]));
      } else {
        input.min = spec.min; input.max = spec.max; input.step = spec.step; input.value = P[spec.key];
      }
      function sync(write) {
        if (write) {
          P[spec.key] = spec.values ? spec.values[parseInt(input.value, 10)] : parseFloat(input.value);
          if (spec.key === "cacheSize") while (sim.cache.length > P.cacheSize) sim.cache.shift();
          sim.preset = "custom";
        }
        out.textContent = spec.format ? spec.format(P[spec.key]) : P[spec.key];
        if (write) renderAll();
      }
      input.addEventListener("input", function () { sync(true); });
      wrap.appendChild(input);
      host.appendChild(wrap);
      sync(false);
    });
  }

  function applyPreset(id) {
    var preset = PRESETS.find(function (p) { return p.id === id; });
    if (!preset) return;
    assignDefaults(preset.values);
    sim.preset = id;
    sim.cache = [];
    buildControls();
    if (id === "missing") reboot(); else jumpToFrame();
    renderPresetState();
  }

  /* ---------- static detail instruments ---------- */

  var SEGMENTS = [
    { at: 0, addr: "host", name: "Kyty process + libraries", size: "host mappings", kind: "host" },
    { at: 1, addr: "reserved", name: "guest address bands", size: "claimed up front", kind: "kyty" },
    { at: 5, addr: "0x0900000000", name: "eboot.bin .text", size: "R-X", kind: "guest" },
    { at: 5, addr: "0x0900021000", name: "eboot.bin .rodata", size: "R--", kind: "guest" },
    { at: 5, addr: "0x0900024000", name: "eboot.bin .data + .bss", size: "RW-", kind: "guest" },
    { at: 5, addr: "TLS template", name: "per-thread initial image", size: "copied on create", kind: "guest" },
    { at: 6, addr: "GOT / reloc", name: "resolved import targets", size: "patched pointers", kind: "kyty" },
    { at: 9, addr: "thread stacks", name: "guest stack + TLS", size: "host backed", kind: "kyty" },
    { at: 10, addr: "direct memory", name: "textures + buffers", size: "guest chosen", kind: "guest" },
    { at: 10, addr: "command rings", name: "PM4 queues", size: "CPU/GPU shared", kind: "guest" }
  ];
  var LOADER_STAGES = ["open SELF/ELF", "read headers", "map segments", "build symbols", "relocate NIDs", "patch code", "protect + enter"];
  var SHADER_STAGES = ["decode", "CFG", "translate", "materialize", "SPIR-V"];

  var pageEls = [];
  var ringEls = [];
  var registerEls = [];
  var cacheEls = [];
  var audioEls = [];

  function buildStaticPanels() {
    var address = $("mc-address-space");
    SEGMENTS.forEach(function (seg) {
      var row = make("div", "mc-segment " + seg.kind);
      row.dataset.at = seg.at;
      row.innerHTML = "<code>" + seg.addr + "</code><b>" + seg.name + "</b><small>" + seg.size + "</small>";
      address.appendChild(row);
    });

    var loader = $("mc-loader-flow");
    LOADER_STAGES.forEach(function (name, i) {
      var step = make("div", "mc-loader-stage", name);
      step.dataset.stage = i;
      loader.appendChild(step);
    });

    var pages = $("mc-pages");
    for (var p = 0; p < PAGES; p++) {
      var page = make("i", "mc-page");
      pages.appendChild(page);
      pageEls.push(page);
    }

    var ring = $("mc-ring");
    for (var r = 0; r < RING; r++) {
      var cell = make("i", "mc-ring-cell");
      ring.appendChild(cell);
      ringEls.push(cell);
    }

    var registers = $("mc-registers");
    for (var g = 0; g < REGISTERS; g++) {
      var reg = make("i", "mc-register");
      registers.appendChild(reg);
      registerEls.push(reg);
    }

    var shader = $("mc-shader-flow");
    SHADER_STAGES.forEach(function (name, i) {
      var node = make("div", "mc-shader-stage", name);
      node.dataset.stage = i;
      shader.appendChild(node);
    });

    var cache = $("mc-cache");
    for (var c = 0; c < CACHE_SLOTS; c++) {
      var slot = make("div", "mc-cache-cell", "—");
      cache.appendChild(slot);
      cacheEls.push(slot);
    }

    var queues = $("mc-queues");
    ["gfx", "cmp 0", "cmp 1", "cmp 2"].forEach(function (name, row) {
      var q = make("div", "mc-queue " + (row ? "compute" : "gfx"));
      q.dataset.queue = row;
      q.appendChild(make("b", "", name));
      for (var i = 0; i < 18; i++) q.appendChild(make("i"));
      queues.appendChild(q);
    });

    var audio = $("mc-audio-ring");
    for (var a = 0; a < 32; a++) {
      var block = make("i", "mc-audio-block");
      audio.appendChild(block);
      audioEls.push(block);
    }

    var threads = $("mc-threads");
    [
      ["guest main", "game update"], ["guest worker", "jobs + streaming"],
      ["window main", "events + present"], ["audio callback", "host device"]
    ].forEach(function (t, i) {
      var row = make("div", "mc-thread");
      row.dataset.thread = i;
      row.innerHTML = "<b>" + t[0] + "</b><span>" + t[1] + "</span><i></i>";
      threads.appendChild(row);
    });

    var kernel = $("mc-kernel-objects");
    [["pthread", "4 live"], ["event queue", "2 waits"], ["semaphore", "3 objects"], ["event flag", "1 signalled"], ["file handle", "6 open"]].forEach(function (o) {
      var obj = make("div", "mc-kobj");
      obj.innerHTML = "<b>" + o[0] + "</b><span>" + o[1] + "</span>";
      kernel.appendChild(obj);
    });
  }

  /* ---------- renderers ---------- */

  function renderStatus() {
    machine.classList.toggle("is-running", sim.running && !sim.blocked);
    machine.classList.toggle("is-blocked", sim.blocked);
    $("mc-state").textContent = sim.blocked ? "Blocked on missing export" : sim.running ? (sim.phase === "boot" ? "Booting" : "Running frame loop") : "Paused";
    $("mc-clock").textContent = sim.phase === "boot" ? "startup · step " + (sim.step + 1) + " of " + BOOT.length : "frame " + sim.frame + " · event " + (sim.step + 1) + " of " + FRAME.length;
    $("mc-play").textContent = sim.blocked ? "Install stub & continue" : sim.running ? "Pause" : "Resume";
  }

  function renderSequence() {
    var host = $("mc-sequence");
    var seq = currentSequence();
    if (host.dataset.phase !== sim.phase) {
      host.dataset.phase = sim.phase;
      host.innerHTML = "";
      seq.forEach(function (step, i) {
        var b = make("button", "mc-seq-step", step.short);
        b.type = "button";
        b.dataset.step = i;
        b.title = step.title;
        b.addEventListener("click", function () {
          sim.running = false;
          sim.blocked = false;
          sim.step = i;
          if (sim.phase === "boot") sim.bootMax = Math.max(sim.bootMax, i);
          enterStep(true);
        });
        host.appendChild(b);
      });
    }
    Array.prototype.forEach.call(host.children, function (b, i) {
      b.classList.toggle("is-current", i === sim.step);
      b.classList.toggle("is-past", i < sim.step || (sim.phase === "boot" && i <= sim.bootMax && i !== sim.step));
    });
    var current = host.children[sim.step];
    if (current && !current.dataset.seen) {
      current.dataset.seen = "1";
      current.scrollIntoView({ block: "nearest", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function renderNow() {
    var step = currentStep();
    $("mc-now-index").textContent = String(sim.step + 1).padStart(2, "0");
    $("mc-now-title").textContent = step.title;
    $("mc-now-body").innerHTML = sim.blocked
      ? "The import has no target. Real Kyty can install a generated unresolved-import thunk, find the symbol in another loaded module, or fail when the call is reached. Use <b>Install stub &amp; continue</b> to recover this teaching run."
      : step.body;
    $("mc-now-cost").textContent = sim.blocked ? "unresolved NID" : eventCost(step);
  }

  function metric(name, value, sub, state) {
    return "<div class=\"mc-metric" + (state ? " " + state : "") + "\"><span>" + name + "</span><b>" + value + "</b><small>" + sub + "</small></div>";
  }

  function renderMetrics() {
    var r = sim.report;
    var hitRate = r ? r.hits / Math.max(1, r.hits + r.misses) : 0;
    var audioState = sim.audioFill < 6 ? "is-bad" : sim.audioFill < 12 ? "is-warn" : "";
    var frameState = r && r.presented > 33.34 ? "is-bad" : r && r.presented > 16.7 ? "is-warn" : "";
    $("mc-metrics").innerHTML =
      metric("presented frame", r ? fmt(r.presented, 1) + " ms" : "—", r ? Math.round(r.fps) + " fps" : "booting", frameState) +
      metric("guest execution", sim.phase === "boot" ? "waiting" : "native", "x86-64 host CPU") +
      metric("HLE calls", sim.phase === "boot" ? "—" : P.hleCalls, "per frame") +
      metric("pipeline hits", r ? Math.round(hitRate * 100) + "%" : "—", r ? r.misses + " misses" : "cache cold", r && r.misses > 8 ? "is-bad" : "") +
      metric("dirty upload", r ? fmt(r.uploadedMB, 2) + " MB" : "—", P.granKB + " KB regions", r && r.upload > 8 ? "is-bad" : "") +
      metric("queue depth", r ? r.queueDepth : "—", P.asyncCompute ? "overlap on" : "serial", !P.asyncCompute ? "is-warn" : "") +
      metric("audio buffer", sim.audioFill + "/32", "PCM blocks", audioState) +
      metric("presented", sim.presentedFrames, "frames this run");
    $("mc-fps").textContent = r ? Math.round(r.fps) + " fps" : "— fps";
  }

  function renderBudget() {
    var r = sim.report;
    var budget = $("mc-budget");
    var list = $("mc-budget-list");
    if (!r) {
      budget.innerHTML = "";
      list.innerHTML = "<dt>Waiting for guest entry</dt><dd>—</dd>";
      return;
    }
    var parts = [["cpu", r.cpu, "CPU, HLE, PM4"], ["upload", r.upload, "memory upload"], ["compile", r.compile, "shader + pipeline compile"], ["gpu", r.gpu, "host GPU"], ["wait", r.wait, "present wait"]];
    budget.innerHTML = "";
    list.innerHTML = "";
    parts.forEach(function (part) {
      var seg = make("span", part[0]);
      seg.style.width = (part[1] / Math.max(0.001, r.presented) * 100) + "%";
      seg.title = part[2] + ": " + fmt(part[1], 2) + " ms";
      budget.appendChild(seg);
      list.appendChild(make("dt", "", part[2]));
      list.appendChild(make("dd", "", fmt(part[1], 2) + " ms"));
    });
    $("mc-budget-label").textContent = fmt(r.work, 1) + " ms work · " + fmt(r.presented, 1) + " ms presented";
  }

  function drawChart() {
    var canvas = $("mc-chart");
    if (!canvas) return;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight || 230;
    if (!w) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var cs = getComputedStyle(document.documentElement);
    function color(name, fallback) { return cs.getPropertyValue(name).trim() || fallback; }
    var colors = {
      grid: color("--line", "#333"), text: color("--ink-3", "#888"),
      cpu: color("--guest", "#4388c7"), upload: color("--kyty", "#c28b20"),
      compile: color("--host", "#ce5e7a"), gpu: color("--accent", "#66a4dc"),
      wait: color("--ink-3", "#888")
    };
    var pad = { l: 38, r: 9, t: 12, b: 19 };
    var gh = h - pad.t - pad.b;
    var gw = w - pad.l - pad.r;
    var data = sim.history.slice(-60);
    if (sim.report && (!data.length || data[data.length - 1] !== sim.report)) data.push(sim.report);
    var max = 40;
    data.forEach(function (r) { max = Math.max(max, r.presented * 1.12); });
    [16.667, 33.333].forEach(function (ms) {
      var y = pad.t + gh - ms / max * gh;
      ctx.strokeStyle = colors.grid;
      ctx.globalAlpha = .75;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = colors.text; ctx.globalAlpha = 1; ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(Math.round(ms) + "ms", 3, y + 3);
    });
    ctx.setLineDash([]);
    if (!data.length) {
      ctx.fillStyle = colors.text; ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("frame history starts after guest entry", pad.l + 12, pad.t + gh / 2);
      return;
    }
    var bw = Math.max(2, gw / Math.max(60, data.length));
    data.forEach(function (r, i) {
      var x = pad.l + i * bw;
      var y = pad.t + gh;
      [["cpu", r.cpu], ["upload", r.upload], ["compile", r.compile], ["gpu", r.gpu], ["wait", r.wait]].forEach(function (p) {
        var ph = p[1] / max * gh;
        y -= ph;
        ctx.fillStyle = colors[p[0]];
        ctx.globalAlpha = i === data.length - 1 ? 1 : .76;
        ctx.fillRect(x, y, Math.max(1, bw - 1), Math.max(.5, ph));
      });
    });
    ctx.globalAlpha = 1;
    canvas.setAttribute("aria-label", "Recent frame times. Current frame " + fmt(sim.report ? sim.report.presented : 0, 1) + " milliseconds.");
  }

  function renderLog() {
    var host = $("mc-log");
    host.innerHTML = "";
    if (!sim.log.length) {
      var empty = make("li");
      empty.innerHTML = "<time>—</time><em>trace</em><span>Events will appear as the machine crosses boundaries.</span>";
      host.appendChild(empty);
      return;
    }
    sim.log.slice(0, 24).forEach(function (entry) {
      var li = make("li", entry.level);
      li.innerHTML = "<time>" + entry.time + "</time><em>" + entry.kind + "</em><span>" + entry.text + "</span>";
      host.appendChild(li);
    });
  }

  function renderMemory() {
    Array.prototype.forEach.call($("mc-address-space").children, function (row) {
      var visible = sim.phase === "frame" || sim.bootMax >= parseInt(row.dataset.at, 10);
      row.classList.toggle("is-hidden", !visible);
    });
    var loaderIndex = sim.phase === "frame" ? LOADER_STAGES.length - 1 : clamp(Math.floor(sim.bootMax / (BOOT.length - 1) * LOADER_STAGES.length), 0, LOADER_STAGES.length - 1);
    Array.prototype.forEach.call($("mc-loader-flow").children, function (node, i) {
      node.classList.toggle("is-past", i < loaderIndex);
      node.classList.toggle("is-active", i === loaderIndex);
      node.classList.toggle("is-error", sim.blocked && i === 4);
    });
    $("mc-loader-stats").innerHTML =
      "<dt>module</dt><dd>/app0/eboot.bin</dd>" +
      "<dt>machine</dt><dd>x86-64 · native</dd>" +
      "<dt>imports</dt><dd>" + (sim.blocked ? "1 unresolved" : sim.bootMax >= 6 ? "NIDs resolved" : "waiting") + "</dd>" +
      "<dt>entry</dt><dd>" + (sim.phase === "frame" ? "executing" : "not entered") + "</dd>";
    pageEls.forEach(function (el, i) { el.className = "mc-page " + sim.pages[i]; });
    var dirty = sim.pages.filter(function (p) { return p === "dirty"; }).length;
    var uploading = sim.pages.filter(function (p) { return p === "uploading"; }).length;
    $("mc-page-status").textContent = uploading ? uploading + " regions are crossing to host GPU memory" : dirty ? dirty + " CPU-dirty regions await the upload phase" : "GPU copies current; watched regions are protected so the next native CPU write is observable";
  }

  function renderGraphics() {
    var frameStep = sim.phase === "frame" ? sim.step : -1;
    ringEls.forEach(function (el, i) {
      var kind = ["state", "state", "draw", "state", "dispatch", "sync"][i % 6];
      el.className = "mc-ring-cell";
      if (i < sim.ringWrite) el.classList.add(kind);
      if (i < sim.ringRead) el.classList.add("is-read");
      if ((i === sim.ringWrite - 1 || i === sim.ringRead) && sim.ringWrite) el.classList.add("is-head");
    });
    $("mc-ring-status").textContent = sim.ringWrite ? sim.ringWrite + " written · " + sim.ringRead + " consumed · " + Math.max(0, sim.ringWrite - sim.ringRead) + " pending" : "Guest write head → Kyty read head";

    var setRegs = frameStep < 6 ? 0 : frameStep === 6 ? 42 : 74;
    registerEls.forEach(function (el, i) {
      el.className = "mc-register";
      if (i < setRegs) el.classList.add("is-set");
      if (i < setRegs && (i + sim.frame) % 17 === 0) el.classList.add("is-hot");
    });
    $("mc-register-status").textContent = setRegs ? setRegs + " shown registers hold current graphics state" : "State accumulates until a draw";

    Array.prototype.forEach.call($("mc-shader-flow").children, function (node, i) {
      node.classList.toggle("is-active", frameStep === 8 && i === sim.frame % SHADER_STAGES.length && sim.report && sim.report.misses > 0);
      node.classList.toggle("is-done", frameStep > 8 || (frameStep === 8 && (!sim.report || sim.report.misses === 0 || i < sim.frame % SHADER_STAGES.length)));
    });

    cacheEls.forEach(function (el, i) {
      var key = sim.cache[i];
      el.className = "mc-cache-cell";
      el.textContent = key || "—";
      if (i >= P.cacheSize) el.classList.add("is-disabled");
      else if (key) el.classList.add("is-used");
      if (key && sim.newPipelines.indexOf(key) >= 0 && frameStep === 8) el.classList.add("is-new");
    });
    $("mc-cache-status").textContent = sim.report ? sim.report.hits + " hits · " + sim.report.misses + " misses · " + P.cacheSize + " slots" : "Compile only on a miss";

    Array.prototype.forEach.call($("mc-queues").children, function (row, q) {
      var waiting = q > 0 && !P.asyncCompute;
      row.classList.toggle("is-waiting", waiting);
      var fill = sim.report && frameStep >= 10 ? clamp(sim.report.queueDepth - q * 2, 0, 18) : 0;
      Array.prototype.forEach.call(row.querySelectorAll("i"), function (cell, i) { cell.classList.toggle("is-full", i < fill); });
    });
    $("mc-queue-status").textContent = P.asyncCompute ? "Graphics + compute may overlap" : "Compute waits behind the graphics queue";

    var screen = $("mc-screen");
    var hasFrame = sim.presentedFrames > 0 || (sim.phase === "frame" && sim.step >= 11);
    screen.classList.toggle("has-frame", hasFrame);
    screen.classList.toggle("is-tearing", hasFrame && !P.vsync);
    $("mc-screen-status").textContent = hasFrame && sim.report ? "frame " + sim.frame + " · " + fmt(sim.report.presented, 1) + " ms · " + Math.round(sim.report.fps) + " fps" : "Waiting for the first flip";
  }

  function renderServices() {
    var step = currentStep();
    var threadLoads = [
      sim.phase === "frame" ? clamp(28 + P.hleCalls + P.draws / 3, 12, 96) : 3,
      sim.phase === "frame" ? clamp(18 + P.draws / 4, 8, 82) : 0,
      currentStep().active.indexOf("window") >= 0 || currentStep().active.indexOf("hostos") >= 0 ? 58 : 12,
      clamp(18 + (32 - sim.audioFill) * 2, 10, 90)
    ];
    Array.prototype.forEach.call($("mc-threads").children, function (row, i) {
      row.style.setProperty("--load", threadLoads[i] + "%");
      var active = (i < 2 && step.active.indexOf("cpu") >= 0) || (i === 2 && (step.active.indexOf("window") >= 0 || step.active.indexOf("hostos") >= 0)) || (i === 3 && step.active.indexOf("audio") >= 0);
      row.classList.toggle("is-active", active);
    });

    var hle = $("mc-hle-list");
    hle.innerHTML = "";
    var calls = sim.hleRecent.length ? sim.hleRecent : HLE_CALLS.slice(0, 5).map(function (name) { return { name: name, frame: "—" }; });
    calls.slice(0, 7).forEach(function (call, i) {
      var row = make("div", "mc-hle-call" + (i === 0 && step.active.indexOf("hle") >= 0 ? " is-live" : ""));
      row.innerHTML = "<code>" + call.name + "</code><span>frame " + call.frame + "</span>";
      hle.appendChild(row);
    });

    $("mc-controller").classList.toggle("is-input", sim.phase === "frame" && sim.step === 0 && sim.inputTick % 3 === 0);
    $("mc-input-status").textContent = sim.phase === "frame" ? "sample " + sim.inputTick + " · host event state copied into guest pad data" : "controller lifecycle initialised before guest entry";

    audioEls.forEach(function (el, i) {
      el.className = "mc-audio-block";
      if (i < sim.audioFill) el.classList.add("is-full");
      if (i === Math.max(0, sim.audioFill - 1) && step.active.indexOf("audio") >= 0) el.classList.add("is-playing");
      if (sim.audioFill < 6 && i >= sim.audioFill && i < 6) el.classList.add("is-starved");
    });
    $("mc-audio-status").textContent = sim.audioFill < 6 ? "Underrun risk · frame stalls consumed the buffer" : sim.audioFill + " of 32 PCM blocks buffered";

    Array.prototype.forEach.call($("mc-kernel-objects").children, function (obj, i) {
      obj.classList.toggle("is-active", step.active.indexOf("kernel") >= 0 && i === sim.frame % 5);
    });
  }

  function renderAll() {
    renderStatus();
    renderSequence();
    renderMapState();
    renderNow();
    renderInspector();
    renderPresetState();
    renderMetrics();
    renderBudget();
    renderLog();
    renderMemory();
    renderGraphics();
    renderServices();
    drawChart();
  }

  /* ---------- interaction ---------- */

  $("mc-play").addEventListener("click", function () {
    if (sim.blocked) {
      P.missingNid = false;
      sim.blocked = false;
      sim.running = true;
      sim.preset = "custom";
      addLog("linker", "teaching stub installed; relocation now has a callable target", "warn");
    } else {
      sim.running = !sim.running;
    }
    renderAll();
  });
  $("mc-step").addEventListener("click", function () {
    sim.running = false;
    if (sim.blocked) {
      P.missingNid = false;
      sim.blocked = false;
      addLog("linker", "teaching stub installed; stepping resumes", "warn");
    }
    advance();
    sim.running = false;
    renderAll();
  });
  $("mc-reboot").addEventListener("click", reboot);
  $("mc-frame").addEventListener("click", jumpToFrame);
  $("mc-speed").addEventListener("change", function () { sim.speed = parseFloat(this.value) || 1; });
  $("mc-reset-tuning").addEventListener("click", function () { applyPreset("balanced"); });
  $("mc-clear-log").addEventListener("click", function () { sim.log = []; renderLog(); });

  Array.prototype.forEach.call($("mc-filter").querySelectorAll("button"), function (button) {
    button.addEventListener("click", function () {
      sim.filter = button.dataset.filter;
      Array.prototype.forEach.call($("mc-filter").querySelectorAll("button"), function (b) { b.classList.toggle("is-active", b === button); });
      renderMapState();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (button) {
    button.addEventListener("click", function () {
      var tab = button.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.setAttribute("aria-selected", b === button ? "true" : "false"); });
      ["overview", "memory", "graphics", "services"].forEach(function (name) { $("mc-panel-" + name).hidden = name !== tab; });
      setTimeout(function () { drawChart(); }, 0);
    });
  });

  function stepDuration() {
    if (sim.phase === "boot") return 1450;
    var key = currentStep().key;
    var extra = 0;
    if (sim.report) {
      if (key === "compile") extra = sim.report.compile * 28;
      else if (key === "upload") extra = sim.report.upload * 24;
      else if (key === "submit" && !P.asyncCompute) extra = P.draws * 7;
      else if (key === "present") extra = sim.report.wait * 18;
    }
    return clamp(660 + extra, 520, 2500);
  }

  var lastTime = 0;
  function tick(time) {
    if (!lastTime) lastTime = time;
    var dt = Math.min(100, time - lastTime);
    lastTime = time;
    if (sim.running && !sim.blocked) {
      sim.elapsed += dt * sim.speed;
      if (sim.elapsed >= stepDuration()) advance();
    }
    window.requestAnimationFrame(tick);
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawEdges(); drawChart(); }, 80);
  });
  new MutationObserver(function () { drawEdges(); drawChart(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- start ---------- */

  buildMap();
  buildPresets();
  buildControls();
  buildStaticPanels();
  addLog("boot", "host process entered Emulator::Run");
  renderAll();
  setTimeout(drawEdges, 0);
  window.requestAnimationFrame(tick);

  window.SYSTEM_EXPLORER = {
    parameters: P,
    simulation: sim,
    applyPreset: applyPreset,
    reboot: reboot,
    jumpToFrame: jumpToFrame,
    step: advance
  };
})();
