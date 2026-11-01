import { json, error } from '../utils/http.js';

// Public board must only return open posts with remaining capacity.
// Claiming must exclude members whose evidence for that post was confirmed invalid.
export async function handlePostRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/posts/board' && request.method === 'GET') {
    if (!env.DB) return error('DB_NOT_CONFIGURED', 'D1 binding DB is missing', 503);
    const rows = await env.DB.prepare(
      `SELECT p.id, p.title, p.description, p.reel_url, p.participant_limit,
        (SELECT COUNT(*) FROM mission_claims c WHERE c.post_id = p.id AND c.status != 'cancelled') AS claim_count
       FROM posts p
       WHERE p.status = 'open'
       ORDER BY p.created_at ASC`
    ).all();
    return json({ ok: true, posts: rows.results ?? [] });
  }
  return error('NOT_IMPLEMENTED', 'Post mutation routes require authenticated member context.', 501);
}
