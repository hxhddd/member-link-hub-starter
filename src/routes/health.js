import { json, error } from '../utils/http.js';

export async function handleHealth(env) {
  if (!env.DB) return error('DB_NOT_CONFIGURED', 'D1 binding DB is missing', 503);
  const result = await env.DB.prepare('SELECT 1 AS ok').first();
  return json({ ok: true, service: 'member-link-hub', database: result?.ok === 1 });
}
