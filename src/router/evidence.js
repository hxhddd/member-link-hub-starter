import { json, fail, bodyJson, id, nowIso, isShopeeUrl } from '../lib/http.js';
import { requireMember, requireRole } from '../lib/auth.js';
import { recordActivity } from '../lib/activity.js';

export async function evidenceRoutes(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/api/evidence'&&request.method==='POST'){
  const auth=await requireMember(request,env);if(auth.error)return auth.error;
  const data=await bodyJson(request);if(!data?.claimId||!isShopeeUrl(data.shopeeUrl))return fail('INVALID_EVIDENCE_URL','กรุณาส่งลิงก์สินค้าจาก Shopee ประเทศไทย',400);
  const claim=await env.DB.prepare("SELECT c.id,c.post_id,c.status,p.owner_member_id FROM mission_claims c JOIN posts p ON p.id=c.post_id WHERE c.id=? AND c.member_id=?").bind(data.claimId,auth.member.id).first();
  if(!claim||claim.status!=='claimed')return fail('CLAIM_NOT_AVAILABLE','ไม่พบภารกิจที่ยังส่งหลักฐานได้',409);
  const evidenceId=id();const time=nowIso();
  const makeup=await env.DB.prepare("SELECT id FROM makeup_missions WHERE member_id=? AND replacement_post_id=? AND status='assigned' LIMIT 1").bind(auth.member.id,claim.post_id).first();
  try{await env.DB.batch([
   env.DB.prepare("INSERT INTO evidence_submissions(id,claim_id,submitted_by,shopee_url,idempotency_key,owner_review_status,admin_review_status,created_at,updated_at) VALUES(?,?,?,?,?,'pending','not_required',?,?)").bind(evidenceId,claim.id,auth.member.id,data.shopeeUrl,data.idempotencyKey||null,time,time),
   env.DB.prepare("UPDATE mission_claims SET status='submitted',submitted_at=? WHERE id=?").bind(time,claim.id),
   ...(makeup?[]:[env.DB.prepare("INSERT INTO mission_credit_events(id,member_id,evidence_id,event_type,reason,created_at) VALUES(?,?,?,'credit_granted','เครดิตจากการส่งหลักฐาน',?)").bind(id(),auth.member.id,evidenceId,time)]),
   ...(makeup?[env.DB.prepare("UPDATE makeup_missions SET status='completed',completion_evidence_id=?,completed_at=?,updated_at=? WHERE id=? AND status='assigned'").bind(evidenceId,time,time,makeup.id)]:[])
  ]);}catch{return fail('EVIDENCE_ALREADY_SUBMITTED','ภารกิจนี้มีการส่งหลักฐานแล้ว',409);}
  await recordActivity(env,auth.member.id,'mission_evidence_submitted',evidenceId);
  if(!makeup)await updateProgress(env,auth.member.id,evidenceId);
  return json({ok:true,evidenceId,creditGranted:!makeup,makeupCompleted:!!makeup},201);
 }
 if(url.pathname==='/api/evidence/owner-rejection'&&request.method==='POST'){
  const auth=await requireRole(request,env,['publisher','admin']);if(auth.error)return auth.error;
  const data=await bodyJson(request);if(!data?.evidenceId||!data?.reason?.trim())return fail('REASON_REQUIRED','กรุณาระบุเหตุผลที่ปฏิเสธ',400);
  const evidence=await env.DB.prepare('SELECT e.id,p.owner_member_id FROM evidence_submissions e JOIN mission_claims c ON c.id=e.claim_id JOIN posts p ON p.id=c.post_id WHERE e.id=?').bind(data.evidenceId).first();
  if(!evidence|| (auth.member.role!=='admin'&&evidence.owner_member_id!==auth.member.id))return fail('NOT_AUTHORIZED','คุณไม่มีสิทธิ์ตรวจหลักฐานนี้',403);
  await env.DB.prepare("UPDATE evidence_submissions SET owner_review_status='flagged',owner_rejection_reason=?,admin_review_status='pending',updated_at=? WHERE id=? AND owner_review_status='pending'").bind(String(data.reason).slice(0,1000),nowIso(),data.evidenceId).run();
  await audit(env,auth.member.id,'owner_rejection_requested','evidence',data.evidenceId,{reason:data.reason});return json({ok:true,adminReviewRequired:true});
 }
 if(url.pathname==='/api/evidence/admin-review'&&request.method==='POST'){
  const auth=await requireRole(request,env,['admin']);if(auth.error)return auth.error;
  const data=await bodyJson(request);if(!data?.evidenceId||!['confirm_invalid','overturn'].includes(data.decision))return fail('INVALID_REVIEW','กรุณาระบุการตัดสินใจ',400);
  const e=await env.DB.prepare(`SELECT e.*,c.post_id,c.member_id AS claimant_id,p.participant_limit,p.status AS post_status,p.closed_at FROM evidence_submissions e JOIN mission_claims c ON c.id=e.claim_id JOIN posts p ON p.id=c.post_id WHERE e.id=?`).bind(data.evidenceId).first();
  if(!e||e.admin_review_status!=='pending')return fail('REVIEW_NOT_PENDING','หลักฐานนี้ไม่ได้รอ Admin ตรวจสอบ',409);
  const time=nowIso();const note=String(data.note||'').slice(0,1000);
  if(data.decision==='overturn'){
   await env.DB.batch([env.DB.prepare("UPDATE evidence_submissions SET owner_review_status='confirmed',admin_review_status='overturned',admin_review_note=?,admin_reviewed_by=?,admin_reviewed_at=?,updated_at=? WHERE id=? AND admin_review_status='pending'").bind(note,auth.member.id,time,time,e.id),env.DB.prepare("INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,'admin_overturned_owner_rejection','evidence',?,?,?)").bind(id(),auth.member.id,e.id,JSON.stringify({note}),time)]);
   return json({ok:true,decision:'overturned',creditReversed:false,capacityAdded:false,makeupCreated:false});
  }
  const limitAfter=e.participant_limit+1;const makeupId=id();
  await env.DB.batch([
   env.DB.prepare("UPDATE evidence_submissions SET admin_review_status='confirmed_invalid',admin_review_note=?,admin_reviewed_by=?,admin_reviewed_at=?,updated_at=? WHERE id=? AND admin_review_status='pending'").bind(note,auth.member.id,time,time,e.id),
   env.DB.prepare("INSERT OR IGNORE INTO mission_credit_events(id,member_id,evidence_id,event_type,reason,actor_member_id,created_at) VALUES(?,?,?,'credit_reversed',?,?,?)").bind(id(),e.claimant_id,e.id,note||'Admin ยืนยันว่าหลักฐานไม่ถูกต้อง',auth.member.id,time),
   env.DB.prepare("INSERT OR IGNORE INTO post_capacity_adjustments(id,post_id,source_evidence_id,adjustment,limit_before,limit_after,approved_by,reason,created_at) VALUES(?,?,?,1,?,?,?,?,?)").bind(id(),e.post_id,e.id,e.participant_limit,limitAfter,auth.member.id,note||'เพิ่มช่องทดแทนหลักฐานที่ Admin ยืนยันว่าไม่ถูกต้อง',time),
   env.DB.prepare("UPDATE posts SET participant_limit=participant_limit+1,status=CASE WHEN status='full' AND closed_at IS NULL THEN 'open' ELSE status END,updated_at=? WHERE id=? AND status IN ('open','full') AND closed_at IS NULL AND participant_limit=? AND EXISTS(SELECT 1 FROM post_capacity_adjustments WHERE source_evidence_id=? AND limit_after=?)").bind(time,e.post_id,e.participant_limit,e.id,limitAfter),
   env.DB.prepare("INSERT OR IGNORE INTO makeup_missions(id,member_id,source_evidence_id,excluded_post_id,task_type,status,reason,assigned_by,created_at,updated_at) VALUES(?,?,?,?, 'video','awaiting_assignment',?,?,?,?)").bind(makeupId,e.claimant_id,e.id,e.post_id,note||'ภารกิจชดเชยจากหลักฐานที่ถูกปฏิเสธ',auth.member.id,time,time),
   env.DB.prepare("INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,'admin_confirmed_invalid_evidence','evidence',?,?,?)").bind(id(),auth.member.id,e.id,JSON.stringify({note,capacityBefore:e.participant_limit,capacityAfter:limitAfter,makeupId}),time)
  ]);
  await recomputeProgress(env,e.claimant_id);
  return json({ok:true,decision:'confirmed_invalid',creditReversed:true,capacityAdded:true,makeupCreated:true,makeupId,postReopened:e.post_status==='full'&&e.closed_at===null});
 }
 if(url.pathname==='/api/evidence/mine'&&request.method==='GET'){
  const auth=await requireMember(request,env);if(auth.error)return auth.error;
  const rows=await env.DB.prepare('SELECT id,claim_id,shopee_url,owner_review_status,admin_review_status,created_at FROM evidence_submissions WHERE submitted_by=? ORDER BY created_at DESC').bind(auth.member.id).all();return json({ok:true,evidence:rows.results||[]});
 }
 return fail('NOT_FOUND','ไม่พบเส้นทางหลักฐาน',404);
}
async function updateProgress(env,memberId,evidenceId){
 const now=Date.now(),at=nowIso(),windowMs=48*3600_000;
 const member=await env.DB.prepare('SELECT role,publisher_promoted_at,posting_progress_count,posting_progress_started_at,posting_published_count FROM members WHERE id=?').bind(memberId).first();
 if(!member)return;
 const existingStart=member.posting_progress_started_at?Date.parse(member.posting_progress_started_at):0;
 const validWindow=existingStart>0 && now-existingStart<windowMs;
 const evidenceTime=await env.DB.prepare('SELECT created_at FROM evidence_submissions WHERE id=?').bind(evidenceId).first();
 const windowStart=validWindow?member.posting_progress_started_at:(evidenceTime?.created_at||at);
 const credits=await env.DB.prepare(`SELECT COUNT(DISTINCT c.post_id) AS total FROM mission_credit_events g
  JOIN evidence_submissions e ON e.id=g.evidence_id JOIN mission_claims c ON c.id=e.claim_id
  WHERE g.member_id=? AND g.event_type='credit_granted' AND g.created_at>=?
  AND NOT EXISTS(SELECT 1 FROM mission_credit_events r WHERE r.evidence_id=g.evidence_id AND r.event_type='credit_reversed')`).bind(memberId,windowStart).first();
 const count=Number(credits?.total||0);
 if(member.role==='member'){
  if(count>=30){
   await env.DB.batch([
    env.DB.prepare("UPDATE members SET role='publisher',publisher_promoted_at=?,posting_progress_count=0,posting_progress_started_at=NULL,updated_at=? WHERE id=? AND role='member'").bind(at,at,memberId),
    env.DB.prepare("INSERT INTO posting_pass_events(id,member_id,event_type,progress_count,details_json,created_at) VALUES(?,?,'publisher_promoted',30,?,?)").bind(id(),memberId,JSON.stringify({triggerEvidenceId:evidenceId,windowHours:48,distinctPosts:count}),at)
   ]);
  }else{
   await env.DB.prepare('UPDATE members SET posting_progress_count=?,posting_progress_started_at=?,updated_at=? WHERE id=? AND role=\'member\'').bind(count,windowStart,at,memberId).run();
  }
  return;
 }
 if(member.role==='publisher' && Number(member.posting_published_count)>0){
  if(count>=50){
   const expires=new Date(now+windowMs).toISOString();
   await env.DB.batch([
    env.DB.prepare('UPDATE members SET posting_progress_count=0,posting_progress_started_at=NULL,posting_pass_available=1,posting_pass_expires_at=?,updated_at=? WHERE id=?').bind(expires,at,memberId),
    env.DB.prepare("INSERT INTO posting_pass_events(id,member_id,event_type,progress_count,details_json,created_at) VALUES(?,?,'pass_granted',50,?,?)").bind(id(),memberId,JSON.stringify({windowHours:48,distinctPosts:count}),at)
   ]);
  }else{
   await env.DB.prepare('UPDATE members SET posting_progress_count=?,posting_progress_started_at=?,updated_at=? WHERE id=?').bind(count,windowStart,at,memberId).run();
  }
 }
}
async function recomputeProgress(env,memberId){
 const member=await env.DB.prepare('SELECT role,posting_progress_started_at FROM members WHERE id=?').bind(memberId).first();if(!member)return;
 const started=member.posting_progress_started_at?Date.parse(member.posting_progress_started_at):0;
 if(!started || Date.now()-started>=48*3600_000){await env.DB.prepare('UPDATE members SET posting_progress_count=0,posting_progress_started_at=NULL,updated_at=? WHERE id=?').bind(nowIso(),memberId).run();return;}
 const credits=await env.DB.prepare(`SELECT COUNT(DISTINCT c.post_id) AS total FROM mission_credit_events g JOIN evidence_submissions e ON e.id=g.evidence_id JOIN mission_claims c ON c.id=e.claim_id
  WHERE g.member_id=? AND g.event_type='credit_granted' AND g.created_at>=? AND NOT EXISTS(SELECT 1 FROM mission_credit_events r WHERE r.evidence_id=g.evidence_id AND r.event_type='credit_reversed')`).bind(memberId,member.posting_progress_started_at).first();
 await env.DB.prepare('UPDATE members SET posting_progress_count=?,updated_at=? WHERE id=?').bind(Number(credits?.total||0),nowIso(),memberId).run();
}
async function audit(env,actor,action,type,target,details){await env.DB.prepare('INSERT INTO audit_logs(id,actor_member_id,action,target_type,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(),actor,action,type,target,JSON.stringify(details),nowIso()).run();}
