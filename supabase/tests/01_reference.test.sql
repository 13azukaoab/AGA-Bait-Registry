-- Reference data test: enums, zones, branches, teams, customer_types, tier_rules
-- Source of truth: SPEC.md §4 (org structure), §7.1 (tier), §7.5 (termite_caste); task.md (master data)
BEGIN;
SELECT plan(25);

-- ---------- enums ----------
SELECT enum_has_labels('public', 'division',        ARRAY['central', 'province']);
SELECT enum_has_labels('public', 'user_role',       ARRAY['host', 'admin', 'recorder', 'viewer']);
SELECT enum_has_labels('public', 'sale_type',       ARRAY['new', 'renew']);
SELECT enum_has_labels('public', 'contract_status', ARRAY['active', 'expired_pending_collection', 'closed', 'cancelled']);
SELECT enum_has_labels('public', 'station_type',    ARRAY['IG', 'AG', 'IC']);
SELECT enum_has_labels('public', 'station_status',  ARRAY['active', 'eliminated', 'pending_removal', 'removed', 'lost', 'withdrawn']);  -- lost/withdrawn: 20261112130000
SELECT enum_has_labels('public', 'visit_type',      ARRAY['routine', 'problem', 'follow_up']);
SELECT enum_has_labels('public', 'termite_caste',
  ARRAY['งาน>ทหาร', 'ทหาร>งาน', 'ทหาร', 'ทหาร+สืบพันธุ์สำรอง', 'สืบพันธุ์สำรอง', 'ปลวกตาย']);
SELECT enum_has_labels('public', 'snapshot_source', ARRAY['computed', 'legacy', 'manual']);
SELECT enum_has_labels('public', 'audit_action',    ARRAY['insert', 'update', 'delete']);

-- ---------- zones / branches ----------
SELECT is((SELECT count(*)::int FROM zones), 13, '13 zones');
SELECT is((SELECT count(*)::int FROM branches), 43, '43 branches');
SELECT is((SELECT count(*)::int FROM branches WHERE division = 'central'), 24, '24 central branches');
SELECT is((SELECT count(*)::int FROM branches WHERE division = 'province'), 19, '19 province branches');
SELECT is((SELECT count(*)::int FROM branches WHERE NOT is_active), 0, 'all branches active');

-- zone 9 is split across divisions (SPEC §4)
SELECT results_eq(
  $$SELECT b.name::text, b.division::text FROM branches b JOIN zones z ON z.id = b.zone_id
    WHERE z.name = 'เขต 9' ORDER BY b.name$$,
  $$VALUES ('ปากช่อง'::text, 'central'::text), ('ลพบุรี', 'province'), ('สระบุรี', 'central')$$,
  'zone 9 split: ปากช่อง/สระบุรี central, ลพบุรี province'
);

-- full pin of all 43 branches: (zone, branch name, division). Names are Dashboard keys.
SELECT results_eq(
  $$SELECT z.name::text, b.name::text, b.division::text FROM branches b JOIN zones z ON z.id = b.zone_id
    ORDER BY z.sort_order, b.name$$,
  $$SELECT * FROM (VALUES
    ('เขต 1', 'พุทธมณฑล', 'central'),
    ('เขต 1', 'นครปฐม', 'central'),
    ('เขต 1', 'หัวหิน', 'central'),
    ('เขต 2', 'สาทร', 'central'),
    ('เขต 2', 'ปทุมวัน', 'central'),
    ('เขต 2', 'พระราม 4', 'central'),
    ('เขต 2', 'นนทบุรี', 'central'),
    ('เขต 3', 'ปทุมธานี', 'central'),
    ('เขต 3', 'รามอินทรา', 'central'),
    ('เขต 3', 'อยุธยา', 'central'),
    ('เขต 4', 'ลาดพร้าว', 'central'),
    ('เขต 4', 'พัฒนาการ', 'central'),
    ('เขต 4', 'สุวินทวงศ์', 'central'),
    ('เขต 4', 'ประชาชื่น', 'central'),
    ('เขต 5', 'สมุทรปราการ', 'central'),
    ('เขต 5', 'พัทยา', 'central'),
    ('เขต 5', 'ระยอง', 'central'),
    ('เขต 6', 'สุขุมวิท', 'central'),
    ('เขต 6', 'ปากน้ำ', 'central'),
    ('เขต 6', 'ชลบุรี', 'central'),
    ('เขต 7', 'เชียงราย', 'province'),
    ('เขต 7', 'เชียงใหม่', 'province'),
    ('เขต 7', 'ตาก', 'province'),
    ('เขต 7', 'พิษณุโลก', 'province'),
    ('เขต 8', 'โคราช', 'province'),
    ('เขต 8', 'ขอนแก่น', 'province'),
    ('เขต 8', 'อุดรธานี', 'province'),
    ('เขต 8', 'อุบลราชธานี', 'province'),
    ('เขต 9', 'ปากช่อง', 'central'),
    ('เขต 9', 'สระบุรี', 'central'),
    ('เขต 9', 'ลพบุรี', 'province'),
    ('เขต 10', 'สุราษฎร์ธานี', 'province'),
    ('เขต 10', 'เกาะสมุย', 'province'),
    ('เขต 10', 'พังงา', 'province'),
    ('เขต 11', 'กระบี่', 'province'),
    ('เขต 11', 'ภูเก็ต', 'province'),
    ('เขต 11', 'หาดใหญ่', 'province'),
    ('เขต 12', 'ระนอง', 'province'),
    ('เขต 12', 'นครศรีธรรมราช', 'province'),
    ('เขต 12', 'ตรัง', 'province'),
    ('เขต 12', 'ชุมพร', 'province'),
    ('เขต 13', 'พระราม 2', 'central'),
    ('เขต 13', 'ปราจีนบุรี', 'central')
  ) AS v (zone_name, branch_name, division) ORDER BY substring(zone_name from 5)::int, branch_name$$,
  'all 43 branches match SPEC §4 (zone, name, division)'
);

-- spot-check branch -> zone mapping (SPEC §4)
SELECT is(
  (SELECT z.name FROM branches b JOIN zones z ON z.id = b.zone_id WHERE b.name = 'หัวหิน'),
  'เขต 1', 'หัวหิน is in เขต 1');
SELECT is(
  (SELECT z.name FROM branches b JOIN zones z ON z.id = b.zone_id WHERE b.name = 'ชุมพร'),
  'เขต 12', 'ชุมพร is in เขต 12');

-- ---------- teams ----------
SELECT results_eq(
  $$SELECT code FROM teams ORDER BY code$$,
  $$VALUES ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H'),('I'),('J'),('K'),('L'),('M'),('N'),('O'),('Sup'),('Z')$$,
  'teams A-O, Z, Sup (17 rows)'
);

-- ---------- customer_types ----------
SELECT is((SELECT count(*)::int FROM customer_types), 14, '14 customer types');
SELECT is((SELECT count(DISTINCT group_label)::int FROM customer_types), 4, '4 customer type groups');
SELECT results_eq(
  $$SELECT group_label, count(*)::int FROM customer_types GROUP BY group_label ORDER BY group_label$$,
  $$VALUES ('ที่พักอาศัย'::text, 3), ('ธุรกิจ / อุตสาหกรรม', 5), ('บริการ / สาธารณะ', 5), ('อื่นๆ', 1)$$,
  'customer type group sizes 3/5/5/1'
);
SELECT results_eq(
  $$SELECT sort_order, label, group_label FROM customer_types ORDER BY sort_order$$,
  $$VALUES
    (1,  'บ้านเดี่ยว'::text,                    'ที่พักอาศัย'::text),
    (2,  'ทาวน์โฮม / ตึกแถว',                   'ที่พักอาศัย'),
    (3,  'คอนโด / อพาร์ตเมนต์ / หอพัก',         'ที่พักอาศัย'),
    (4,  'ออฟฟิต',                              'ธุรกิจ / อุตสาหกรรม'),
    (5,  'ห้าง / ร้านค้า',                      'ธุรกิจ / อุตสาหกรรม'),
    (6,  'โรงแรม/รีสอร์ท',                      'ธุรกิจ / อุตสาหกรรม'),
    (7,  'โรงงาน',                              'ธุรกิจ / อุตสาหกรรม'),
    (8,  'โกดังสินค้า',                         'ธุรกิจ / อุตสาหกรรม'),
    (9,  'โรงพยาบาล',                           'บริการ / สาธารณะ'),
    (10, 'สถานศึกษา',                           'บริการ / สาธารณะ'),
    (11, 'สถานที่ราชการ',                       'บริการ / สาธารณะ'),
    (12, 'สถานที่ทางศาสนา',                     'บริการ / สาธารณะ'),
    (13, 'สถานที่สำคัญ',                        'บริการ / สาธารณะ'),
    (14, 'อื่นๆ (ระบุในหมายเหตุ)',              'อื่นๆ')$$,
  'all 14 customer type labels + groups match task.md'
);

-- ---------- tier_rules (SPEC §7.1) ----------
SELECT results_eq(
  $$SELECT tier, min_annual::numeric, max_annual::numeric FROM tier_rules ORDER BY min_annual$$,
  $$VALUES ('S'::text, 0::numeric, 29999.99::numeric), ('M', 30000, 49999.99), ('L', 50000, 99999.99), ('XL', 100000, NULL)$$,
  'tier_rules min/max: S 0-29999.99 / M 30000-49999.99 / L 50000-99999.99 / XL 100000-unbounded'
);

SELECT * FROM finish();
ROLLBACK;
