// Read-only structural/source-anchor checks. These are not semantic proofs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const pages = ['developer-curriculum.html', 't-trace-boot.html', 't-trace-draw.html', 't-debugging-labs.html'];
const context = {window: {}};
vm.runInNewContext(read('docs/assets/topics.js'), context);
for (const [i, file] of pages.entries()) {
  const item = context.window.KYTY_TOPICS.find(t => t.file === file);
  if (!item || item.n !== 'D'+(i+1) || !item.ready) errors.push('Missing D-topic: '+file);
  if (!read('docs/'+file).includes('class="notranslate" translate="no"')) errors.push('Translation marker missing: '+file);
}
const rtTopic = context.window.KYTY_TOPICS.find(t => t.file === 't-ray-tracing.html');
if (!rtTopic || rtTopic.n !== 'C11' || !rtTopic.ready) errors.push('Missing C11 ray-tracing appendix');
const rt = read('docs/t-ray-tracing.html');
for (const id of ['current-state', 'rdna-contract', 'encoding', 'cpu-re', 'shader-re', 'bvh-re',
  'oracle', 'compiler', 'resources', 'vulkan', 'synchronization', 'cache', 'testing', 'milestones', 'limits']) {
  if (!rt.includes('id="'+id+'"')) errors.push('Missing ray-tracing section: '+id);
}
if (!rt.includes('This is a development roadmap, not implemented support')) errors.push('Missing RT implementation-status warning');
if (!rt.includes('href="labs/raytracing-reference.cjs"')) errors.push('Missing RT fixture link');
if (!read('docs/developer-curriculum.html').includes('href="t-ray-tracing.html"')) errors.push('RT coverage map is stale');
for (const file of ['docs/index.html', 'docs/path.html', 'docs/t-first-change.html']) {
  if (!read(file).includes('href="developer-curriculum.html"')) errors.push('Missing curriculum entry: '+file);
}
for (const file of ['docs/course.html', 'docs/t-first-change.html']) {
  const text = read(file);
  if (/Crude but effective|whatever the game expects to proceed|Try alternative plausible values/.test(text))
    errors.push('Unsafe contribution shortcut remains: '+file);
  if (!text.includes('Step 5 — prove the guest-visible contract')) errors.push('Missing behavioral gate: '+file);
}
for (const file of ['CMakeLists.txt', 'developer_labs.cpp', 'expect_failure.cmake', 'README.md']) {
  if (!fs.existsSync(path.join(root, 'docs/labs', file))) errors.push('Missing lab artifact: '+file);
}
const anchors = {
  'src/emulator.cpp': ['LoadElf', 'WindowRun', 'Libs::InitAll'],
  'src/loader/runtimeLinker.cpp': ['RuntimeLinker::LoadProgram', 'RuntimeLinker::LoadProgramToMemory', 'RuntimeLinker::RelocateAll', 'RuntimeLinker::StartModule', 'RuntimeLinker::GetEntry', 'RunEntry'],
  'src/graphics/guest_gpu/graphicsRun.cpp': ['GuestGpu::Submit', 'GuestGpu::Process', 'CommandProcessor::DrawIndexAuto', 'CommandProcessor::BufferFlush'],
  'src/graphics/guest_gpu/command_processor/pm4Handlers.cpp': ['CpOpDrawIndexAuto', '0xc0012d00'],
  'src/graphics/host_gpu/renderer/renderDraw.cpp': ['RenderExecutor::DrawAuto', 'PrepareDrawRenderState', 'ExecutePreparedDraw', 'EmitDrawPrimitives'],
  'src/graphics/host_gpu/renderer/pipeline/descriptors.cpp': ['PrepareBindings', 'PrepareGraphicsBindings', 'CommitBindings'],
  'src/graphics/host_gpu/renderer/commandScheduler.cpp': ['CommandScheduler::Submit', 'CommandScheduler::DeferOperation', 'PopPendingOperations'],
  'src/graphics/host_gpu/renderer/masterSemaphore.h': ['KnownGpuTick', 'IsFree'],
  'src/common/alignment.h': ['AlignUp', 'AlignDown'],
  'src/common/lruCache.h': ['LeastRecentlyUsedCache', 'ForEachItemBelow'],
  'src/graphics/shader/recompiler/frontend/decode/ShaderDecoder.cpp': ['program.has_bvh = true', '0xe6u', '0xe7u'],
  'src/graphics/shader/recompiler/frontend/decode/ImageOps.cpp': ['DecodeMimg', 'nsa_dwords', 'word_count'],
  'src/graphics/shader/recompiler/ShaderRecompiler.cpp': ['decoded.has_bvh', 'return {.skip_dispatch = true}'],
  'src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp': ['entry->second.skip_dispatch = true'],
  'src/graphics/host_gpu/renderer/renderCompute.cpp': ['if (!compute_program)'],
  'tests/ShaderRayTracingTests.inc': ['TestRayTracingDispatchDetection', '0xf1989f01u', '0xf19c9f01u', '0xf1989f07u'],
  'tests/LruCacheTests.cpp': ['TestTouchReordersAndSkips'],
  'tests/VirtualMemoryAllocationTests.cpp': ['TestSparseBackingReadPreservesResidency', 'TestSparseReadDuringDirectCommit'],
  'tests/KernelFileSystemTests.cpp': ['CheckAprPaths']
};
const hasSource = fs.existsSync(path.join(root, 'KytyPS5/src'));
if (hasSource) {
  for (const [file, symbols] of Object.entries(anchors)) {
    const target = path.join(root, 'KytyPS5', file);
    if (!fs.existsSync(target)) { errors.push('Missing source: '+file); continue; }
    const source = fs.readFileSync(target, 'utf8');
    for (const symbol of symbols) if (!source.includes(symbol)) errors.push(file+': missing '+symbol);
  }
} else console.log('SKIP: source-anchor checks (optional KytyPS5 checkout absent).');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('PASS: D1–D4 and C11 navigation, lab artifacts, behavioral gates'+(hasSource ? ' and source anchors.' : '.'));
