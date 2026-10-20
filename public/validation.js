export const text = (value, max = 2000) => typeof value === 'string' && value.length <= max;
export function validateRecord(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = key === 'draft:active';
  if (value.id !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)) return false;
  if (!draft && (!key.startsWith('session:') || key.slice(8) !== value.id || !text(value.date, 40) || !Number.isFinite(Date.parse(value.date)))) return false;
  if (!['Push', 'Pull', 'Legs'].includes(value.day)) return false;
  if (!draft && value.status !== undefined && !['planned', 'done'].includes(value.status)) return false;
  if (value.planId !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(value.planId)) return false;
  if (value.notes !== undefined && !text(value.notes)) return false;
  if (!Array.isArray(value.entries) || value.entries.length > 100) return false;
  if (!value.entries.every(e => e && text(e.exercise, 200) && e.exercise.trim() &&
      (e.group === undefined || text(e.group, 200)) && (e.note === undefined || text(e.note)) &&
      Array.isArray(e.sets) && e.sets.length <= 100 && e.sets.every(s => s &&
        Number.isFinite(s.w) && s.w >= 0 && s.w <= 2000 && Number.isInteger(s.r) && s.r > 0 && s.r <= 10000 &&
        (s.rpe == null || (Number.isFinite(s.rpe) && s.rpe >= 1 && s.rpe <= 10))))) return false;
  if (value.meta !== undefined) {
    const m = value.meta;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    for (const k of ['bodyweight', 'sleep', 'commuteTime']) {
      if (m[k] !== undefined && (!Number.isFinite(m[k]) || m[k] < 0 || m[k] > 2000)) return false;
    }
    if (m.feel !== undefined && !text(m.feel)) return false;
    if (m.commute !== undefined && !text(m.commute, 100)) return false;
  }
  return true;
}
