import { json, fail, bodyJson, id, nowIso } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
export async function adminRoutes(request,env){
 const url=new URL(request.url);const auth=await requireRole(request,env,['admin','assistant_admin']);if(auth.error)return auth.error;const admin=auth.member.role==='admin';
 if(url.pathname==='/api/admin/members'&&request.method==='GET'){
  const rows=await env.DB.prepare('SELECT id,display_name,picture_url,role,status,created_at,last_login_at FROM members ORDER BY created_at DESC LIMIT 300').all();return json({ok:true,members:rows.results||[]});
 }
 if(url.pathname==='/api/admin/members/approve'&&request.method==='POST'){
  const data=await bodyJson(request);if(!data?.memberId)return fail('INVALID_INPUT','กรุณาระบุสมาชิก',400);
  const r=await env.DB.prepare("UPDATE members SET status='active',approved_by=?,approved_at=?,updated_at=? WHERE id=? AND status='pending'").bind(auth.member.id,nowIso(),nowIso(),data.memberId).run();if(!r.meta?.changes)return fail('MEMBER_NOT_PENDING','ไม่พบสมาชิกที่รออนุมัติ',404);return json({ok:true});
 }
 if(url.pathname==='/api/admin/members/role'&&request.method==='POST'){
  if(!admin)return fail('FORBIDDEN','เฉพาะ Admin หลักเท่านั้นที่สามารถเปลี่ยนบทบาทได้',403);
  const data=await bodyJson(request);if(!data?.memberId||!['member','publisher','assistant_admin','admin'].includes(data.role))return fail('INVALID_INPUT','ข้อมูลบทบาทไม่ถูกต้อง',400);
  if(data.memberId===auth.member.id&&data.role!=='admin')return fail('SELF_DEMOTION_BLOCKED','ไม่สามารถลดสิทธิ์ตัวเองจากหน้านี้ได้',409);
  const old=await env.DB.prepare('SELECT role FROM members WHERE id=?').bind(data.memberId).first();if(!old)return fail('MEMBER_NOT_FOUND','ไม่พบสมาชิก',404);
  await env.DB.batch([env.DB.prepare('UPDATE members SET role=?,updated_at=? WHERE id=?').bind(data.role,nowIso(),data.memberId),env.DB.prepare('INSERT INTO member_role_history(id,member_id,old_role,new_role,changed_by,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(),data.memberId,old.role,data.role,auth.member.id,String(data.reason||'Admin role change'),nowIso())]);return json({ok:true});
 }
 if(url.pathname==='/api/admin/makeup/assign'&&request.method==='POST'){
  const data=await bodyJson(request);if(!data?.makeupId||!data?.replacementPostId)return fail('INVALID_INPUT','กรุณาเลือกโพสต์ทดแทน',400);
  const post=await env.DB.prepare("SELECT id FROM posts WHERE id=? AND status='open'").bind(data.replacementPostId).first();if(!post)return fail('POST_UNAVAILABLE','โพสต์ทดแทนไม่พร้อมใช้งาน',409);
  const r=await env.DB.prepare("UPDATE makeup_missions SET replacement_post_id=?,status='assigned',assigned_by=?,assigned_at=?,updated_at=? WHERE id=? AND status='awaiting_assignment'").bind(post.id,auth.member.id,nowIso(),nowIso(),data.makeupId).run();if(!r.meta?.changes)return fail('MAKEUP_NOT_WAITING','ภารกิจชดเชยนี้ไม่ได้รอการมอบหมาย',409);return json({ok:true});
 }
 if(url.pathname==='/api/admin/settings'&&request.method==='GET'){const rows=await env.DB.prepare('SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key').all();return json({ok:true,settings:rows.results||[]});}
 if(url.pathname==='/api/admin/settings'&&request.method==='PATCH'){
  if(!admin)return fail('FORBIDDEN','เฉพาะ Admin หลักเท่านั้นที่แก้การตั้งค่าระบบได้',403);const data=await bodyJson(request);if(!data?.key||data.value===undefined)return fail('INVALID_INPUT','ข้อมูลตั้งค่าไม่ครบ',400);
  await env.DB.prepare('INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(String(data.key),String(data.value),auth.member.id,nowIso()).run();return json({ok:true});
 }
 if(url.pathname==='/api/admin/watchlist'&&request.method==='GET'){
  if(!admin)return fail('FORBIDDEN','ข้อมูล Watchlist เป็นข้อมูลเฉพาะ Admin',403);const rows=await env.DB.prepare("SELECT w.*,m.display_name FROM member_watchlist w JOIN members m ON m.id=w.member_id ORDER BY w.created_at DESC").all();return json({ok:true,watchlist:rows.results||[]});
 }
 return fail('NOT_FOUND','ไม่พบเส้นทาง Admin',404);
}
