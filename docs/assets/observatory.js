(function () {
  'use strict';
  const O=window.KYTY_OBSERVATORY,A=window.KYTY_ARTIFACTS,root=document.getElementById('observatory');
  if(!root)return;
  const $=id=>document.getElementById(id);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>typeof value==='number'&&!Number.isInteger(value)?(value!==0&&Math.abs(value)<.0001?value.toExponential(6):Number(value.toFixed(6))):value;
  const table=(headers,rows)=>'<table class="ro-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(num(cell))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  const empty=message=>'<div class="ro-empty">'+esc(message)+'</div>';
  const pre=value=>'<pre class="ro-pre">'+esc(value)+'</pre>';
  const note=text=>'<p class="ro-note">'+esc(text)+'</p>';
  const colors={loader:'#7ba1e5',cpu:'#38b4cb',memory:'#bd8bdd',hle:'#e4a94d',packets:'#df8798',shader:'#779ad9',cache:'#91ac57',gpu:'#5ab393',present:'#5ab393',services:'#b6a584'};
  const tabs=['cpu','memory','packets','shader','queues','services','compare'];
  const groups=[['loader','Load'],['cpu','CPU'],['memory','Memory'],['hle','HLE'],['packets','Packets'],['shader','Shader'],['gpu','Queue'],['present','Display']];
  const ownerTab={loader:'cpu',cpu:'cpu',memory:'memory',hle:'services',packets:'packets',shader:'shader',cache:'shader',gpu:'queues',present:'queues',services:'services'};
  let trace,baseline,cursor=0,tab='cpu',regionName='data',byteIndex=0,timer=null,watch=null,pixel=null;
  const event=()=>trace.events[cursor],state=()=>event().state;
  const status=message=>{$('ro-file-status').textContent=message;};
  function getConfig(){return O.config({scenario:$('ro-case').value,frames:Number($('ro-frames').value),offset:Number($('ro-offset').value),cacheSize:Number($('ro-capacity').value)});}
  function setConfig(c){$('ro-case').value=c.scenario;$('ro-frames').value=c.frames;$('ro-offset').value=c.offset;$('ro-capacity').value=c.cacheSize;$('ro-offset-value').textContent=c.offset+'%';}
  function stop(message){if(timer){clearTimeout(timer);timer=null;}$('ro-play').textContent='▶ Replay';if(message)$('ro-play-state').textContent=message;}
  function rebuild(c=getConfig(),index=0){
    stop();trace=O.run(c);baseline=c.scenario==='healthy'?trace:O.run(c.scenario==='thrash'?{...c,cacheSize:Math.max(3,c.cacheSize)}:{...c,scenario:'healthy'});cursor=Math.max(0,Math.min(trace.events.length-1,index));
    setConfig(c);$('ro-seek').max=trace.events.length-1;$('ro-fingerprint').textContent='Replay '+trace.digest+' · source '+trace.revision.slice(0,8);
    renderTimeline();render();status('');
  }
  function seek(index,reason){stop(reason||'Paused');cursor=Math.max(0,Math.min(trace.events.length-1,index));render();}
  function breakpoint(e){
    if(watch!==null&&e.writes.some(w=>watch>=w.address&&watch<w.address+w.after.length))return 'Write watchpoint reached at '+O.hex(watch);
    const kind=$('ro-break').value;
    if(kind==='problem'&&(e.kind==='fault'||e.checks.some(c=>!c.ok)))return 'Paused at a failed invariant';
    if(kind!=='none'&&e.kind===kind)return 'Breakpoint: '+e.title;
    return '';
  }
  function replay(){
    if(timer){stop('Paused');return;}
    if(cursor===trace.events.length-1)cursor=0;
    $('ro-play').textContent='Ⅱ Pause';$('ro-play-state').textContent='Replaying recorded state';
    function advance(){
      cursor=Math.min(cursor+1,trace.events.length-1);render();
      const reason=breakpoint(event());
      if(reason||cursor===trace.events.length-1){stop(reason||'End of capture');return;}
      timer=setTimeout(advance,Number($('ro-speed').value));
    }
    timer=setTimeout(advance,Number($('ro-speed').value));
  }
  function draw(canvas,pixels){canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),O.WIDTH,O.HEIGHT),0,0);}
  function region(){return state().regions.find(r=>r.name===regionName)||state().regions[0];}
  function render(){
    const e=event(),s=e.state;
    $('ro-prev').disabled=cursor===0;$('ro-home').disabled=cursor===0;$('ro-next').disabled=cursor===trace.events.length-1;
    $('ro-frame').disabled=cursor===trace.events.length-1;$('ro-seek').value=cursor;
    $('ro-position').textContent='EVENT '+cursor+' / '+(trace.events.length-1);$('ro-clock').textContent=e.time.toLocaleString()+' modeled µs';
    if(!timer)$('ro-play-state').textContent=s.fault?'Stopped · '+s.fault.owner:cursor===trace.events.length-1?'Capture complete':'Paused · '+e.kind;
    $('ro-owner').textContent=O.SOURCES[e.owner].label.toUpperCase();$('ro-frame-label').textContent=s.frame?'FRAME '+s.frame:'PRE-ENTRY';
    $('ro-event-title').textContent=e.title;$('ro-event-why').textContent=e.why;
    $('ro-checks').innerHTML=e.checks.map(c=>'<div class="ro-check '+(c.ok?'good':'bad')+'">'+(c.ok?'✓ ':'! ')+esc(c.label)+'</div>').join('');
    const deltas=e.changes.map(c=>'<div class="ro-change"><span>'+esc(c.key)+'</span><b>'+esc(num(c.before))+' → '+esc(num(c.after))+'</b></div>');
    const bytePreview=bytes=>bytes.slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join(' ')+(bytes.length>12?' …':'');
    e.writes.forEach((w,i)=>deltas.push('<button type="button" class="ro-write" data-write="'+i+'"><span>'+esc(w.region)+' @ '+O.hex(w.address)+' · inspect '+w.after.length+' bytes ↗</span><b>'+bytePreview(w.before)+' → '+bytePreview(w.after)+'</b></button>'));
    $('ro-changes').innerHTML=deltas.join('')||'<span class="ro-muted">No scalar or memory change. This event records a boundary or checks an invariant.</span>';
    $('ro-changes').querySelectorAll('[data-write]').forEach(b=>b.onclick=()=>{const w=e.writes[Number(b.dataset.write)];regionName=w.region;byteIndex=w.address-s.regions.find(r=>r.name===w.region).base;selectTab('memory');$('ro-inspect').scrollIntoView({block:'center'});$('ro-inspect').querySelector('[data-byte="'+byteIndex+'"]').focus({preventScroll:true});});
    const source=O.SOURCES[e.owner],url='https://github.com/KytyPS5/KytyPS5/blob/'+trace.revision+'/'+source.path;
    $('ro-source').innerHTML='<a href="'+url+'" target="_blank" rel="noopener">'+esc(source.symbol)+' ↗</a><span>'+esc(source.path)+'</span><a href="'+source.lesson+'">Read the matching lesson →</a>';
    const pending=$('ro-pending').checked&&s.pendingImage;
    draw($('ro-canvas'),pending||s.image);
    renderPixel();
    $('ro-screen-title').textContent=pending?'Rasterized, awaiting presentation':s.frontFrame?'Presented frame '+s.frontFrame:'Waiting for the first flip';
    $('ro-image-label').textContent=(pending?'PENDING TARGET':'FRONT BUFFER')+' · 128 × 80 · '+O.hash(pending||s.image);
    $('ro-screen-hint').textContent=s.fault?'The last presented image survives this fault.':pending?'Pixels are ready; completion and presentation are separate boundaries.':s.frontFrame?'Pixels come from the shader operations and GPU-visible bytes.':'The display changes at presentation, after completion.';
    $('ro-metrics').innerHTML=[[s.stats.instructions,'instructions'],[s.stats.translations,'translations'],[s.submitted+'/'+s.completed,'submit / done'],[s.stats.presents,'presents']].map(([v,k])=>'<div><b>'+v+'</b><span>'+k+'</span></div>').join('');
    $('ro-path').innerHTML=groups.map(([owner,name])=>'<button type="button" data-owner="'+owner+'" class="'+(e.owner===owner?'is-current':trace.events.slice(0,cursor+1).some(ev=>ev.owner===owner)?'visited':'')+'">'+name+'</button>').join('');
    $('ro-path').querySelectorAll('button').forEach(b=>b.onclick=()=>{
      const next=trace.events.find(ev=>ev.owner===b.dataset.owner&&ev.seq>cursor)||trace.events.find(ev=>ev.owner===b.dataset.owner);
      if(next)seek(next.seq);selectTab(ownerTab[b.dataset.owner]);
    });
    $('ro-timeline').querySelectorAll('[data-event]').forEach(r=>r.classList.toggle('is-current',Number(r.dataset.event)===cursor));
    $('ro-export-memory').disabled=!region();
    renderInspector();renderEvents();
  }
  function renderTimeline(){
    const lanes=['loader','cpu','memory','hle','packets','shader','gpu','present'],width=1000,start=100,span=880,total=Math.max(1,trace.events.at(-1).time);
    const lane=owner=>owner==='cache'?'shader':owner==='services'?'hle':owner;
    let svg='<svg viewBox="0 0 '+width+' 170" role="group" aria-label="Modeled event timeline. Use the event ledger for keyboard navigation.">';
    lanes.forEach((name,i)=>{svg+='<text x="0" y="'+(i*19+16)+'">'+name.toUpperCase()+'</text><line class="ro-gridline" x1="'+start+'" y1="'+(i*19+11)+'" x2="990" y2="'+(i*19+11)+'"/>';});
    trace.events.forEach(e=>{const x=start+(e.time-e.cost)/total*span,w=Math.max(2,e.cost/total*span),y=lanes.indexOf(lane(e.owner))*19+4;
      svg+='<rect data-event="'+e.seq+'" x="'+x.toFixed(2)+'" y="'+y+'" width="'+w.toFixed(2)+'" height="13" rx="2" fill="'+colors[e.owner]+'"><title>'+esc(e.seq+' · '+e.title+' · frame '+e.frame)+'</title></rect>';
    });
    $('ro-timeline').innerHTML=svg+'</svg>';
    $('ro-timeline').querySelectorAll('[data-event]').forEach(r=>r.onclick=()=>seek(Number(r.dataset.event)));
  }
  function selectTab(id){
    tab=id;tabs.forEach(name=>{const b=$('ro-tab-'+name);b.setAttribute('aria-selected',String(name===id));b.tabIndex=name===id?0:-1;});
    $('ro-inspect').setAttribute('aria-labelledby','ro-tab-'+id);renderInspector();
  }
  function renderInspector(){
    const s=state(),e=event(),host=$('ro-inspect');
    if(tab==='cpu'){
      const text=s.regions.find(r=>r.name==='text');
      const instructions=text?O.disassemble(text.bytes):[];
      host.innerHTML='<div class="ro-columns"><div><h3>The program in guest memory</h3>'+(!text?empty('Map the module to inspect its instructions.'):
        '<table class="ro-table"><thead><tr><th>Address</th><th>Decoded teaching instruction</th></tr></thead><tbody>'+instructions.map(i=>'<tr class="'+(i.pc===s.pc?'is-current':'')+'"><td>'+O.hex(i.pc)+'</td><td>'+esc(i.text)+'</td></tr>').join('')+'</tbody></table>')+
        note('Each invented instruction occupies eight bytes: opcode/register word + immediate word. Highlight = next PC. Real KytyPS5 does not interpret this ISA.')+'</div><div><h3>Registers & thread</h3><div class="ro-registers">'+s.regs.map((r,i)=>'<div>r'+i+'<b>'+esc(num(r))+'</b><span>'+O.hex(O.floatBits(r))+' f32 bits</span></div>').join('')+'</div>'+table(['Field','Value'],[['Next PC',O.hex(s.pc)],['Thread',s.thread],['Retired instructions',s.stats.instructions],['TLS thread ID',s.regions.length?'1 @ '+O.hex(O.ADDR.tls):'not mapped']])+
        '<button type="button" id="ro-export-elf">Export teaching ELF</button>'+note('The exported ELF64 has e_machine = NONE and an invented bytecode payload. It is a parser fixture, not a PS5 executable.')+'</div></div>';
      $('ro-export-elf').onclick=()=>download('observatory-fixture.elf',O.elfFixture(trace.config),'application/octet-stream');
    }else if(tab==='memory'){
      const r=region();if(!r){host.innerHTML=empty('Guest regions have not been mapped. Step through the loader first.');return;}
      regionName=r.name;byteIndex=Math.min(byteIndex,r.bytes.length-1);
      let cells='';for(let row=0;row<16;row++){cells+='<span class="ro-address">'+O.hex(r.base+row*16)+'</span>';for(let col=0;col<16;col++){
        const i=row*16+col,changed=e.writes.some(w=>r.base+i>=w.address&&r.base+i<w.address+w.after.length);
        cells+='<button type="button" class="ro-byte '+(changed?'written ':'')+(i===byteIndex?'selected':'')+'" data-byte="'+i+'" tabindex="'+(i===byteIndex?'0':'-1')+'" aria-label="Byte '+O.hex(r.base+i)+' value '+r.bytes[i].toString(16).padStart(2,'0')+'">'+r.bytes[i].toString(16).padStart(2,'0').toUpperCase()+'</button>';
      }}
      const aligned=Math.min(Math.floor(byteIndex/4)*4,r.bytes.length-4),d=new DataView(r.bytes.buffer),cpu=s.regions.find(r=>r.name==='data');
      host.innerHTML='<div class="ro-region-tabs">'+s.regions.map(p=>'<button type="button" data-region="'+p.name+'" class="'+(r.name===p.name?'is-current':'')+'">'+p.name+' · '+p.perm+'</button>').join('')+'</div><div class="ro-columns"><div><h3>'+esc(r.name)+' · '+O.hex(r.base)+' · '+r.perm+'</h3><div class="ro-hex-grid">'+cells+'</div>'+note('All 256 bytes. Highlighted bytes were written by the selected event. Export includes the whole region.')+'</div><div class="ro-memory-details"><h3>Read the same four bytes</h3>'+table(['Interpretation','Value'],[['Aligned address',O.hex(r.base+aligned)],['uint32 little-endian',d.getUint32(aligned,true)],['float32 little-endian',d.getFloat32(aligned,true)],['CPU data version',s.cpuVersion],['GPU mirror version',s.gpuVersion]])+
        '<h3>Position visibility</h3>'+table(['Owner','x offset'],[['CPU bytes',cpu?new DataView(cpu.bytes.buffer).getFloat32(4,true):'—'],['GPU mirror',s.gpuUniforms[1]]])+
        '<button type="button" id="ro-watch-selected">Watch this byte</button>'+note('These compact regions model access permissions and separate CPU/GPU visibility. They are not real host virtual mappings or the native tracker’s page layout.')+'</div></div>';
      host.querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{regionName=b.dataset.region;byteIndex=0;renderInspector();});
      host.querySelectorAll('[data-byte]').forEach(b=>{
        const select=index=>{byteIndex=Math.max(0,Math.min(r.bytes.length-1,index));renderInspector();host.querySelector('[data-byte="'+byteIndex+'"]').focus({preventScroll:true});};
        b.onclick=()=>select(Number(b.dataset.byte));
        b.onkeydown=key=>{const steps={ArrowLeft:-1,ArrowRight:1,ArrowUp:-16,ArrowDown:16};let next;if(Object.hasOwn(steps,key.key))next=byteIndex+steps[key.key];else if(key.key==='Home')next=key.ctrlKey?0:byteIndex-byteIndex%16;else if(key.key==='End')next=key.ctrlKey?255:byteIndex-byteIndex%16+15;else return;key.preventDefault();key.stopPropagation();select(next);host.querySelector('[data-byte="'+byteIndex+'"]').scrollIntoView({block:'nearest'});};
      });
      $('ro-watch-selected').onclick=()=>{$('ro-watch').value=O.hex(r.base+byteIndex);updateWatch();};
    }else if(tab==='packets'){
      const r=s.regions.find(r=>r.name==='ring'),raw=r?Array.from({length:6},(_,i)=>new DataView(r.bytes.buffer).getUint32(i*4,true)):[];
      host.innerHTML='<div class="ro-columns"><div><h3>Command ring · actual bytes</h3>'+pre(raw.length?raw.map((w,i)=>O.hex(O.ADDR.ring+i*4)+'  '+O.hex(w)).join('\n'):'not mapped')+
        note('The headers use the pinned PM4 constants. SET_CONTEXT_REG offset 0 is only a teaching blend slot in this model; these payloads are not a runnable native GPU stream.')+'</div><div><h3>Last decoded packets</h3>'+(s.packets.length?table(['Offset','Packet','Dwords'],s.packets.map(p=>[p.at,p.name,p.len])):empty('No packet has been decoded yet. The fault event explains malformed input.'))+
        table(['Request','Value'],[['Vertex count',s.packets[1]?.payload[0]??'—'],['Model blend', ['opaque','alpha','additive'][s.blend]],['Submitted tick',s.submitted],['Completed tick',s.completed]])+'</div></div>';
    }else if(tab==='shader'){
      let decoded='No shader has been decoded.';if(s.shaderWords.length)decoded=A.decodeIsa(s.shaderWords).map(r=>O.hex(r.pc)+'  '+r.raw.map(w=>O.hex(w)).join(' ')+'  '+r.dec.name).join('\n');
      host.innerHTML='<div class="ro-columns"><div><h3>Input ISA → executable operation plan</h3>'+pre(decoded)+pre(s.ir.length?s.ir.map(o=>'v'+o.dst+' = '+o.op+'(s'+o.left+', v'+o.right+');').join('\n'):'Translation has not produced an operation plan.')+
        note('s0 is scale; s1 is horizontal offset. v0/v1 begin as vertex x/y. These operations are executed to produce the transformed coordinates below. Color is interpolated by the software rasterizer.')+
        (s.transformed.length?table(['Vertex','x after shader','y after shader'],s.transformed.slice(0,3).map((v,i)=>[i,v[0],v[1]])):empty('Step to GPU execution to see transformed vertices.'))+'</div><div><h3>Two different kinds of reuse</h3>'+table(['Counter','Value'],[['Program translations',s.stats.translations],['Pipeline creations',s.stats.pipelines],['Pipeline hits',s.stats.hits],['Pipeline evictions',s.stats.evictions],['Pipeline capacity',trace.config.cacheSize]])+
        '<h3>Live pipeline entries · oldest first</h3>'+(s.pipelines.length?table(['Identity','Created frame'],s.pipelines.map(p=>[p.key,p.created])):empty('The pipeline cache is cold.'))+note('Uniform changes do not alter this model’s key. Blend changes do. Cache capacities and compilation costs are chosen for the experiment, not copied from native runtime measurements.')+'</div></div>';
    }else if(tab==='queues'){
      host.innerHTML='<div class="ro-columns"><div><h3>Submission timeline</h3>'+table(['Tick','Frame','Status'],s.queue.map(q=>[q.tick,q.frame,q.done?'complete':'pending']))+
        table(['Boundary','Value'],[['Last submitted',s.submitted],['Last completed',s.completed],['Current front frame',s.frontFrame],['Pending raster target',s.pendingImage?'ready, not presented':'none'],['Covered samples (latest draw)',s.covered]])+'</div><div><h3>Transient command allocations</h3>'+table(['Allocation','Last-use tick','Lifetime'],s.allocations.map(a=>['commands #'+a.id,a.lastUse,a.retired?'retired after completion':'retained']))+
        note('Submit returning does not satisfy a completion wait. A completed draw also does not change the front buffer until presentation. The teaching allocation stays alive until completed ≥ last-use tick.')+
        '<p class="ro-note"><a href="t-cpp-concurrency.html">Follow native synchronization and ownership →</a></p></div></div>';
    }else if(tab==='services'){
      const points=s.audio.map((v,i)=>(i/127*500).toFixed(1)+','+(40-v*150).toFixed(1)).join(' ');
      host.innerHTML='<div class="ro-columns"><div><h3>Imports and callable targets</h3>'+table(['Slot','Teaching service','Target'],s.imports.map(i=>[i.slot,i.name,i.target?O.hex(i.target):'UNRESOLVED']))+
        note('The instruction reads its target from actual GOT bytes. These names and numeric IDs belong to this model; KytyPS5’s guest export keys include NIDs and library/module identity.')+'</div><div><h3>Audio ring · '+s.audio.length+' computed samples</h3><svg class="ro-pcm" viewBox="0 0 500 80" role="img" aria-label="Computed PCM waveform"><polyline points="'+points+'"/></svg><p><button type="button" id="ro-audition" '+(!s.audio.length?'disabled':'')+'>Audition PCM · 0.2 seconds</button></p><h3>/savedata0/frame.json · virtual file</h3>'+pre(s.file||'No checkpoint has been written.')+'</div></div>';
      $('ro-audition').onclick=audition;
    }else{
      const good=baseline.events.at(-1).state,bad=trace.events.at(-1).state,delta=O.difference(baseline,trace),thrash=trace.config.scenario==='thrash';
      const reference=thrash?'SAME WORKLOAD · '+baseline.config.cacheSize+' SLOTS':'HEALTHY';
      const explanation=thrash?'The reference runs the same blend-state sequence with at least three cache slots. Only capacity changes; the final pixels should match.':'Complete captures compared with the same input, frame count and capacity.';
      host.innerHTML=note(explanation+' This view compares the entire runs, independent of the replay cursor.')+'<div class="ro-compare-images"><div><b>'+reference+' · frame '+good.frontFrame+'</b><canvas id="ro-good-image" width="128" height="80" aria-label="Reference run final frame"></canvas></div><div><b>'+esc(O.CASES[trace.config.scenario].title.toUpperCase())+' · frame '+bad.frontFrame+'</b><canvas id="ro-case-image" width="128" height="80" aria-label="Selected case final frame"></canvas></div></div><div class="ro-columns"><div>'+table(['Measurement','Reference','Selected'],[['Pipeline capacity',baseline.config.cacheSize,trace.config.cacheSize],['Presented frames',good.stats.presents,bad.stats.presents],['Shader translations',good.stats.translations,bad.stats.translations],['Pipeline creations',good.stats.pipelines,bad.stats.pipelines],['Evictions',good.stats.evictions,bad.stats.evictions],['Uploaded bytes',good.stats.uploadBytes,bad.stats.uploadBytes],['Final image fingerprint',O.hash(good.image),O.hash(bad.image)],['Modeled duration (µs)',good.clock,bad.clock]])+'</div><div><h3>First recorded divergence</h3>'+(delta?note('Reference: '+(delta.left?.title||'end')+' · Selected: '+(delta.right?.title||'end'))+'<button type="button" id="ro-divergence">Go to first divergence</button>':empty(thrash?'No differences under these settings. To observe repeated misses, run at least four frames with fewer than three slots.':'This is the healthy baseline. Load one of the failure cases to compare.'))+
        note(O.CASES[trace.config.scenario].answer)+note('A difference is evidence, not an automatic diagnosis of a real emulator failure. Read the write, dependency and invariant before its visible symptom.')+'</div></div>';
      draw($('ro-good-image'),good.image);draw($('ro-case-image'),bad.image);
      if(delta)$('ro-divergence').onclick=()=>seek(Math.min(delta.index,trace.events.length-1));
    }
  }
  function renderEvents(){
    const filter=$('ro-filter').value.toLowerCase(),host=$('ro-events'),oldScroll=host.scrollTop;
    const rows=trace.events.filter(e=>(e.kind+' '+e.owner+' '+e.title+' frame '+e.frame).toLowerCase().includes(filter));
    host.innerHTML=rows.length?rows.map(e=>'<button type="button" data-event="'+e.seq+'" class="ro-event-row '+(e.seq===cursor?'is-current ':'')+(e.kind==='fault'||e.checks.some(c=>!c.ok)?'has-problem':'')+'" '+(e.seq===cursor?'aria-current="step"':'')+'><span>'+String(e.seq).padStart(3,'0')+'</span><span>'+(e.frame?'FRAME '+e.frame:'BOOT')+'</span><span>'+e.owner+'</span><b>'+esc(e.title)+'</b><span>'+e.time+' µs</span></button>').join(''):empty('No events match this filter.');
    host.scrollTop=oldScroll;
    host.querySelectorAll('button').forEach(b=>b.onclick=()=>{seek(Number(b.dataset.event));host.querySelector('[data-event="'+cursor+'"]')?.focus({preventScroll:true});});
    const selected=host.querySelector('.is-current');
    if(selected){const y=selected.getBoundingClientRect().top-host.getBoundingClientRect().top;if(y<0||y>host.clientHeight-selected.clientHeight)host.scrollTop+=y-host.clientHeight/2;}
  }
  function renderPixel(){
    if(!pixel)return;
    const s=state(),bytes=$('ro-pending').checked&&s.pendingImage?s.pendingImage:s.image,p=(pixel.y*O.WIDTH+pixel.x)*4,rgba=Array.from(bytes.slice(p,p+4));
    $('ro-pixel').textContent='Pixel ('+pixel.x+', '+pixel.y+') · RGBA ['+rgba.join(', ')+'] · byte offset '+p+' · '+($('ro-pending').checked&&s.pendingImage?'pending target':'front buffer');
  }
  $('ro-canvas').tabIndex=0;
  $('ro-canvas').onclick=e=>{const b=e.currentTarget.getBoundingClientRect();pixel={x:Math.min(O.WIDTH-1,Math.max(0,Math.floor((e.clientX-b.left)/b.width*O.WIDTH))),y:Math.min(O.HEIGHT-1,Math.max(0,Math.floor((e.clientY-b.top)/b.height*O.HEIGHT)))};renderPixel();};
  $('ro-canvas').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();pixel??={x:64,y:40};pixel.x=Math.max(0,Math.min(O.WIDTH-1,pixel.x+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)));pixel.y=Math.max(0,Math.min(O.HEIGHT-1,pixel.y+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)));renderPixel();};
  function updateWatch(){
    const text=$('ro-watch').value.trim();watch=null;
    if(!text){$('ro-watch-status').textContent='Optional: pause replay when an event writes this address.';return;}
    if(!/^(?:0x)?[0-9a-f]{1,8}$/i.test(text)){$('ro-watch-status').textContent='Enter a hexadecimal address of up to eight digits.';return;}
    watch=parseInt(text.replace(/^0x/i,''),16);$('ro-watch-status').textContent='Watching writes that cover '+O.hex(watch)+'.';
  }
  function download(name,data,type='application/json'){
    const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Exported '+name+'.');
  }
  let audioContext;
  async function audition(){
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Web Audio is unavailable.');
      audioContext??=new Audio();await audioContext.resume();
      const samples=state().audio,buffer=audioContext.createBuffer(1,samples.length,audioContext.sampleRate);buffer.copyToChannel(Float32Array.from(samples),0);
      const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=true;source.connect(gain);gain.connect(audioContext.destination);
      const now=audioContext.currentTime;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.3,now+.015);gain.gain.linearRampToValueAtTime(0,now+.2);source.start(now);source.stop(now+.21);
      source.onended=()=>{source.disconnect();gain.disconnect();};status('Auditioned the computed PCM block.');
    }catch(err){status(err.message);}
  }
  Object.entries(O.CASES).forEach(([key,c])=>{const option=document.createElement('option');option.value=key;option.textContent=c.title;$('ro-case').append(option);});
  $('ro-missions').innerHTML=Object.entries(O.CASES).filter(([id])=>id!=='healthy').map(([id,c])=>'<article class="ro-mission"><span>'+c.tag+'</span><h3>'+esc(c.title)+'</h3><p>'+esc(c.description)+'</p><p><b>Predict:</b> '+esc(c.question)+'</p><details><summary>Check your explanation</summary><p>'+esc(c.answer)+'</p></details><button type="button" data-case="'+id+'">Load experiment →</button></article>').join('');
  $('ro-missions').querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{rebuild({...getConfig(),scenario:b.dataset.case,frames:Math.max(4,Number($('ro-frames').value))});selectTab('compare');root.scrollIntoView({block:'start'});});
  tabs.forEach((id,i)=>{
    $('ro-tab-'+id).onclick=()=>selectTab(id);
    $('ro-tab-'+id).onkeydown=e=>{let index=i;if(e.key==='ArrowRight')index=(i+1)%tabs.length;else if(e.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();e.stopPropagation();selectTab(tabs[index]);$('ro-tab-'+tabs[index]).focus();};
  });
  $('ro-home').onclick=()=>seek(0);$('ro-prev').onclick=()=>seek(cursor-1);$('ro-next').onclick=()=>seek(cursor+1);$('ro-play').onclick=replay;
  $('ro-frame').onclick=()=>seek(trace.events.find(e=>e.seq>cursor&&e.kind==='present.flip')?.seq??trace.events.length-1);
  $('ro-seek').oninput=()=>seek(Number($('ro-seek').value));$('ro-rebuild').onclick=()=>rebuild();
  for(const id of ['ro-case','ro-frames','ro-capacity','ro-offset'])$(id).onchange=()=>rebuild();
  $('ro-offset').oninput=()=>{$('ro-offset-value').textContent=$('ro-offset').value+'%';};
  $('ro-pending').onchange=render;$('ro-filter').oninput=renderEvents;$('ro-watch').oninput=updateWatch;
  $('ro-export').onclick=()=>download('observatory-'+trace.config.scenario+'.json',O.exportTrace(trace));
  $('ro-export-memory').onclick=()=>{const r=region();if(r)download('observatory-'+r.name+'-'+O.hex(r.base)+'.bin',r.bytes,'application/octet-stream');};
  $('ro-import').onclick=()=>$('ro-import-file').click();
  $('ro-import-file').onchange=async()=>{
    stop();const file=$('ro-import-file').files[0];if(!file)return;
    try{if(file.size>2*1024*1024)throw new Error('Replay exceeds the 2 MiB limit.');const imported=O.importTrace(await file.text());rebuild(imported.config);status('Replay regenerated and verified: '+imported.digest+'.');}
    catch(err){status('Could not import: '+err.message);}finally{$('ro-import-file').value='';}
  };
  $('ro-share').onclick=async()=>{const url=new URL(location.href);url.hash=new URLSearchParams({...trace.config,event:cursor,tab}).toString();try{await navigator.clipboard.writeText(url.href);status('Copied the configuration and selected event. The recipient needs access to this site URL.');}catch{status('Clipboard unavailable. Use Export replay to share this run.');}};
  root.addEventListener('keydown',e=>{
    if(e.target.closest('input,select,textarea,[role=tab]')||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='ArrowRight'){e.preventDefault();seek(cursor+1);}else if(e.key==='ArrowLeft'){e.preventDefault();seek(cursor-1);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Paused while the page is hidden');});
  function loadView(first=false){
    const params=new URLSearchParams(location.hash.slice(1));if(!first&&!params.has('scenario'))return;
    let initial={},index=0,initialTab='cpu',initialError='';
    try{if(params.has('scenario')){
      initial=O.config({scenario:params.get('scenario'),frames:Number(params.get('frames')),offset:Number(params.get('offset')),cacheSize:Number(params.get('cacheSize'))});
      index=Math.max(0,Math.floor(Number(params.get('event'))||0));initialTab=tabs.includes(params.get('tab'))?params.get('tab'):'cpu';
    }}catch(err){initial={};initialError='Invalid view link: '+err.message;}
    rebuild(O.config(initial),index);selectTab(initialTab);if(initialError)status(initialError);
  }
  loadView(true);window.addEventListener('hashchange',()=>loadView());
  // Snapshot access for browser verification and inspection in developer tools.
  window.RUN_OBSERVATORY={get trace(){return trace;},get index(){return cursor;},get activeTab(){return tab;}};
})();
