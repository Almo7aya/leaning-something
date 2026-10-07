// Behavioral checks for the executable model; no native emulator execution.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const O=require('../docs/assets/observatory-engine.js');
const A=require('../docs/assets/artifact-parsers.js');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
const final=t=>t.events.at(-1).state;
const cases=Object.fromEntries(Object.keys(O.CASES).map(s=>[s,O.run({scenario:s})]));
const healthy=cases.healthy,h=final(healthy);
check('repeatable full run with real byte writes and warm reuse',()=>{
  assert.equal(healthy.digest,O.run().digest);assert.equal(h.status,'complete');
  assert.equal(h.stats.instructions,44);assert.equal(h.stats.presents,4);
  assert.equal(h.stats.translations,1);assert.equal(h.stats.pipelines,1);assert.equal(h.stats.hits,3);
  assert.equal(h.stats.uploadBytes,32);assert.equal(h.cpuVersion,h.gpuVersion);
  assert.ok(healthy.events.every(e=>e.checks.every(c=>c.ok)));
  const stores=healthy.events.filter(e=>e.kind==='cpu.store');assert.equal(stores.length,8);
  assert.deepEqual(stores[0].writes[0].after,[...new Uint8Array(new Float32Array([Math.fround(-.18)]).buffer)]);
  assert.equal(healthy.events[0].state.regions.length,0,'Earlier snapshots are not mutated');
  assert.equal(healthy.events.find(e=>e.kind==='loader.map').state.regions[0].perm,'RW');
  assert.equal(h.regions[0].perm,'RX');
});
check('ELF fixture and PM4 bytes use shared readers',()=>{
  const elf=A.parseElf(O.elfFixture(O.config()));assert.equal(elf.phdrs.length,2);
  assert.equal(elf.phdrs[0].vaddrLo,O.ADDR.text);assert.equal(elf.phdrs[0].memsz,256);
  const packet=healthy.events.find(e=>e.kind==='packet.decode').state;
  const decoded=A.decodePm4(packet.packetWords);assert.equal(decoded[1].name,'IT_DRAW_INDEX_AUTO');
  assert.equal(decoded[1].payload[0],9);assert.equal(decoded[1].len,3);
});
check('shader operations compute coordinates consumed by rasterization',()=>{
  const ir=O.lowerShader(O.SHADER);assert.equal(ir.length,3);
  const vertex=O.runVertex(ir,[.5,-.5,1,0,0],[.75,.1]);
  assert.equal(vertex[0],Math.fround(Math.fround(.5*.75)+.1));assert.equal(vertex[1],-.375);
  assert.deepEqual(vertex.slice(2),[1,0,0]);
  assert.throws(()=>O.lowerShader([0xd0000000,0,0xbf810000]),/Unsupported/);
  assert.throws(()=>O.lowerShader(O.SHADER.slice(0,-1)),/end/);
  const gpu=healthy.events.find(e=>e.kind==='gpu.execute').state;
  assert.ok(gpu.covered>500);assert.equal(gpu.transformed.length,9);
  assert.deepEqual(gpu.pendingImage,O.rasterize(gpu.transformed).pixels);
  assert.notEqual(O.hash(gpu.image),O.hash(gpu.pendingImage));
});
check('submission, completion, retirement and presentation are distinct',()=>{
  for(let frame=1;frame<=4;frame++){
    const events=healthy.events.filter(e=>e.frame===frame),at=kind=>events.find(e=>e.kind===kind);
    assert.ok(at('gpu.submit').seq<at('audio.write').seq);
    assert.ok(at('cpu.wait').seq<at('gpu.execute').seq);
    assert.ok(at('gpu.execute').seq<at('gpu.complete').seq);
    assert.ok(at('gpu.complete').seq<at('resource.retire').seq);
    assert.ok(at('resource.retire').seq<at('present.flip').seq);
    assert.equal(at('gpu.submit').state.completed,frame-1);
    assert.equal(at('gpu.complete').state.frontFrame,frame-1);
    assert.equal(at('present.flip').state.frontFrame,frame);
    assert.equal(at('cpu.wait').state.thread,'waiting');
    assert.equal(at('gpu.complete').state.allocations.at(-1).retired,false);
    assert.equal(at('resource.retire').state.allocations.at(-1).retired,true);
  }
});
check('five fault boundaries stop without a fake successful frame',()=>{
  const failures={'missing-import':['loader',/Unresolved/,0],'write-rx':['memory',/Write denied/,1],'bad-packet':['packets',/packet/i,6],'unsupported-shader':['shader',/Unsupported/,6],'early-retire':['gpu',/in use/,6]};
  for(const [id,[owner,reason,instructions]] of Object.entries(failures)){
    const s=final(cases[id]);assert.equal(s.status,'faulted',id);assert.equal(s.fault.owner,owner,id);
    assert.match(s.fault.message,reason,id);assert.equal(s.stats.presents,0,id);
    assert.equal(s.stats.instructions,instructions,id);
  }
  assert.equal(final(cases['early-retire']).allocations[0].retired,false);
  assert.equal(final(cases['write-rx']).regions.find(r=>r.name==='text').bytes[0],O.OP.SYS);
});
check('stale visibility can complete successfully with incorrect pixels',()=>{
  const t=cases['stale-upload'],s=final(t);assert.equal(s.status,'complete');assert.equal(s.stats.presents,4);
  assert.equal(s.stats.uploads,1);assert.ok(s.cpuVersion>s.gpuVersion);
  assert.ok(t.events.some(e=>e.kind==='memory.upload'&&e.checks.some(c=>!c.ok)));
  const images=t.events.filter(e=>e.kind==='present.flip').map(e=>O.hash(e.state.image));
  assert.equal(new Set(images).size,1);assert.notEqual(images.at(-1),O.hash(h.image));
  const diff=O.difference(healthy,t);assert.equal(diff.right.kind,'memory.upload');assert.equal(diff.right.frame,2);
  assert.equal(O.difference(healthy,O.run()),null);
});
check('capacity fixes thrashing without changing program translations or pixels',()=>{
  const small=final(O.run({scenario:'thrash',frames:6,cacheSize:2}));
  const large=final(O.run({scenario:'thrash',frames:6,cacheSize:3}));
  assert.equal(small.stats.pipelines,6);assert.equal(large.stats.pipelines,3);
  assert.equal(small.stats.evictions,4);assert.equal(large.stats.evictions,0);
  assert.equal(small.stats.translations,1);assert.equal(large.stats.translations,1);
  assert.equal(O.hash(small.image),O.hash(large.image));assert.ok(large.clock<small.clock);
});
check('input changes propagate through uploaded bytes into different pixels',()=>{
  const left=final(O.run({offset:-35})),right=final(O.run({offset:20}));
  assert.notEqual(O.hash(left.image),O.hash(right.image));
  assert.equal(left.stats.translations,right.stats.translations);
  const save=JSON.parse(h.file);assert.equal(save.frame,4);assert.equal(save.image,O.hash(h.image));
  assert.equal(h.audio.length,128);assert.ok(h.audio.some(v=>v>0)&&h.audio.some(v=>v<0));
});
check('all scenarios export, regenerate and validate their evidence',()=>{
  for(const trace of Object.values(cases)){
    const serialized=O.exportTrace(trace);assert.ok(Buffer.byteLength(serialized)<2*1024*1024);
    assert.equal(O.importTrace(serialized).digest,trace.digest);
  }
  const max=O.run({frames:8,cacheSize:8});assert.equal(O.importTrace(O.exportTrace(max)).digest,max.digest);
  const record=JSON.parse(O.exportTrace(healthy));record.events[0].title='<script>bad()</script>';
  assert.throws(()=>O.importTrace(JSON.stringify(record)),/evidence differs/);
  record.revision='wrong';assert.throws(()=>O.importTrace(JSON.stringify(record)),/revision/);
  assert.throws(()=>O.importTrace('x'.repeat(2*1024*1024+1)),/limit/);
  assert.throws(()=>O.importTrace('{bad'),SyntaxError);
  assert.throws(()=>O.importTrace('null'),/Unsupported replay format/);
  assert.throws(()=>O.config({frames:9}),/frames/);assert.throws(()=>O.config({cacheSize:0}),/cacheSize/);
  assert.throws(()=>O.config({scenario:'toString'}),/Unknown/);assert.throws(()=>O.config({offset:NaN}),/offset/);
});
check('native connections and curriculum routes exist',()=>{
  const root=path.resolve(__dirname,'..'),native=process.env.KYTY_SOURCE_DIR||path.join(root,'KytyPS5');
  for(const source of Object.values(O.SOURCES)){
    assert.ok(fs.existsSync(path.join(root,'docs',source.lesson)),source.lesson);
    if(fs.existsSync(native))assert.ok(fs.existsSync(path.join(native,source.path)),source.path);
  }
});
console.log(`PASS: ${checks} observatory behavior groups, including all ${Object.keys(cases).length} scenarios.`);
