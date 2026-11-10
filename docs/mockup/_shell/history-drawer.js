/* ===== AGA-HISTORY-DRAWER v1 : ลิ้นชัก "ประวัติ" ตามจุด (เห็นเฉพาะ host) =====
   แหล่งจริงอยู่ที่ docs/mockup/_shell/history-drawer.js — คัดลอกบล็อกนี้ไปทุกหน้าที่มีปุ่ม "ประวัติ" (ดู _shell/README.md)
   ต้องมี history-mock.js (HM_ALL / HM_CUST / hmFor) อยู่ก่อนในหน้าเดียวกัน
   วิธีใช้ในหน้า:
     1) ใส่ปุ่มด้วย HD.btn(เลขสัญญา, ชื่อลูกค้า)  → ได้ <button class="hd-btn"> ที่ซ่อนเองเมื่อไม่ใช่ host
     2) ตอนเปลี่ยน role เรียก HD.sync(role)       → โชว์/ซ่อนปุ่มทั้งหมด (ปุ่มที่สร้างทีหลังตามค่า role ล่าสุด)
     3) ปุ่มระดับหน้า (ไม่ผูกสัญญา) เรียก HD.open({title:'…', k:'Port ต่างจังหวัด'}) ได้เลย
   • โชว์เฉพาะ "การเปลี่ยนแปลง" (แก้/ลบ/ไฟล์/สถานี/ปิดเดือน) ล่าสุด 20 รายการ — ที่เหลือไปดูไทม์ไลน์เต็มในหน้าลูกค้า
   • ของจริง: อ่านจาก audit_log (RLS = host เท่านั้น) ไม่ใช่แค่ซ่อนปุ่ม · ที่นี่ใช้ข้อมูลสมมติ
   • ถ้าเลขสัญญาในเดโมไม่มีประวัติตรงตัว จะหยิบชุดตัวอย่างของลูกค้าเดโมรายหนึ่งมาแสดง (คงที่ตามเลขสัญญา) พร้อมป้ายบอก */
var HD=(function(){
  var role=null, el=null, lastFocus=null, LIMIT=20;
  var ACT={insert:['ok','เพิ่ม'],update:['info','แก้ไข'],'delete':['miss','ลบ']};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
  function isHost(){return role==='host';}
  var css='.hd-btn{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:11.5px;line-height:1.2;padding:2px 8px;border-radius:999px;'+
    'border:1px solid var(--border-strong);background:var(--surface);color:var(--accent-strong);cursor:pointer;white-space:nowrap;vertical-align:middle}'+
    '.hd-btn:hover{background:var(--accent-soft);border-color:var(--accent)}.hd-btn[hidden]{display:none}'+
    '.hd-ov{position:fixed;inset:0;background:rgba(10,18,28,.45);z-index:300}.hd-ov[hidden],.hd-panel[hidden]{display:none}'+
    '.hd-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);background:var(--surface);color:var(--fg);z-index:301;display:flex;flex-direction:column;'+
    'border-left:1px solid var(--border);box-shadow:var(--shadow);outline:none}'+
    '.hd-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}'+
    '.hd-head h2{margin:0;font-size:15px;line-height:1.35;flex:1}.hd-head small{display:block;font-weight:400;font-size:12px;color:var(--fg-muted);margin-top:2px}'+
    '.hd-x{font:inherit;font-size:18px;line-height:1;border:0;background:transparent;color:var(--fg-muted);cursor:pointer;padding:4px 8px;border-radius:8px}'+
    '.hd-x:hover{background:var(--surface-3);color:var(--fg)}'+
    '.hd-body{flex:1;overflow:auto;padding:10px 16px 16px}.hd-note{font-size:11.5px;color:var(--fg-muted);background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin:0 0 10px;line-height:1.5}'+
    '.hd-list{list-style:none;margin:0;padding:0 0 0 16px;border-left:2px solid var(--border)}'+
    '.hd-it{position:relative;padding:5px 0 11px 12px}.hd-it::before{content:"";position:absolute;left:-23px;top:10px;width:10px;height:10px;border-radius:50%;background:var(--surface);border:2px solid var(--accent)}'+
    '.hd-it.ins::before{border-color:var(--ok)}.hd-it.del::before{border-color:var(--danger)}'+
    '.hd-day{font-size:12px;font-weight:600;color:var(--fg-muted);margin:12px 0 6px}.hd-day:first-child{margin-top:0}'+
    '.hd-row{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:13px}.hd-txt{font-size:13px;margin-top:3px;word-break:break-word}.hd-meta{font-size:11.5px;color:var(--fg-muted);margin-top:2px}'+
    '.hd-chip{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;white-space:nowrap;background:var(--surface-3);color:var(--fg-muted)}'+
    '.hd-chip.ok{background:var(--ok-soft);color:var(--ok)}.hd-chip.miss{background:var(--danger-soft);color:var(--danger)}.hd-chip.info{background:var(--accent-soft);color:var(--accent-strong)}.hd-chip.pend{background:var(--warn-soft);color:var(--warn)}'+
    '.hd-foot{padding:10px 16px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px}'+
    '.hd-foot a{color:var(--accent-strong)}.hd-empty{padding:18px 4px;color:var(--fg-muted);font-size:13px}';
  function build(){
    if(el) return;
    var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
    el=document.createElement('div');
    el.innerHTML='<div class="hd-ov" id="hdOv" hidden></div><aside class="hd-panel" id="hdPanel" role="dialog" aria-modal="true" aria-labelledby="hdTitle" tabindex="-1" hidden>'+
      '<div class="hd-head"><h2 id="hdTitle"></h2><button type="button" class="hd-x" id="hdX" aria-label="ปิดประวัติ">✕</button></div>'+
      '<div class="hd-body" id="hdBody"></div><div class="hd-foot" id="hdFoot"></div></aside>';
    document.body.appendChild(el);
    document.getElementById('hdOv').addEventListener('click',close);
    document.getElementById('hdX').addEventListener('click',close);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!document.getElementById('hdPanel').hidden)close();});
  }
  /* ปุ่มเปิดลิ้นชัก — ใส่ใน markup ของหน้า (ซ่อนเองถ้าไม่ใช่ host) */
  function btn(ct,name){
    var n=rowsFor({ct:ct,name:name}).list.length;
    return '<button type="button" class="hd-btn" data-hd-ct="'+esc(ct)+'" data-hd-name="'+esc(name)+'"'+(isHost()?'':' hidden')+
      ' title="ดูประวัติการแก้ไขของสัญญานี้ (เฉพาะ host)" aria-label="ดูประวัติการแก้ไข '+esc(ct)+'">⟲ ประวัติ ('+n+')</button>';
  }
  function sync(r){
    role=r;
    [].forEach.call(document.querySelectorAll('.hd-btn'),function(b){b.hidden=!isHost();});
    if(!isHost()&&el&&!document.getElementById('hdPanel').hidden) close();
  }
  /* หารายการของสัญญา/ลูกค้า: ตรงตัวก่อน ไม่มีก็หยิบชุดตัวอย่างคงที่ */
  function rowsFor(o){
    var list, sample=false, cu=null;
    if(o.k){ list=hmFor({k:o.k,onlyChange:true}); }
    else {
      list=hmFor({ct:o.ct,onlyChange:true});
      HM_CUST.forEach(function(c){ if(c.ct===o.ct) cu=c; });
      if(!list.length){
        sample=true; cu=HM_CUST[hash(String(o.ct||o.name||''))%HM_CUST.length];
        list=hmFor({ct:cu.ct,onlyChange:true});
      }
    }
    return {list:list,sample:sample,cu:cu};
  }
  function open(o){
    if(!isHost()) return;
    build(); lastFocus=document.activeElement;
    var r=rowsFor(o), list=r.list, shown=list.slice(0,LIMIT);
    var cid=(r.cu&&r.cu.cid)||'';
    document.getElementById('hdTitle').innerHTML=esc(o.title||('ประวัติการแก้ไข · '+(o.ct||'')))+
      '<small>'+(o.name?esc(o.name)+' · ':'')+list.length+' รายการ (เฉพาะการเปลี่ยนแปลง) · 4–10 พ.ย. 2026</small>';
    var h='<p class="hd-note">ข้อมูลตัวอย่าง — ของจริงอ่านจาก <b>audit_log</b> (host เท่านั้น) · การกรอกผลบริการปกติจำนวนมากไม่แสดงที่นี่'+
      (r.sample?' · <b>เลขสัญญานี้ในเดโมยังไม่มีประวัติเฉพาะ จึงแสดงชุดตัวอย่าง</b>':'')+'</p>';
    if(!shown.length){ h+='<div class="hd-empty">ยังไม่มีการแก้ไขในช่วงที่เก็บ</div>'; }
    else {
      var day=null,openUl=false;
      shown.forEach(function(e){
        if(e.ds!==day){ if(openUl) h+='</ul>'; day=e.ds; h+='<div class="hd-day">'+esc(e.ds)+' 2026</div><ul class="hd-list">'; openUl=true; }
        var a=ACT[e.a]||ACT.update;
        h+='<li class="hd-it '+(e.a==='insert'?'ins':e.a==='delete'?'del':'')+'"><div class="hd-row"><b>'+esc(e.t)+'</b><span>'+esc(e.who)+'</span>'+
          '<span class="hd-meta" style="margin:0">'+esc(e.role)+'</span><span class="hd-chip '+a[0]+'">'+a[1]+'</span><span class="hd-chip">'+esc(e.k)+'</span>'+
          (e.closed?'<span class="hd-chip pend" title="แก้ข้อมูลของเดือนที่ปิดแล้ว">แก้หลังปิดเดือน</span>':'')+'</div>'+
          '<div class="hd-txt">'+esc(e.x)+'</div><div class="hd-meta">'+(e.ct&&e.ct!=='-'?esc(e.ct)+' · ':'')+'ข้อมูลเดือน '+esc(e.mk)+'</div></li>';
      });
      if(openUl) h+='</ul>';
    }
    document.getElementById('hdBody').innerHTML=h;
    var f=(cid?'<a href="customer-detail.html?c='+esc(cid)+'#tab=timeline">ไทม์ไลน์เต็มของลูกค้า ↗</a>':'')+'<a href="history-log.html">ประวัติย้อนหลังทุกสาขา ↗</a>';
    document.getElementById('hdFoot').innerHTML=f;
    document.getElementById('hdOv').hidden=false; var p=document.getElementById('hdPanel'); p.hidden=false; p.focus();
  }
  function close(){
    if(!el) return;
    document.getElementById('hdOv').hidden=true; document.getElementById('hdPanel').hidden=true;
    if(lastFocus&&lastFocus.focus) try{lastFocus.focus();}catch(e){}
  }
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('.hd-btn[data-hd-ct]'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    open({ct:b.getAttribute('data-hd-ct'),name:b.getAttribute('data-hd-name')});
  });
  /* หน้าที่ไม่ได้เรียก HD.sync เอง → ใช้ค่าจากตัวเลือก role ของ topbar (ถ้ามี) */
  document.addEventListener('DOMContentLoaded',function(){
    if(role===null){ var s=document.getElementById('roleSel'); sync(s?s.value:'host'); }
  });
  return {btn:btn,sync:sync,open:open,close:close};
})();
/* ===== /AGA-HISTORY-DRAWER v1 ===== */
