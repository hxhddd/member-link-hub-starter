# Project instructions

- Preserve existing data; never drop or rebuild populated tables without explicit approval.
- Enforce authorization on the server, never only in the browser.
- All timestamps are UTC in storage; display using Asia/Bangkok.
- Use parameterized D1 queries.
- Admin review is required before an owner's rejection reverses mission credit or changes post capacity.
- A confirmed-invalid submitter cannot claim the same post again; only a different member may fill the restored slot.
- Capacity adjustments must be idempotent per evidence submission.
- Keep audit records for all moderation and capacity decisions.
- Do not expose Watchlist status to ordinary members.
