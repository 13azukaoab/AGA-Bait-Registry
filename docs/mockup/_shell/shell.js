/* ===== AGA-SHELL v2 : เปิด/ปิดลิ้นชักเมนูบนจอเล็ก (body.nav-open) + กรองเมนูตามสิทธิ์ ===== */
/* เมนูย่อบนจอกว้าง (body.nav-mini) — ปุ่ม ☰ บนจอกว้าง = ย่อ/ขยาย · จอเล็กยังเปิดลิ้นชัก (body.nav-open)
   จำค่าใน localStorage ใช้ร่วมทุกหน้า · private mode อาจใช้ storage ไม่ได้ จึงครอบ try */
function navWide(){ return window.matchMedia('(min-width:861px)').matches; }
function navMini(on){
  document.body.classList.toggle('nav-mini',on);
  var t=document.getElementById('navToggle');
  if(t && navWide()){
    t.setAttribute('aria-pressed',on?'true':'false');
    t.setAttribute('aria-label',on?'ขยายเมนู (ตอนนี้ย่อไว้ ชี้ที่แถบเมนูเพื่อดูชั่วคราว)':'ย่อเมนูให้เนื้อหากว้างขึ้น');
    t.title=t.getAttribute('aria-label');
  }
  try{ localStorage.setItem('aga-nav-mini',on?'1':'0'); }catch(e){}
}
(function(){
  function init(){ var on=false; try{ on=localStorage.getItem('aga-nav-mini')==='1'; }catch(e){} navMini(on); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
function toggleNav(open){
  if(typeof open!=='boolean' && navWide()){ navMini(!document.body.classList.contains('nav-mini')); return; }  // จอกว้าง: ☰ = ย่อ/ขยายเมนู
  var b=document.body, want=(typeof open==='boolean')?open:!b.classList.contains('nav-open');
  b.classList.toggle('nav-open',want);
  var t=document.getElementById('navToggle'); if(t) t.setAttribute('aria-expanded',want?'true':'false');
}
document.addEventListener('keydown',function(e){ if(e.key==='Escape') toggleNav(false); });

/* กรองเมนูตามสิทธิ์: ลิงก์ที่ data-roles ไม่มี role นี้ถูกซ่อน + ซ่อนหัวกลุ่มที่ไม่เหลือเมนู
   เรียกตอนโหลดหน้า และทุกครั้งที่สลับ role (ใน setRole ของแต่ละหน้า) */
function applyNavRole(role){
  document.querySelectorAll('#nav a[data-nav]').forEach(function(a){
    var roles=(a.getAttribute('data-roles')||'').split(/\s+/);
    a.style.display = roles.indexOf(role)>=0 ? '' : 'none';
  });
  document.querySelectorAll('#nav .group').forEach(function(g){
    var n=g.nextElementSibling, any=false;
    while(n && !n.classList.contains('group')){ if(n.style.display!=='none') any=true; n=n.nextElementSibling; }
    g.style.display = any ? '' : 'none';
  });
}
/* ===== /AGA-SHELL v2 ===== */
