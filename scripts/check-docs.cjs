// Read-only checks for the static learning site and its optional KytyPS5 checkout.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(path.join(root, 'docs')).filter(f => /\.(html|js)$/.test(f) && !f.endsWith('.min.js'));
const errors = [];
const ids = new Map();
const read = f => fs.readFileSync(f, 'utf8');
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const label = f => path.relative(root, f).replaceAll('\\', '/');
for (const f of files.filter(f => f.endsWith('.html'))) {
  const found = [...read(f).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(found).size !== found.length) errors.push(`${label(f)}: duplicate HTML id`);
  ids.set(f, new Set(found));
}
for (const f of files) {
  const text = read(f);
  if (f.endsWith('.js')) {
    try { new vm.Script(text, {filename: f}); } catch (e) { errors.push(e.message); }
  } else {
    for (const m of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const ref = decode(m[1]);
      if (/^(?:[a-z]+:|\/\/)/i.test(ref)) continue;
      const [url, fragment] = ref.split('#');
      const target = url ? path.resolve(path.dirname(f), url.split('?')[0]) : f;
      if (!fs.existsSync(target)) errors.push(`${label(f)}: missing asset/link ${ref}`);
      else if (fragment && ids.has(target) && !ids.get(target).has(decodeURIComponent(fragment)))
        errors.push(`${label(f)}: missing fragment ${ref}`);
    }
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc=|application\/ld\+json/i.test(m[1])) continue;
      try { new vm.Script(m[2], {filename: f}); } catch (e) { errors.push(`${label(f)}: ${e.message}`); }
    }
    const clean = text.replace(/<!--[^]*?-->|<script\b[^]*?<\/script>|<style\b[^]*?<\/style>/gi, '');
    for (const tag of ['html','head','body','main','section','div','pre','table','thead','tbody','tr','ul','ol']) {
      const open = [...clean.matchAll(new RegExp('<'+tag+'(?:\\s|>)', 'gi'))].length;
      const close = [...clean.matchAll(new RegExp('</'+tag+'>', 'gi'))].length;
      if (open !== close) errors.push(`${label(f)}: unbalanced ${tag} (${open}/${close})`);
    }
  }
}
if (fs.existsSync(path.join(root, 'KytyPS5/src'))) {
  const sourceFiles = walk(path.join(root, 'KytyPS5/src')).concat(walk(path.join(root, 'KytyPS5/tests')));
  const sources = sourceFiles.map(f => path.relative(path.join(root, 'KytyPS5'), f).replaceAll('\\', '/'));
  for (const f of [...files, path.join(root, 'README.md')]) {
    const text = read(f);
    for (const m of text.matchAll(/(?<![\w/])((?:src|tests)\/[\w./-]+\.(?:cpp|h|inc|cmake))/g)) {
      if (!sources.includes(m[1])) errors.push(`${label(f)}: missing source ${m[1]}`);
    }
    for (const m of text.matchAll(/(?:…\/|\.\.\.\/)([\w./-]+\.(?:cpp|h|inc))/g)) {
      if (!sources.some(s => s.endsWith('/'+m[1]))) errors.push(`${label(f)}: missing abbreviated source ${m[1]}`);
    }
  }
}
const context = {window: {}};
vm.runInNewContext(read(path.join(root, 'docs/assets/topics.js')), context);
vm.runInNewContext(read(path.join(root, 'docs/assets/search-index.js')), context);
for (const item of context.window.KYTY_TOPICS || []) {
  if (item.ready && !fs.existsSync(path.join(root, 'docs', item.file))) errors.push(`topic missing: ${item.file}`);
}
for (const value of Object.values(context.window)) {
  if (!Array.isArray(value)) continue;
  for (const item of value) {
    if (!item.f || !item.a) continue;
    const target = path.join(root, 'docs', item.f);
    if (!ids.get(target)?.has(item.a)) errors.push(`search index: ${item.f}#${item.a}`);
  }
}
const unique = [...new Set(errors)];
if (unique.length) { console.error(unique.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${ids.size} HTML pages; local links/assets, anchors, HTML structure, JavaScript, navigation, search and source paths.`);
