import { json, fail, bodyJson, id, nowIso } from '../lib/http.js';
import { requireMember, requireRole } from '../lib/auth.js';
import { recordActivity, bangkokUsageDate, getSetting } from '../lib/activity.js';

async function quota(env, memberId, role, kind) {
  const key = kind === 'posts' ? 'daily_post_limit' : 'daily_mission_limit';
  const overrideColumn = kind === 'posts' ? 'daily_post_limit' : 'daily_mission_limit';
  const enabledKey = kind === 'posts' ? 'daily_post_limit_enabled' : 'daily_mission_limit_enabled';
  if ((await getSetting(env,enabledKey,'true')) === 'false') return 999999;
  const global = Number(await getSetting(env,key,5));
  const override = await env.DB.prepare(`SELECT ${overrideColumn} AS value FROM member_quota_overrides WHERE member_id=?`).bind(memberId).first();
  const restricted = kind === 'posts' ? await env.DB.prepare(`SELECT restriction_value FROM member_restrictions WHERE member_id=? AND restriction_type='daily_post_limit' AND active=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY restriction_value ASC LIMIT 1`).bind(memberId,nowIso()).first() : null;
  let value = override?.value == null ? global : Number(override.value);
  if (restricted) value = Math.min(value,Number(restricted.restriction_value));
  if (role === 'admin') return 999999;
  return Math.max(0,value);
}
async function usageDate(env) { return bangkokUsageDate(new Date(),await getSetting(env,'daily_post_reset_time','05:00')); }

export async function postsRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/posts/board' && request.method === 'GET') {
    const auth = await requireMember(request,env); if (auth.error) return auth.error;
    const rows = await env.DB.prepare(`SELECT p.id,p.title,p.description,p.reel_url,p.participant_limit,p.owner_member_id,p.created_at,m.display_name AS owner_name,
      (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') AS claim_count
      FROM posts p JOIN members m ON m.id=p.owner_member_id WHERE p.status='open'
      AND (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') < p.participant_limit
      AND NOT EXISTS(SELECT 1 FROM mission_claims old WHERE old.post_id=p.id AND old.member_id=? AND old.status!='cancelled')
      ORDER BY p.created_at ASC LIMIT 100`).bind(auth.member.id).all();
    return json({ok:true,posts:rows.results||[]});
  }
  if (url.pathname === '/api/posts/claim' && request.method === 'POST') {
    const auth = await requireMember(request,env); if (auth.error) return auth.error;
    const data = await bodyJson(request); if (!data?.postId) return fail('INVALID_INPUT','กรุณาระบุโพสต์',400);
    const limit = await quota(env,auth.member.id,auth.member.role,'missions');
    const day = await usageDate(env);
    await env.DB.prepare('INSERT OR IGNORE INTO member_daily_usage(member_id,usage_date,posts_used,missions_claimed,updated_at) VALUES(?,?,0,0,?)').bind(auth.member.id,day,nowIso()).run();
    const claimId = id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO mission_claims(id,post_id,member_id,status,claimed_at)
          SELECT ?,p.id,?,'claimed',? FROM posts p WHERE p.id=? AND p.status='open'
          AND (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') < p.participant_limit
          AND NOT EXISTS(SELECT 1 FROM mission_claims old WHERE old.post_id=p.id AND old.member_id=?)
          AND COALESCE((SELECT missions_claimed FROM member_daily_usage WHERE member_id=? AND usage_date=?),0) < ?`)
          .bind(claimId,auth.member.id,nowIso(),data.postId,auth.member.id,auth.member.id,day,limit),
        env.DB.prepare(`UPDATE member_daily_usage SET missions_claimed=missions_claimed+1,updated_at=?
          WHERE member_id=? AND usage_date=? AND EXISTS(SELECT 1 FROM mission_claims WHERE id=?)`).bind(nowIso(),auth.member.id,day,claimId)
      ]);
      if (!results[0]?.meta?.changes) {
        const existing = await env.DB.prepare('SELECT missions_claimed FROM member_daily_usage WHERE member_id=? AND usage_date=?').bind(auth.member.id,day).first();
        if (Number(existing?.missions_claimed||0) >= limit) return fail('DAILY_MISSION_LIMIT','คุณใช้โควตารับภารกิจวันนี้ครบแล้ว',429);
        return fail('POST_UNAVAILABLE','ภารกิจเต็ม ปิดแล้ว หรือคุณเคยรับไปแล้ว',409);
      }
    } catch { return fail('CLAIM_CONFLICT','คุณเคยรับภารกิจนี้แล้วหรือภารกิจเต็ม',409); }
    await env.DB.prepare("UPDATE posts SET status='full',updated_at=? WHERE id=? AND status='open' AND (SELECT COUNT(*) FROM mission_claims WHERE post_id=? AND status!='cancelled')>=participant_limit").bind(nowIso(),data.postId,data.postId).run();
    return json({ok:true,claimId});
  }
  if (url.pathname === '/api/posts/open' && request.method === 'POST') {
    const auth = await requireMember(request,env); if (auth.error) return auth.error;
    const data = await bodyJson(request); if (!data?.claimId) return fail('INVALID_INPUT','กรุณาระบุ Claim ID',400);
    const claim = await env.DB.prepare("SELECT c.id,c.post_id,c.status,p.reel_url FROM mission_claims c JOIN posts p ON p.id=c.post_id WHERE c.id=? AND c.member_id=?").bind(data.claimId,auth.member.id).first();
    if (!claim || claim.status !== 'claimed') return fail('CLAIM_NOT_AVAILABLE','ไม่พบภารกิจที่เปิดคลิปได้',409);
    await recordActivity(env,auth.member.id,'mission_video_opened',claim.id);
    return json({ok:true,reelUrl:claim.reel_url});
  }
  if (url.pathname === '/api/posts' && request.method === 'POST') {
    const auth = await requireRole(request,env,['publisher','admin']); if (auth.error) return auth.error;
    const data = await bodyJson(request); if (!data?.title || !data?.reelUrl) return fail('INVALID_INPUT','กรุณากรอกชื่อโพสต์และลิงก์ Reel',400);
    let reel; try { reel = new URL(data.reelUrl); } catch { return fail('INVALID_REEL_URL','ลิงก์ Reel ไม่ถูกต้อง',400); }
    if (!['facebook.com','www.facebook.com','m.facebook.com','fb.watch'].includes(reel.hostname.toLowerCase()) || reel.protocol !== 'https:') return fail('INVALID_REEL_URL','กรุณาใช้ลิงก์ Facebook Reel',400);
    const isAdmin = auth.member.role === 'admin';
    const day = await usageDate(env);
    const postLimit = await quota(env,auth.member.id,auth.member.role,'posts');
    await env.DB.prepare('INSERT OR IGNORE INTO member_daily_usage(member_id,usage_date,posts_used,missions_claimed,updated_at) VALUES(?,?,0,0,?)').bind(auth.member.id,day,nowIso()).run();
    const setting = await env.DB.prepare("SELECT setting_value FROM app_settings WHERE setting_key='default_participant_limit'").first();
    const postId=id(), at=nowIso();
    const batch=[
      env.DB.prepare(`INSERT INTO posts(id,owner_member_id,title,description,reel_url,participant_limit,status,created_at,updated_at)
        SELECT ?,m.id,?,?,?,?,'open',?,? FROM members m WHERE m.id=? AND m.deleted_at IS NULL
        AND (m.role='admin' OR m.posting_published_count=0 OR (m.posting_pass_available=1 AND m.posting_pass_expires_at>?))
        AND COALESCE((SELECT posts_used FROM member_daily_usage WHERE member_id=m.id AND usage_date=?),0) < ?`)
        .bind(postId,String(data.title).slice(0,160),String(data.description||'').slice(0,2000),reel.href,Math.max(1,Math.min(500,Number(setting?.setting_value||60))),at,at,auth.member.id,at,day,postLimit),
      env.DB.prepare('UPDATE member_daily_usage SET posts_used=posts_used+1,updated_at=? WHERE member_id=? AND usage_date=? AND EXISTS(SELECT 1 FROM posts WHERE id=?)').bind(at,auth.member.id,day,postId)
    ];
    if (!isAdmin) {
      batch.push(env.DB.prepare(`UPDATE members SET posting_pass_available=CASE WHEN posting_published_count>0 THEN 0 ELSE posting_pass_available END,posting_pass_expires_at=CASE WHEN posting_published_count>0 THEN NULL ELSE posting_pass_expires_at END,posting_published_count=posting_published_count+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM posts WHERE id=?)`).bind(at,auth.member.id,postId));
      batch.push(env.DB.prepare(`INSERT INTO posting_pass_events(id,member_id,event_type,related_post_id,created_at) SELECT ?,?,'pass_used',?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?) AND EXISTS(SELECT 1 FROM members WHERE id=? AND posting_published_count>1)`).bind(id(),auth.member.id,postId,at,postId,auth.member.id));
    }
    const results=await env.DB.batch(batch);
    if (!results[0]?.meta?.changes) {
      const usage=await env.DB.prepare('SELECT posts_used FROM member_daily_usage WHERE member_id=? AND usage_date=?').bind(auth.member.id,day).first();
      if(Number(usage?.posts_used||0)>=postLimit)return fail('DAILY_POST_LIMIT','คุณใช้โควตาโพสต์วันนี้ครบแล้ว',429);
      return fail('POSTING_PASS_REQUIRED','ต้องมี Posting Pass ที่ยังไม่หมดอายุ หรือยังไม่มีสิทธิ์โพสต์',403);
    }
    await recordActivity(env,auth.member.id,'post_published',postId);
    return json({ok:true,postId},201);
  }
  if (url.pathname === '/api/posts/mine' && request.method === 'GET') {
    const auth=await requireMember(request,env); if(auth.error)return auth.error;
    const rows=await env.DB.prepare('SELECT * FROM posts WHERE owner_member_id=? ORDER BY created_at DESC').bind(auth.member.id).all();
    return json({ok:true,posts:rows.results||[]});
  }
  return fail('NOT_FOUND','ไม่พบเส้นทางโพสต์',404);
}
