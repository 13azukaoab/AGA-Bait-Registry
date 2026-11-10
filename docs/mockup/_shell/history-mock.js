/* ===== AGA-HISTORY-MOCK v1 : ข้อมูลตัวอย่างประวัติย้อนหลัง (โครงตามตาราง audit_log) =====
   แหล่งจริงอยู่ที่ docs/mockup/_shell/history-mock.js — คัดลอกบล็อกนี้ไปทุกหน้าที่โชว์ประวัติ (ดู _shell/README.md)
   ใช้ร่วมกันทั้งหน้ารวม history-log.html, ลิ้นชัก "ประวัติ" ตามจุด และไทม์ไลน์ในหน้าลูกค้า → ตัวเลข/เนื้อหาตรงกันเสมอ
   • สร้างแบบกำหนดผลได้ (seed คงที่) 4–10 พ.ย. 2026 — ทุกครั้งที่เปิดได้ชุดเดิม · ข้อมูลทั้งหมดสมมติ ไม่ใช่ของจริง
   • 2 ชนิดแถว:
       เปลี่ยนแปลง (b=0): แก้/ลบ/ไฟล์/ปิดเดือน/Port — แถวละ 1 เหตุการณ์ (a = insert|update|delete เหมือน audit_log.action)
       กลุ่มการกรอกปกติ (b=1): "กรอกผลบริการ/ติดกล่อง AG ใหม่" ของคนเดียวกัน วันเดียวกัน → รวมเป็น 1 แถว มี n รายการ
         (ของจริงคำนวณกลุ่มนี้จากตาราง visits ด้วย created_by/created_at — ไม่ต้องเก็บ audit insert ซ้ำ ประหยัดที่เก็บ)
   • closed=1 = "แก้หลังปิด" (แก้ข้อมูลของเดือนที่ปิดแล้ว) · mk = เดือนของข้อมูล (month_key) */
var HM_PEOPLE=[
  {n:'สมชาย ใจดี',role:'หัวหน้างาน',br:'ลาดพร้าว'},{n:'วิภา ศรีสุข',role:'หัวหน้างาน',br:'พุทธมณฑล'},
  {n:'ประเสริฐ รักงาน',role:'หัวหน้างาน',br:'พัทยา'},{n:'สุดา แสงทอง',role:'Admin',br:'พุทธมณฑล'},
  {n:'อรุณ เจริญสุข',role:'Admin',br:'ลาดพร้าว'},{n:'นที พัฒนา',role:'PM',br:'ส่วนกลาง'},{n:'สมหญิง ใจดี',role:'OM',br:'ส่วนกลาง'}];
/* ลูกค้าเดโม: 3 รายแรกตรงกับ customer-detail.html (c1 / c2 / c3) */
var HM_CUST=[
  {ct:'CT26-0000142',cn:'บมจ. สยามพัฒนาเฮ้าส์',br:'ลาดพร้าว',cid:'c1'},{ct:'CT25-0000098',cn:'บมจ. สยามพัฒนาเฮ้าส์',br:'ลาดพร้าว',cid:'c1'},
  {ct:'CT26-0000088',cn:'คุณวิรัช ตั้งมั่น (บ้านพัก)',br:'พุทธมณฑล',cid:'c2'},{ct:'CT23-0000311',cn:'โรงแรมบ้านสวนรีสอร์ท',br:'นครปฐม',cid:'c3'},
  {ct:'CT23-0000017',cn:'บจก. เมืองทองคลังสินค้า',br:'พัฒนาการ'},{ct:'CT23-0000041',cn:'อาคารชุดลุมพินีวิว',br:'สุขุมวิท'},
  {ct:'CT26-0000203',cn:'หจก. ทรัพย์เจริญ',br:'นนทบุรี'},{ct:'CT26-0000009',cn:'คุณสมหญิง รุ่งเรือง',br:'ระยอง'}];
var HM_PROV=['เชียงใหม่','ขอนแก่น','ภูเก็ต','หาดใหญ่','สุราษฎร์ธานี','โคราช'];
var HM_TPL=[ /* w=น้ำหนักการสุ่ม · who=ตำแหน่งที่ทำได้ · cl=โอกาสเป็น "แก้หลังปิด" · scope=ctr(ผูกสัญญา)|prov(ต่างจังหวัด)|sys(ระบบ) */
  {k:'ผลบริการ',a:'update',w:6,who:['หัวหน้างาน'],cl:.3,tbl:'station_checks',f:function(r){var n=1+Math.floor(r()*40),p=r()<.7;return 'แก้ผลตรวจสถานี IG-'+n+' จาก "'+(p?'ไม่พบปลวก':'พบปลวก')+'" เป็น "'+(p?'พบปลวก':'ไม่พบปลวก')+'"';}},
  {k:'ผลบริการ',a:'update',w:3,who:['หัวหน้างาน'],cl:.2,tbl:'visits',f:function(r){var d=2+Math.floor(r()*20);return 'แก้วันที่เข้าบริการจาก '+d+'/10 เป็น '+(d+1)+'/10';}},
  {k:'กล่อง AG',a:'update',w:3,who:['หัวหน้างาน'],cl:0,tbl:'station_checks',f:function(r){var n=1+Math.floor(r()*8),a=[50,100,150,200];return 'แก้ปริมาณเหยื่อกล่อง AG จุดที่ '+n+' จาก '+a[Math.floor(r()*2)]+' ก. เป็น '+a[2+Math.floor(r()*2)]+' ก.';}},
  {k:'สัญญา',a:'update',w:5,who:['Admin','PM','OM'],cl:0,tbl:'contracts',f:function(r){var v=[24000,36000,48000,96000,150000],i=Math.floor(r()*4);return 'มูลค่า '+v[i].toLocaleString('en-US')+' → '+(v[i]+Math.round((2+r()*8))*1000).toLocaleString('en-US');}},
  {k:'สัญญา',a:'update',w:2,who:['Admin','PM','OM'],cl:0,tbl:'contracts',f:function(r){var t=['A','B','C','Z'],i=Math.floor(r()*3);return 'เปลี่ยนทีมที่ดูแลจาก '+t[i]+' เป็น '+t[i+1];}},
  {k:'ลูกค้า',a:'update',w:2,who:['Admin'],cl:0,tbl:'customers',f:function(){return 'แก้ชื่อลูกค้า (พิมพ์ตกหล่น) — เพิ่มคำนำหน้า "บจก."';}},
  {k:'ไฟล์แนบ',a:'insert',w:4,who:['Admin'],cl:0,tbl:'contract_files',f:function(r){var s=[8.0,9.0,7.2,6.5][Math.floor(r()*4)];return r()<.5?'แนบสัญญา + Site plan (บีบอัดจาก '+s.toFixed(1)+' MB เหลือ '+(s*.4).toFixed(1)+' MB)':'อัปเดต Site plan v'+(2+Math.floor(r()*2))+' · เหตุผล: แก้ตอนติดตั้ง';}},
  {k:'สถานี',a:'delete',w:2,who:['Admin','หัวหน้างาน'],cl:0,tbl:'stations',f:function(r){return 'ลบสถานี '+(r()<.5?'IC':'IG')+'-'+(1+Math.floor(r()*30))+' (บันทึกผิดสัญญา)';}},
  {k:'สถานี',a:'insert',w:2,who:['Admin'],cl:0,tbl:'stations',f:function(r){return 'เพิ่มสถานี IG-'+(31+Math.floor(r()*9))+' (ติดตั้งเพิ่มตามที่ลูกค้าขอ)';}},
  {k:'Port ต่างจังหวัด',a:'update',w:3,who:['PM','OM'],cl:.2,tbl:'monthly_branch_snapshots',scope:'prov',f:function(r){var a=40+Math.floor(r()*30);return ['S 1 ปี','M 1 ปี','L 1 ปี'][Math.floor(r()*3)]+': '+a+' → '+(a+1+Math.floor(r()*4))+' ราย · ยอดรวมตรงรายงาน';}},
  {k:'ปิดเดือน',a:'update',w:1,who:['PM','OM'],cl:0,tbl:'month_closures',scope:'sys',f:function(r){return r()<.5?'ปิดเดือน ต.ค. 2026 ส่วนกลาง 24 สาขา':'คำนวณ snapshot ใหม่ + ส่ง Dashboard (แก้หลังปิด '+(1+Math.floor(r()*4))+' รายการ)';}}
];
function hmRng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hmPad(n){return (n<10?'0':'')+n;}
var HM_DAYS=[10,9,8,7,6,5,4]; /* พ.ย. 2026 (วันที่ 10 = "วันนี้" ของเดโม) */
function hmBuild(){
  var r=hmRng(20261110), out=[], id=0, rr=0, wsum=HM_TPL.reduce(function(a,t){return a+t.w;},0);
  HM_DAYS.forEach(function(d){
    var cnt=5+Math.floor(r()*5);
    for(var i=0;i<cnt;i++){
      var x=r()*wsum, tp=HM_TPL[0]; for(var j=0,acc=0;j<HM_TPL.length;j++){acc+=HM_TPL[j].w; if(x<acc){tp=HM_TPL[j];break;}}
      var pool=HM_PEOPLE.filter(function(p){return tp.who.indexOf(p.role)>=0;}), who=pool[Math.floor(r()*pool.length)];
      var cu=HM_CUST[(rr++)%HM_CUST.length], prov=(tp.scope==='prov'), sys=(tp.scope==='sys');
      var h=8+Math.floor(r()*10), m=Math.floor(r()*60), closed=(tp.cl&&r()<tp.cl)?1:0;
      out.push({id:++id,d:d,ds:d+' พ.ย.',t:hmPad(h)+':'+hmPad(m),who:who.n,role:who.role,
        br:prov?HM_PROV[Math.floor(r()*HM_PROV.length)]:(sys?'ส่วนกลาง':cu.br),ct:(prov||sys)?'-':cu.ct,cn:(prov||sys)?'':cu.cn,cid:cu.cid||'',
        k:tp.k,a:tp.a,x:tp.f(r),tbl:tp.tbl,mk:closed?'2026-10':'2026-11',closed:closed,b:0,n:0});
    }
    HM_PEOPLE.filter(function(p){return p.role==='หัวหน้างาน';}).forEach(function(p){
      if(r()<.85){var n=25+Math.floor(r()*86),f=Math.floor(n*.1);
        out.push({id:++id,d:d,ds:d+' พ.ย.',t:'09:'+hmPad(Math.floor(r()*30)),t2:'16:'+hmPad(10+Math.floor(r()*40)),who:p.n,role:p.role,br:p.br,ct:'หลายสัญญา',cn:'',cid:'',
          k:'ผลบริการ',a:'insert',x:'กรอกผลบริการประจำเดือน '+n+' ราย (ปกติ '+(n-f)+' · พบปลวก '+f+')',tbl:'visits',mk:'2026-11',closed:0,b:1,n:n});}
      if(r()<.25){var g=2+Math.floor(r()*8);
        out.push({id:++id,d:d,ds:d+' พ.ย.',t:'11:'+hmPad(Math.floor(r()*50)),t2:'15:'+hmPad(Math.floor(r()*50)),who:p.n,role:p.role,br:p.br,ct:'หลายสัญญา',cn:'',cid:'',
          k:'กล่อง AG',a:'insert',x:'ติดกล่อง AG ใหม่ '+g+' กล่อง (นอกรอบบริการ)',tbl:'station_checks',mk:'2026-11',closed:0,b:1,n:g});}
    });
  });
  out.sort(function(a,b){return b.d-a.d || (b.t>a.t?1:b.t<a.t?-1:0);});
  return out;
}
var HM_ALL=hmBuild();
/* รายการย่อยของกลุ่มการกรอกปกติ (สร้างเมื่อกาง) — กำหนดผลได้จาก id ของกลุ่ม */
function hmBatchItems(e){
  var r=hmRng(e.id*7919+3), out=[], base=100+Math.floor(r()*800);
  for(var i=0;i<e.n;i++){var f=r()<.1;out.push({ct:'CT26-9'+hmPad(0)+(base+i*3+Math.floor(r()*3)),cn:'บจก. ลูกค้าตัวอย่าง '+(1+((base+i)%150)),res:e.k==='กล่อง AG'?('ติดกล่อง AG จุดที่ '+(1+i)+' (S)'):(f?'พบปลวก (ปลวกงาน)':'ปกติทั้งหมด'),f:f});}
  return out;
}
/* ค้นหา/กรองแบบง่าย: s={ct, cid, br, k, q, who, onlyChange} */
function hmFor(s){
  s=s||{};
  return HM_ALL.filter(function(e){
    if(s.ct&&e.ct!==s.ct) return false; if(s.cid&&e.cid!==s.cid) return false; if(s.br&&e.br!==s.br) return false;
    if(s.k&&e.k!==s.k) return false; if(s.who&&e.who!==s.who) return false; if(s.onlyChange&&e.b) return false;
    if(s.q){var q=s.q.toLowerCase().replace(/\s+/g,''), hay=(e.ct+e.cn+e.x+e.who+e.br+e.k).toLowerCase().replace(/\s+/g,''); if(hay.indexOf(q)<0) return false;}
    return true;});
}
/* ===== /AGA-HISTORY-MOCK v1 ===== */
