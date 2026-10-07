// Content contracts: route order, complete runnable listings, answer feedback,
// and synchronized golden outputs. Native execution is verified separately by CTest.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('docs/content/learning.json'));
const topics = new Map(manifest.topics.filter(t => t.id).map(t => [t.id, t]));
const core = manifest.routes.core;
assert.deepEqual(core.slice(0, 6), ['start', 'beginner-cpp', 'beginner-bytes',
  'beginner-memory', 'beginner-machine', 'beginner-completion']);
assert.equal(core.at(-1), 'first-change', 'The first contribution concludes the core route');
assert.ok(core.indexOf('cpp-build') < core.indexOf('mapping'), 'Build/orientation must precede source walkthroughs');
assert.deepEqual(manifest.topics.filter(t => core.includes(t.id)).map(t => t.id), core,
  'Sidebar and pager must teach the same sequence');
const boundaries = [
  ['cpp-codebase', 'cpp-language'], ['cpp-language', 'cpp-build'],
  ['address-space', 'pointers-memory'], ['pointers-memory', 'elf-and-self'],
  ['nids', 'cpp-asm'], ['cpp-asm', 'patching'], ['hle', 'cpp-system'], ['cpp-system', 'trace-boot'],
  ['trace-boot', 'gpu-basics'], ['vulkan', 'program-cache'], ['program-cache', 'coherency'],
  ['coherency', 'cpp-concurrency'], ['cpp-concurrency', 'trace-draw'],
  ['trace-draw', 'cpp-performance'], ['cpp-performance', 'developer-curriculum'],
  ['debugging', 'reading-a-run'], ['reading-a-run', 'cpp-diagnosis'],
  ['cpp-diagnosis', 'debugging-labs'], ['debugging-labs', 'first-change']
];
const integrated = ['cpp-language', 'pointers-memory', 'cpp-asm', 'cpp-system',
  'program-cache', 'cpp-concurrency', 'cpp-performance', 'cpp-diagnosis'];
for (const id of integrated) {
  assert.ok(core.includes(id), id + ': belongs in the main learning sequence');
  assert.equal(topics.get(id).level, 'project', id + ': project lesson, not a detached appendix');
}
assert.ok(!manifest.topics.some(t => t.part === 'C++ and subsystem reference'), 'Removed reference bucket must not return');
for (const [from, to] of boundaries) assert.equal(core[core.indexOf(from) + 1], to,
  `${from}: the next lesson should consolidate this stage or prepare the next task`);
assert.ok(topics.get('trace-boot').prerequisites.includes('threads'), 'Boot needs threads/TLS');
assert.ok(topics.get('trace-draw').prerequisites.includes('coherency'), 'Draw needs coherency');
const generated = {window: {}};
vm.runInNewContext(read('docs/assets/topics.js'), generated);
for (const [index, id] of core.entries()) {
  const topic = generated.window.KYTY_TOPICS.find(t => t.id === id);
  if (id === 'start') continue;
  assert.equal(topic.step, String(index).padStart(2, '0'), id + ': continuous display numbering');
  assert.ok(read('docs/' + topic.file).includes('Step ' + topic.step + ' · '), id + ': page label agrees with navigation');
}
for (const [index, id] of core.entries()) {
  assert.ok(read('docs/' + topics.get(id).file).includes('class="check-item"'), id + ': core progress needs a checkpoint');
  for (const pre of topics.get(id).prerequisites || []) {
    assert.ok(core.indexOf(pre) >= 0 && core.indexOf(pre) < index,
      `${id}: prerequisite ${pre} must precede it on the core route`);
  }
}
// Exercise the production route/progress/pager code with a minimal DOM boundary.
// This checks first/last lessons, optional references and saved completion IDs.
const app = read('docs/assets/app.js');
function element(tag, className, textContent) {
  return {tag, className, textContent, children: [],
    appendChild(child) { this.children.push(child); }, setAttribute() {}};
}
let current = topics.get('start');
let completion = {};
const ui = {window: {KYTY_ROUTES: manifest.routes}, LIST: [...topics.values()],
  currentTopic: () => current, done: () => completion, el: element, esc: s => s};
const extract = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
vm.runInNewContext(extract('  function coreTopics()', '  function currentFile()') +
  extract('  function progress()', '  /* ---------------- sidebar') +
  extract('  function addPager(holder)', '  /* ---------------- checkpoints'), ui);
let holder = element('main');
ui.addPager(holder);
assert.equal(holder.children[0].children.length, 1, 'first page has no previous step');
assert.equal(holder.children[0].children[0].href, 'b-first-program.html');
current = topics.get('beginner-completion'); holder = element('main'); ui.addPager(holder);
assert.equal(holder.children[0].children[1].href, 't-what-an-emulator-is.html');
for (const [from, to] of boundaries) {
  current = topics.get(from); holder = element('main'); ui.addPager(holder);
  assert.equal(holder.children[0].children.at(-1).href, topics.get(to).file, from + ': rendered next link');
}
current = topics.get(core.at(-1)); holder = element('main'); ui.addPager(holder);
assert.equal(holder.children[0].children.length, 1, 'last core page must not lead into an optional appendix');
current = topics.get('ray-tracing'); holder = element('main'); ui.addPager(holder);
assert.equal(holder.children[0].children[0].href, 'start.html');
completion = {'beginner-cpp': true, 'what-an-emulator-is': true, 'ray-tracing': true, removed: true};
assert.equal(ui.progress().done, 2, 'optional and stale IDs do not inflate core progress');
completion['cpp-language'] = true;
completion['program-cache'] = true;
assert.equal(ui.progress().done, 4, 'Saved completion of newly integrated lessons remains counted');
assert.equal(ui.progress().total, core.length);
completion = Object.fromEntries(core.map(id => [id, true]));
assert.equal(ui.progress().pct, 100);
const lessons = [
  ['b-first-program.html', 'first_program'], ['b-bytes.html', 'bytes'],
  ['b-memory.html', 'ownership'], ['b-machine.html', 'machine'],
  ['b-completion.html', 'completion'], ['t-cpp-language.html', 'cpp_idioms']
];
for (const [page, fixture] of lessons) {
  const text = read('docs/' + page);
  assert.ok(text.includes(`<!-- code:labs/beginner/${fixture}.cpp -->`), page + ': complete source listing');
  assert.ok(text.includes(`<!-- output:labs/beginner/${fixture}.txt -->`), page + ': generated expected output');
  assert.ok(text.includes(`--target ${fixture}`), page + ': build command');
  assert.ok(text.includes(`^beginner_${fixture}$`), page + ': focused verification command');
  assert.match(text, /<details><summary>[^<]*(?:answer|rubric)/i, page + ': worked feedback');
  assert.ok(read('docs/labs/beginner/' + fixture + '.cpp').includes('int main()'), fixture + ': standalone program');
}
assert.ok(!read('docs/labs/beginner/CMakeLists.txt').includes('KYTY_SOURCE_DIR'), 'Beginner build must remain independent of emulator source');
for (const file of fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.html'))) {
  const text = read('docs/' + file);
  assert.ok(!/every resource has exactly one owner|Every allocation has exactly one owner|Planned support, not an implemented feature|planned work, not existing RT support/.test(text), file + ': retired misleading claim');
}
console.log('PASS: beginner route/progress/pager behavior, complete examples, build commands, worked answers and claim regressions.');
