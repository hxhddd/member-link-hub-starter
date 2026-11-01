[AGENTS.md](https://github.com/user-attachments/files/34248900/AGENTS.md)
# Project invariants
- Preserve existing production D1 data. Never drop, rebuild, or apply fresh-install baseline SQL to the existing database.
- Authenticate on the server; never trust a browser-supplied member ID or role.
- Pending members cannot use member features until approved.
- Owner rejection is a review request only; only Admin may reverse credit or adjust capacity.
- Admin-confirmed invalid evidence must be handled idempotently; same evidence cannot reverse credit or add capacity twice.
- Confirmed-invalid submitter cannot reclaim the original post; only a different member can fill restored capacity.
- Never demote a Publisher automatically.
- Store UTC timestamps; show local time in Asia/Bangkok.
- Use parameterized D1 queries and write audit records for privileged actions.
- Watchlist data is Admin-only.
- Never commit secrets.
