import { json, fail, bodyJson, id, nowIso } from '../lib/http.js';
import { requireMember, requireRole } from '../lib/auth.js';

export async function postsRoutes(request, env) {
  const url=new URL(request.url);
  if(url.pathname==='/api/posts/board' && request.method==='GET'){
    const auth=await requireMember(request,env); if(auth.error)return auth.error;
    const rows=await env.DB.prepare(`SELECT p.id,p.title,p.description,p.reel_url,p.participant_limit,p.owner_member_id,p.created_at,m.display_name AS owner_name,
      (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') AS claim_count
      FROM posts p JOIN members m ON m.id=p.owner_member_id WHERE p.status='open'
      AND (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') < p.participant_limit
      AND NOT EXISTS(SELECT 1 FROM mission_claims old WHERE old.post_id=p.id AND old.member_id=? AND old.status!='cancelled')
      ORDER BY p.created_at ASC LIMIT 100`).bind(auth.member.id).all();
    return json({ok:true,posts:rows.results||[]});
  }
  if(url.pathname==='/api/posts/claim' && request.method==='POST'){
    const auth=await requireMember(request,env);if(auth.error)return auth.error;
    const data=await bodyJson(request);if(!data?.postId)return fail('INVALID_INPUT','กรุณาระบุโพสต์',400);
    const post=await env.DB.prepare(`SELECT p.id,p.status,p.participant_limit,(SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') AS used FROM posts p WHERE p.id=?`).bind(data.postId).first();
    if(!post||post.status!=='open'||post.used>=post.participant_limit)return fail('POST_UNAVAILABLE','ภารกิจนี้เต็มหรือปิดแล้ว',409);
    const already=await env.DB.prepare('SELECT id FROM mission_claims WHERE post_id=? AND member_id=?').bind(post.id,auth.member.id).first();
    if(already)return fail('ALREADY_CLAIMED','คุณเคยรับภารกิจนี้แล้ว',409);
    const claimId=id();
    try{await env.DB.prepare("INSERT INTO mission_claims(id,post_id,member_id,status,claimed_at) VALUES(?,?,?,'claimed',?)").bind(claimId,post.id,auth.member.id,nowIso()).run();}
    catch{return fail('CLAIM_CONFLICT','ไม่สามารถรับภารกิจได้ อาจมีผู้รับเต็มจำนวนแล้ว',409);}
    const count=post.used+1;if(count>=post.participant_limit)await env.DB.prepare("UPDATE posts SET status='full',updated_at=? WHERE id=? AND status='open'").bind(nowIso(),post.id).run();
    return json({ok:true,claimId});
  }
  if(url.pathname==='/api/posts' && request.method==='POST'){
    const auth=await requireRole(request,env,['publisher','admin']);if(auth.error)return auth.error;
    const data=await bodyJson(request);if(!data?.title||!data?.reelUrl)return fail('INVALID_INPUT','กรุณากรอกชื่อโพสต์และลิงก์ Reel',400);
    const pass=await env.DB.prepare('SELECT posting_pass_available,posting_pass_expires_at,posting_published_count FROM members WHERE id=?').bind(auth.member.id).first();
    const isAdmin=auth.member.role==='admin';
    if(!isAdmin && pass?.posting_published_count>0 && (!pass.posting_pass_available || !pass.posting_pass_expires_at || pass.posting_pass_expires_at<=nowIso()))return fail('POSTING_PASS_REQUIRED','ต้องมี Posting Pass ที่ยังไม่หมดอายุก่อนโพสต์',403);
    const limitSetting=await env.DB.prepare("SELECT setting_value FROM app_settings WHERE setting_key='default_participant_limit'").first();
    const postId=id();const batch=[env.DB.prepare("INSERT INTO posts(id,owner_member_id,title,description,reel_url,participant_limit,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'open',?,?)").bind(postId,auth.member.id,String(data.title).slice(0,160),String(data.description||'').slice(0,2000),String(data.reelUrl),Math.max(1,Math.min(500,Number(limitSetting?.setting_value||60))),nowIso(),nowIso())];
    if(!isAdmin && pass?.posting_published_count>0){batch.push(env.DB.prepare("UPDATE members SET posting_pass_available=0,posting_pass_expires_at=NULL,posting_published_count=posting_published_count+1,updated_at=? WHERE id=?").bind(nowIso(),auth.member.id));batch.push(env.DB.prepare("INSERT INTO posting_pass_events(id,member_id,event_type,related_post_id,created_at) VALUES(?,?,'pass_used',?,?)").bind(id(),auth.member.id,postId,nowIso()));}
    else if(!isAdmin){batch.push(env.DB.prepare("UPDATE members SET posting_published_count=posting_published_count+1,updated_at=? WHERE id=?").bind(nowIso(),auth.member.id));}
    await env.DB.batch(batch);return json({ok:true,postId},201);
  }
  if(url.pathname==='/api/posts/mine' && request.method==='GET'){
    const auth=await requireMember(request,env);if(auth.error)return auth.error;
    const rows=await env.DB.prepare('SELECT * FROM posts WHERE owner_member_id=? ORDER BY created_at DESC').bind(auth.member.id).all();return json({ok:true,posts:rows.results||[]});
  }
  return fail('NOT_FOUND','ไม่พบเส้นทางโพสต์',404);
}
