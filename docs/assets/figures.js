/* ============================================================
   figures.js — interactive figures that ship inside ported book
   chapters (the ABI table, the PM4 header decoder, the V#/T#/S#
   sharp decoder, the memory map, tabs and steppers).

   Lifted from the original book's inline script. The book-only
   parts (table of contents, scrollspy, glossary filter) are
   deliberately left behind. Every widget no-ops when its markup
   is absent, so this is safe to load on every page.
   ============================================================ */
(function(){
"use strict";
var $=function(s){return document.querySelector(s)};
var $$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
/* ---------------- generic tabs ---------------- */
$$("[data-tabs]").forEach(function(w){
  w.addEventListener("click",function(e){
    var b=e.target.closest("button[data-pane]"); if(!b) return;
    Array.prototype.forEach.call(w.querySelectorAll("button[data-pane]"),function(x){
      var on=x===b; x.setAttribute("aria-selected",on?"true":"false");
      var p=document.getElementById(x.dataset.pane); if(p) p.hidden=!on;
    });
  });
});

/* ---------------- generic stepper ---------------- */
function stepper(o){
  var host=document.getElementById(o.tabsId), panel=document.getElementById(o.panelId);
  if(!host||!panel) return;
  var cur=0;
  o.items.forEach(function(it,i){
    var b=document.createElement("button");
    b.type="button"; b.setAttribute("role","tab");
    b.setAttribute("aria-selected",i===0?"true":"false");
    b.innerHTML=o.btn(it,i);
    b.addEventListener("click",function(){show(i)});
    host.appendChild(b);
  });
  function show(i){
    cur=(i+o.items.length)%o.items.length;
    Array.prototype.forEach.call(host.querySelectorAll("button"),function(b,n){
      b.setAttribute("aria-selected",n===cur?"true":"false");
    });
    panel.innerHTML=o.pane(o.items[cur],cur);
    var c=o.countId&&document.getElementById(o.countId);
    if(c) c.textContent=(cur+1)+" / "+o.items.length;
  }
  var p=o.prevId&&document.getElementById(o.prevId); if(p) p.addEventListener("click",function(){show(cur-1)});
  var n=o.nextId&&document.getElementById(o.nextId); if(n) n.addEventListener("click",function(){show(cur+1)});
  host.addEventListener("keydown",function(e){
    if(e.key==="ArrowRight"){show(cur+1);host.querySelectorAll("button")[cur].focus()}
    if(e.key==="ArrowLeft"){show(cur-1);host.querySelectorAll("button")[cur].focus()}
  });
  show(0);
}
window.__stepper=stepper;

/* ---------------- ABI widget ---------------- */
var SYSV=["rdi","rsi","rdx","rcx","r8","r9"];
var MSX =["rcx","rdx","r8","r9"];
var abiIn=$("#abi-count");
function abiRender(){
  if(!abiIn) return;
  var n=Math.max(0,Math.min(8,parseInt(abiIn.value,10)||0));
  function col(regs,shadow){
    var h="";
    for(var i=0;i<n;i++){
      if(i<regs.length) h+='<div class="abi-row"><span class="r">'+regs[i]+'</span><span class="a">arg '+(i+1)+'</span></div>';
      else h+='<div class="abi-row stack"><span class="r">stack</span><span class="a">arg '+(i+1)+' at [rsp+'+((i-regs.length)*8+(shadow?32:0)+8)+']</span></div>';
    }
    if(shadow) h+='<div class="abi-row stack"><span class="r">shadow</span><span class="a">32 bytes reserved by the caller, always</span></div>';
    if(n===0) h+='<div class="abi-row"><span class="a">no arguments</span></div>';
    return h;
  }
  var a=$("#abi-sysv"), b=$("#abi-ms");
  if(a) a.innerHTML=col(SYSV,false);
  if(b) b.innerHTML=col(MSX,true);
}
if(abiIn){abiIn.addEventListener("input",abiRender);abiRender();}

/* ---------------- PM4 decoder ---------------- */
var OPS={0x10:"IT_NOP",0x11:"IT_SET_BASE",0x12:"IT_CLEAR_STATE",0x13:"IT_INDEX_BUFFER_SIZE",
0x15:"IT_DISPATCH_DIRECT",0x16:"IT_DISPATCH_INDIRECT",0x20:"IT_SET_PREDICATION",0x22:"IT_COND_EXEC",
0x24:"IT_DRAW_INDIRECT",0x25:"IT_DRAW_INDEX_INDIRECT",0x26:"IT_INDEX_BASE",0x27:"IT_DRAW_INDEX_2",
0x28:"IT_CONTEXT_CONTROL",0x2A:"IT_INDEX_TYPE",0x2C:"IT_DRAW_INDIRECT_MULTI",0x2D:"IT_DRAW_INDEX_AUTO",
0x2F:"IT_NUM_INSTANCES",0x33:"IT_INDIRECT_BUFFER_CNST",0x35:"IT_DRAW_INDEX_OFFSET_2",0x37:"IT_WRITE_DATA",
0x38:"IT_DRAW_INDEX_INDIRECT_MULTI",0x39:"IT_MEM_SEMAPHORE",0x3A:"IT_DISPATCH_DRAW_PREAMBLE",
0x3F:"IT_INDIRECT_BUFFER",0x40:"IT_COPY_DATA",0x41:"IT_CP_DMA",0x42:"IT_PFP_SYNC_ME",0x43:"IT_SURFACE_SYNC",
0x46:"IT_EVENT_WRITE",0x47:"IT_EVENT_WRITE_EOP",0x48:"IT_EVENT_WRITE_EOS",0x49:"IT_RELEASE_MEM",
0x50:"IT_DMA_DATA",0x58:"IT_ACQUIRE_MEM",0x59:"IT_REWIND",0x63:"IT_SET_SH_REG_INDIRECT",
0x64:"IT_SET_UCONFIG_REG_INDIRECT",0x68:"IT_SET_CONFIG_REG",0x69:"IT_SET_CONTEXT_REG",0x76:"IT_SET_SH_REG",
0x78:"IT_SET_QUEUE_REG",0x79:"IT_SET_UCONFIG_REG",0x7A:"IT_SET_UCONFIG_REG_INDEX",0x81:"IT_WRITE_CONST_RAM",
0x83:"IT_DUMP_CONST_RAM",0x84:"IT_INCREMENT_CE_COUNTER",0x85:"IT_INCREMENT_DE_COUNTER",
0x86:"IT_WAIT_ON_CE_COUNTER",0x88:"IT_WAIT_ON_DE_COUNTER_DIFF",0x8D:"IT_DISPATCH_DRAW",
0x8E:"IT_GET_LOD_STATS",0x9F:"IT_SET_CONTEXT_REG_INDIRECT"};
var RREG={0x00:"R_ZERO",0x05:"R_DRAW_RESET",0x06:"R_WAIT_FLIP_DONE",0x09:"R_DISPATCH_RESET",
0x0A:"R_WAIT_MEM_32",0x0B:"R_PUSH_MARKER",0x0C:"R_POP_MARKER",0x14:"R_ACQUIRE_MEM",0x15:"R_WRITE_DATA",
0x16:"R_WAIT_MEM_64",0x17:"R_FLIP",0x18:"R_RELEASE_MEM",0x19:"R_DMA_DATA"};
var pin=$("#pm4in");
if(pin){
  [["draw auto","0xC0012D00"],["draw indexed","0xC0032700"],["set context reg","0xC0016900"],
   ["set SH reg","0xC0027600"],["release mem","0xC0044900"],["flip","0xC000105C"],
   ["dispatch","0xC0031500"],["dump const RAM","0xC0038300"]].forEach(function(p){
    var b=document.createElement("button"); b.type="button"; b.textContent=p[0];
    b.addEventListener("click",function(){pin.value=p[1];pm4()});
    $("#pm4presets").appendChild(b);
  });
  pin.addEventListener("input",pm4);
  pm4();
}
function hx(v,w){var s=(v>>>0).toString(16).toUpperCase();while(s.length<w)s="0"+s;return "0x"+s}
function pm4(){
  var raw=pin.value.trim().replace(/^0[xX]/,"").replace(/[^0-9a-fA-F]/g,"");
  var v=raw.length?parseInt(raw,16)>>>0:0;
  var type=v>>>30, count=(v>>>16)&0x3fff, op=(v>>>8)&0xff, r=(v>>>2)&0x3f;
  var bits=$("#pm4bits"); bits.innerHTML="";
  for(var i=31;i>=0;i--){
    var d=document.createElement("div"), c="bit";
    if(i>=30)c+=" f0"; else if(i>=16)c+=" f1"; else if(i>=8)c+=" f2"; else if(i>=2)c+=" f3";
    d.className=c; d.textContent=(v>>>i)&1; bits.appendChild(d);
  }
  var rows=[
    ["31:30 type","TYPE"+type+(type===3?"":"  ← Kyty only handles type 3")],
    ["29:16 count",count+"  → "+(count+1)+" body dword"+(count===0?"":"s")],
    ["15:8 opcode",hx(op,2)+"  "+(OPS[op]||"&lt;unknown&gt;")],
    ["7:2 selector",hx(r,2)+(op===0x10?"  "+(RREG[r]||"&lt;unknown&gt;"):"  (only meaningful for IT_NOP)")],
    ["1 engine",(v&2)===0?"GX (graphics)":"CX (constant)"],
    ["packet size",(count+2)+" dwords = "+((count+2)*4)+" bytes"]
  ];
  $("#pm4out").innerHTML=rows.map(function(k){return '<div><div class="k">'+k[0]+'</div><div class="v">'+k[1]+"</div></div>"}).join("");
}

/* ---------------- sharp (V#/T#/S#) decoder ---------------- */
var IMGTYPE={8:"1D",9:"2D",10:"3D",11:"Cube",12:"1D array",13:"2D array",14:"2D MSAA",15:"2D MSAA array"};
var TILEMODE={0:"linear",1:"standard 256B",5:"standard 4KB",9:"standard 64KB",17:"PRT 64KB",24:"depth",27:"render target"};
var DSEL={0:"0",1:"1",4:"R",5:"G",6:"B",7:"A"};
var FILTER={0:"point",1:"bilinear",2:"aniso point",3:"aniso linear"};
var CLAMP={0:"wrap",1:"mirror",2:"clamp last texel",3:"mirror once last",4:"clamp half border",5:"mirror once half",6:"clamp border",7:"mirror once border"};
var sharpKind="V";
function sharpFields(){return sharpKind==="T"?8:4}
function sharpRead(){
  var out=[];
  for(var i=0;i<8;i++){
    var el=document.getElementById("sh"+i);
    if(!el) {out.push(0);continue;}
    var raw=el.value.trim().replace(/^0[xX]/,"").replace(/[^0-9a-fA-F]/g,"");
    out.push(raw.length?parseInt(raw,16)>>>0:0);
  }
  return out;
}
function sharpRender(){
  var wrap=$("#sharpwrap"); if(!wrap) return;
  var n=sharpFields();
  for(var i=0;i<8;i++){
    var el=document.getElementById("shbox"+i);
    if(el) el.style.display = i<n ? "" : "none";
  }
  var f=sharpRead(), rows=[];
  var lo=f[0], hi=f[1];
  if(sharpKind==="V"){
    var base=(hi&0xffff)*4294967296+lo;
    rows=[["base address (48-bit)","0x"+base.toString(16).toUpperCase()],
      ["stride",((hi>>>16)&0x3fff)+" bytes"],
      ["swizzle enabled",((hi>>>31)&1)?"yes":"no"],
      ["num records",(f[2]>>>0)+""],
      ["dst_sel XYZW",[0,3,6,9].map(function(s){return DSEL[(f[3]>>>s)&7]||"?"}).join(" ")],
      ["data format",((f[3]>>>12)&0x7f)+"  (BufferFormat enum)"],
      ["index stride",((f[3]>>>21)&3)+""],
      ["add tid",((f[3]>>>23)&1)?"yes":"no"],
      ["out-of-bounds mode",((f[3]>>>28)&3)+""],
      ["type",((f[3]>>>30)&3)+"  (1=buffer, 2=sampler, 3=unused)"]];
  } else if(sharpKind==="T"){
    var b40=((hi&0xff)*4294967296+lo)*256;
    rows=[["base address (40-bit &lt;&lt; 8)","0x"+b40.toString(16).toUpperCase()],
      ["min lod",((hi>>>8)&0xfff)+""],
      ["format",((hi>>>20)&0x1ff)+"  (BufferFormat enum)"],
      ["width",((((hi>>>30)&3)|(((f[2]>>>0)&0xfff)<<2))+1)+" texels"],
      ["height",(((f[2]>>>14)&0x3fff)+1)+" texels"],
      ["dst_sel XYZW",[0,3,6,9].map(function(s){return DSEL[(f[3]>>>s)&7]||"?"}).join(" ")],
      ["base level",((f[3]>>>12)&0xf)+""],
      ["last level",((f[3]>>>16)&0xf)+""],
      ["tile mode",((f[3]>>>20)&0x1f)+"  "+(TILEMODE[(f[3]>>>20)&0x1f]||"?")],
      ["image type",((f[3]>>>28)&0xf)+"  "+(IMGTYPE[(f[3]>>>28)&0xf]||"?")],
      ["depth",(((f[4]>>>0)&0x1fff)+1)+""],
      ["base array slice",((f[4]>>>16)&0x1fff)+""],
      ["max mip",((f[5]>>>4)&0xf)+""],
      ["metadata addr","0x"+((((f[6]>>>24)&0xff)+f[7]*256)>>>0).toString(16).toUpperCase()+"  (DCC/HTile)"]];
  } else {
    rows=[["clamp X",((f[0]>>>0)&7)+"  "+(CLAMP[(f[0]>>>0)&7]||"?")],
      ["clamp Y",((f[0]>>>3)&7)+"  "+(CLAMP[(f[0]>>>3)&7]||"?")],
      ["clamp Z",((f[0]>>>6)&7)+"  "+(CLAMP[(f[0]>>>6)&7]||"?")],
      ["max aniso ratio",((f[0]>>>9)&7)+"  (0=1x, 1=2x, 2=4x, 3=8x, 4=16x)"],
      ["depth compare func",((f[0]>>>12)&7)+""],
      ["force unorm coords",((f[0]>>>15)&1)?"yes":"no"],
      ["filter mode",((f[0]>>>29)&3)+""],
      ["min lod",((f[1]>>>0)&0xfff)+"  (4.8 fixed point)"],
      ["max lod",((f[1]>>>12)&0xfff)+"  (4.8 fixed point)"],
      ["lod bias",((f[2]>>>0)&0x3fff)+""],
      ["XY mag filter",((f[2]>>>20)&3)+"  "+(FILTER[(f[2]>>>20)&3]||"?")],
      ["XY min filter",((f[2]>>>22)&3)+"  "+(FILTER[(f[2]>>>22)&3]||"?")],
      ["mip filter",((f[2]>>>26)&3)+"  (0=none, 1=point, 2=linear)"],
      ["border color ptr",((f[3]>>>0)&0xfff)+""]];
  }
  $("#sharpout").innerHTML=rows.map(function(k){return '<div><div class="k">'+k[0]+'</div><div class="v">'+k[1]+"</div></div>"}).join("");
}
if($("#sharpwrap")){
  $$("#sharpkind button").forEach(function(b){
    b.addEventListener("click",function(){
      sharpKind=b.dataset.kind;
      $$("#sharpkind button").forEach(function(x){x.setAttribute("aria-selected",x===b?"true":"false")});
      var pre=b.dataset.preset.split(",");
      for(var i=0;i<8;i++){var el=document.getElementById("sh"+i); if(el) el.value=pre[i]||"0x00000000";}
      sharpRender();
    });
  });
  for(var si=0;si<8;si++){
    var e=document.getElementById("sh"+si);
    if(e) e.addEventListener("input",sharpRender);
  }
  sharpRender();
}

/* ---------------- memory map ---------------- */
var BANDS=[
 {c:"h",a:"0x0000040000 – 0x07FFFFBFFF",n:"System managed",sz:"~32 GB",
  d:"<p>Left entirely to the host operating system. The emulator's own image, the C++ runtime, Qt, SDL, the Vulkan loader and the graphics driver live here. Guest allocations never enter this band.</p><p>On Windows this is enforced by passing an explicit <code>LowestStartingAddress</code> / <code>HighestEndingAddress</code> pair to <code>VirtualAlloc2</code>, so the allocator physically cannot return an address outside the band it was asked for.</p>",
  s:"src/common/platform/sysWindowsVirtual.cpp:102"},
 {c:"k",a:"0x07FFFFC000 – 0x0FFFFFFFFF",n:"System reserved",sz:"~32 GB",
  d:"<p>Reserved by Kyty for structures the guest can see. Two things live here:</p><ul><li><strong>Loaded modules.</strong> The first lands at <code>0x900000000</code> — the band base <code>0x800000000</code> plus a <code>0x100000000</code> code offset — and each subsequent module is placed <code>0x10000000</code> (256 MB) further on.</li><li><strong>Custom PLT tables</strong>, the generated trampolines for guest imports.</li></ul><p>Because every module lands in a known, contiguous band, the crash handler can walk a guest stack by simply testing whether each return address falls inside it.</p>",
  s:"src/loader/runtimeLinker.cpp:337"},
 {c:"g",a:"0x1000000000 – 0xFBFFFFFFFF",n:"User area",sz:"~1 TB",
  d:"<p>Every guest allocation: direct memory mappings, flexible memory, memory pools, thread stacks, GPU-visible buffers. Kyty keeps its own free list and page-attribute tables across this range, because it has to answer <code>sceKernelVirtualQuery</code> with per-range protection, memory type, flags — and the <em>name</em> the game assigned to the range.</p><p>Page granularity here is the guest's 16 KB, not the host's 4 KB. One guest page covers four host pages, so every protection change applies in groups of four. This matters enormously in the memory tracker.</p>",
  s:"src/kernel/memoryAddressSpace.inc:9"},
 {c:"h",a:"0xFC00000000 and above",n:"Host high memory",sz:"—",
  d:"<p>Outside the guest's world entirely. The emulator binary is deliberately linked high — <code>--image-base=0x100000000000</code> on Linux, <code>-image_base 0x700000000000</code> on macOS — so its own code sits far above anything the guest can allocate.</p><p>This matters more than it sounds. It guarantees that a guest pointer and a host pointer can never be confused by value alone, which turns a whole class of bug into something you can spot by looking at a hex dump.</p>",
  s:"CMakeLists.txt:126"}
];
var bh=$("#bands"), bd=$("#band-detail");
if(bh){
  BANDS.forEach(function(b,i){
    var el=document.createElement("button");
    el.type="button"; el.className="band "+b.c; el.setAttribute("role","tab");
    el.innerHTML='<span class="addr">'+b.a+'</span><span class="ttl">'+b.n+'</span><span class="sz">'+b.sz+'</span>';
    el.addEventListener("click",function(){showBand(i)});
    bh.appendChild(el);
  });
  showBand(2);
}
function showBand(i){
  Array.prototype.forEach.call(bh.children,function(c,n){c.setAttribute("aria-selected",n===i?"true":"false")});
  var b=BANDS[i];
  bd.innerHTML='<h5 style="margin-top:0;text-transform:none;letter-spacing:-.01em;font-size:15px;color:var(--ink)">'+b.n+"</h5>"+b.d+'<div class="srcs" style="margin-bottom:0"><span class="src">'+b.s+"</span></div>";
}


})();



/* ------------------------------------------------------------
   Shader-pipeline stepper data, from the book's second inline
   script. The boot-sequence stepper is omitted - that chapter
   is not part of the course.
   ------------------------------------------------------------ */
(function(){
"use strict";
var stepper = window.__stepper;
if (!stepper) return;
/* ---------------- shader pipeline ---------------- */
var PIPE=[
 {t:"Decode", h:"DecodeProgram — RDNA 2 words → typed instructions",
  b:"<p>Walk the code blob and decode each instruction family, recording opcode, operands, literal constants, modifier bits, raw words and program counter.</p><p>The rest of the compiler sees typed instructions rather than packed machine words.</p>",
  w:"Everything downstream works on a typed instruction list rather than raw bits. This is also where an unrecognised instruction produces a clean, locatable error instead of silent nonsense.",
  s:"…/frontend/decode/ShaderDecoder.cpp"},
 {t:"Build CFG", h:"BuildGraph — blocks, dominators, loops",
  b:"<p>Split the instruction list at branch targets and branch instructions, wire up predecessors and successors, then compute dominators, post-dominators, back edges, natural loops and strongly connected components.</p><p>Branch conditions are typed to hardware registers — <code>SccZero</code>, <code>VccNonZero</code>, <code>ExecZero</code> — because a GPU branch tests a condition register, not an arbitrary value.</p>",
  w:"Reducibility is decided here. A strongly connected component with more than one entry point is irreducible, and the structured path is abandoned before it is even attempted.",
  s:"…/frontend/cfg/ShaderCFG.cpp"},
 {t:"Structurize", h:"Structurize — find merge and continue blocks",
  b:"<p>SPIR-V requires every conditional branch to declare a merge block and every loop to declare both a merge and a continue target. This pass computes them, using nearest-common-post-dominator for selections and loop-exit analysis for loops.</p><p>On failure the graph reverts to its unstructured form, is flagged <code>unsupported</code> with a <code>FailureKind</code>, and dispatcher-based emission is used instead.</p>",
  w:"This is where GPU control flow — which is mask manipulation, not structure — becomes something a structured IR can express. It is the most failure-prone stage in the compiler, so failure is a documented fallback rather than an error.",
  s:"…/frontend/cfg/ShaderCFG.cpp"},
 {t:"Translate", h:"TranslateProgram — decoded ops → typed value IR",
  b:"<p>Create the IR program and translate opcodes through explicit category dispatchers for scalar, vector, memory, LDS and export instructions.</p><p>The current compiler has one typed IR; the older second IR was removed.</p>",
  w:"Separating decode from translation makes instruction encodings and semantic lowering independently testable and keeps opcode work local to a category file.",
  s:"…/frontend/translate/Translate.cpp"},
 {t:"SSA + simplify", h:"RewriteToSsa, propagate, remove identities, eliminate dead code",
  b:"<p>Convert register-like values and control-flow joins to SSA, fold constants, resolve identities and discard dead instructions.</p><p>The pass sequence makes value dependencies explicit for resource analysis and emission.</p>",
  w:"The old separate scalar-provenance representation is gone; current SRT analysis follows values in this typed IR directly.",
  s:"…/ir/passes/SsaRewrite.cpp"},
 {t:"SRT plan", h:"BuildSrtPlan — a recipe for reading descriptor tables",
  b:"<p>Walk the typed value graph, collect reachable shader-resource-table reads and turn them into a plan. Constant offsets are assigned flattened slots; genuinely dynamic reads stay explicit.</p>",
  w:"Separating the plan from its execution is what lets one compiled shader be reused across draws that bind completely different resources.",
  s:"…/ir/passes/SrtWalker.cpp"},
 {t:"Track resources", h:"TrackResources — classify every descriptor use",
  b:"<p>Classify buffers, images, samplers and sampled pairs, including read/write/atomic behavior, dimensions, formats, aliases and descriptor sources.</p>",
  w:"This produces the list the Vulkan descriptor set layout is generated from. Wrong classification means either a pipeline that fails validation or, worse, one that silently reads the wrong memory.",
  s:"…/ir/passes/ResourceTracking.cpp"},
 {t:"Materialize", h:"MaterializeResources + SpecializeResources",
  b:"<p>Use a supplied resource snapshot or run the plan against current user data and guest memory, then specialise the IR using the concrete descriptors.</p>",
  w:"Specialisation is why <code>ShaderId</code> includes resource information: two draws with differently-shaped resources need different SPIR-V, so they must not collide in the pipeline cache.",
  s:"…/ir/passes/ResourceMaterialization.cpp"},
 {t:"Layout", h:"CollectShaderInfo + AllocateBindings",
  b:"<p>Gather stage-specific inputs and outputs, allocate resource and support bindings, and compute push-constant placement.</p>",
  w:"The renderer needs exactly this layout when it writes descriptor sets at draw time, so the allocation is stored alongside the SPIR-V rather than recomputed.",
  s:"…/ir/passes/BindingLayout.cpp"},
 {t:"Requirements", h:"AnalyzeProgramRequirements",
  b:"<p>Record every subgroup, derivative, image, LDS, scratch and pixel-mask feature the final module needs before emission begins.</p>",
  w:"Capability selection is explicit and auditable, and the emitter can reject an unsupported combination before building a partial module.",
  s:"…/backend/spirv/spirvEmitterAnalysis.cpp"},
 {t:"Emit SPIR-V", h:"Spirv::EmitProgram",
  b:"<p>The backend — about 360 KB across 15 files — declares capabilities, types, interfaces and descriptors, then lowers typed IR into SPIR-V flow, ALU, memory and image instructions.</p>",
  w:"SPIR-V is stricter than machine code in every respect — types declared, control flow structured, capabilities requested. This stage is where all that bookkeeping happens.",
  s:"…/backend/spirv/SpirvEmitter.cpp"}
];

stepper({
  tabsId:"pipe", panelId:"pipe-panel", items:PIPE,
  btn:function(it,i){ return '<span class="i">'+String(i+1).padStart(2,"0")+'</span><span class="t">'+it.t+"</span>"; },
  pane:function(it){
    return "<div><h5>"+it.h+"</h5>"+it.b+
      '<div class="why"><strong>Why:</strong> '+it.w+"</div>"+
      '<div class="srcs" style="margin-bottom:0"><span class="src">'+it.s+"</span></div></div>";
  }
});
})();

