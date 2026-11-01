[README.md](https://github.com/user-attachments/files/34248905/README.md)
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
- Mobile-first starter UI

## Important deployment configuration
The Worker needs secrets configured outside Git:

```sh
npx wrangler secret put LINE_CHANNEL_ID
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put APP_BASE_URL
```

Set `APP_BASE_URL` to the exact HTTPS Worker/site origin. In LINE Developers, configure the callback URL as `${APP_BASE_URL}/api/auth/callback` and enable OpenID Connect profile scope. Never commit real secrets.

## Database safety
`wrangler.jsonc` points to the existing `member-link-hub-db`. Do not run `database/migrations/0001_core.sql` against that existing database; it is a fresh-install reference only. This package intentionally does not run SQL automatically.

## Local check

```sh
npm install
npm run check
npx wrangler dev
```

Copy `.dev.vars.example` to `.dev.vars` and use test credentials locally. For local D1, configure a separate local database; do not point local experiments at production.

## Important limitations before public launch
- LINE channel credentials and callback configuration must be supplied by the owner.
- The first Admin account must be bootstrapped safely by a one-time operator-controlled procedure; no public endpoint can grant Admin.
- This is an implementation baseline, not a completed compliance/security audit. Configure rate limiting, CSRF/origin protections, monitoring, backup/restore, and test with a staging D1 before public launch.
- Daily posting quotas, restriction enforcement, full Watchlist management, detailed admin review UI, makeup completion flow, and owner post creation UI need further implementation before the product's full policy is enforced.
- URL domain validation confirms only that the submitted link is on a Shopee domain; it cannot prove that a user watched or tapped through Facebook.
