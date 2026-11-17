/* ===== AGA-UPDATE-BANNER (M34) : พฤติกรรมแถบแจ้งเวอร์ชันใหม่ =====
   API:  UB.show()            แสดงแถบ (หน้าจริงเรียกเมื่อ service worker ตัวใหม่รออยู่)
         UB.setDirty(bool)    บอกว่ามีงานกรอกค้างหรือไม่ (หน้าจริงผูกกับกลไกเตือนก่อนออกจากหน้า)
         UB.onApply = fn      ถูกเรียกเมื่อผู้ใช้ยืนยันอัปเดต (หน้าจริง: ส่ง SKIP_WAITING แล้วรีโหลดเมื่อ controllerchange)
   ภายหลัง = ซ่อนแถบรอบนี้ (ไม่เก็บถาวร — เวอร์ชันถัดไป/รีโหลดแล้วแจ้งใหม่ได้) */
var UB=(function(){
  var dirty=false, lastFocus=null;
  function $(id){ return document.getElementById(id); }
  function show(){
    var ub=$('ub'); if(!ub) return; ub.classList.add('show');
    document.body.classList.add('ub-on-float');
  }
  function hide(){ var ub=$('ub'); if(ub) ub.classList.remove('show'); document.body.classList.remove('ub-on-float'); }
  function apply(){ hide(); if(typeof api.onApply==='function') api.onApply(); }
  var api={
    onApply:null,
    show:show, hide:hide,
    setDirty:function(v){ dirty=!!v; },
    isDirty:function(){ return dirty; }
  };
  function init(){
    if(!$('ub')) return;
    $('ubLater').addEventListener('click',hide);
    $('ubNow').addEventListener('click',function(){
      if(!dirty){ apply(); return; }
      lastFocus=document.activeElement; $('ubDlg').showModal();
    });
    $('ubCancel').addEventListener('click',function(){ $('ubDlg').close(); });
    $('ubConfirm').addEventListener('click',function(){ $('ubDlg').close(); apply(); });
    $('ubDlg').addEventListener('close',function(){ if(lastFocus&&lastFocus.focus) lastFocus.focus(); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  return api;
})();
/* ===== /AGA-UPDATE-BANNER ===== */
