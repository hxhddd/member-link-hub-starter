# Member Link Hub — GitHub update bundle

This bundle contains one targeted source correction:

- `src/lib/auth.js`: `currentMember()` now selects the member's posting counters and Posting Pass fields used by the post-publishing workflow. It also excludes anonymized/deleted member records from authenticated sessions.

## Apply to GitHub

Repository: `hxhddd/member-link-hub-starter`
Branch: `main`

Replace this exact file:

`src/lib/auth.js`

Do not replace other files with this bundle.

## Important status

This is a targeted correction, NOT a complete production release.

Verified during the review:
- The repository source files and current D1 schema were inspected through the connected GitHub and Cloudflare integrations.
- The live D1 database already contains the additive activity, notification, quota and inactivity schema changes described in migration `0002`.
- The GitHub connector currently reports no available GitHub App installations (`installations: []`). A previous test write returned HTTP 403 `Resource not accessible by integration`.
- No GitHub commit was created by that failed test.
- No Worker deployment was performed.

Before production deployment:
1. Restore/configure the GitHub App installation and repository Contents write permission if direct ChatGPT-to-GitHub writes are desired.
2. Run `npm run check` and `npm test` from the repository.
3. Review and test post creation, Posting Pass consumption, daily quotas, evidence submission/reversal, make-up missions, notifications, and inactivity cleanup against a staging D1 database.
4. Verify the migration history carefully. Do NOT rerun migration `0002` against the live D1 database: its `ALTER TABLE ... ADD COLUMN` statements are not idempotent, and those columns were already added manually.
5. Configure Worker secrets outside GitHub. Never place LINE credentials or session secrets in source files.

This bundle does not contain credentials, database exports, or user data.
