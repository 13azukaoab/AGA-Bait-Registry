-- Reference data test: enums, zones, branches, teams, customer_types, tier_rules
-- Source of truth: SPEC.md §4 (org structure), §7.1 (tier), §7.5 (termite_caste); task.md (master data)
BEGIN;
SELECT plan(23);

-- ---------- enums ----------
SELECT enum_has_labels('public', 'division',        ARRAY['central', 'province']);
SELECT enum_has_labels('public', 'user_role',       ARRAY['host', 'admin', 'recorder', 'viewer']);
SELECT enum_has_labels('public', 'sale_type',       ARRAY['new', 'renew']);
SELECT enum_has_labels('public', 'contract_status', ARRAY['active', 'expired_pending_collection', 'closed', 'cancelled']);
SELECT enum_has_labels('public', 'station_type',    ARRAY['IG', 'AG', 'IC']);
SELECT enum_has_labels('public', 'station_status',  ARRAY['active', 'eliminated', 'pending_removal', 'removed']);
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

-- ---------- tier_rules (SPEC §7.1) ----------
SELECT results_eq(
  $$SELECT tier, min_annual::int FROM tier_rules ORDER BY min_annual$$,
  $$VALUES ('S'::text, 0), ('M', 30000), ('L', 50000), ('XL', 100000)$$,
  'tier_rules S0 / M30000 / L50000 / XL100000'
);

SELECT * FROM finish();
ROLLBACK;
