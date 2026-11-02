import { json, fail, bodyJson, id, nowIso } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';

const SETTINGS = new Set(['default_participant_limit','member_promotion_threshold','publisher_posting_threshold','posting_pass_validity_hours','posting_progress_window_hours','daily_post_limit','daily_post_limit_enabled','daily_mission_limit','daily_mission_limit_enabled','daily_post_reset_time','daily_post_timezone','inactivity_days','inactivity_warning_days','auto_moderation_enabled','auto_watchlist_rejections_threshold','auto_watchlist_window_days','auto_restriction_rejections_threshold','auto_restriction_daily_post_limit','auto_restriction_duration_days']);
const integerSettings = new Set(['default_participant_limit','member_promotion_threshold','publisher_posting_threshold','posting_pass_validity_hours','posting_progress_window_hours','daily_post_limit','daily_mission_limit','inactivity_days','auto_watchlist_rejections_threshold','auto_watchlist_window_days','auto_restriction_rejections_threshold','auto_restriction_daily_post_limit','auto_restriction_duration_days']);
export async function adminRoutes(request,env){
 const url=new URL(request.url);const auth=await requireRole(request,env,['admin','assistant_admin']);if(auth.error)return auth.error;const admin=auth.member.role==='admin';
 if(url.pathname==='/api/admin/members'&&request.method==='GET'){
  const rows=await env.DB.prepare("SELECT id,display_name,picture_url,role,status,created_at,last_login_at,last_active_at,inactivity_notice_stage FROM members WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 300").all();return json({ok:true,members:rows.results||[]});
 }
 if(url.pathname==='/api/admin/members/approve'&&request.method==='POST'){
  const data=await bodyJson(request);if(!data?.memberId)return fail('INVALID_INPUT','กรุณาระบุสมาชิก',400);
  const r=await env.DB.prepare("UPDATE members SET status='active',approved_by=?,approved_at=?,last_active_at=COALESCE(last_active_at,?),updated_at=? WHERE id=? AND status='pending' AND deleted_at IS NULL").bind(auth.member.id,nowIso(),nowIso(),nowIso(),data.memberId).run();if(!r.meta?.changes)return fail('MEMBER_NOT_PENDING','ไม่พบสมาชิกที่รออนุมัติ',404);return json({ok:true});
 }
 if(url.pathname==='/api/admin/members/role'&&request.method==='POST'){
  if(!admin)return fail('FORBIDDEN','เฉพาะ Admin หลักเท่านั้นที่สามารถเปลี่ยนบทบาทได้',403);
  const data=await bodyJson(request);if(!data?.memberId||!['member','publisher','assistant_admin','admin'].includes(data.role))return fail('INVALID_INPUT','ข้อมูลบทบาทไม่ถูกต้อง',400);
  if(data.memberId===auth.member.id&&data.role!=='admin')return fail('SELF_DEMOTION_BLOCKED','ไม่สามารถลดสิทธิ์ตัวเองจากหน้านี้ได้',409);
  const old=await env.DB.prepare('SELECT role FROM members WHERE id=? AND deleted_at IS NULL').bind(data.memberId).first();if(!old)return fail('MEMBER_NOT_FOUND','ไม่พบสมาชิก',404);
  if(old.role==='admin'&&data.role!=='admin'){const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE role='admin' AND status='active' AND deleted_at IS NULL").first();if(Number(count.n)<=1)return fail('LAST_ADMIN_PROTECTED','ต้องมี Admin อย่างน้อยหนึ่งบัญชี',409);}
  const at=nowIso();await env.DB.batch([env.DB.prepare('UPDATE members SET role=?,updated_at=? WHERE id=?').bind(data.role,at,data.memberId),env.DB.prepare('INSERT INTO member_role_history(id,member_id,old_role,new_role,changed_by,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(),data.memberId,old.role,data.role,auth.member.id,String(data.reason||'Admin role change'),at)]);return json({ok:true});
 }
 if(url.pathname==='/api/admin/members/quota'&&request.method==='GET'){
  const memberId=url.searchParams.get('memberId');if(!memberId)return fail('INVALID_INPUT','กรุณาระบุสมาชิก',400);
  const row=await env.DB.prepare('SELECT daily_post_limit,daily_mission_limit,updated_by,updated_at FROM member_quota_overrides WHERE member_id=?').bind(memberId).first();
  return json({ok:true,quota:row||{daily_post_limit:null,daily_mission_limit:null}});
 }
 if(url.pathname==='/api/admin/members/quota'&&request.method==='PATCH'){
  const data=await bodyJson(request);if(!data?.memberId)return fail('INVALID_INPUT','กรุณาระบุสมาชิก',400);
  for(const k of ['dailyPostLimit','dailyMissionLimit'])if(data[k]!==undefined&&data[k]!==null&&(!Number.isInteger(Number(data[k]))||Number(data[k])<0||Number(data[k])>1000))return fail('INVALID_QUOTA','โควตาต้องเป็นจำนวนเต็มระหว่าง 0 ถึง 1000',400);
  const current=await env.DB.prepare('SELECT daily_post_limit,daily_mission_limit FROM member_quota_overrides WHERE member_id=?').bind(data.memberId).first();
  const postValue=data.dailyPostLimit===undefined?(current?.daily_post_limit??null):data.dailyPostLimit;
  const missionValue=data.dailyMissionLimit===undefined?(current?.daily_mission_limit??null):data.dailyMissionLimit;
  const at=nowIso();await env.DB.prepare(`INSERT INTO member_quota_overrides(member_id,daily_post_limit,daily_mission_limit,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET daily_post_limit=excluded.daily_post_limit,daily_mission_limit=excluded.daily_mission_limit,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(data.memberId,postValue,missionValue,auth.member.id,at).run();
  await env.DB.prepare("INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,'member_quota_updated','member',?,?,?)").bind(id(),auth.member.id,data.memberId,JSON.stringify({dailyPostLimit:postValue,dailyMissionLimit:missionValue}),at).run();return json({ok:true,dailyPostLimit:postValue,dailyMissionLimit:missionValue});
 }
 if(url.pathname==='/api/admin/makeup/assign'&&request.method==='POST'){
  const data=await bodyJson(request);if(!data?.makeupId||!data?.replacementPostId)return fail('INVALID_INPUT','กรุณาเลือกโพสต์ทดแทน',400);
  const makeup=await env.DB.prepare("SELECT member_id,excluded_post_id FROM makeup_missions WHERE id=? AND status='awaiting_assignment'").bind(data.makeupId).first();if(!makeup)return fail('MAKEUP_NOT_WAITING','ภารกิจชดเชยนี้ไม่ได้รอการมอบหมาย',409);
  const post=await env.DB.prepare("SELECT id FROM posts WHERE id=? AND status='open' AND id!=? AND owner_member_id!=? AND (SELECT COUNT(*) FROM mission_claims WHERE post_id=posts.id AND status!='cancelled')<participant_limit").bind(data.replacementPostId,makeup.excluded_post_id,makeup.member_id).first();if(!post)return fail('POST_UNAVAILABLE','โพสต์ทดแทนต้องเป็นโพสต์อื่นที่ยังเปิดและมีที่ว่าง',409);
  const r=await env.DB.prepare("UPDATE makeup_missions SET replacement_post_id=?,status='assigned',assigned_by=?,assigned_at=?,updated_at=? WHERE id=? AND status='awaiting_assignment'").bind(post.id,auth.member.id,nowIso(),nowIso(),data.makeupId).run();if(!r.meta?.changes)return fail('MAKEUP_NOT_WAITING','ภารกิจชดเชยนี้ถูกมอบหมายไปแล้ว',409);return json({ok:true});
 }
 if(url.pathname==='/api/admin/settings'&&request.method==='GET'){const rows=await env.DB.prepare('SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key').all();return json({ok:true,settings:rows.results||[]});}
 if(url.pathname==='/api/admin/settings'&&request.method==='PATCH'){
  const data=await bodyJson(request);if(!data?.key||data.value===undefined)return fail('INVALID_INPUT','ข้อมูลตั้งค่าไม่ครบ',400);
  if(!SETTINGS.has(data.key))return fail('SETTING_NOT_ALLOWED','ไม่อนุญาตให้แก้ไขการตั้งค่านี้',400);
  if(integerSettings.has(data.key)&&(!/^\d+$/.test(String(data.value))||Number(data.value)<0||Number(data.value)>10000))return fail('INVALID_SETTING_VALUE','ค่าต้องเป็นจำนวนเต็มในช่วงที่กำหนด',400);
  if(data.key==='daily_post_reset_time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.value)))return fail('INVALID_SETTING_VALUE','เวลารีเซ็ตต้องอยู่ในรูปแบบ HH:MM',400);
  if(data.key==='daily_post_timezone'&&data.value!=='Asia/Bangkok')return fail('INVALID_SETTING_VALUE','ระบบนี้ใช้เขตเวลา Asia/Bangkok',400);
  if(['daily_post_limit_enabled','daily_mission_limit_enabled','auto_moderation_enabled'].includes(data.key)&&!['true','false'].includes(String(data.value)))return fail('INVALID_SETTING_VALUE','ค่านี้ต้องเป็น true หรือ false',400);
  const at=nowIso();await env.DB.prepare('INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(data.key,String(data.value),auth.member.id,at).run();
  await env.DB.prepare("INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,'system_setting_updated','setting',?,?,?)").bind(id(),auth.member.id,data.key,JSON.stringify({value:String(data.value)}),at).run();return json({ok:true});
 }
 if(url.pathname==='/api/admin/watchlist'&&request.method==='GET'){
  if(!admin)return fail('FORBIDDEN','ข้อมูล Watchlist เป็นข้อมูลเฉพาะ Admin',403);const rows=await env.DB.prepare("SELECT w.*,m.display_name FROM member_watchlist w JOIN members m ON m.id=w.member_id ORDER BY w.created_at DESC").all();return json({ok:true,watchlist:rows.results||[]});
 }
 return fail('NOT_FOUND','ไม่พบเส้นทาง Admin',404);
}
