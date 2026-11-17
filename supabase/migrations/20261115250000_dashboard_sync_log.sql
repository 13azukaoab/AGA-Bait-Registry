-- M27 (phase 5): บันทึกการส่งข้อมูลเข้า AGA Bait Dashboard — ตาราง sync_logs + RPC เริ่ม/จบรอบ
-- (SPEC §9.2 "บันทึกผลทุกครั้ง (สำเร็จ/ล้มเหลว) ให้ Host เห็นในหน้าจอ 10" · mockup docs/mockup/dashboard-sync.html)
--
-- Logic summary:
--   1. sync_logs = 1 แถวต่อการส่ง 1 รอบ (ชื่อตรงกับ lib/dashboard/sync.ts)
--      - source       : 'auto' (Vercel Cron 06:00) | 'manual' (host กด "ส่งตอนนี้")
--                       + เผื่อช่องทางตาม mockup: 'close' | 'resync' | 'export' (ยังไม่มีทางเขียน — RPC ปฏิเสธ
--                         จนกว่าจะทำหน้าปิดเดือน/Export · ตอนนั้นแก้แค่ start_sync_log ไม่ต้องแก้ตาราง)
--      - triggered_by : ผู้กด (auth.uid() — RPC ตั้งเอง ห้ามรับจากผู้เรียก) · NULL = cron
--      - started_at / finished_at · result: success | skipped (ข้อมูลไม่เปลี่ยน ไม่ commit) | failed
--        (NULL = กำลังส่ง)
--      - error_code (สั้น ≤ 40) + error_message (≤ 500) · months_sent = key เดือน MMM.YY ที่ข้อมูลเปลี่ยนในรอบนี้
--        · month_count = จำนวนเดือนทั้งไฟล์ · commit_sha (40 hex)
--      - **ไม่มี token / ความลับ / ข้อมูลลูกค้า** ในทุกช่อง (ฝั่ง app ตัดข้อความให้สั้น · ตัวเลขสรุปรายสาขาไม่อยู่ที่นี่)
--   2. สิทธิ์ (RLS เปิด · กัน 2 ชั้น สิทธิ์ + RLS):
--      - อ่าน: host เท่านั้น (mockup: admin/recorder เห็นหน้าล็อก) · anon / viewer / admin / recorder ไม่ได้
--      - เขียน: ไม่มี INSERT/UPDATE/DELETE ผ่าน REST ทุก role (รวม service_role) → ต้องผ่าน RPC 2 ตัว
--   3. start_sync_log(p_source) → id ของรอบ (SECURITY DEFINER)
--      - 'auto'   : เฉพาะ service_role (cron ฝั่ง server) · triggered_by = NULL
--      - 'manual' : เฉพาะ host (is_host() ตรวจที่ DB — ไม่เชื่อ role ฝั่ง client) · triggered_by = auth.uid()
--      - กันส่งซ้อน: lock (pg_advisory_xact_lock) → แถวที่ยังไม่จบและเริ่มเกิน 10 นาที = ค้าง → ปิดเป็น failed/timeout
--        → ยังมีรอบที่กำลังส่ง (เริ่มไม่ถึง 10 นาที) →
--          * manual: error SY001 (หน้าจอบอก "กำลังส่งอยู่ รอสักครู่")
--          * auto  : บันทึกแถว skipped/busy ทันที (ให้ประวัติเห็นว่ารอบ 06:00 ไม่ได้ส่งเพราะอะไร) แล้วคืน NULL
--        10 นาที > maxDuration ของ route (60 วินาที) เผื่อเวลา GitHub ช้า
--   4. finish_sync_log(id, result, error_code, error_message, months_sent, month_count, commit_sha)
--      - แก้ได้เฉพาะแถวที่ยังไม่จบ · service_role แก้แถว auto · ผู้เปิดรอบ manual (triggered_by) แก้แถวของตัวเอง
--        (ไม่ตรวจ is_host ซ้ำ — เปิดรอบได้ต้องเป็น host อยู่แล้ว · ถูกถอดสิทธิ์กลางรอบยังปิดผลจริงได้)
--      - ตรวจรูปแบบค่าด้วย CHECK ของตาราง (result ต้องคู่กับ finished_at, sha 40 hex, ข้อความไม่เกิน 500)
--   5. ไม่ต้องลง audit_log (ตารางนี้เป็นบันทึกอยู่แล้ว · ไม่แตะ audit_trigger)
--   * error ใหม่: SY001 (มีการส่งอื่นกำลังทำงาน) · SY002 (ช่องทาง/ผลลัพธ์ไม่ถูกต้อง) · SY003 (ไม่พบรอบที่ยังไม่จบ)
--     · 42501 (ไม่มีสิทธิ์)

-- =====================================================================
-- 1. ตาราง
-- =====================================================================
CREATE TABLE public.sync_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source        text NOT NULL
                  CONSTRAINT sync_logs_source_valid
                  CHECK (source IN ('auto', 'manual', 'close', 'resync', 'export')),
  triggered_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  result        text
                  CONSTRAINT sync_logs_result_valid
                  CHECK (result IN ('success', 'skipped', 'failed')),
  error_code    text CONSTRAINT sync_logs_error_code_len CHECK (char_length(error_code) <= 40),
  error_message text CONSTRAINT sync_logs_error_message_len CHECK (char_length(error_message) <= 500),
  months_sent   text[] NOT NULL DEFAULT '{}'
                  CONSTRAINT sync_logs_months_sent_len CHECK (cardinality(months_sent) <= 120)
                  -- ทุกตัวต้องเป็น key เดือน MMM.YY (array_to_string รวมแล้วตรวจทั้งก้อน — CHECK ใช้ subquery ไม่ได้)
                  CONSTRAINT sync_logs_months_sent_format
                  CHECK (array_to_string(months_sent, ',') ~ '^([A-Z]{3}\.[0-9]{2}(,[A-Z]{3}\.[0-9]{2})*)?$'),
  month_count   int CONSTRAINT sync_logs_month_count_range CHECK (month_count BETWEEN 0 AND 1000),
  commit_sha    text CONSTRAINT sync_logs_commit_sha_hex CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  -- ยังไม่จบ = ไม่มีผล · จบแล้ว = ต้องมีผล
  CONSTRAINT sync_logs_finished_has_result
    CHECK ((finished_at IS NULL) = (result IS NULL)),
  -- commit sha มีได้เฉพาะรอบที่สำเร็จ
  CONSTRAINT sync_logs_sha_only_on_success
    CHECK (commit_sha IS NULL OR result = 'success')
);

COMMENT ON TABLE public.sync_logs IS
  'M27: ประวัติการส่งข้อมูลเข้า AGA Bait Dashboard (SPEC §9.2) — host อ่าน · เขียนผ่าน start_sync_log/finish_sync_log เท่านั้น · ห้ามเก็บ token/ข้อมูลลูกค้า';
COMMENT ON COLUMN public.sync_logs.triggered_by IS 'ผู้กดส่ง (auth.uid() ที่ RPC ตั้งเอง) · NULL = Vercel Cron';
COMMENT ON COLUMN public.sync_logs.months_sent IS 'key เดือน MMM.YY ที่ข้อมูลเปลี่ยนจากบน repo ในรอบนี้ (ข้าม/ล้มเหลว = ว่าง)';
COMMENT ON COLUMN public.sync_logs.month_count IS 'จำนวนเดือนทั้งไฟล์ที่สร้าง (แต่ละเดือนครบ 43 สาขา)';

CREATE INDEX sync_logs_started_at_idx ON public.sync_logs (started_at DESC);
-- หา "รอบที่กำลังส่ง" เร็ว (ปกติมี 0–1 แถว)
CREATE INDEX sync_logs_running_idx ON public.sync_logs (started_at) WHERE finished_at IS NULL;

-- =====================================================================
-- 2. สิทธิ์ + RLS
-- =====================================================================
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sync_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sync_logs TO authenticated, service_role;

CREATE POLICY sync_logs_host_select ON public.sync_logs
  FOR SELECT TO authenticated USING (public.is_host());

-- service_role ข้าม RLS อยู่แล้ว (ใช้อ่านตอนทดสอบ/ตรวจ) · ไม่มี policy เขียนสำหรับใครเลย

-- =====================================================================
-- 3. start_sync_log
-- =====================================================================
CREATE FUNCTION public.start_sync_log(p_source text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := coalesce(current_setting('role', true), '') = 'service_role'
                          OR coalesce(auth.role(), '') = 'service_role';
  v_uid        uuid := auth.uid();
  v_id         bigint;
BEGIN
  IF p_source = 'auto' THEN
    IF NOT v_is_service THEN
      RAISE EXCEPTION 'Auto Sync เรียกได้เฉพาะระบบ (cron)' USING ERRCODE = '42501';
    END IF;
    v_uid := NULL;
  ELSIF p_source = 'manual' THEN
    IF v_uid IS NULL OR NOT public.is_host() THEN
      RAISE EXCEPTION 'ส่งข้อมูลเข้า Dashboard ได้เฉพาะ OM/PM (host)' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- close / resync / export: ยังไม่มีหน้าจอ — เปิดเมื่อทำหน้าปิดเดือน/Export (แก้ฟังก์ชันนี้ ไม่ต้องแก้ตาราง)
    RAISE EXCEPTION 'ช่องทางส่ง "%" ยังไม่รองรับ', p_source USING ERRCODE = 'SY002';
  END IF;

  -- คิวเดียวทั้งระบบ: รอบอื่นที่เรียกพร้อมกันต้องรอ lock แล้วเห็นแถวที่เพิ่ง insert
  PERFORM pg_advisory_xact_lock(hashtext('public.sync_logs'));

  -- รอบที่ค้างเกิน 10 นาที (route ล่ม/หมดเวลา) → ปิดเป็นล้มเหลว ไม่ให้บล็อกตลอดไป
  UPDATE sync_logs
     SET finished_at   = now(),
         result        = 'failed',
         error_code    = 'timeout',
         error_message = 'รอบนี้ไม่ได้บันทึกผลภายใน 10 นาที (ระบบหยุดกลางทาง)'
   WHERE finished_at IS NULL
     AND started_at < now() - interval '10 minutes';

  IF EXISTS (SELECT 1 FROM sync_logs WHERE finished_at IS NULL) THEN
    IF p_source = 'auto' THEN
      INSERT INTO sync_logs (source, triggered_by, finished_at, result, error_code, error_message)
      VALUES ('auto', NULL, now(), 'skipped', 'busy', 'มีการส่งอื่นกำลังทำงานอยู่ รอบนี้ข้าม');
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'มีการส่งข้อมูลเข้า Dashboard กำลังทำงานอยู่ รอสักครู่แล้วลองใหม่' USING ERRCODE = 'SY001';
  END IF;

  INSERT INTO sync_logs (source, triggered_by)
  VALUES (p_source, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.start_sync_log(text) IS
  'M27: เริ่มรอบส่ง Dashboard — auto = service_role · manual = host · กันส่งซ้อน (SY001) · คืน id (auto ที่ชนรอบอื่น = NULL + แถว skipped/busy)';

-- =====================================================================
-- 4. finish_sync_log
-- =====================================================================
CREATE FUNCTION public.finish_sync_log(
  p_id            bigint,
  p_result        text,
  p_error_code    text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_months_sent   text[] DEFAULT '{}',
  p_month_count   int DEFAULT NULL,
  p_commit_sha    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := coalesce(current_setting('role', true), '') = 'service_role'
                          OR coalesce(auth.role(), '') = 'service_role';
  v_row        sync_logs%ROWTYPE;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('success', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'ผลการส่งไม่ถูกต้อง: %', p_result USING ERRCODE = 'SY002';
  END IF;

  SELECT * INTO v_row FROM sync_logs WHERE id = p_id FOR UPDATE;

  IF NOT FOUND OR v_row.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบรอบส่งที่ยังไม่จบ (id %)', p_id USING ERRCODE = 'SY003';
  END IF;

  IF v_is_service THEN
    IF v_row.source <> 'auto' THEN
      RAISE EXCEPTION 'ระบบปิดได้เฉพาะรอบ Auto Sync' USING ERRCODE = '42501';
    END IF;
  -- ผู้เปิดรอบปิดรอบของตัวเองได้แม้ถูกถอดสิทธิ์ host ระหว่างทาง (ไม่งั้น commit แล้วแต่ log ค้างเป็น timeout)
  ELSIF v_row.source <> 'manual'
        OR auth.uid() IS NULL
        OR v_row.triggered_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกผลรอบนี้' USING ERRCODE = '42501';
  END IF;

  UPDATE sync_logs
     SET finished_at   = now(),
         result        = p_result,
         error_code    = nullif(left(btrim(p_error_code), 40), ''),
         error_message = nullif(left(btrim(p_error_message), 500), ''),
         months_sent   = coalesce(p_months_sent, '{}'),
         month_count   = p_month_count,
         commit_sha    = CASE WHEN p_result = 'success' THEN lower(p_commit_sha) END
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.finish_sync_log(bigint, text, text, text, text[], int, text) IS
  'M27: จบรอบส่ง Dashboard — service_role ปิดรอบ auto · host ปิดรอบ manual ของตัวเอง · แก้ได้ครั้งเดียว (SY003)';

REVOKE ALL ON FUNCTION public.start_sync_log(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_sync_log(bigint, text, text, text, text[], int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_sync_log(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_sync_log(bigint, text, text, text, text[], int, text) TO authenticated, service_role;
