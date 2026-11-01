export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export const fail = (code, message, status = 400) => json({ ok: false, error: { code, message } }, status);
export async function bodyJson(request) { try { return await request.json(); } catch { return null; } }
export function cookie(request, name) { const raw = request.headers.get('Cookie') || ''; const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`)); return item ? decodeURIComponent(item.slice(name.length + 1)) : null; }
export function setCookie(name, value, maxAge, secure = true) { return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`.replace('Secure; ', secure ? 'Secure; ' : ''); }
export const id = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export async function sha256(value) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function isShopeeUrl(value) { try { const u = new URL(value); return ['shopee.co.th', 'www.shopee.co.th', 'shope.ee'].includes(u.hostname.toLowerCase()) && u.protocol === 'https:'; } catch { return false; } }
