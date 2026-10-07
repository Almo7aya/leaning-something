/* Executable teaching model. Native source connections are references, not an emulation claim. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./artifact-parsers.js') : root.KYTY_ARTIFACTS);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KYTY_OBSERVATORY = api;
})(typeof window === 'object' ? window : globalThis, function (A) {
  'use strict';
  const VERSION = 1;
  const WIDTH = 128, HEIGHT = 80;
  const ADDR = {text:0x10000, data:0x12000, vertices:0x13000, ring:0x14000, got:0x15000, tls:0x16000};
  const OP = {MOVF:1, STORE:2, SYS:3, BUILD:4, WAIT:5, YIELD:6};
  const IMPORTS = ['ReadPad', 'SubmitFrame', 'AudioOut', 'Flip', 'SaveCheckpoint'];
  const SOURCES = {
    loader:{label:'Loader & imports',lesson:'t-trace-boot.html',path:'src/loader/runtimeLinker.cpp',symbol:'RuntimeLinker::LoadProgram / RelocateAll'},
    cpu:{label:'Guest execution',lesson:'t-no-cpu-emulator.html',path:'src/loader/runtimeLinker.cpp',symbol:'RuntimeLinker::Execute'},
    memory:{label:'Memory & visibility',lesson:'t-coherency.html',path:'src/graphics/host_gpu/renderer/cache/bufferCache.cpp',symbol:'BufferCache::ObtainBuffer'},
    hle:{label:'Service boundary',lesson:'t-hle.html',path:'src/libs/libAgcDriver.cpp',symbol:'AgcDriverSubmitCommandBuffer'},
    packets:{label:'Command processor',lesson:'t-pm4.html',path:'src/graphics/guest_gpu/pm4.h',symbol:'KYTY_PM4 / IT_DRAW_INDEX_AUTO'},
    shader:{label:'Shader translation',lesson:'t-shaders.html',path:'src/graphics/shader/recompiler/ShaderRecompiler.cpp',symbol:'TranslateProgram / CompileProgram'},
    cache:{label:'Program & pipeline reuse',lesson:'t-program-cache.html',path:'src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp',symbol:'ProgramKey / CompilePermutation'},
    gpu:{label:'Submission & lifetime',lesson:'t-trace-draw.html',path:'src/graphics/host_gpu/renderer/commandScheduler.cpp',symbol:'CommandScheduler::Submit / Wait'},
    present:{label:'Presentation',lesson:'t-vulkan.html',path:'src/graphics/presentation/videoOut.cpp',symbol:'VideoOutSubmitFlip'},
    services:{label:'Input, audio & files',lesson:'t-cpp-system.html',path:'src/kernel/fileSystem.cpp',symbol:'Virtual filesystem services'}
  };
  const CASES = {
    healthy:{title:'Healthy run',tag:'START HERE',description:'A cold first frame, warm reuse, synchronized uploads and safe retirement.',question:'Will the second frame translate the shader again just because its position changes?',answer:'No. Uniform bytes change, so the GPU mirror must be refreshed. The shader code and compatible pipeline remain reusable.'},
    'missing-import':{title:'Missing import',tag:'LOADER',description:'One required service has no callable target.',question:'Can entry execute before the required SubmitFrame import has been resolved?',answer:'This model stops at relocation. Inspect the import and export key before adding an implementation; a real lookup can fail for version, module or library reasons.'},
    'write-rx':{title:'Write to executable memory',tag:'MEMORY',description:'The guest store targets protected code instead of its uniform buffer.',question:'Which instruction writes, and which memory permission rejects it?',answer:'STORE attempts to modify the RX text region. The memory boundary rejects the write before any command submission. Inspect its decoded target and the fault address.'},
    'bad-packet':{title:'Broken command header',tag:'PACKETS',description:'A corrupted header reaches the command processor.',question:'Does a submitted buffer prove its packet stream is valid?',answer:'No. The parser stops at an unsupported packet type. Follow the ring bytes back to the guest write that produced them.'},
    'unsupported-shader':{title:'Unsupported shader encoding',tag:'SHADER',description:'An instruction outside the executable shader subset reaches translation.',question:'Should the translator invent output for an unsupported instruction?',answer:'No. This compiler stops at the unsupported encoding, with its byte offset. Real KytyPS5 supports a much larger instruction set; this is a limit of the teaching compiler.'},
    'stale-upload':{title:'Stale GPU data',tag:'COHERENCY',description:'After frame one, dirty uniform writes stop reaching the GPU mirror.',question:'Can every call succeed while the picture is still wrong?',answer:'Yes. Submission and completion proceed, but the shader reads the old position. CPU and GPU versions diverge at upload, before the visible symptom appears.'},
    'early-retire':{title:'Retire before completion',tag:'LIFETIME',description:'A command allocation is released while a submission still references it.',question:'Is the return from Submit a safe time to release all referenced resources?',answer:'No. The model catches last-use tick > completed tick. Recording, submitting, completing and retiring are separate events.'},
    thrash:{title:'Pipeline cache thrash',tag:'PERFORMANCE',description:'Three blend states rotate through a two-entry pipeline cache.',question:'Does a pipeline miss imply the shader must be translated again?',answer:'No. Translation remains warm while incompatible pipeline states evict each other. Compare program translations, pipeline creations and evictions separately.'}
  };
  function config(input = {}) {
    const c = {scenario:input.scenario ?? 'healthy', frames:input.frames ?? 4, offset:input.offset ?? -18, cacheSize:input.cacheSize ?? 2};
    if (!Object.hasOwn(CASES,c.scenario)) throw new Error('Unknown experiment.');
    for (const [key,min,max] of [['frames',1,8],['offset',-35,20],['cacheSize',1,8]])
      if (!Number.isInteger(c[key]) || c[key]<min || c[key]>max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    return c;
  }
  const clone = value => structuredClone(value);
  const hex = (n,w=8) => A.hex(n,w);
  function hash(bytes) { let n=2166136261; for (const b of bytes) n=Math.imul(n^b,16777619)>>>0; return n.toString(16).padStart(8,'0'); }
  const floatBits = n => { const b=new ArrayBuffer(4);new DataView(b).setFloat32(0,n,true);return new DataView(b).getUint32(0,true); };
  const bitsFloat = n => { const b=new ArrayBuffer(4);new DataView(b).setUint32(0,n,true);return new DataView(b).getFloat32(0,true); };
  const wordsBytes = words => { const b=new Uint8Array(words.length*4);const d=new DataView(b.buffer);words.forEach((w,i)=>d.setUint32(i*4,w,true));return b; };
  const PROGRAM = [
    [OP.SYS,0,0], [OP.STORE,0,ADDR.data+4], [OP.MOVF,1,floatBits(.72)], [OP.STORE,1,ADDR.data],
    [OP.BUILD,0,0], [OP.SYS,2,1], [OP.SYS,3,2], [OP.WAIT,2,0], [OP.SYS,0,3], [OP.SYS,0,4], [OP.YIELD,0,0]
  ];
  function programBytes(c) {
    return wordsBytes(PROGRAM.flatMap(([op,r,imm])=>[(op|(r<<8))>>>0, c.scenario==='write-rx'&&op===OP.STORE ? ADDR.text : imm]));
  }
  function disassemble(bytes) {
    const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),rows=[];
    for(let p=0;p<PROGRAM.length*8;p+=8){
      const w=d.getUint32(p,true),imm=d.getUint32(p+4,true),op=w&255,r=(w>>>8)&255;
      const text=op===OP.MOVF?`MOVF r${r}, ${bitsFloat(imm).toFixed(2)}`:op===OP.STORE?`STORE.f32 [${hex(imm)}], r${r}`:
        op===OP.SYS?`SYS r${r}, GOT[${imm}] ; ${IMPORTS[imm]}`:op===OP.BUILD?'BUILD_PACKET ; model helper':op===OP.WAIT?`WAIT timeline, r${r}`:'YIELD frame';
      rows.push({pc:ADDR.text+p,op,r,imm,text,words:[w,imm]});
    }
    return rows;
  }
  const VERTICES = [
    [-.82,-.58, .15,.85,1], [.02,.8, .75,.95,.35], [.08,-.25, .22,.35,1],
    [.02,.8, .75,.95,.35], [.86,-.48, 1,.35,.45], [.08,-.25, .22,.35,1],
    [-.82,-.58, .15,.85,1], [.08,-.25, .22,.35,1], [.86,-.48, 1,.35,.45]
  ];
  // Real base VOP2 encodings. Only multiply/add scalar-to-vector plus s_endpgm are executable here.
  const SHADER = [0x10000000,0x06000001,0x10020200,0xbf810000];
  function lowerShader(words) {
    const records=A.decodeIsa(words),ir=[];
    for(const row of records){
      if(row.dec.stop)throw new Error(`Unsupported encoding at shader byte ${row.pc}: ${row.dec.warning}`);
      if(row.dec.name==='s_endpgm')break;
      if(!['v_mul_f32','v_add_f32'].includes(row.dec.name))throw new Error('Teaching compiler cannot execute '+row.dec.name+'.');
      const w=row.raw[0],src=w&511,dst=(w>>>17)&255,right=(w>>>9)&255;
      if(src>1||dst>1||right>1)throw new Error('Teaching shader uses only s0/s1 and v0/v1.');
      ir.push({pc:row.pc,op:row.dec.name==='v_mul_f32'?'mul.f32':'add.f32',dst,left:src,right});
    }
    if(records.at(-1)?.dec.name!=='s_endpgm')throw new Error('Shader must end with s_endpgm.');
    return ir;
  }
  function runVertex(ir,vertex,uniforms) {
    const v=vertex.slice();
    for(const op of ir)v[op.dst]=Math.fround(op.op==='mul.f32'?uniforms[op.left]*v[op.right]:uniforms[op.left]+v[op.right]);
    return v;
  }
  function rasterize(vertices, blend = 0) {
    const pixels=new Uint8ClampedArray(WIDTH*HEIGHT*4);
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const p=(y*WIDTH+x)*4,grid=x%16===0||y%16===0;
      pixels[p]=grid?22:12;pixels[p+1]=grid?37:22;pixels[p+2]=grid?51:34;pixels[p+3]=255;
    }
    const screen=v=>[(v[0]+1)*(WIDTH-1)/2,(1-v[1])*(HEIGHT-1)/2,...v.slice(2)];
    const edge=(a,b,x,y)=>(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
    let covered=0;
    for(let t=0;t<vertices.length;t+=3){
      const [a,b,c]=vertices.slice(t,t+3).map(screen),area=edge(a,b,c[0],c[1]);
      if(Math.abs(area)<1e-9)continue;
      for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<=Math.min(HEIGHT-1,Math.ceil(Math.max(a[1],b[1],c[1])));y++)
        for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<=Math.min(WIDTH-1,Math.ceil(Math.max(a[0],b[0],c[0])));x++){
          const u=edge(b,c,x+.5,y+.5)/area,v=edge(c,a,x+.5,y+.5)/area,w=1-u-v;
          if(u<0||v<0||w<0)continue;
          const p=(y*WIDTH+x)*4;
          for(let ch=0;ch<3;ch++){
            const value=(u*a[ch+2]+v*b[ch+2]+w*c[ch+2])*255;
            pixels[p+ch]=blend===1?value*.6+pixels[p+ch]*.4:blend===2?pixels[p+ch]+value*.8:value;
          }
          covered++;
        }
    }
    return {pixels,covered};
  }
  function elfFixture(c) {
    const b=new ArrayBuffer(0x600),d=new DataView(b),u=new Uint8Array(b);
    d.setUint32(0,0x7f454c46,false);u[4]=2;u[5]=1;u[6]=1;d.setUint16(16,3,true);d.setUint16(18,0,true);
    d.setUint32(20,1,true);d.setBigUint64(24,BigInt(ADDR.text),true);d.setBigUint64(32,64n,true);
    d.setUint16(52,64,true);d.setUint16(54,56,true);d.setUint16(56,2,true);
    [[0x200,ADDR.text,PROGRAM.length*8,256,5],[0x400,ADDR.data,16,256,6]].forEach(([off,addr,size,memsz,flags],i)=>{
      const p=64+i*56;d.setUint32(p,1,true);d.setUint32(p+4,flags,true);d.setBigUint64(p+8,BigInt(off),true);
      d.setBigUint64(p+16,BigInt(addr),true);d.setBigUint64(p+32,BigInt(size),true);d.setBigUint64(p+40,BigInt(memsz),true);d.setBigUint64(p+48,256n,true);
    });
    u.set(programBytes(c),0x200);
    return b;
  }
  function run(input) {
    const c=config(input),events=[];
    const state={frame:0,clock:0,status:'ready',pc:ADDR.text,regs:[0,0,0,0],thread:'not started',regions:[],imports:[],
      cpuVersion:0,gpuVersion:0,gpuUniforms:[0,0],packets:[],packetWords:[],shaderWords:[],ir:[],programCached:false,
      pipelines:[],pipelineKey:'—',blend:0,submitted:0,completed:0,queue:[],allocations:[],frontFrame:0,
      image:rasterize([]).pixels,pendingImage:null,transformed:[],covered:0,audio:[],file:'',
      stats:{instructions:0,uploads:0,uploadBytes:0,translations:0,pipelines:0,hits:0,evictions:0,draws:0,presents:0},fault:null};
    let writes=[];
    function summary(s){return {'CPU.pc':hex(s.pc),'CPU.thread':s.thread,'CPU.r0':s.regs[0],'CPU.r1':s.regs[1],'CPU.r2':s.regs[2],'CPU.r3':s.regs[3],
      'memory.cpuVersion':s.cpuVersion,'memory.gpuVersion':s.gpuVersion,'shader.translations':s.stats.translations,
      'pipeline.creations':s.stats.pipelines,'pipeline.hits':s.stats.hits,'pipeline.evictions':s.stats.evictions,'pipeline.liveEntries':s.pipelines.length,'timeline.submitted':s.submitted,'timeline.completed':s.completed,
      'display.frame':s.frontFrame,'queue.pending':s.queue.filter(q=>!q.done).length,'save.bytes':s.file.length};}
    function emit(kind,owner,title,why,mutate=()=>{},cost=10,checks=[]){
      const before=summary(state);writes=[];mutate();state.clock+=cost;
      const after=summary(state),changes=Object.keys(after).filter(k=>before[k]!==after[k]).map(key=>({key,before:before[key],after:after[key]}));
      const event={seq:events.length,frame:state.frame,kind,owner,title,why,cost,time:state.clock,changes,writes:clone(writes),checks:checks.map(check=>({label:check.label,ok:check.test()})),state:clone(state)};
      events.push(event);return event;
    }
    function region(name){const r=state.regions.find(r=>r.name===name);if(!r)throw new Error('Unmapped region '+name);return r;}
    function locate(addr,n){const r=state.regions.find(r=>addr>=r.base&&addr+n<=r.base+r.bytes.length);if(!r)throw new Error('Unmapped access '+hex(addr));return r;}
    function write(addr,bytes,loader=false){
      const r=locate(addr,bytes.length);if(!loader&&!r.perm.includes('W'))throw new Error('Write denied at '+hex(addr)+' in '+r.name+' ('+r.perm+').');
      const at=addr-r.base,old=Array.from(r.bytes.slice(at,at+bytes.length));r.bytes.set(bytes,at);
      writes.push({region:r.name,address:addr,before:old,after:Array.from(bytes)});
      if(r.name==='data'&&!loader)state.cpuVersion++;
    }
    function fault(owner,message){emit('fault',owner,'Stopped at the failing boundary',message,()=>{state.fault={owner,message};state.status='faulted';state.thread='faulted';},0,[{label:'Boundary accepted the operation',test:()=>false}]);}
    function doGpu(){
      emit('gpu.execute','gpu','Execute the submitted draw','The software backend runs the lowered vertex operations against the GPU-visible uniform bytes, then rasterizes three triangles.',()=>{
        const d=new DataView(region('vertices').bytes.buffer),vertices=[];
        for(let i=0;i<9;i++)vertices.push(Array.from({length:5},(_,j)=>d.getFloat32(i*20+j*4,true)));
        state.transformed=vertices.map(v=>runVertex(state.ir,v,state.gpuUniforms));
        const rendered=rasterize(state.transformed,state.blend);state.pendingImage=rendered.pixels;state.covered=rendered.covered;state.stats.draws++;
      },180,[{label:'GPU uniform version matches the CPU version',test:()=>state.cpuVersion===state.gpuVersion}]);
      emit('gpu.complete','gpu','Signal completion','A modeled completion tick proves this submission has finished. It does not itself replace the displayed image.',()=>{
        state.completed=state.submitted;state.queue.at(-1).done=true;
      },30);
      emit('resource.retire','gpu','Retire the command allocation','The allocation can be reclaimed only after its last-use tick has completed.',()=>{state.allocations.at(-1).retired=true;},5,
        [{label:'completed tick ≥ allocation last-use tick',test:()=>state.completed>=state.allocations.at(-1).lastUse}]);
    }
    function prepareDraw(){
      owner='packets';
      const d=new DataView(region('ring').bytes.buffer);
      const words=Array.from({length:6},(_,i)=>d.getUint32(i*4,true));
      emit('packet.decode','packets','Decode the bytes in the command ring','The shared Playground parser reads actual PM4 header fields. Register offset 0 is a teaching state slot here, not a claim about its native hardware meaning.',()=>{
        state.packetWords=words;state.packets=A.decodePm4(words);
        if(state.packets.some(p=>p.short||p.unknown))throw new Error('Incomplete or unknown packet.');
        if(state.packets[1].payload[0]!==9)throw new Error('The fixture expects nine vertices.');
        state.blend=state.packets[0].payload[1];
      },20);
      owner='memory';
      emit('memory.upload','memory',c.scenario==='stale-upload'&&state.frame>1?'Dirty upload was skipped':'Make guest writes GPU-visible',
        'CPU bytes and the GPU mirror are separate. Changing a uniform needs visibility; it does not inherently change shader code or the pipeline identity.',()=>{
          if(c.scenario==='stale-upload'&&state.frame>1)return;
          const d=new DataView(region('data').bytes.buffer);state.gpuUniforms=[d.getFloat32(0,true),d.getFloat32(4,true)];
          state.gpuVersion=state.cpuVersion;state.stats.uploads++;state.stats.uploadBytes+=8;
        },25,[{label:'Every dirty uniform write reached the GPU mirror',test:()=>state.cpuVersion===state.gpuVersion}]);
      if(!state.programCached){
        owner='shader';
        emit('shader.decode','shader','Decode the guest shader','These words use real base RDNA encodings. The teaching compiler executes only the multiply/add subset listed here.',()=>{
          state.shaderWords=c.scenario==='unsupported-shader'?[0xd0000000,0,0xbf810000]:SHADER.slice();
        },20);
        emit('shader.translate','shader','Lower to executable operations','The lowered operations are consumed by the software vertex executor. No SPIR-V or Vulkan compiler is running in this page.',()=>{
          state.ir=lowerShader(state.shaderWords);state.programCached=true;state.stats.translations++;
        },120);
      }else emit('shader.reuse','shader','Reuse the translated program','Identical shader bytes reuse the existing operation plan. Current uniform values are supplied at execution.',()=>{},3);
      const key='shader:'+hash(wordsBytes(state.shaderWords))+'/blend:'+state.blend;
      owner='cache';
      const hit=state.pipelines.find(p=>p.key===key);
      emit(hit?'pipeline.hit':'pipeline.create','cache',hit?'Compatible pipeline found':'Create a compatible pipeline',
        'The model keys pipelines by shader identity and blend state. Real KytyPS5 keys contain additional static state and specialization data.',()=>{
          state.pipelineKey=key;
          if(hit){state.stats.hits++;state.pipelines=state.pipelines.filter(p=>p.key!==key);state.pipelines.push(hit);}
          else{state.stats.pipelines++;if(state.pipelines.length===c.cacheSize){state.pipelines.shift();state.stats.evictions++;}state.pipelines.push({key,created:state.frame});}
        },hit?5:600);
      owner='gpu';
      emit('gpu.submit','gpu','Submit, then return to the guest','Submission assigns a lifetime tick and queues work. The guest can do other work before it waits for completion.',()=>{
        state.submitted++;state.regs[2]=state.submitted;state.queue.push({tick:state.submitted,frame:state.frame,done:false});
        state.allocations.push({id:state.frame,lastUse:state.submitted,retired:false});
      },20);
      if(c.scenario==='early-retire'){
        emit('resource.early','gpu','Attempted early retirement','The allocation is still referenced by pending work. The guard stops here before a use-after-free is allowed.',()=>{},0,
          [{label:'completed tick ≥ allocation last-use tick',test:()=>state.completed>=state.allocations.at(-1).lastUse}]);
        throw new Error('Allocation '+state.frame+' is in use until tick '+state.submitted+'; completed is '+state.completed+'.');
      }
    }
    emit('start','loader','A cold process','A deterministic teaching executable is ready. Step forward to map it. This initial view contains no guest memory yet.',()=>{},0);
    let owner='loader';
    try{
      emit('loader.map','loader','Read ELF headers and map segments','A real ELF64 header/table is parsed locally. e_machine is NONE because the payload is an invented bytecode, not x86-64.',()=>{
        const file=elfFixture(c),parsed=A.parseElf(file);
        for(const [i,p] of parsed.phdrs.entries()){
          const bytes=new Uint8Array(p.memsz);bytes.set(new Uint8Array(file,p.offset,p.filesz));
          state.regions.push({name:i?'data':'text',base:p.vaddrLo,perm:'RW',bytes});
        }
        for(const name of ['vertices','ring','got','tls'])state.regions.push({name,base:ADDR[name],perm:'RW',bytes:new Uint8Array(256)});
        write(ADDR.vertices,wordsBytes(VERTICES.flat().map(floatBits)),true);write(ADDR.tls,wordsBytes([1,0,0,0]),true);
      },60);
      emit('loader.imports','loader','Resolve service imports','Toy import slots are resolved into callable service IDs. The same need for an exact target motivates NID and relocation handling in KytyPS5.',()=>{
        state.imports=IMPORTS.map((name,i)=>({name,slot:i,target:c.scenario==='missing-import'&&i===1?null:0x8000+i*16}));
        state.imports.forEach(i=>write(ADDR.got+i.slot*4,wordsBytes([i.target||0]),true));
      },30);
      if(state.imports.some(i=>i.target===null))throw new Error('Unresolved required import: SubmitFrame. Entry has not run.');
      emit('loader.protect','memory','Finalize region permissions','The text becomes RX, vertices become R, and the GOT becomes R. Uniforms and the ring stay RW. There is no executable browser mapping.',()=>{
        region('text').perm='RX';region('vertices').perm='R';region('got').perm='R';
      },15);
      emit('thread.start','cpu','Enter the guest workload','One interpreted thread starts at the ELF entry. KytyPS5 instead executes supported guest x86-64 natively on host threads.',()=>{state.thread='running';},10);
      for(let frame=1;frame<=c.frames;frame++){
        emit('frame.begin','cpu','Begin frame '+frame,'Each iteration executes the same stored program with a new input sample.',()=>{state.frame=frame;state.pc=ADDR.text;},1);
        for(let n=0;n<PROGRAM.length;n++){
          owner='cpu';const ins=disassemble(region('text').bytes)[n];
          if(!region('text').perm.includes('X'))throw new Error('Instruction fetch requires executable permission.');
          if(ins.op===OP.STORE){
            owner='memory';emit('cpu.store','memory',ins.text,'Decode the target from the instruction, check its region permission, then write four little-endian float bytes.',()=>{
              write(ins.imm,wordsBytes([floatBits(state.regs[ins.r])]));state.stats.instructions++;state.pc+=8;
            },2);
          }else if(ins.op===OP.MOVF){
            emit('cpu.move','cpu',ins.text,'The immediate bits are interpreted as a 32-bit float.',()=>{state.regs[ins.r]=bitsFloat(ins.imm);state.stats.instructions++;state.pc+=8;},1);
          }else if(ins.op===OP.BUILD){
            emit('cpu.packets','cpu','Build the draw request in guest memory','The bytecode helper writes a SET_CONTEXT_REG header and a DRAW_INDEX_AUTO header with nine vertices. A packet-shaped request is still not GPU completion.',()=>{
              const blend=c.scenario==='thrash'?(frame-1)%3:0;
              const words=[c.scenario==='bad-packet'?0:A.encodePm4(3,0x69,0),0,blend,A.encodePm4(3,0x2d,0),9,2];
              write(ADDR.ring,wordsBytes(words));state.stats.instructions++;state.pc+=8;
            },5);
          }else if(ins.op===OP.SYS){
            owner='hle';const target=new DataView(region('got').bytes.buffer).getUint32(ins.imm*4,true);
            const imp=state.imports.find(i=>i.target===target);
            if(!imp?.target)throw new Error('Missing service target.');
            emit('hle.'+ins.imm,'hle','Call '+imp.name,'The CPU instruction indexes the resolved GOT slot and crosses into a JavaScript host service. This is the model equivalent of an HLE boundary.',()=>{state.stats.instructions++;state.pc+=8;},3);
            if(ins.imm===0)emit('input.sample','services','Read the input sample','A repeatable input trajectory supplies the horizontal offset. It is configuration data, not a physical controller reading.',()=>{state.regs[0]=Math.fround(c.offset/100+(frame-1)*.08);},2);
            if(ins.imm===1){owner='packets';prepareDraw();}
            if(ins.imm===2)emit('audio.write','services','Produce an audio block','The model computes 128 mono PCM samples. The optional audition button loops this block through Web Audio.',()=>{
              state.audio=Array.from({length:128},(_,i)=>Math.sin(i*2*Math.PI/128)*(0.15+frame*.01));state.regs[3]=state.audio.length;
            },10);
            if(ins.imm===3){owner='present';if(state.completed<state.regs[2])throw new Error('Present requested before the rendered frame completed.');
              emit('present.flip','present','Present frame '+frame,'The completed back buffer becomes the front buffer. These pixels were rasterized from the uploaded bytes and lowered operations.',()=>{
                state.image=state.pendingImage;state.pendingImage=null;state.frontFrame=frame;state.stats.presents++;
              },10,[{label:'The presented submission has completed',test:()=>state.completed>=state.regs[2]}]);
            }
            if(ins.imm===4)emit('file.write','services','Write a virtual checkpoint','This writes a JSON string in the model filesystem. No local game save or host file is changed.',()=>{
              state.file=JSON.stringify({frame,position:state.gpuUniforms[1],image:hash(state.image)},null,2);
            },15);
          }else if(ins.op===OP.WAIT){
            owner='gpu';emit('cpu.wait','cpu','Wait for tick '+state.regs[ins.r],'The guest thread is blocked while the queued work executes. A second activity lane, not CPU instruction retirement, advances completion.',()=>{state.thread='waiting';state.stats.instructions++;state.pc+=8;},1);
            doGpu();
            emit('cpu.wake','cpu','Resume after completion','The wait condition is now true, so the guest may continue to presentation.',()=>{state.thread='running';},2);
          }else emit('cpu.yield','cpu','Yield the frame','All guest instructions in this iteration have retired. The next frame can reuse compatible resources.',()=>{state.stats.instructions++;state.pc+=8;},1);
        }
      }
      emit('finished','cpu','Workload complete','Rewind, compare a broken case, inspect a memory write, or export this deterministic replay.',()=>{state.status='complete';state.thread='finished';},0);
    }catch(err){fault(state.shaderWords.length&&!state.programCached?'shader':owner,err.message);}
    const digest=hash(new TextEncoder().encode(JSON.stringify(events.map(e=>[e.kind,e.frame,e.changes,e.writes,e.checks,hash(e.state.image)]))));
    return {version:VERSION,revision:A.data.revision,config:c,events,digest};
  }
  function difference(a,b) {
    const comparable=e=>JSON.stringify([e.kind,e.frame,e.changes,e.writes,e.checks]);
    for(let i=0;i<Math.max(a.events.length,b.events.length);i++)if(!a.events[i]||!b.events[i]||comparable(a.events[i])!==comparable(b.events[i]))return {index:i,left:a.events[i]||null,right:b.events[i]||null};
    return null;
  }
  function exportTrace(trace) {
    return JSON.stringify({schema:'kyty-observatory',version:VERSION,revision:trace.revision,config:trace.config,digest:trace.digest,
      events:trace.events.map(({seq,frame,kind,title,time,changes,writes,checks})=>({seq,frame,kind,title,time,changes,writes,checks}))},null,2);
  }
  function importTrace(text) {
    if(text.length>2*1024*1024)throw new Error('Replay exceeds the 2 MiB limit.');
    const record=JSON.parse(text);
    if(!record||record.schema!=='kyty-observatory'||record.version!==VERSION||!record.config||typeof record.config!=='object'||Array.isArray(record.config))throw new Error('Unsupported replay format.');
    if(record.revision!==A.data.revision)throw new Error('Replay uses a different pinned source revision.');
    const trace=run(record.config);
    if(record.digest!==trace.digest)throw new Error('Replay fingerprint does not match its configuration.');
    // Event evidence is regenerated, never trusted as executable state or HTML.
    if(JSON.stringify(record.events)!==JSON.stringify(JSON.parse(exportTrace(trace)).events))throw new Error('Recorded event evidence differs from the regenerated run.');
    return trace;
  }
  return {VERSION,WIDTH,HEIGHT,ADDR,OP,IMPORTS,SOURCES,CASES,SHADER,config,run,hash,hex,floatBits,bitsFloat,disassemble,lowerShader,runVertex,rasterize,elfFixture,difference,exportTrace,importTrace};
});
