import { json, fail } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { postsRoutes } from './routes/posts.js';
import { evidenceRoutes } from './routes/evidence.js';
import { adminRoutes } from './routes/admin.js';
const cors={ 'Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Vary':'Origin' };
function withHeaders(response){const h=new Headers(response.headers);for(const [k,v] of Object.entries(cors))h.set(k,v);return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});}
export default {async fetch(request,env){const url=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});try{
 let response=null;
 if(url.pathname==='/api/health'&&request.method==='GET'){if(!env.DB)return fail('DB_NOT_CONFIGURED','D1 binding DB is missing',503);await env.DB.prepare('SELECT 1').first();response=json({ok:true,service:'member-link-hub',database:true});}
 if(url.pathname.startsWith('/api/auth/'))response=await authRoutes(request,env);
 if(!response&&url.pathname.startsWith('/api/posts'))response=await postsRoutes(request,env);
 if(!response&&url.pathname.startsWith('/api/evidence'))response=await evidenceRoutes(request,env);
 if(!response&&url.pathname.startsWith('/api/admin'))response=await adminRoutes(request,env);
 if(!response&&url.pathname.startsWith('/api/'))response=fail('NOT_FOUND','API route not found',404);
 if(!response)response=await env.ASSETS.fetch(request);
 return withHeaders(response);
 }catch(err){console.error('Request failed',err);return withHeaders(fail('INTERNAL_ERROR','เกิดข้อผิดพลาดภายในระบบ',500));}}};
