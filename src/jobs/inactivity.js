import { id, nowIso } from '../lib/http.js';
import { addNotification, getSetting } from '../lib/activity.js';

export async function runInactivitySweep(env, now = new Date()) {
  const days = Math.max(1, Math.min(90, Number(await getSetting(env,'inactivity_days',7)) || 7));
  const warnings = (await getSetting(env,'inactivity_warning_days','5,6')).split(',').map(Number).filter(n => n > 0 && n < days);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const firstWarning = warnings.length ? Math.min(...warnings) : days;
  const scanCutoff = new Date(now.getTime() - firstWarning * 86400000).toISOString();
  const members = await env.DB.prepare(`SELECT id,role,COALESCE(last_active_at,created_at) AS last_active_at,inactivity_notice_stage FROM members WHERE role IN ('member','publisher') AND status IN ('active','pending','suspended') AND COALESCE(last_active_at,created_at)<=? AND deleted_at IS NULL`).bind(scanCutoff).all();
  let deleted = 0;
  for (const m of (members.results || [])) {
    const ageDays = Math.floor((now.getTime() - Date.parse(m.last_active_at)) / 86400000);
    if (ageDays >= days) {
      const due = nowIso();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,NULL,'member_auto_deleted_inactive','member',?,?,?)`).bind(id(),m.id,JSON.stringify({role:m.role,lastActiveAt:m.last_active_at,inactivityDays:days}),due),
        env.DB.prepare(`DELETE FROM auth_sessions WHERE member_id=?`).bind(m.id),
        env.DB.prepare(`DELETE FROM member_notifications WHERE member_id=?`).bind(m.id),
        env.DB.prepare(`UPDATE members SET line_user_id='deleted:'||id,display_name=NULL,picture_url=NULL,status='suspended',role='member',posting_pass_available=0,posting_pass_expires_at=NULL,posting_progress_count=0,posting_progress_started_at=NULL,last_active_at=NULL,deleted_at=?,updated_at=? WHERE id=? AND role IN ('member','publisher') AND deleted_at IS NULL AND COALESCE(last_active_at,created_at)<=?`).bind(due,due,m.id,cutoff)
      ]);
      deleted++;
      continue;
    }
    for (const warningDay of warnings) {
      if (ageDays >= warningDay && Number(m.inactivity_notice_stage || 0) < warningDay) {
        await addNotification(env,m.id,'inactivity_warning','บัญชีใกล้หมดอายุ',`บัญชีของคุณไม่มีการทำภารกิจหรือโพสต์มาแล้ว ${ageDays} วัน กรุณากลับมาใช้งานก่อนครบ ${days} วัน` ,`inactive:${m.id}:${warningDay}`);
        await env.DB.prepare('UPDATE members SET inactivity_notice_stage=? WHERE id=? AND inactivity_notice_stage<?').bind(warningDay,m.id,warningDay).run();
      }
    }
  }
  await env.DB.prepare('UPDATE members SET posting_progress_count=0,posting_progress_started_at=NULL,updated_at=? WHERE posting_progress_started_at IS NOT NULL AND posting_progress_started_at<=?').bind(nowIso(),new Date(now.getTime()-48*86400000).toISOString()).run();
  await env.DB.prepare('UPDATE members SET posting_pass_available=0,posting_pass_expires_at=NULL,updated_at=? WHERE posting_pass_available=1 AND posting_pass_expires_at IS NOT NULL AND posting_pass_expires_at<=?').bind(nowIso(),nowIso()).run();
  await env.DB.prepare("DELETE FROM member_daily_usage WHERE usage_date<date('now','-30 days')").run();
  await env.DB.prepare("DELETE FROM member_notifications WHERE created_at<datetime('now','-90 days')").run();
  await env.DB.prepare('DELETE FROM auth_login_states WHERE expires_at<=?').bind(nowIso()).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(nowIso()).run();
  return { scanned:(members.results||[]).length, deleted };
}
