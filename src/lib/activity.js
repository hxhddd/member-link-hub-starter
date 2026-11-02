import { id, nowIso } from './http.js';

export async function recordActivity(env, memberId, type, relatedId = null) {
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE members SET last_active_at=?, inactivity_notice_stage=0, deletion_due_at=NULL, updated_at=? WHERE id=? AND role IN (\'member\',\'publisher\')').bind(at, at, memberId),
    env.DB.prepare('INSERT INTO member_activity_events(id,member_id,activity_type,related_id,created_at) VALUES(?,?,?,?,?)').bind(id(), memberId, type, relatedId, at)
  ]);
}

export function bangkokUsageDate(now = new Date(), reset = '05:00') {
  const [rh, rm] = reset.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
  let day = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) * 60 + Number(p.minute) < rh * 60 + rm) {
    const d = new Date(`${day}T00:00:00+07:00`); d.setUTCDate(d.getUTCDate()-1);
    day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  return day;
}

export async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT setting_value FROM app_settings WHERE setting_key=?').bind(key).first();
  return row?.setting_value ?? String(fallback);
}

export async function addNotification(env, memberId, type, title, message, dedupeKey, relatedId = null) {
  await env.DB.prepare(`INSERT OR IGNORE INTO member_notifications(id,member_id,notification_type,title,message,related_id,created_at,dedupe_key) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id(),memberId,type,title,message,relatedId,nowIso(),dedupeKey).run();
}
