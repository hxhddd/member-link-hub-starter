import { json, fail, bodyJson, id, nowIso } from '../lib/http.js';
import { requireMember, requireRole } from '../lib/auth.js';
import { recordActivity, bangkokUsageDate, getSetting } from '../lib/activity.js';

async function getDailyLimit(env, memberId, role, kind) {
  const settingKey = kind === 'posts' ? 'daily_post_limit' : 'daily_mission_limit';
  const enabledKey = kind === 'posts' ? 'daily_post_limit_enabled' : 'daily_mission_limit_enabled';
  const column = kind === 'posts' ? 'daily_post_limit' : 'daily_mission_limit';

  if ((await getSetting(env, enabledKey, 'true')) === 'false') return Number.MAX_SAFE_INTEGER;

  const globalLimit = Number(await getSetting(env, settingKey, 5));
  const override = await env.DB.prepare(
    `SELECT ${column} AS quota_limit FROM member_quota_overrides WHERE member_id=?`
  ).bind(memberId).first();

  let limit = override?.quota_limit == null ? globalLimit : Number(override.quota_limit);

  if (kind === 'posts') {
    const restriction = await env.DB.prepare(
      `SELECT restriction_value FROM member_restrictions
       WHERE member_id=? AND restriction_type='daily_post_limit' AND active=1
       AND (expires_at IS NULL OR expires_at>?)
       ORDER BY CAST(restriction_value AS INTEGER) ASC LIMIT 1`
    ).bind(memberId, nowIso()).first();
    if (restriction) limit = Math.min(limit, Number(restriction.restriction_value));
  }

  if (role === 'admin') return Number.MAX_SAFE_INTEGER;
  return Math.max(0, limit);
}

async function getUsageDate(env) {
  return bangkokUsageDate(new Date(), await getSetting(env, 'daily_post_reset_time', '05:00'));
}

export async function postsRoutes(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/posts/board' && request.method === 'GET') {
    const auth = await requireMember(request, env);
    if (auth.error) return auth.error;

    const rows = await env.DB.prepare(`
      SELECT p.id,p.title,p.description,p.reel_url,p.participant_limit,p.owner_member_id,p.created_at,
        m.display_name AS owner_name,
        (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') AS claim_count
      FROM posts p JOIN members m ON m.id=p.owner_member_id
      WHERE p.status='open'
        AND (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id=p.id AND c.status!='cancelled') < p.participant_limit
        AND NOT EXISTS (
          SELECT 1 FROM mission_claims old
          WHERE old.post_id=p.id AND old.member_id=? AND old.status!='cancelled'
        )
        AND NOT EXISTS (
          SELECT 1 FROM makeup_missions reserved
          WHERE reserved.replacement_post_id=p.id AND reserved.status='assigned' AND reserved.member_id!=?
        )
      ORDER BY p.created_at ASC LIMIT 100
    `).bind(auth.member.id, auth.member.id).all();

    return json({ ok: true, posts: rows.results || [] });
  }

  if (url.pathname === '/api/posts/claim' && request.method === 'POST') {
    const auth = await requireMember(request, env);
    if (auth.error) return auth.error;

    const data = await bodyJson(request);
    if (!data?.postId) return fail('INVALID_INPUT', 'กรุณาระบุโพสต์', 400);

    const existing = await env.DB.prepare(
      'SELECT id,status FROM mission_claims WHERE post_id=? AND member_id=?'
    ).bind(data.postId, auth.member.id).first();

    if (existing) {
      if (existing.status === 'cancelled') {
        return fail('CLAIM_ALREADY_USED', 'คุณเคยรับภารกิจนี้แล้วและไม่สามารถรับซ้ำได้', 409);
      }
      return json({ ok: true, claimId: existing.id, existing: true });
    }

    const limit = await getDailyLimit(env, auth.member.id, auth.member.role, 'missions');
    const usageDate = await getUsageDate(env);
    const timestamp = nowIso();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO member_daily_usage
        (member_id,usage_date,posts_used,missions_claimed,updated_at)
      VALUES(?,?,0,0,?)
    `).bind(auth.member.id, usageDate, timestamp).run();

    const claimId = id();

    const insert = await env.DB.prepare(`
      INSERT INTO mission_claims(id,post_id,member_id,status,claimed_at)
      SELECT ?,p.id,?,'claimed',?
      FROM posts p
      WHERE p.id=? AND p.status='open'
        AND (SELECT COUNT(*) FROM mission_claims c
             WHERE c.post_id=p.id AND c.status!='cancelled') < p.participant_limit
        AND NOT EXISTS (
          SELECT 1 FROM mission_claims old
          WHERE old.post_id=p.id AND old.member_id=?
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM makeup_missions assigned
            WHERE assigned.replacement_post_id=p.id AND assigned.status='assigned'
          )
          OR EXISTS (
            SELECT 1 FROM makeup_missions mine
            WHERE mine.replacement_post_id=p.id AND mine.member_id=? AND mine.status='assigned'
          )
        )
        AND COALESCE((
          SELECT missions_claimed FROM member_daily_usage
          WHERE member_id=? AND usage_date=?
        ),0) < ?
    `).bind(
      claimId, auth.member.id, timestamp, data.postId,
      auth.member.id, auth.member.id, auth.member.id, usageDate, limit
    ).run();

    if (!insert.meta?.changes) {
      const usage = await env.DB.prepare(
        'SELECT missions_claimed FROM member_daily_usage WHERE member_id=? AND usage_date=?'
      ).bind(auth.member.id, usageDate).first();

      if (Number(usage?.missions_claimed || 0) >= limit) {
        return fail('DAILY_MISSION_LIMIT', 'คุณใช้โควตารับภารกิจวันนี้ครบแล้ว', 429);
      }
      return fail('POST_UNAVAILABLE', 'ภารกิจเต็ม ปิดแล้ว หรือถูกจองให้สมาชิกอื่น', 409);
    }

    await env.DB.prepare(`
      UPDATE member_daily_usage
      SET missions_claimed=missions_claimed+1,updated_at=?
      WHERE member_id=? AND usage_date=?
    `).bind(timestamp, auth.member.id, usageDate).run();

    await env.DB.prepare(`
      UPDATE posts SET status='full',updated_at=?
      WHERE id=? AND status='open'
        AND (SELECT COUNT(*) FROM mission_claims
             WHERE post_id=? AND status!='cancelled')>=participant_limit
    `).bind(timestamp, data.postId, data.postId).run();

    await recordActivity(env, auth.member.id, 'mission_claimed', claimId);
    return json({ ok: true, claimId });
  }

  if (url.pathname === '/api/posts/open' && request.method === 'POST') {
    const auth = await requireMember(request, env);
    if (auth.error) return auth.error;

    const data = await bodyJson(request);
    if (!data?.claimId) return fail('INVALID_INPUT', 'กรุณาระบุ Claim ID', 400);

    const claim = await env.DB.prepare(`
      SELECT c.id,c.status,p.reel_url
      FROM mission_claims c JOIN posts p ON p.id=c.post_id
      WHERE c.id=? AND c.member_id=?
    `).bind(data.claimId, auth.member.id).first();

    if (!claim || claim.status !== 'claimed') {
      return fail('CLAIM_NOT_AVAILABLE', 'ไม่พบภารกิจที่เปิดคลิปได้', 409);
    }

    await recordActivity(env, auth.member.id, 'mission_video_opened', claim.id);
    return json({ ok: true, reelUrl: claim.reel_url });
  }

  if (url.pathname === '/api/posts' && request.method === 'POST') {
    const auth = await requireRole(request, env, ['publisher', 'admin']);
    if (auth.error) return auth.error;

    const data = await bodyJson(request);
    if (!data?.title || !data?.reelUrl) {
      return fail('INVALID_INPUT', 'กรุณากรอกชื่อโพสต์และลิงก์ Reel', 400);
    }

    let reel;
    try {
      reel = new URL(data.reelUrl);
    } catch {
      return fail('INVALID_REEL_URL', 'ลิงก์ Reel ไม่ถูกต้อง', 400);
    }

    if (
      reel.protocol !== 'https:' ||
      !['facebook.com','www.facebook.com','m.facebook.com','fb.watch'].includes(reel.hostname.toLowerCase())
    ) {
      return fail('INVALID_REEL_URL', 'กรุณาใช้ลิงก์ Facebook Reel', 400);
    }

    const limit = await getDailyLimit(env, auth.member.id, auth.member.role, 'posts');
    const usageDate = await getUsageDate(env);
    const timestamp = nowIso();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO member_daily_usage
        (member_id,usage_date,posts_used,missions_claimed,updated_at)
      VALUES(?,?,0,0,?)
    `).bind(auth.member.id, usageDate, timestamp).run();

    const defaultLimit = Number(await getSetting(env, 'default_participant_limit', 60));
    const participantLimit = Math.max(1, Math.min(500, Number(data.participantLimit || defaultLimit)));
    const postId = id();

    const insert = await env.DB.prepare(`
      INSERT INTO posts
        (id,owner_member_id,title,description,reel_url,participant_limit,status,created_at,updated_at)
      SELECT ?,m.id,?,?,?,?,'open',?,?
      FROM members m
      WHERE m.id=? AND m.deleted_at IS NULL
        AND (
          m.role='admin'
          OR m.posting_published_count=0
          OR (m.posting_pass_available=1 AND m.posting_pass_expires_at>?)
        )
        AND COALESCE((
          SELECT posts_used FROM member_daily_usage
          WHERE member_id=m.id AND usage_date=?
        ),0) < ?
    `).bind(
      postId, String(data.title).slice(0,160),
      String(data.description || '').slice(0,2000), reel.href,
      participantLimit, timestamp, timestamp, auth.member.id,
      timestamp, usageDate, limit
    ).run();

    if (!insert.meta?.changes) {
      const usage = await env.DB.prepare(
        'SELECT posts_used FROM member_daily_usage WHERE member_id=? AND usage_date=?'
      ).bind(auth.member.id, usageDate).first();

      if (Number(usage?.posts_used || 0) >= limit) {
        return fail('DAILY_POST_LIMIT', 'คุณใช้โควตาโพสต์วันนี้ครบแล้ว', 429);
      }
      return fail('POSTING_PASS_REQUIRED', 'ต้องมี Posting Pass ที่ยังไม่หมดอายุ หรือยังไม่มีสิทธิ์โพสต์', 403);
    }

    await env.DB.prepare(`
      UPDATE member_daily_usage
      SET posts_used=posts_used+1,updated_at=?
      WHERE member_id=? AND usage_date=?
    `).bind(timestamp, auth.member.id, usageDate).run();

    if (auth.member.role !== 'admin') {
      await env.DB.prepare(`
        UPDATE members
        SET posting_pass_available=CASE
              WHEN posting_published_count>0 THEN 0 ELSE posting_pass_available END,
            posting_pass_expires_at=CASE
              WHEN posting_published_count>0 THEN NULL ELSE posting_pass_expires_at END,
            posting_published_count=posting_published_count+1,
            updated_at=?
        WHERE id=?
      `).bind(timestamp, auth.member.id).run();

      if (Number(auth.member.posting_published_count || 0) > 0) {
        await env.DB.prepare(`
          INSERT INTO posting_pass_events(id,member_id,event_type,related_post_id,created_at)
          VALUES(?,?,'pass_used',?,?)
        `).bind(id(), auth.member.id, postId, timestamp).run();
      }
    }

    await recordActivity(env, auth.member.id, 'post_published', postId);
    return json({ ok: true, postId }, 201);
  }

  if (url.pathname === '/api/posts/mine' && request.method === 'GET') {
    const auth = await requireMember(request, env);
    if (auth.error) return auth.error;

    const rows = await env.DB.prepare(
      'SELECT * FROM posts WHERE owner_member_id=? ORDER BY created_at DESC'
    ).bind(auth.member.id).all();

    return json({ ok: true, posts: rows.results || [] });
  }

  return fail('NOT_FOUND', 'ไม่พบเส้นทางโพสต์', 404);
}
