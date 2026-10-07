// Serve docs/ first. Same browser environment variables as check-visual-tools.cjs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const O=require('../docs/assets/observatory-engine.js');
const base=(process.env.DOCS_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
const output=path.resolve(__dirname,'../_Build/curriculum/browser/observatory');
const report={layouts:[],checks:[],errors:[]};
fs.mkdirSync(output,{recursive:true});
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    const go=async(hash='')=>{await page.goto('about:blank');await page.goto(base+'/run-observatory.html'+hash);await page.waitForFunction(()=>window.RUN_OBSERVATORY&&document.querySelector('.vt-toolbar'));};
    const seek=async kind=>{const n=await page.evaluate(k=>RUN_OBSERVATORY.trace.events.find(e=>e.kind===k).seq,kind);await page.locator('#ro-seek').fill(String(n));};
    const current=()=>page.evaluate(()=>{const x=RUN_OBSERVATORY;return {index:x.index,event:x.trace.events[x.index].kind,frame:x.trace.events[x.index].frame};});
    const check=name=>report.checks.push(name);
    for(const width of [1280,1440,1920])for(const theme of ['dark','light']){
      await page.setViewportSize({width,height:1000});await go();await page.evaluate(t=>localStorage.setItem('kyty.theme',t),theme);await page.reload();await page.waitForFunction(()=>window.RUN_OBSERVATORY&&document.querySelector('.vt-toolbar'));
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      await page.locator('#ro-frame').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      for(const tab of ['cpu','memory','packets','shader','queues','services','compare']){
        await page.locator('#ro-tab-'+tab).click();
        const overflow=await page.locator('#ro-inspect').evaluate(e=>e.scrollWidth-e.clientWidth);
        assert.ok(overflow<=1,`${width} ${theme} ${tab} inspector overflows ${overflow}px`);
        if(width===1440&&['memory','shader','compare'].includes(tab))await page.locator('#ro-inspect').screenshot({path:path.join(output,`${tab}-${theme}.png`)});
      }
      await page.getByRole('button',{name:'Expand workspace',exact:true}).click();
      await page.locator('#ro-tab-memory').click();
      const b=await page.locator('.vt-expanded').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width);
      const sticky=await page.locator('.ro-controls').boundingBox();assert.ok(sticky.y>=0&&sticky.y<150,`Sticky transport y=${sticky.y}`);
      if(width===1440)await page.screenshot({path:path.join(output,`expanded-inspector-${theme}.png`)});
      await page.keyboard.press('Escape');assert.equal(await page.locator('.vt-expanded').count(),0);
      report.layouts.push({width,theme});
    }
    check('Seven inspectors fit three desktop widths in both themes; expanded transport remains accessible');
    await page.setViewportSize({width:1440,height:1000});await go();
    assert.equal((await current()).index,0);await page.locator('#ro-next').click();assert.equal((await current()).index,1);
    await page.locator('#ro-prev').click();assert.equal((await current()).index,0);
    await page.locator('#ro-frame').click();assert.equal((await current()).event,'present.flip');
    const firstHash=await page.evaluate(()=>KYTY_OBSERVATORY.hash(RUN_OBSERVATORY.trace.events[RUN_OBSERVATORY.index].state.image));
    await page.locator('#ro-frame').click();await page.locator('#ro-home').click();await page.locator('#ro-frame').click();
    assert.equal(await page.evaluate(()=>KYTY_OBSERVATORY.hash(RUN_OBSERVATORY.trace.events[RUN_OBSERVATORY.index].state.image)),firstHash);
    await page.locator('#ro-canvas').click({position:{x:100,y:100}});assert.match(await page.locator('#ro-pixel').innerText(),/RGBA \[/);
    const before=await current();await page.locator('#ro-canvas').press('ArrowRight');assert.equal((await current()).index,before.index);
    await seek('gpu.execute');await page.locator('#ro-pending').check();assert.match(await page.locator('#ro-screen-title').innerText(),/Rasterized/);
    await page.locator('#ro-pending').uncheck();assert.match(await page.locator('#ro-screen-title').innerText(),/Waiting/);
    check('Rewind restores pixels; pending and presented images are separate; pixel inspection preserves the cursor');
    await page.locator('#ro-home').click();await page.locator('#ro-speed').selectOption('90');await page.locator('#ro-break').selectOption('gpu.submit');await page.locator('#ro-play').click();
    await page.waitForFunction(()=>document.querySelector('#ro-play-state').textContent.startsWith('Breakpoint:'));
    assert.equal((await current()).event,'gpu.submit');
    await page.locator('#ro-home').click();await page.locator('#ro-break').selectOption('none');await page.locator('#ro-watch').fill('0x00012004');await page.locator('#ro-play').click();
    await page.waitForFunction(()=>document.querySelector('#ro-play-state').textContent.startsWith('Write watchpoint'));
    assert.equal((await current()).event,'cpu.store');await page.locator('#ro-watch').fill('invalid');assert.match(await page.locator('#ro-watch-status').innerText(),/hexadecimal/);await page.locator('#ro-watch').fill('');
    check('Replay pauses at event breakpoints and actual memory write watchpoints');
    await page.locator('[data-write]').first().click();assert.equal(await page.evaluate(()=>RUN_OBSERVATORY.activeTab),'memory');assert.equal(await page.locator('[data-byte]').count(),256);
    assert.equal(await page.locator('[data-byte][tabindex="0"]').count(),1);
    const memoryEvent=(await current()).index;await page.keyboard.press('ArrowDown');assert.equal(await page.locator('[data-byte="20"]').evaluate(e=>e===document.activeElement),true);assert.equal((await current()).index,memoryEvent);
    await page.locator('[data-region=tls]').click();await page.locator('[data-byte="0"]').click();assert.match(await page.locator('#ro-inspect').innerText(),/1.401298e-45/);
    await page.locator('#ro-watch-selected').click();assert.equal(await page.locator('#ro-watch').inputValue(),'0x00016000');await page.locator('#ro-watch').fill('');
    const [memory]=await Promise.all([page.waitForEvent('download'),page.locator('#ro-export-memory').click()]);
    const memoryBytes=fs.readFileSync(await memory.path());assert.equal(memoryBytes.length,256);assert.equal(memoryBytes.readUInt32LE(0),1);
    await page.locator('#ro-tab-cpu').click();const [elf]=await Promise.all([page.waitForEvent('download'),page.locator('#ro-export-elf').click()]);
    assert.equal(fs.readFileSync(await elf.path()).readUInt32BE(0),0x7f454c46);
    check('All bytes are inspectable; float interpretation preserves tiny values; memory and ELF export contain bytes');
    for(const id of Object.keys(O.CASES)){
      await page.locator('#ro-case').selectOption(id);await page.locator('#ro-tab-compare').click();
      if(id!=='healthy')await page.locator('#ro-divergence').click();
      assert.equal(await page.evaluate(()=>RUN_OBSERVATORY.trace.config.scenario),id);
    }
    await page.locator('#ro-frames').selectOption('6');
    assert.match(await page.locator('#ro-inspect').innerText(),/Only capacity changes/);
    assert.equal(await page.evaluate(()=>{const h=id=>KYTY_OBSERVATORY.hash(document.getElementById(id).getContext('2d').getImageData(0,0,128,80).data);return h('ro-good-image')===h('ro-case-image');}),true);
    await page.locator('#ro-capacity').selectOption('3');
    assert.equal(await page.evaluate(()=>RUN_OBSERVATORY.trace.events.at(-1).state.stats.pipelines),3);
    assert.match(await page.locator('#ro-inspect').innerText(),/No differences under these settings/);
    await page.locator('#ro-case').selectOption('stale-upload');await page.locator('#ro-break').selectOption('problem');await page.locator('#ro-play').click();
    await page.waitForFunction(()=>document.querySelector('#ro-play-state').textContent==='Paused at a failed invariant');
    assert.equal((await current()).event,'memory.upload');assert.equal((await current()).frame,2);
    await page.locator('#ro-tab-compare').click();await page.locator('#ro-inspect').screenshot({path:path.join(output,'stale-comparison.png')});
    check('All eight experiments load; capacity changes solve thrashing; stale upload stops before the wrong frame');
    const [replay]=await Promise.all([page.waitForEvent('download'),page.locator('#ro-export').click()]);const replayBytes=fs.readFileSync(await replay.path());
    await page.locator('#ro-case').selectOption('healthy');
    await page.locator('#ro-import-file').setInputFiles({name:'run.json',mimeType:'application/json',buffer:replayBytes});
    await page.waitForFunction(()=>document.querySelector('#ro-file-status').textContent.includes('regenerated and verified'));
    assert.equal(await page.locator('#ro-case').inputValue(),'stale-upload');
    const record=JSON.parse(replayBytes);record.events[0].title='<img src=x onerror="window.BAD_IMPORT=true">';
    await page.locator('#ro-import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record))});
    await page.waitForFunction(()=>document.querySelector('#ro-file-status').textContent.includes('evidence differs'));
    assert.equal(await page.evaluate(()=>window.BAD_IMPORT),undefined);
    await context.grantPermissions(['clipboard-read','clipboard-write']);await seek('gpu.complete');await page.locator('#ro-share').click();
    const link=await page.evaluate(()=>navigator.clipboard.readText());await page.goto('about:blank');await page.goto(link);await page.waitForFunction(()=>window.RUN_OBSERVATORY);
    assert.equal((await current()).event,'gpu.complete');assert.equal(await page.locator('#ro-frames').inputValue(),'6');
    check('Replay downloads round-trip; modified evidence is rejected; view links restore configuration and cursor');
    await page.evaluate(()=>{location.hash='scenario=healthy&frames=3&offset=-10&cacheSize=7&event=5&tab=memory';});
    await page.waitForFunction(()=>RUN_OBSERVATORY.trace.config.frames===3);
    assert.equal(await page.locator('#ro-frames').inputValue(),'3');assert.equal(await page.locator('#ro-capacity').inputValue(),'7');
    await page.locator('#ro-rebuild').click();assert.equal((await current()).index,0);
    await page.locator('#ro-tab-cpu').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>RUN_OBSERVATORY.activeTab),'memory');
    await page.locator('.side-search').pressSequentially('shader');assert.equal(await page.locator('.side-search').inputValue(),'shader');assert.equal((await current()).index,0);
    await page.locator('.side-search').fill('');await page.locator('#ro-filter').fill('no-such-event');assert.match(await page.locator('#ro-events').innerText(),/No events/);await page.locator('#ro-filter').fill('');
    await page.locator('[data-case=early-retire]').click();assert.equal(await page.locator('#ro-case').inputValue(),'early-retire');assert.equal(await page.evaluate(()=>RUN_OBSERVATORY.activeTab),'compare');
    await go('#scenario=invalid&frames=4');assert.match(await page.locator('#ro-file-status').innerText(),/Invalid view link/);
    check('Keyboard tabs, sidebar typing, filtering, mission preparation and invalid links recover correctly');
    assert.deepEqual(report.errors,[]);await context.close();
  }finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  console.log(`PASS: ${report.layouts.length} desktop/theme layouts; ${report.checks.length} observatory interaction groups; no browser exceptions. Screenshots: ${output}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
