-- Migration: enums + reference tables + master data seed
-- Source of truth: SPEC.md §4 (zones/branches), §6 (data model), §7.1 (tier rules),
--                  §7.5 (termite_caste); task.md (teams, customer_types - 14 values / 4 groups)
--
-- Notes for the team:
--   * Branch names are keys for the AGA Bait Dashboard - spell EXACTLY as below.
--   * Division is bound to the BRANCH, not the zone (zone 9 spans central + province).
--   * RLS is NOT enabled here; it is applied in a later migration (RLS task) for every table.
--   * Tier thresholds live in tier_rules only - never hardcode them in code (CLAUDE.md rule 3).

-- =====================================================================
-- 1. Enum types
-- =====================================================================
CREATE TYPE division        AS ENUM ('central', 'province');
CREATE TYPE user_role       AS ENUM ('host', 'admin', 'recorder', 'viewer');
CREATE TYPE sale_type       AS ENUM ('new', 'renew');
CREATE TYPE contract_status AS ENUM ('active', 'expired_pending_collection', 'closed', 'cancelled');
CREATE TYPE station_type    AS ENUM ('IG', 'AG', 'IC');
CREATE TYPE station_status  AS ENUM ('active', 'eliminated', 'pending_removal', 'removed');
CREATE TYPE visit_type      AS ENUM ('routine', 'problem', 'follow_up');
-- Termite caste ratio observed at a station (SPEC §7.5). NULL on a check = no termites found.
CREATE TYPE termite_caste   AS ENUM (
  'งาน>ทหาร', 'ทหาร>งาน', 'ทหาร', 'ทหาร+สืบพันธุ์สำรอง', 'สืบพันธุ์สำรอง', 'ปลวกตาย'
);
CREATE TYPE snapshot_source AS ENUM ('computed', 'legacy', 'manual');
CREATE TYPE audit_action    AS ENUM ('insert', 'update', 'delete');

-- =====================================================================
-- 2. Reference tables
-- =====================================================================
CREATE TABLE zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,            -- 'เขต 1' ... 'เขต 13'
  sort_order integer NOT NULL UNIQUE
);

CREATE TABLE branches (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id   uuid NOT NULL REFERENCES zones (id),
  name      text NOT NULL UNIQUE,             -- must match Dashboard spelling exactly
  division  division NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX branches_zone_id_idx ON branches (zone_id);
CREATE INDEX branches_division_idx ON branches (division);

CREATE TABLE teams (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches (id),    -- NULL = central team (phase 1)
  code      text NOT NULL,                    -- 'A'..'O', 'Z', 'Sup'
  name      text NOT NULL
);
-- One code per branch; NULL branch (central teams) is treated as a single scope.
CREATE UNIQUE INDEX teams_branch_code_uq
  ON teams (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE customer_types (
  code        text PRIMARY KEY,               -- short English code
  label       text NOT NULL UNIQUE,           -- Thai label shown in dropdown
  group_label text NOT NULL,                  -- Thai <optgroup> label
  sort_order  integer NOT NULL UNIQUE
);

-- Tier is resolved by the highest min_annual <= annual value (min_annual is the source
-- of truth). max_annual is informational/display only (NULL = unbounded, i.e. XL).
CREATE TABLE tier_rules (
  tier       text PRIMARY KEY CHECK (tier IN ('S', 'M', 'L', 'XL')),
  min_annual numeric(12, 2) NOT NULL CHECK (min_annual >= 0),
  max_annual numeric(12, 2),
  CHECK (max_annual IS NULL OR max_annual > min_annual)
);

-- =====================================================================
-- 3. Seed: zones (13)
-- =====================================================================
INSERT INTO zones (name, sort_order)
SELECT 'เขต ' || n, n FROM generate_series(1, 13) AS n;

-- =====================================================================
-- 4. Seed: branches (43 = central 24 + province 19) - SPEC §4
-- =====================================================================
INSERT INTO branches (zone_id, name, division)
SELECT z.id, b.name, b.division::division
FROM (VALUES
  ('เขต 1',  'พุทธมณฑล',      'central'),
  ('เขต 1',  'นครปฐม',        'central'),
  ('เขต 1',  'หัวหิน',        'central'),
  ('เขต 2',  'สาทร',          'central'),
  ('เขต 2',  'ปทุมวัน',       'central'),
  ('เขต 2',  'พระราม 4',      'central'),
  ('เขต 2',  'นนทบุรี',       'central'),
  ('เขต 3',  'ปทุมธานี',      'central'),
  ('เขต 3',  'รามอินทรา',     'central'),
  ('เขต 3',  'อยุธยา',        'central'),
  ('เขต 4',  'ลาดพร้าว',      'central'),
  ('เขต 4',  'พัฒนาการ',      'central'),
  ('เขต 4',  'สุวินทวงศ์',    'central'),
  ('เขต 4',  'ประชาชื่น',     'central'),
  ('เขต 5',  'สมุทรปราการ',   'central'),
  ('เขต 5',  'พัทยา',         'central'),
  ('เขต 5',  'ระยอง',         'central'),
  ('เขต 6',  'สุขุมวิท',      'central'),
  ('เขต 6',  'ปากน้ำ',        'central'),
  ('เขต 6',  'ชลบุรี',        'central'),
  ('เขต 7',  'เชียงราย',      'province'),
  ('เขต 7',  'เชียงใหม่',     'province'),
  ('เขต 7',  'ตาก',           'province'),
  ('เขต 7',  'พิษณุโลก',      'province'),
  ('เขต 8',  'โคราช',         'province'),
  ('เขต 8',  'ขอนแก่น',       'province'),
  ('เขต 8',  'อุดรธานี',      'province'),
  ('เขต 8',  'อุบลราชธานี',   'province'),
  ('เขต 9',  'ปากช่อง',       'central'),
  ('เขต 9',  'สระบุรี',       'central'),
  ('เขต 9',  'ลพบุรี',        'province'),
  ('เขต 10', 'สุราษฎร์ธานี',  'province'),
  ('เขต 10', 'เกาะสมุย',      'province'),
  ('เขต 10', 'พังงา',         'province'),
  ('เขต 11', 'กระบี่',        'province'),
  ('เขต 11', 'ภูเก็ต',        'province'),
  ('เขต 11', 'หาดใหญ่',       'province'),
  ('เขต 12', 'ระนอง',         'province'),
  ('เขต 12', 'นครศรีธรรมราช', 'province'),
  ('เขต 12', 'ตรัง',          'province'),
  ('เขต 12', 'ชุมพร',         'province'),
  ('เขต 13', 'พระราม 2',      'central'),
  ('เขต 13', 'ปราจีนบุรี',    'central')
) AS b (zone_name, name, division)
JOIN zones z ON z.name = b.zone_name;

-- =====================================================================
-- 5. Seed: teams (A-O, Z = new installation, Sup) - task.md
--    Phase 1: branch_id = NULL (central teams); assign branches later if needed.
-- =====================================================================
INSERT INTO teams (branch_id, code, name)
SELECT NULL, chr(64 + n), 'ทีม ' || chr(64 + n) FROM generate_series(1, 15) AS n;   -- A..O
INSERT INTO teams (branch_id, code, name) VALUES
  (NULL, 'Z',   'ทีม Z (ติดตั้งงานใหม่)'),
  (NULL, 'Sup', 'ทีม Sup');

-- =====================================================================
-- 6. Seed: customer_types (14 values / 4 groups) - task.md 2026-11-02
-- =====================================================================
INSERT INTO customer_types (code, label, group_label, sort_order) VALUES
  ('house',      'บ้านเดี่ยว',                       'ที่พักอาศัย',          1),
  ('townhome',   'ทาวน์โฮม / ตึกแถว',                'ที่พักอาศัย',          2),
  ('condo',      'คอนโด / อพาร์ตเมนต์ / หอพัก',      'ที่พักอาศัย',          3),
  ('office',     'ออฟฟิต',                           'ธุรกิจ / อุตสาหกรรม',  4),
  ('mall_shop',  'ห้าง / ร้านค้า',                   'ธุรกิจ / อุตสาหกรรม',  5),
  ('hotel',      'โรงแรม/รีสอร์ท',                   'ธุรกิจ / อุตสาหกรรม',  6),
  ('factory',    'โรงงาน',                           'ธุรกิจ / อุตสาหกรรม',  7),
  ('warehouse',  'โกดังสินค้า',                      'ธุรกิจ / อุตสาหกรรม',  8),
  ('hospital',   'โรงพยาบาล',                        'บริการ / สาธารณะ',     9),
  ('school',     'สถานศึกษา',                        'บริการ / สาธารณะ',     10),
  ('government', 'สถานที่ราชการ',                    'บริการ / สาธารณะ',     11),
  ('religious',  'สถานที่ทางศาสนา',                  'บริการ / สาธารณะ',     12),
  ('landmark',   'สถานที่สำคัญ',                     'บริการ / สาธารณะ',     13),
  ('other',      'อื่นๆ (ระบุในหมายเหตุ)',           'อื่นๆ',                14);

-- =====================================================================
-- 7. Seed: tier_rules - SPEC §7.1 (annual value = contract value / term years)
-- =====================================================================
INSERT INTO tier_rules (tier, min_annual, max_annual) VALUES
  ('S',  0,      29999.99),
  ('M',  30000,  49999.99),
  ('L',  50000,  99999.99),
  ('XL', 100000, NULL);
