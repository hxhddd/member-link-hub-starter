import { json, error } from './utils/http.js';
import { handleHealth } from './routes/health.js';
import { handleEvidenceRoutes } from './routes/evidence.js';
import { handlePostRoutes } from './routes/posts.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return handleHealth(env);
      }
      if (url.pathname.startsWith('/api/evidence/')) {
        return handleEvidenceRoutes(request, env);
      }
      if (url.pathname.startsWith('/api/posts/')) {
        return handlePostRoutes(request, env);
      }
      if (url.pathname.startsWith('/api/')) {
        return error('NOT_FOUND', 'API route not found', 404);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Unhandled request error', err);
      return error('INTERNAL_ERROR', 'Unexpected server error', 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}
