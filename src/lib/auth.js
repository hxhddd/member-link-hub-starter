import { cookie, fail, sha256 } from './http.js';

export async function currentMember(request, env) {
  const token = cookie(request, 'mlh_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT m.id,m.role,m.status,m.display_name,m.picture_url,s.id AS session_id FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}
export async function requireMember(request, env) {
  const member = await currentMember(request, env);
  if (!member) return { error: fail('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน', 401) };
  if (member.status !== 'active') return { error: fail('ACCOUNT_NOT_ACTIVE', 'บัญชียังไม่ได้รับอนุมัติหรือถูกระงับ', 403) };
  return { member };
}
export async function requireRole(request, env, roles) {
  const result = await requireMember(request, env);
  if (result.error) return result;
  if (!roles.includes(result.member.role)) return { error: fail('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้', 403) };
  return result;
}
