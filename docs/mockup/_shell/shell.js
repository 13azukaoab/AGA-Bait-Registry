/* ===== AGA-SHELL v1 : เปิด/ปิดลิ้นชักเมนูบนจอเล็ก (body.nav-open) ===== */
function toggleNav(open){
  var b=document.body, want=(typeof open==='boolean')?open:!b.classList.contains('nav-open');
  b.classList.toggle('nav-open',want);
  var t=document.getElementById('navToggle'); if(t) t.setAttribute('aria-expanded',want?'true':'false');
}
document.addEventListener('keydown',function(e){ if(e.key==='Escape') toggleNav(false); });
/* ===== /AGA-SHELL v1 ===== */
