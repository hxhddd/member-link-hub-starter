[Uploading README.md…]()
# Member Link Hub

Mobile-first LINE Login member mission platform on Cloudflare Workers + D1.

## Included in this package
- LINE OIDC login/callback and hashed server-side sessions
- Pending member approval and role checks on the server
- Mission board and claim endpoint with capacity checks
- Shopee URL evidence submission and immediate credit event
- Owner rejection as a review request only
- Admin decision: overturn or confirm invalid; idempotent credit reversal, capacity adjustment, reopening eligible full posts, makeup obligation and audit record
- Admin member approval, role management, settings, Watchlist read and makeup assignment
- Daily mission and post quotas (global defaults plus per-member overrides)
- Asia/Bangkok quota-day boundary (default 05:00)
- Inactivity warnings at days 5 and 6; automatic account anonymization after 7 inactive days for member/publisher only
- In-app notification API and daily scheduled cleanup
- 48-hour anchored credit accumulation windows; 30 distinct posts for Publisher promotion and 50 distinct new posts for Posting Pass
- Idempotent make-up mission completion without double-credit
- Mobile-first starter UI

## Important deployment configuration
The Worker needs secrets configured outside Git. The inactivity sweep runs daily at 00:10 UTC (07:10 Asia/Bangkok):

```sh
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put APP_BASE_URL
```

Set `APP_BASE_URL` to the exact HTTPS Worker/site origin. In LINE Developers, configure the callback URL as `${APP_BASE_URL}/api/auth/callback` and enable OpenID Connect profile scope. Never commit real secrets.

## Database safety
`wrangler.jsonc` points to the existing `member-link-hub-db`. Do not run `database/migrations/0001_core.sql` against that existing database; it is a fresh-install reference only. `database/migrations/0002_activity_quotas_notifications.sql` is additive and is the only migration in this package intended for the existing schema. Review and apply it to a staging D1 first; it is not run automatically.

## Local check

```sh
npm install
npm run check
npm test
npx wrangler dev
```

Copy `.dev.vars.example` to `.dev.vars` and use test credentials locally. For local D1, configure a separate local database; do not point local experiments at production.

## Important limitations before public launch
- LINE channel credentials and callback configuration must be supplied by the owner.
- The first Admin account must be bootstrapped safely by a one-time operator-controlled procedure; no public endpoint can grant Admin.
- This is an implementation candidate, not a completed compliance/security audit. Configure rate limiting, CSRF/origin protections, monitoring, backup/restore, and test with a staging D1 before public launch.
- Daily quotas and inactivity cleanup are implemented in the backend package but require staging tests before activation. Inactivity cleanup anonymizes the member identity and removes sessions/notifications rather than hard-deleting relational history, because the existing schema intentionally protects mission/evidence/audit references.
- The frontend still needs dedicated Publisher post creation, notification display, quota management, Admin review, and Watchlist screens. URL validation cannot prove that a user watched or tapped through Facebook.
