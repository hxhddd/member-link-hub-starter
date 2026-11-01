import { json, error, readJson } from '../utils/http.js';

// Authentication/authorization middleware must be added before enabling these routes.
// This starter intentionally does not trust member IDs supplied by the browser.
export async function handleEvidenceRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/evidence/owner-rejection' && request.method === 'POST') {
    return error('AUTH_NOT_IMPLEMENTED', 'Authentication and owner authorization must be implemented before review actions are enabled.', 501);
  }
  if (url.pathname === '/api/evidence/admin-review' && request.method === 'POST') {
    return error('AUTH_NOT_IMPLEMENTED', 'Admin authorization and transactional review workflow must be implemented before this action is enabled.', 501);
  }
  return error('NOT_FOUND', 'Evidence route not found', 404);
}
