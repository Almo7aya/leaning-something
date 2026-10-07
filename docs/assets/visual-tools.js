/* Desktop inspection controls shared by the optional teaching workspaces. */
(function () {
  'use strict';
  let expanded = null;
  function button(text, action) {
    const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;
  }
  document.querySelectorAll('[data-visual-workspace]').forEach(workspace=>{
    const bar=document.createElement('div');bar.className='vt-toolbar';
    const name=document.createElement('span');name.textContent=workspace.dataset.visualWorkspace;bar.append(name);
    let saved=null;
    const expand=button('Expand workspace',()=>saved?close():open());
    expand.setAttribute('aria-expanded','false');bar.append(expand);workspace.prepend(bar);
    function open(){
      if(expanded)expanded();
      const placeholder=document.createElement('div');placeholder.style.height=workspace.getBoundingClientRect().height+'px';
      saved={placeholder,focus:document.activeElement,overflow:document.body.style.overflow,scroll:window.scrollY};
      workspace.before(placeholder);workspace.classList.add('vt-expanded');document.body.style.overflow='hidden';
      expand.textContent='Close workspace · Esc';expand.setAttribute('aria-expanded','true');expanded=close;
      expand.focus({preventScroll:true});window.dispatchEvent(new Event('resize'));
    }
    function close(){
      if(!saved)return;const state=saved;saved=null;expanded=null;
      workspace.classList.remove('vt-expanded');state.placeholder.remove();document.body.style.overflow=state.overflow;
      expand.textContent='Expand workspace';expand.setAttribute('aria-expanded','false');window.dispatchEvent(new Event('resize'));
      window.scrollTo(0,state.scroll);state.focus?.focus({preventScroll:true});
    }
    workspace.addEventListener('keydown',e=>{
      if(!saved)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
      if(e.key==='Tab'){
        const targets=[...workspace.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
        const first=targets[0],last=targets[targets.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    const svg=workspace.querySelector('.fd-svg');
    if(svg){
      const viewport=document.createElement('div');viewport.className='vt-diagram-view';svg.before(viewport);viewport.append(svg);
      const label=document.createElement('label');label.textContent='Diagram zoom ';
      const zoom=document.createElement('select');zoom.setAttribute('aria-label','Diagram zoom');
      [100,125,150,200].forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value+'%';zoom.append(option);});
      zoom.addEventListener('change',()=>{svg.style.width=zoom.value+'%';svg.style.maxWidth='none';});label.append(zoom);bar.append(label);
    }
    if(workspace.classList.contains('pg-tool')){
      bar.append(button('Copy result',async()=>{
        const result=workspace.querySelector('.pg-out'),status=workspace.querySelector('.vt-copy-status');
        try {await navigator.clipboard.writeText(result?.innerText||'');status.textContent='Result copied.';}
        catch {status.textContent='Clipboard unavailable. Select and copy the result text.';}
      }));
      const status=document.createElement('span');status.className='vt-copy-status';status.setAttribute('role','status');bar.append(status);
    }
  });
  const click=selector=>{const node=document.querySelector(selector);if(!node)throw new Error('The tool is not ready yet.');node.click();};
  const input=(selector,value)=>{const node=document.querySelector(selector);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
  const actions={
    'pm4':()=>input('#pm4-in','00000 | 0xc0012d00 | IT_DRAW_INDEX_AUTO (OP:0x2d) SH:GX CNT:2\n      | 0x00000003 |\n      | 0x00000002 |'),
    'elf':()=>click('#elf-demo'),
    'log':()=>{const ta=document.querySelector('#log-ta');ta.hidden=false;input('#log-ta','error: file not found: /app0/settings.json\nUnresolved symbol pt2fEBBpEJk#v#v');},
    'id':()=>input('#id-num','63'),
    'layout':()=>{const preset=document.querySelector('#ly-preset');preset.value='trap';preset.dispatchEvent(new Event('change',{bubbles:true}));},
    'jit':()=>click('#jit-demo-far'),
    'crash':()=>click('#crash-demo'),
    'isa':()=>input('#isa-ta','0xBE8003FF 0x3F800000 0xBF810000'),
    'shader':()=>click('#shl-demo-spv'),
    'descriptor':()=>click('#dc-demo-v'),
    'overview':()=>click('#lt-reset'),
    'load':()=>click('.fd-mark:first-child'),
    'frame':()=>click('.fd-mark:first-child'),
    'explorer':()=>click('#mc-presets [data-preset="thrash"]'),
    'performance':()=>{click('[data-preset="smooth"]');click('#mc-reset');},
    'micro':()=>{if(!window.BROWSER_EMULATOR?.emulator.booted)throw new Error('Wait for boot to finish, then prepare the experiment.');if(!window.BROWSER_EMULATOR.emulator.processAlive)throw new Error('Cold reboot the faulted guest first, then prepare the experiment.');window.BROWSER_EMULATOR.pause();click('#be-tab-gpu');},
    'intro':()=>{click('#ax-reset');click('.ax-navbtn[data-tab="gpu"]');}
  };
  document.querySelectorAll('[data-vt-action]').forEach(b=>b.addEventListener('click',()=>{
    const status=b.parentElement.querySelector('[role="status"]');
    try {actions[b.dataset.vtAction]();status.textContent='Experiment prepared. Follow the steps below.';}
    catch(err){status.textContent=err.message;}
  }));
})();
