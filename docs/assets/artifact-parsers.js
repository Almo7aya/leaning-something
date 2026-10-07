/* Pure, browser/Node artifact readers. See docs/content/README.md for their scope. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./artifact-data.js') : root.KYTY_ARTIFACT_DATA);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KYTY_ARTIFACTS = api;
})(typeof window === 'object' ? window : globalThis, function (data) {
  'use strict';
  const MAX_WORDS = 16384, MAX_TEXT = 2 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024;
  const hex = (n, width = 8) => '0x' + BigInt(n).toString(16).toUpperCase().padStart(width, '0');
  function parseWords(text) {
    text = String(text);
    if (text.length > MAX_TEXT) throw new Error('Text exceeds the 2 MiB interactive limit. Extract a smaller block.');
    const words = [];
    let buffers = 0;
    const dump = text.includes('|'), rdna = /raw=\[/.test(text);
    function append(token, line) {
      if (!/^(?:0x)?[0-9a-f]{1,8}$/i.test(token)) throw new Error('Line '+line+': expected a 32-bit hex word, found '+token.slice(0,40)+'.');
      words.push(parseInt(token.replace(/^0x/i,''),16) >>> 0);
      if (words.length > MAX_WORDS) throw new Error('At most '+MAX_WORDS+' words can be inspected at once. Extract a smaller block.');
    }
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      if (/^-+\s*Buffer/.test(line.trim())) {
        if (++buffers > 1) throw new Error('Paste one command buffer at a time; buffers may have independent offsets.');
        return;
      }
      if (rdna) {
        const m = line.match(/raw=\[([^\]]*)\]/);
        if (!m) { if (/^\s*(;|\/\/)/.test(line)) return; throw new Error('Line '+(i+1)+': missing raw=[...] instruction words.'); }
        line = m[1];
      } else if (dump) {
        const m = line.match(/^\s*[0-9a-f]*\s*\|\s*(0x[0-9a-f]{8})\s*\|/i);
        if (m) { append(m[1],i+1); return; }
        // Native dumps may annotate indirect registers without adding stream words.
        if (/^\s*\|\s*\|/.test(line) || /^\s*(;|\/\/)/.test(line)) return;
        throw new Error('Line '+(i+1)+': unrecognized dump row. Expected offset | 0xDWORD | annotation.');
      }
      line = line.replace(/(?:\/\/|;).*$/, '').replace(/[\[\],]/g,' ').trim();
      if (line) line.split(/\s+/).forEach(t => append(t,i+1));
    });
    return words;
  }
  function decodePm4(words) {
    const records = [];
    for (let i=0; i<words.length;) {
      if (records.length === 4096) throw new Error('More than 4096 packets; inspect a smaller buffer.');
      const raw=words[i]>>>0, type=raw>>>30;
      if (type!==2 && type!==3) throw new Error('Unsupported PM4 packet type '+type+' at dword '+i+'. Parsing stopped; no resynchronization was guessed.');
      const len=type===2?1:((raw>>>16)&0x3fff)+2, op=(raw>>>8)&255;
      records.push({at:i,raw,type,len,op,r:(raw>>>2)&63,name:type===2?'TYPE-2 filler':data.pm4[op]||'Unknown opcode '+hex(op,2),
        payload:words.slice(i+1,i+len),short:i+len>words.length,unknown:type===3&&!data.pm4[op]});
      i+=len;
    }
    return records;
  }
  function encodePm4(len,op,r) {
    if (!Number.isInteger(len)||len<2||len>16385||!Number.isInteger(op)||op<0||op>255||!Number.isInteger(r)||r<0||r>63)
      throw new Error('Length must be an integer from 2 to 16385; opcode 0–255; r 0–63.');
    return (0xc0000000|((len-2)<<16)|(op<<8)|(r<<2))>>>0;
  }
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-';
  function encodeId64(id) {
    if (!Number.isInteger(id)||id<0||id>65535) throw new Error('ID must be an integer from 0 to 65535.');
    let out='';do {out=alphabet[id%64]+out;id=Math.floor(id/64);}while(id);return out;
  }
  function decodeId64(text) {
    if (!/^[A-Za-z0-9+\-]{1,3}$/.test(text)) throw new Error('An encoded ID has one to three characters from the 64-symbol alphabet.');
    let value=0;for(const c of text)value=value*64+alphabet.indexOf(c);
    if(value>65535)throw new Error('This token exceeds the 16-bit ID range.');
    if(encodeId64(value)!==text)throw new Error('Noncanonical ID: remove leading A characters.');
    return value;
  }
  function parseAddress(text) {
    if(!/^(?:0x)?[0-9a-f]{1,16}$/i.test(String(text).trim()))throw new Error('Enter an unsigned 64-bit hexadecimal address.');
    return BigInt('0x'+String(text).trim().replace(/^0x/i,''));
  }
  function relativePatch(rip,target) {
    const displacement=parseAddress(target)-parseAddress(rip),bits=BigInt.asUintN(32,displacement);
    return {displacement,signed:BigInt.asIntN(32,displacement),inRange:displacement>=-2147483648n&&displacement<=2147483647n,
      bytes:Array.from({length:4},(_,i)=>Number((bits>>BigInt(i*8))&255n).toString(16).padStart(2,'0').toUpperCase())};
  }
  function parseElf(buf) {
    if(buf.byteLength>MAX_FILE)throw new Error('Module exceeds the 64 MiB interactive limit. Use an offline ELF inspector.');
    const dv=new DataView(buf),length=buf.byteLength;
    const range=(off,size,label)=>{if(!Number.isSafeInteger(off)||!Number.isSafeInteger(size)||off<0||size<0||off>length||size>length-off)throw new Error(label+' extends beyond the file.');};
    const u64=(at,label)=>{const value=dv.getBigUint64(at,true);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(label+' exceeds this inspector\'s supported numeric range.');return Number(value);};
    range(0,64,'ELF header');let off=0,selfHdr=null;
    const magic=dv.getUint32(0,true);
    if(magic===0x1d3d154f||magic===0xeef51454){
      const segments=dv.getUint16(24,true);off=32+segments*32;range(0,off+64,'SELF segment table and ELF header');
      selfHdr={magic:hex(magic),segments};
    }
    if(dv.getUint32(off,false)!==0x7f454c46)throw new Error('ELF magic not found at the expected header offset. Compressed/encrypted SELF contents are not decoded.');
    if(dv.getUint8(off+4)!==2||dv.getUint8(off+5)!==1)throw new Error('Only little-endian ELF64 is supported.');
    if(dv.getUint8(off+6)!==1||dv.getUint32(off+20,true)!==1)throw new Error('Unsupported ELF version.');
    if(dv.getUint16(off+52,true)!==64)throw new Error('ELF64 header size must be 64 bytes.');
    const e={selfHdr,elfOffset:off,type:dv.getUint16(off+16,true),machine:dv.getUint16(off+18,true),entryLo:dv.getUint32(off+24,true),entryHi:dv.getUint32(off+28,true),
      phoff:u64(off+32,'Program table offset'),phentsize:dv.getUint16(off+54,true),phnum:dv.getUint16(off+56,true),phdrs:[],dyn:[],warnings:[]};
    if(e.phnum===65535)throw new Error('Extended ELF program-header numbering is not supported.');
    if(e.phnum>1024)throw new Error('More than 1024 program headers; use an offline ELF inspector.');
    if(e.phnum&&e.phentsize!==56)throw new Error('ELF64 program headers must be 56 bytes each.');
    range(off+e.phoff,e.phnum*e.phentsize,'Program-header table');
    for(let i=0;i<e.phnum;i++){
      const p=off+e.phoff+i*56;
      const seg={type:dv.getUint32(p,true),flags:dv.getUint32(p+4,true),offset:u64(p+8,'Segment offset'),vaddrLo:dv.getUint32(p+16,true),vaddrHi:dv.getUint32(p+20,true),filesz:u64(p+32,'Segment file size'),memsz:u64(p+40,'Segment memory size'),align:u64(p+48,'Segment alignment')};
      if(seg.type!==0&&!selfHdr)range(seg.offset,seg.filesz,'Segment '+i);
      if(seg.type===1&&seg.filesz>seg.memsz)throw new Error('PT_LOAD '+i+' has filesz greater than memsz.');
      if(seg.align>1&&(BigInt(seg.align)&(BigInt(seg.align)-1n))!==0n)throw new Error('Segment '+i+' alignment is not a power of two.');
      e.phdrs.push(seg);
    }
    if(selfHdr)e.warnings.push('SELF header inspection only: segment contents require container mapping/decompression. Dynamic entries and payload validity are not inferred from ELF offsets.');
    else for(const seg of e.phdrs.filter(p=>p.type===2)){
      if(seg.filesz%16)throw new Error('PT_DYNAMIC has an incomplete 16-byte entry.');
      let terminated=false;
      for(let p=seg.offset;p<seg.offset+seg.filesz;p+=16){
        const tagLo=dv.getUint32(p,true),tagHi=dv.getUint32(p+4,true);
        if(!tagLo&&!tagHi){terminated=true;break;}
        if(e.dyn.length>=4096)throw new Error('More than 4096 dynamic entries; use an offline ELF inspector.');
        e.dyn.push({tagLo,tagHi,valLo:dv.getUint32(p+8,true),valHi:dv.getUint32(p+12,true)});
      }
      if(seg.filesz&&!terminated)throw new Error('PT_DYNAMIC is missing its DT_NULL terminator.');
    }
    return e;
  }
  function wordsFromBuffer(buf, spirv = true) {
    if(buf.byteLength%4)throw new Error('Binary length is not a multiple of four bytes; the last word is truncated.');
    if(buf.byteLength/4>MAX_WORDS)throw new Error('Binary exceeds the '+MAX_WORDS+'-word interactive limit.');
    const dv=new DataView(buf),little=!spirv||buf.byteLength<4||dv.getUint32(0,true)!==0x03022307;
    return Array.from({length:buf.byteLength/4},(_,i)=>dv.getUint32(i*4,little));
  }
  function parseSpirv(words) {
    if(words.length<5)throw new Error('SPIR-V requires a complete five-word header.');
    if(words[0]!==0x07230203)throw new Error('Invalid SPIR-V magic.');
    const version=words[1]>>>0;
    if((version>>>16)!==1||((version>>>8)&255)>6||(version&255))throw new Error('Unsupported SPIR-V version.');
    if(!words[3]||words[4]!==0)throw new Error('Invalid SPIR-V ID bound or reserved schema word.');
    const instructions=[];
    for(let i=5;i<words.length;){
      const wc=words[i]>>>16,opcode=words[i]&65535;
      if(!wc)throw new Error('Zero instruction word count at word '+i+'.');
      if(wc>words.length-i)throw new Error('Truncated instruction at word '+i+': needs '+wc+' words, has '+(words.length-i)+'.');
      instructions.push({at:i,wc,opcode});i+=wc;
    }
    return {version:'1.'+((version>>>8)&255),bound:words[3],instructions};
  }
  function bufferDescriptor(w) {
    const base=BigInt(w[0]>>>0)|(BigInt(w[1]&65535)<<32n),stride=(w[1]>>>16)&0x3fff,records=w[2]>>>0;
    return {base,stride,records,size:stride?BigInt(stride)*BigInt(records):BigInt(records),format:(w[3]>>>12)&127,type:w[3]>>>30,
      swizzle:!!(w[1]>>>31),outOfBounds:(w[3]>>>28)&3};
  }
  function samplerDescriptor(w) {
    return {clamp:[w[0]&7,(w[0]>>>3)&7,(w[0]>>>6)&7],aniso:(w[0]>>>9)&7,compare:(w[0]>>>12)&7,
      minLod:w[1]&4095,maxLod:(w[1]>>>12)&4095,mag:(w[2]>>>20)&3,min:(w[2]>>>22)&3,mip:(w[2]>>>26)&3,border:w[3]>>>30};
  }
  function sourceName(n) {
    if(n<=105)return 's'+n;
    if(n>=256&&n<=511)return 'v'+(n-256);
    if(n>=128&&n<=192)return String(n-128);
    if(n>=193&&n<=208)return String(192-n);
    if(n>=240&&n<=247)return ['0.5','-0.5','1.0','-1.0','2.0','-2.0','4.0','-4.0'][n-240];
    return ({106:'vcc_lo',107:'vcc_hi',124:'m0',125:'null',126:'exec_lo',127:'exec_hi',235:'shared_base',237:'private_base',239:'pops_exiting_wave_id',248:'1/(2π)',251:'vccz',252:'execz',253:'scc',255:'literal'})[n]||'reserved selector '+n;
  }
  function decodeInstruction(words,at=0) {
    const w=words[at]>>>0,r={w0:w,words:1,family:'UNKNOWN',name:'Unknown encoding',fields:[],operands:[],stop:false,warning:''};
    const field=(n,b,v)=>r.fields.push({n,b,v});let op,selectors=[];
    if(!(w&0x80000000)){
      op=(w>>>25)&63;r.family=op===62?'VOPC':op===63?'VOP1':'VOP2';
      if(r.family==='VOP1')op=(w>>>9)&255;else if(r.family==='VOPC')op=(w>>>17)&255;
      const src=w&511;selectors=[src];
      field('src0 selector','0–8',src+' → '+sourceName(src));
      if(r.family!=='VOP1')field('vsrc1','9–16','v'+((w>>>9)&255));
      if(r.family!=='VOPC')field('destination field','17–24',(w>>>17)&255);
      if([233,249,250].includes(src)){r.stop=true;r.warning='DPP/SDWA extension: use the recompiler’s decoded log for operand modifiers and instruction length.';}
    }else if((w>>>30)===2){
      op=(w>>>23)&127;r.family=op===125?'SOP1':op===126?'SOPC':op===127?'SOPP':op>=96?'SOPK':'SOP2';
      if(r.family==='SOP1')op=(w>>>8)&255;
      else if(r.family==='SOPC'||r.family==='SOPP')op=(w>>>16)&127;
      else if(r.family==='SOPK')op=(w>>>23)&31;
      if(['SOP1','SOP2','SOPC'].includes(r.family)){
        selectors=[w&255];if(r.family!=='SOP1')selectors.push((w>>>8)&255);
        selectors.forEach((s,i)=>field('ssrc'+i+' selector',i?'8–15':'0–7',s+' → '+sourceName(s)));
      }
      if(!['SOPC','SOPP'].includes(r.family))field('sdst field','16–22',sourceName((w>>>16)&127));
      if(['SOPK','SOPP'].includes(r.family))field('immediate','0–15',hex(w&65535,4)+' (signed '+(w<<16>>16)+')');
      if(r.family==='SOPP'&&(op===2||(op>=4&&op<=9)))field('branch target','pc + 4 + simm16 × 4',hex((at*4+4+(w<<16>>16)*4)>>>0));
    }else{
      r.family=({50:'VINTRP',51:'VOP3P',53:'VOP3',54:'DS',55:'FLAT',56:'MUBUF',58:'MTBUF',60:'MIMG',61:'SMEM',62:'EXP'})[w>>>26]||'UNKNOWN';
      r.stop=true;r.warning='Family identified; operand decoding and stream length for this family are outside this ALU inspector. Use the recompiler’s decoded log for complete instructions.';
      field('family selector','26–31',hex(w>>>26,2));
    }
    r.opcode=op;r.dispatch='Encoding family: '+r.family;
    if(op!==undefined){
      r.name=data.instructions[r.family]?.[op]||'Unknown '+r.family+' opcode '+hex(op,2);field('opcode','family-dependent',hex(op,2));
      if(!data.instructions[r.family]?.[op]){r.stop=true;r.warning='Opcode is absent from the pinned source table. Parsing stops here rather than guessing its length.';}
    }else r.name=r.family+' family';
    if(r.name==='s_getpc_b64'||r.name==='v_nop')selectors=[];
    if(!r.stop){
      const literal=selectors.includes(255)||/^v_(?:madmk|madak|fmamk|fmaak)_/.test(r.name);
      if(literal){
        if(at+1>=words.length)throw new Error('Truncated literal after instruction at byte '+at*4+'.');
        r.words=2;field('literal word','next 32 bits',hex(words[at+1]));
      }
      r.operands=['[encoded fields below]'];
    }
    return r;
  }
  function decodeIsa(words) {
    const rows=[];for(let i=0;i<words.length;){const dec=decodeInstruction(words,i);rows.push({pc:i*4,dec,raw:words.slice(i,i+dec.words)});if(dec.stop)break;i+=dec.words;}return rows;
  }
  const LOG_RULES = [
    {key:'unresolved',label:'Unresolved imports',re:/(?:unresolved|cannot resolve|can't resolve|not found).*(?:symbol|import|nid)|(?:symbol|import|nid).*(?:unresolved|cannot resolve|can't resolve|not found)/i,why:'A resolution failure is a lead. Check the requested module/library, versions, loaded exports and lookup key before deciding an implementation is missing.'},
    {key:'unimpl',label:'Unimplemented calls',re:/\bunimplemented\b|not implemented|\bstub\b|\bTODO\b/i,why:'A stub or unsupported path was reported. Its behavior and whether execution reaches it must be checked in the matching source.'},
    {key:'unknown',label:'Unknown GPU / shader operations',re:/unknown (?:opcode|packet|register|format)|unhandled (?:IR|shader|PM4|opcode)/i,why:'Inspect the original opcode, surrounding data and source revision. An unrecognized encoding can also result from an earlier parsing error.'},
    {key:'error',label:'Errors',re:/\berror\b|\bfail(?:ed|ure)?\b|exception|assert|not found/i,why:'Read the first relevant failure and its surrounding events. Later errors can be consequences; a line alone does not establish the cause.'},
    {key:'warn',label:'Warnings',re:/\bwarn(?:ing)?\b/i,why:'Warnings need context. Compare when they begin, whether they repeat, and whether the same warning occurs in a successful run.'}
  ];
  function analyseLog(text) {
    if(text.length>MAX_TEXT)throw new Error('Log exceeds the 2 MiB interactive limit. Extract the relevant run or failure window.');
    const lines=text.split(/\r?\n/),buckets={},nids={};let unmatched=0;
    LOG_RULES.forEach(rule=>buckets[rule.key]={rule,hits:[],counts:{}});
    lines.forEach((line,i)=>{
      if(!line.trim())return;
      const rule=LOG_RULES.find(r=>r.re.test(line));
      if(!rule){unmatched++;return;}
      const b=buckets[rule.key],key=line.trim().slice(0,300);
      b.counts[key]=(b.counts[key]||0)+1;
      if(b.hits.length<400)b.hits.push({n:i+1,t:line.trim()});
      if(rule.key==='unresolved')for(const m of line.matchAll(/(?:^|[^A-Za-z0-9+\-])([A-Za-z0-9+\-]{11})(?=#|[^A-Za-z0-9+\-]|$)/g))nids[m[1]]=(nids[m[1]]||0)+1;
    });
    return {lines:lines.length,buckets,nids,unmatched};
  }
  var EXCEPTION_TYPES = { 0: "Unknown", 1: "AccessViolation", 2: "IllegalInstruction" };
  var ACCESS_TYPES = { 0: "Unknown", 1: "Read", 2: "Write", 3: "Execute" };

  function parseCrash(text) {
    var t = String(text).replace(/\r/g, "").replace(/\x1b\[[0-9;]*m/g, "");
    if(t.length > MAX_TEXT) throw new Error('Crash log exceeds the 2 MiB interactive limit.');
    if((t.match(/---\s*Guest fault context\s*---/gi)||[]).length > 1 || (t.match(/kyty_exception_handler:/gi)||[]).length > 1)
      throw new Error('Multiple crash blocks found. Paste one crash at a time so registers and exception details cannot be mixed.');
    var o = { regs: [], stack: [], guest: [], trace: [], code: [], codeFault: -1, summary: {}, unpatched: false, format: "" };
    var m;
    var HEX = "[0-9a-fA-F]";

    /* ---- current format ---- */
    if (/---\s*Guest fault context\s*---/i.test(t)) o.format = "guest-fault-context";
    if ((m = t.match(/^\s*thread:\s*(.+)$/mi))) o.summary.thread = m[1].trim();
    if ((m = t.match(/Unhandled host exception:\s*type=(\d+)\s+code=(\d+)\s+pc=0x([0-9a-f]+)\s+access=(\d+)\s+address=0x([0-9a-f]+)/i))) {
      o.format = o.format || "guest-fault-context";
      o.summary.type = EXCEPTION_TYPES[+m[1]] || ("type " + m[1]);
      o.summary.native = (+m[2]).toString(16).toLowerCase();
      o.summary.addr = m[3].toUpperCase();
      o.summary.av_type = ACCESS_TYPES[+m[4]] || ("access " + m[4]);
      o.summary.av_addr = m[5].toUpperCase();
    }
    if ((m = t.match(/code \(pc-48 \.\. pc\+48, fault at byte 48\):\s*\n((?:[ \t]*(?:[0-9a-fA-F]{2}[ \t]*)+\n?)+)/i))) {
      o.code = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 96);
      o.codeFault = 48;
    }
    if ((m = t.match(/^\s*stack:\s*\n((?:[ \t]*(?:[0-9a-fA-F]{16}[ \t]*)+\n?)+)/mi))) {
      o.stack = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 32).map(function (v) { return v.toUpperCase(); });
    }

    /* ---- legacy format ---- */
    if ((m = t.match(/kyty_exception_handler:\s*([0-9a-fA-F]+)/))) { o.summary.addr = m[1].toUpperCase(); o.format = o.format || "legacy"; }
    if ((m = t.match(/exception module:\s*(.+)/i))) o.summary.module = m[1].trim();
    if ((m = t.match(/code-32:\s*(.+)/i))) { o.code = m[1].trim().split(/\s+/).filter(Boolean).slice(0, 32); o.codeFault = -1; }
    if ((m = t.match(/exception:\s*type=(\w+),\s*av_type=(\w+),\s*av_addr=([0-9a-fA-F]+),\s*native_code=([0-9a-fA-F_]+)/i))) {
      o.summary.type = m[1]; o.summary.av_type = m[2]; o.summary.av_addr = m[3].toUpperCase();
      o.summary.native = m[4].replace(/[^0-9a-f]/gi, "").slice(-8).toLowerCase();
    }
    var sm = t.match(/stack:\s*(\[\d+\]=.+)/i);
    if (sm) sm[1].replace(/\[\d+\]=([0-9a-fA-F]+)/gi, function (_, v) { o.stack.push(v.toUpperCase()); return ""; });
    var g = new RegExp("guest\\s+(\\S+)\\[0\\]:\\s*addr=(" + HEX + "+),\\s*off=(" + HEX + "+),\\s*(.*)", "gi");
    while ((m = g.exec(t))) o.guest.push({ reg: m[1], addr: m[2].toUpperCase(), off: m[3].toUpperCase(), module: m[4].trim() });
    if (t.indexOf("(Unpatched object)") >= 0) o.unpatched = true;
    if ((m = t.match(/Access violation:\s*(\w+)\s*\[([0-9a-fA-F]+)\]/i))) {
      o.summary.fatal = "Access violation — " + m[1] + " at " + m[2].toUpperCase();
    } else if ((m = t.match(/Unknown exception!!!\s*\(([0-9a-fA-F]+)\)/i))) {
      o.summary.fatal = "Unknown exception — " + m[1];
    }

    /* ---- common: registers and the guest stack walk (RuntimeLinker::StackTrace) ---- */
    var re = new RegExp("\\b(rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|r8|r9|r10|r11|r12|r13|r14|r15)\\s*=\\s*(" + HEX + "+)", "gi");
    while ((m = re.exec(t))) o.regs.push({ name: m[1], value: m[2].toUpperCase() });
    var tr = new RegExp("\\[(\\d+)\\]\\s+(" + HEX + "+),\\s*off=(" + HEX + "+),\\s*(.*)", "g");
    while ((m = tr.exec(t))) o.trace.push({ frame: +m[1], addr: m[2].toUpperCase(), off: m[3].toUpperCase(), module: m[4].trim() });
    return o;
  }

  return {data,MAX_WORDS,MAX_TEXT,MAX_FILE,hex,parseWords,decodePm4,encodePm4,encodeId64,decodeId64,parseAddress,relativePatch,
    parseElf,wordsFromBuffer,parseSpirv,bufferDescriptor,samplerDescriptor,sourceName,decodeInstruction,decodeIsa,LOG_RULES,analyseLog,parseCrash};
});
