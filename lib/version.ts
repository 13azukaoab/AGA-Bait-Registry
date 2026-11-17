/**
 * จัดรูปเลขเวอร์ชันสำหรับแสดงบนหน้าจอ (SemVer — DECISIONS 2.58)
 * - มี commit sha → "v0.7.0 · a1b2c3d"
 * - ไม่มี sha (เช่น รันในเครื่อง) → "v0.7.0"
 */
export function formatVersion(version: string, sha: string): string {
  const v = version.trim();
  const s = sha.trim();
  return s ? `v${v} · ${s}` : `v${v}`;
}
