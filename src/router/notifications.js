import { json, fail } from '../lib/http.js';
import { requireMember } from '../lib/auth.js';
export async function notificationRoutes(request, env) {
  const auth = await requireMember(request, env); if (auth.error) return auth.error;
  const url = new URL(request.url);
  if (url.pathname === '/api/notifications' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,notification_type,title,message,related_id,created_at,read_at FROM member_notifications WHERE member_id=? ORDER BY created_at DESC LIMIT 50').bind(auth.member.id).all();
    return json({ok:true,notifications:rows.results||[]});
  }
  if (url.pathname === '/api/notifications/read' && request.method === 'POST') {
    const data = await request.json().catch(()=>null); if (!data?.id) return fail('INVALID_INPUT','กรุณาระบุการแจ้งเตือน',400);
    await env.DB.prepare('UPDATE member_notifications SET read_at=? WHERE id=? AND member_id=? AND read_at IS NULL').bind(new Date().toISOString(),data.id,auth.member.id).run();
    return json({ok:true});
  }
  return null;
}
