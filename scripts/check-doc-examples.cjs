// Exercise the actual data and pure functions shipped by the interactive examples.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const lab = read('docs/assets/lab.js');
const run = code => { const context = {}; vm.runInNewContext(code, context); return context; };
const bands = run(lab.match(/var BANDS = \[[^]*?\n    \];/)[0]).BANDS;
const classify = address => bands.find(b => address >= b.lo && address <= b.hi);
assert.equal(classify(0x1000000000).n, 'user area');
assert.equal(classify(0x080000000000).n, 'extended guest arena');
assert.equal(classify(0x087FFFFFFFFF).n, 'extended guest arena');
assert.notEqual(classify(0x080000000000 - 1)?.k, 'guest');
assert.notEqual(classify(0x088000000000)?.k, 'guest');
assert.equal(classify(0x700000001234).n, 'host high');
const key = run(lab.match(/var FIELDS = \[[^]*?(?=    var cache =)/)[0] +
  lab.match(/function pack\(\) \{[^]*?(?=    function render\(marks\))/)[0]);
const original = JSON.stringify(key.pack());
key.state.stencil = 1;
assert.equal(JSON.stringify(key.pack()), original, 'dynamic stencil must not change the key');
key.state.blend = 1;
assert.notEqual(JSON.stringify(key.pack()), original, 'static blend enable must change the key');
key.state.blend = 0;
key.state.srcblend = 2;
assert.equal(JSON.stringify(key.pack()), original, 'inactive blend factors must not change the key');
const playground = read('docs/assets/playground.js');
const stubs = run(playground.match(/var JIT_STUBS = \{[^]*?\n  \};/)[0]).JIT_STUBS;
assert.deepEqual(Object.keys(stubs), ['call9', 'tls'], 'only current relative-call examples');
assert.equal(stubs.call9.opByte, 2);
assert.equal(stubs.call9.ripByte, 6);
assert.equal(stubs.call9.total, 9);
assert.equal(stubs.tls.opByte, 9);
assert.equal(stubs.tls.ripByte, 13);
assert.equal(stubs.tls.total, 32);
for (const f of ['docs/course.html', 'docs/tour.html', 'docs/assets/figures.js']) {
  const map = run(read(f).match(/var BANDS\s*=\s*\[[^]*?\n\s*\];/)[0]).BANDS;
  assert.equal(map.length, 5, f);
  assert.equal(map[3].n, 'Extended guest', f);
}
// Execute the simulator's real compile transitions with a tiny host fixture.
const simulation = read('docs/assets/advanced-emulator.js');
const context = {Emu: function () {}, hashOf: k => k, shaderArtifacts: () => ({}),
  permName: k => String(k), hex: k => String(k), SH: ['decode', 'IR', 'SPIR-V', 'module', 'pipeline']};
vm.runInNewContext(simulation.slice(simulation.indexOf('Emu.prototype.startCompile ='),
  simulation.indexOf('Emu.prototype.finishSubmit =')), context);
const emulator = new context.Emu();
let commits = 0;
Object.assign(emulator, {diskEnabled: true, disk: {7: 1}, diskBytes: 8192, compMs: 100,
  shaders: {stage: -1, commit: () => commits++}, log() {}, vklog() {}, draw() {}});
emulator.startCompile(7, 'fixture', false);
assert.equal(emulator.shaders.stage, 0, 'a disk hit must still start shader translation');
assert.equal(emulator.compileAnim.diskHit, true);
for (let i = 0; i < 4; i++) emulator.advanceCompile(100, false);
assert.equal(commits, 0, 'disk driver data must not skip the compiler phases');
emulator.advanceCompile(50, false);
assert.equal(commits, 1);
assert.equal(emulator.compileAnim, null);
// Guard the new main features against accidental replacement by the older branch.
for (const file of ['loadlink.html', 'guest-run.html', 'host-run.html', 't-pointers-memory.html']) {
  assert.match(read('docs/'+file), /class="notranslate" translate="no"/);
}
assert.equal(fs.existsSync(path.join(root, 'docs/upstream-changes.html')), false,
  'main intentionally removed the standalone changelog');
assert.match(read('docs/assets/topics.js'), /n: "C10"/);
console.log('PASS: memory boundaries, pipeline keys, JIT examples, memory maps, simulator disk-cache behavior and retained main features.');
