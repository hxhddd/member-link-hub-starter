import { json, fail, id, sha256, setCookie, cookie } from '../lib/http.js';
import { currentMember } from '../lib/auth.js';

export async function authRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const member = await currentMember(request, env);
    if (!member) return json({ ok: true, member: null });
    return json({ ok: true, member: { id: member.id, role: member.role, status: member.status, displayName: member.display_name, pictureUrl: member.picture_url } });
  }
  if (url.pathname === '/api/auth/line' && request.method === 'GET') {
    if (!env.LINE_CHANNEL_ID || !env.APP_BASE_URL) return fail('AUTH_CONFIG_MISSING', 'ยังไม่ได้ตั้งค่า LINE Login', 503);
    const state = id() + id(); const nonce = id() + id();
    await env.DB.prepare('INSERT INTO auth_login_states(state_hash,nonce_hash,expires_at) VALUES(?,?,?)').bind(await sha256(state), await sha256(nonce), new Date(Date.now()+5*60_000).toISOString()).run();
    const redirect = new URL('https://access.line.me/oauth2/v2.1/authorize');
    redirect.search = new URLSearchParams({response_type:'code',client_id:env.LINE_CHANNEL_ID,redirect_uri:`${env.APP_BASE_URL}/api/auth/callback`,state,scope:'openid profile',nonce}).toString();
    const headers=new Headers({Location:redirect.toString()}); headers.append('Set-Cookie',setCookie('mlh_state',state,300)); headers.append('Set-Cookie',setCookie('mlh_nonce',nonce,300)); return new Response(null,{status:302,headers});
  }
  if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
    const code=url.searchParams.get('code'), state=url.searchParams.get('state');
    const savedState=cookie(request,'mlh_state'), nonce=cookie(request,'mlh_nonce');
    if (!code || !state || !savedState || state!==savedState || !nonce) return fail('INVALID_OIDC_STATE','ไม่สามารถยืนยันสถานะการเข้าสู่ระบบได้',400);
    const stateRow=await env.DB.prepare('SELECT nonce_hash FROM auth_login_states WHERE state_hash=? AND expires_at>?').bind(await sha256(state),new Date().toISOString()).first();
    if (!stateRow || stateRow.nonce_hash!==await sha256(nonce)) return fail('EXPIRED_OIDC_STATE','คำขอเข้าสู่ระบบหมดอายุ กรุณาลองใหม่',400);
    await env.DB.prepare('DELETE FROM auth_login_states WHERE state_hash=?').bind(await sha256(state)).run();
    const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:`${env.APP_BASE_URL}/api/auth/callback`,client_id:env.LINE_CHANNEL_ID,client_secret:env.LINE_CHANNEL_SECRET});
    const tokenRes=await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
    const tokens=await tokenRes.json(); if(!tokenRes.ok || !tokens.id_token) return fail('LINE_TOKEN_EXCHANGE_FAILED','LINE Login ไม่สำเร็จ',502);
    const verifyRes=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:tokens.id_token,client_id:env.LINE_CHANNEL_ID})});
    const profile=await verifyRes.json(); if(!verifyRes.ok || profile.nonce!==nonce || !profile.sub) return fail('LINE_ID_TOKEN_INVALID','ตรวจสอบตัวตน LINE ไม่สำเร็จ',401);
    const memberId=id();
    await env.DB.prepare(`INSERT INTO members(id,line_user_id,display_name,picture_url,role,status,last_login_at) VALUES(?,?,?,?, 'member','pending',?) ON CONFLICT(line_user_id) DO UPDATE SET display_name=excluded.display_name,picture_url=excluded.picture_url,last_login_at=excluded.last_login_at`).bind(memberId,profile.sub,profile.name||null,profile.picture||null,new Date().toISOString()).run();
    const member=await env.DB.prepare('SELECT id FROM members WHERE line_user_id=?').bind(profile.sub).first();
    const sessionToken=id()+id()+id(); const sessionId=id();
    await env.DB.prepare('INSERT INTO auth_sessions(id,member_id,token_hash,expires_at) VALUES(?,?,?,?)').bind(sessionId,member.id,await sha256(sessionToken),new Date(Date.now()+30*24*60*60_000).toISOString()).run();
    const headers=new Headers({Location:'/'}); headers.append('Set-Cookie',setCookie('mlh_session',sessionToken,30*24*60*60)); headers.append('Set-Cookie',setCookie('mlh_state','',0)); headers.append('Set-Cookie',setCookie('mlh_nonce','',0)); return new Response(null,{status:302,headers});
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const token=cookie(request,'mlh_session'); if(token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':setCookie('mlh_session','',0)}});
  }
  return null;
}
