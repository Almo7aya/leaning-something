// Optional desktop browser regressions. See docs/content/README.md for setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.DOCS_URL || 'http://127.0.0.1:8765').replace(/\/$/,'');
const output = path.resolve(__dirname,'../_Build/curriculum/browser/visual-tools');
const names = ['playground','lifetime','loadlink','guest-run','host-run','system-explorer','machine','browser-emulator','advanced-emulator'];
const report = {layouts:[],checks:[],errors:[]};
fs.mkdirSync(output,{recursive:true});
async function main() {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page = await context.newPage();
    page.on('pageerror',error=>report.errors.push({url:page.url(),message:error.message}));
    const go=async name=>{await page.goto(base+'/'+name+'.html');await page.waitForSelector('[data-visual-workspace]>.vt-toolbar');};
    const text=id=>page.locator('#'+id).innerText();
    const check=(name)=>report.checks.push(name);
    for(const width of [1280,1440,1920])for(const theme of ['dark','light']) {
      await page.setViewportSize({width,height:1000});
      await page.addInitScript(t=>localStorage.setItem('kyty.theme',t),theme);
      for(const name of names){
        await go(name);
        assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
        const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
        assert.ok(scrollWidth<=width+1,`${name} ${theme} ${width}: page overflows to ${scrollWidth}`);
        const bar=page.locator('.vt-toolbar').first();
        const contrast=await bar.evaluate(e=>{
          const l=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
          const s=getComputedStyle(e),a=l(s.color),b=l(s.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
        });
        assert.ok(contrast>=4.5,`${name} ${theme}: toolbar contrast ${contrast}`);
        await bar.getByRole('button',{name:'Expand workspace',exact:true}).click();
        const expanded=page.locator('.vt-expanded');
        assert.equal(await expanded.count(),1);
        const bounds=await expanded.boundingBox();
        assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,`${name}: expanded workspace exceeds viewport`);
        if(width===1440){
          if(name==='browser-emulator')await page.waitForFunction(()=>BROWSER_EMULATOR.emulator.booted);
          if(name==='advanced-emulator')await page.waitForSelector('#ax-boot.is-off',{state:'attached'});
          assert.ok(await expanded.evaluate(e=>e.scrollTop)<2,`${name}: workspace scrolled itself during boot`);
          await page.screenshot({path:path.join(output,`${name}-${theme}-expanded.png`)});
        }
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.vt-expanded').count(),0);
        assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
        report.layouts.push({name,width,theme,scrollWidth});
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    for(const name of ['lifetime','loadlink','guest-run','host-run']) {
      await go(name);
      const marks=page.locator(name==='lifetime'?'.lt-tick':'.fd-mark');
      for(let i=0;i<await marks.count();i++)await marks.nth(i).click();
      await page.locator('[data-vt-action]').click();
      assert.match(await page.locator('.vt-guide [role=status]').innerText(),/prepared/);
      if(name!=='lifetime'){
        await page.getByLabel('Diagram zoom').selectOption('200');
        assert.equal(await page.locator('.fd-svg').evaluate(e=>e.style.width),'200%');
        const node=page.locator('.fd-node').last();await node.focus();await page.keyboard.press('Enter');
        assert.match(await page.locator('.fd-pos').innerText(),/\d+ \/ \d+/);
      }
      check(name+' all stages, prepared exercise and diagram controls');
    }
    await go('playground');
    await page.locator('#ly-preset').selectOption('natural');
    assert.match(await text('ly-out'),/no padding is needed/);
    await page.locator('#ly-expect').fill('16');assert.match(await text('ly-assert'),/PASS/);
    await page.locator('#ly-expect').focus();await page.keyboard.press('Control+A');await page.keyboard.type('24');assert.equal(await page.locator('#ly-expect').inputValue(),'24');assert.match(await text('ly-assert'),/FAIL/);
    for(const action of await page.locator('[data-vt-action]').all()){
      await action.click();assert.match(await action.locator('..').locator('[role=status]').innerText(),/prepared/);
    }
    for(const id of ['elf-demo','log-demo','jit-demo-f','jit-demo-b','jit-demo-far','crash-demo','isa-demo','shl-demo-isa','shl-demo-spv','shl-demo-words','dc-demo-v','dc-demo-t'])await page.locator('#'+id).click();
    check('All Playground demos and prepared exercises');
    assert.equal(await page.locator('#ly-preset').inputValue(),'trap');
    await page.locator('#ly-pack').check();assert.equal(await page.locator('#ly-out .pg-table tr').nth(2).locator('td').nth(3).innerText(),'1');
    while(await page.locator('#ly-members .pg-btn').count())await page.locator('#ly-members .pg-btn').first().click();
    assert.equal(await page.locator('#ly-out .pg-stat-n').first().innerText(),'1');
    await page.locator('[data-vt-action=layout]').click();
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    const firstTool=page.locator('[data-visual-workspace]').first();
    await firstTool.getByRole('button',{name:'Copy result',exact:true}).click();
    assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),await text('pm4-out'));
    await page.locator('[data-vt-action=pm4]').click();assert.match(await text('pm4-out'),/1 packet/);
    await page.locator('#pm4-in').fill('C0012D00 rubbish 3 2');assert.match(await text('pm4-out'),/expected a 32-bit hex word/);
    await page.locator('[data-vt-action=isa]').click();assert.match(await text('isa-out'),/s_endpgm/);
    assert.equal(await page.locator('#isa-out [data-k]').count(),2);
    await page.locator('#id-str').fill('BAAA');assert.match(await text('id-out'),/one to three/);
    await page.locator('#id-num').fill('65536');assert.match(await text('id-out'),/65535/);
    await page.locator('#jit-rip').fill('0020000000000000');await page.locator('#jit-func').fill('0020000000000001');assert.match(await text('jit-out'),/01 00 00 00/);
    await page.locator('#dc-demo-v').click();assert.match(await text('dc-out'),/000180000000/);assert.match(await text('dc-out'),/9,?600/);
    await page.locator('#dc-demo-t').click();assert.match(await text('dc-out'),/W2/);
    const binary=words=>{const b=Buffer.alloc(words.length*4);words.forEach((w,i)=>b.writeUInt32LE(w,i*4));return b;};
    const upload=async(id,name,buffer,expected)=>{
      await page.locator('#'+id+'-file').setInputFiles({name,mimeType:'application/octet-stream',buffer});
      await page.waitForFunction(({id,source})=>new RegExp(source).test(document.querySelector('#'+id+'-out').innerText),{id,source:expected.source});
    };
    await upload('shl','two.spv',binary([0x07230203,0x10000,0,1,0,0x20011,1,0x3000e,0,1]),/2 instructions/);
    await upload('shl','truncated.spv',Buffer.from([3,2,35,7,0]),/truncated/);
    await upload('shl','literal.bin',binary([0xbe8003ff,0x3f800000,0xbf810000]),/2 encoding record/);
    await upload('shl','decoded.log',Buffer.from('shader decoded RDNA2 (early):\n0x00000000: S_MOV_B32 s0, 0\n0x00000004: s_endpgm'),/s_mov_b32/);
    assert.equal(await page.locator('#shl-out .pg-stat-n').first().innerText(),'2');
    const elf=Buffer.alloc(64);elf.writeUInt32BE(0x7f454c46);elf[4]=2;elf[5]=1;elf[6]=1;elf.writeUInt32LE(1,20);elf.writeBigUInt64LE(64n,32);elf.writeUInt16LE(64,52);elf.writeUInt16LE(56,54);elf.writeUInt16LE(3,56);
    await upload('elf','short.elf',elf,/Program-header table/);
    await page.locator('#elf-demo').click();assert.doesNotMatch(await text('elf-out'),/Could not parse/);
    await page.locator('[data-vt-action=log]').click();assert.match(await text('log-out'),/settings.json/);
    await page.locator('#log-ta').fill('');assert.doesNotMatch(await text('log-out'),/settings.json/);
    await page.locator('#crash-paste').click();await page.locator('#crash-ta').fill('--- Guest fault context ---\n--- Guest fault context ---');assert.match(await text('crash-out'),/Multiple crash/);
    await page.locator('#crash-ta').fill('');assert.match(await text('crash-out'),/No crash-log/);
    check('PM4 annotations, ID bounds, shader literals, exact addresses, descriptors, binary file inputs and error recovery');
    await go('system-explorer');await page.locator('[data-vt-action]').click();assert.equal(await page.evaluate(()=>SYSTEM_EXPLORER.simulation.running),false);
    for(const tab of ['overview','memory','graphics','services']){await page.locator('#mc-tab-'+tab).click();assert.ok(await page.locator('#mc-panel-'+tab).isVisible());}
    for(const preset of await page.locator('#mc-presets button').all()){await preset.click();for(let i=0;i<25;i++)await page.locator('#mc-step').click();}
    check('System explorer presets, paused preparation and all inspectors');
    await go('machine');assert.equal(await page.evaluate(()=>MACHINE.P.paused),true);
    for(const preset of ['smooth','thrash','uploads','serial']){await page.locator('[data-preset='+preset+']').click();for(let i=0;i<12;i++)await page.locator('#mc-step').click();}
    await page.locator('#mc-reset').click();assert.equal(await page.evaluate(()=>MACHINE.sim.frame),0);check('Performance presets, stepping and reset');
    for(const name of ['browser-emulator','advanced-emulator']){
      await go(name);await page.locator('.side-search').pressSequentially('shader');assert.equal(await page.locator('.side-search').inputValue(),'shader');await page.locator('.side-search').fill('');
      if(name==='browser-emulator'){
        await page.waitForFunction(()=>BROWSER_EMULATOR.emulator.booted);assert.equal(await page.evaluate(()=>BROWSER_EMULATOR.emulator.running),false);
        await page.locator('[data-vt-action]').click();await page.locator('#be-flush-pipelines').click();await page.locator('#be-step').click();assert.equal(await page.evaluate(()=>BROWSER_EMULATOR.emulator.processAlive),true);
        await page.locator('#be-corrupt-pm4').click();await page.locator('#be-step').click();assert.equal(await page.evaluate(()=>BROWSER_EMULATOR.emulator.processAlive),false);
        await page.locator('#be-reset').click();await page.waitForFunction(()=>BROWSER_EMULATOR.emulator.booted&&BROWSER_EMULATOR.emulator.processAlive);
        await page.locator('#be-write-rx').click();assert.equal(await page.evaluate(()=>BROWSER_EMULATOR.emulator.processAlive),false);
      }else{
        await page.waitForSelector('#ax-boot.is-off',{state:'attached'});assert.match(await text('ax-run'),/Run|Resume/);
        await page.locator('[data-vt-action]').click();await page.waitForSelector('#ax-boot.is-off',{state:'attached'});await page.locator('#ax-frame').click();
        for(const tab of await page.locator('.ax-navbtn').all())await tab.click();
        await page.locator('#ax-fault-rx').click();assert.match(await text('ax-sub'),/fault/i);
        await page.locator('#ax-reset').click();await page.waitForSelector('#ax-boot.is-off',{state:'attached'});await page.locator('#ax-frame').click();
      }
      check(name+' sidebar typing, deliberate start, inspectors and fault recovery');
    }
    assert.deepEqual(report.errors,[],'Browser runtime errors');
    await context.close();
  }finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  console.log(`PASS: ${report.layouts.length} desktop/theme layouts; ${report.checks.length} interaction groups; no browser exceptions. Screenshots: ${output}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
