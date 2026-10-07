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
if (!rt.includes('Implemented software intersections; further coverage needs evidence')) errors.push('Missing RT implementation-status boundary');
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
  'tests/ShaderRecompilerComputeTests.cpp': ['Vop3Min3U16CapturedAndSelectors', 'BufferLoadFormatD16XCases', 'BufferStoreFormatD16XCases', '--buffer-format-store-only', '--integer64-compare-only', '--med3-i16-only'],
  'src/launcher/src/trophyViewerDialog.cpp': ['ShowTrophyInspector', 'Show Hidden Trophy'],
  'src/graphics/presentation/systemOverlay.cpp': ['WrapTrophyTitle'],
  'src/graphics/presentation/window/window.cpp': ['title_interval_ms = 1000', 'UpdateTitle(uint64_t frame_num, double current_fps)', 'HostInputWaitEvent(&loop.event, wait_ms)'],
  'src/graphics/presentation/window/swapchain.cpp': ['presented_frames.fetch_add(1, std::memory_order_relaxed)'],
  'src/graphics/shader/recompiler/frontend/translate/Compare.cpp': ['V_CMPX_EQ_I64', 'std::bit_cast<int32_t>(operand.value)'],
  'src/graphics/shader/recompiler/frontend/translate/Vector.cpp': ['Integer16Ternary(inst, IR::ValueOpcode::UMinTri32, false)'],
  'src/graphics/host_gpu/renderer/depthRenderTarget.cpp': ['copy_depth_to_color', 'unsupported depth register state'],
  'src/libs/agc.cpp': ['AgcDcbSetShRegistersIndirectGetSize', 'return 5u * sizeof(uint32_t)'],
  'src/libs/libKernel.cpp': ['KernelAioWaitRequests', 'KERNEL_AIO_WAIT_OR', 'kernel_aio_get_state', 'lgK+oIWkJyA'],
  'src/libs/libSystemService.cpp': ['SystemServiceGetNoticeScreenSkipFlag(bool* value)', '*value = Config::SkipNoticeScreen()'],
  'src/main.cpp': ['--skip-notice-screen'],
  'src/common/emulatorConfig.h': ['skip_notice_screen          = false'],
  'src/emulator.cpp': ['LoadElf', 'WindowRun', 'Libs::InitAll'],
  'src/loader/runtimeLinker.cpp': ['RuntimeLinker::LoadProgram', 'RuntimeLinker::LoadProgramToMemory', 'RuntimeLinker::RelocateAll', 'RuntimeLinker::StartModule', 'RuntimeLinker::GetEntry', 'RunEntry'],
  'src/graphics/guest_gpu/graphicsRun.cpp': ['GuestGpu::Submit', 'GuestGpu::Process', 'CommandProcessor::DrawIndexAuto', 'CommandProcessor::BufferFlush'],
  'src/graphics/guest_gpu/command_processor/pm4Handlers.cpp': ['CpOpDrawIndexAuto', '0xc0012d00'],
  'src/graphics/host_gpu/renderer/renderDraw.cpp': ['RenderExecutor::DrawAuto', 'PrepareDrawRenderState', 'ExecutePreparedDraw', 'EmitDrawPrimitives'],
  'src/graphics/host_gpu/renderer/pipeline/descriptors.cpp': ['PrepareBindings', 'PrepareGraphicsBindings', 'CommitBindings'],
  'src/graphics/host_gpu/renderer/commandScheduler.cpp': ['CommandScheduler::Submit', 'CommandScheduler::DeferOperation', 'PopPendingOperations'],
  'src/graphics/host_gpu/renderer/masterSemaphore.h': ['KnownGpuTick', 'IsFree'],
  'src/common/alignment.h': ['AlignUp', 'AlignDown'],
  'src/graphics/host_gpu/regionDefinitions.h': ['TRACKER_PAGE_SIZE    = 4ull * 1024ull'],
  'src/graphics/host_gpu/renderer/pipeline/pipelineCache.h': ['sizeof(PipelineStaticParameters) == 116'],
  'src/libs/libAgcDriver.cpp': ['b4fpgH5ZXxQ', 'Gen5Driver::AgcDriverSubmitCommandBuffer', 'nNlUtdDDvZ0'],
  'src/graphics/shader/recompiler/frontend/decode/VectorAluOps.cpp': ['{0x03u, Opcode::V_ADD_F32', '{0x04u, Opcode::V_CMP_GT_F32', '{0x08u, Opcode::V_MUL_F32', '{0x353u, Opcode::V_MIN3_U16', 'ApplyNativeVop3B16TernarySelectors', 'V_CMPX_EQ_I64'],
  'src/graphics/shader/recompiler/frontend/decode/ScalarAluOps.cpp': ['{0x24u, Opcode::S_AND_SAVEEXEC_B64'],
  'src/graphics/shader/recompiler/frontend/decode/MemoryOps.cpp': ['{0x0cu, Opcode::BUFFER_LOAD_DWORD', '{0x80u, Opcode::BUFFER_LOAD_FORMAT_D16_X', '{0x84u, Opcode::BUFFER_STORE_FORMAT_D16_X'],
  'src/common/lruCache.h': ['LeastRecentlyUsedCache', 'ForEachItemBelow'],
  'src/graphics/shader/recompiler/frontend/decode/ImageOps.cpp': ['DecodeMimg', 'nsa_dwords', 'IMAGE_BVH_INTERSECT_RAY', '0xe6', '0xe7'],
  'src/graphics/shader/recompiler/frontend/translate/Memory.cpp': ['IR::ValueOpcode::BvhIntersect', 'ir.GetExec()', 'inst.image_address_components - 10u'],
  'src/graphics/shader/recompiler/ShaderRecompiler.cpp': ['ConstantPropagationPass(ir.blocks, ir.wave_size)', 'ir.value_storage.clear()', 'options.input_info.compute->lds_storage'],
  'src/graphics/shader/recompiler/backend/spirv/spirvEmitterBvh.cpp': ['DefineBvhIntersect', 'EmitBvhIntersect', 'GetBdaPointer'],
  'src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp': ['TryReadBufferBacking', 'runtime.workgroup_counts', 'maxComputeSharedMemorySize'],
  'src/graphics/host_gpu/renderer/renderCompute.cpp': ['BindSharedMemory', 'maxStorageBufferRange', 'DISPATCH_INITIATOR_USE_THREAD_DIMENSIONS'],
  'src/graphics/shader/shader.cpp': ['ShaderMapUserData', 'XXH3_64bits', 'data.code_size_bytes'],
  'src/graphics/shader/recompiler/ir/ShaderIR.h': ['DescriptorBindingKind::Samplers) == 49u', 'DescriptorBindingKind::Count) == 56u', 'SharedMemory'],
  'src/graphics/host_gpu/pageManager.h': ['template <bool track>', 'UpdatePageWatchersForRegion'],
  'src/graphics/guest_gpu/tile.h': ['TileSurfaceDescription', 'TileSurfaceLayout', 'TileGetTiledTextureLayout'],
  'src/loader/guestInstructionPatcher.h': ['GuestInstructionPatchResult', 'InstructionPatchCounts', 'PatchGuestInstructions'],
  'tests/ShaderRayTracingTests.inc': ['0xf1989f01u', '0xf19c9f01u', '0xf1989f07u'],
  'tests/ShaderRayTracingGpuTests.inc': ['Bvh', 'Triangle'],
  'tests/LruCacheTests.cpp': ['TestTouchReordersAndSkips'],
  'tests/VirtualMemoryAllocationTests.cpp': ['TestSparseBackingReadPreservesResidency', 'TestSparseReadDuringDirectCommit'],
  'tests/KernelFileSystemTests.cpp': ['CheckAprPaths', 'TestAioBatches', 'wait_batch']
};
const hasSource = fs.existsSync(path.join(root, 'KytyPS5/src'));
if (hasSource) {
  const cmake = read('KytyPS5/CMakeLists.txt');
  const portableTargets = cmake.match(/add_custom_target\(kyty_tests DEPENDS([^]*?)\)/)?.[1].trim().split(/\s+/);
  if (portableTargets?.length !== 29) errors.push('Portable test-target count changed; review the build/test lessons.');
  const {execFileSync} = require('node:child_process');
  const reviewedRevision = 'd2413fc2ebd91d1b7234197c2dd5bd48e1cb6a51';
  const head = execFileSync('git', ['-C', path.join(root, 'KytyPS5'), 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (head !== reviewedRevision) errors.push('KytyPS5 HEAD differs from the reviewed revision; review docs before updating the snapshot.');
  for (const [file, symbols] of Object.entries(anchors)) {
    const target = path.join(root, 'KytyPS5', file);
    if (!fs.existsSync(target)) { errors.push('Missing source: '+file); continue; }
    const source = fs.readFileSync(target, 'utf8');
    for (const symbol of symbols) if (!source.includes(symbol)) errors.push(file+': missing '+symbol);
  }
} else console.log('SKIP: source-anchor checks (optional KytyPS5 checkout absent).');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('PASS: D1–D4 and C11 navigation, lab artifacts, behavioral gates'+(hasSource ? ' and source anchors.' : '.'));
