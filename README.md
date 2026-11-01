# Member Link Hub

Mobile-first member mission and link management platform.

## Stack
- Cloudflare Workers
- Cloudflare D1
- LINE Login (OIDC)
- Static frontend served by Workers

## Current scope
This starter establishes the application structure and safe API boundaries. It is not production-ready until LINE credentials, session secrets, Admin bootstrap, and deployment configuration are supplied.

## Setup
1. Create a D1 database and bind it as `DB`.
2. Configure Worker secrets: `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `APP_BASE_URL`.
3. Review `wrangler.jsonc` and replace the D1 database ID.
4. Apply SQL migrations in `database/migrations/` in order.
5. Deploy with Wrangler.

Never commit secrets.
