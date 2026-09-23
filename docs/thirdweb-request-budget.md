# Thirdweb request budgets

Payment status requests always read the receipt first. Webhook-confirmed payments
remain visible during the chain scan cooldown. Optional on-chain event scans are
limited per merchant and receipt, across GET/POST callers and application workers:

- Receipts up to 30 minutes old: once per 60 seconds.
- Older receipts: once per five minutes. Old invoices can still be paid.
- Missing, closed/refunded, and ACH-pending receipts: no fallback chain scan.
- Fiat-only status checks: no chain scan and no consumption of the crypto allowance.
- A budget database failure or unavailable latest block skips the optional scan;
  it does not fall back to unrestricted queries.

The shared budget uses atomic MongoDB conditional upserts or Cosmos ETag writes.
It is intentionally retained after a failed upstream query to prevent retry storms.
Payment widgets, webhook processing, and settlement recovery are not throttled by
this budget. Manual-transfer fallback detection may take up to a minute, or five
minutes for older receipts, plus the client's status polling interval.

The portal checks status every 15 seconds and pauses while hidden. Its initial
delayed check is cleaned up when the effect restarts. Terminal and kiosk polling
also pause while hidden; server limits protect all callers, including older clients.

The scheduler checks recorded merchant activity every ten minutes using database
reads. It only indexes a merchant if its snapshot is missing, its split configuration
changes, or a newer on-chain receipt or successful autoclose distribution is recorded.
Activity is delayed by two minutes to allow indexing services to catch up. Each
merchant has a shared six-hour scan cooldown across platform and partner workers.
Unchanged merchants do not make thirdweb requests. Legacy snapshots are not all
rebuilt solely to add configuration fingerprints. Failed event queries leave the
previous snapshot intact and remain subject to the cooldown.

Platform, partner, and merchant on-chain reports explicitly use indexed-only API reads, even
when data is missing or empty. Their update time is the oldest available merchant
snapshot; missing and failed reads are disclosed. Reports cannot initiate live
refreshes and do not silently fetch uncovered split contracts.

This is selective merchant indexing, not incremental block indexing. Each eligible
merchant still scans historical ranges. Insight-provided block timestamps are reused;
RPC remains the fallback when a timestamp is missing. Out-of-band transfers without
a recorded receipt/distribution cannot be discovered from database activity alone.
An authenticated operator can repair one merchant through
`/api/split/reindex-all?merchantWallet=0x...&force=true`; its six-hour budget still applies.
Blanket forced scans are rejected. No reports UI exposes this maintenance action.

Expected reductions for these paths (not a forecast of the entire invoice):

- Continuous five-second receipt scans: about 92% fewer for fresh receipts and
  about 98% fewer after 30 minutes, before savings from hidden tabs or deduplication.
- Scheduled historical scans: unchanged merchants are skipped; volume depends on
  recorded activity, with at most one attempt per merchant per six hours. Inactive
  merchants no longer repeat scans. Eligible merchants are picked up on the next
  ten-minute discovery tick once their cooldown expires.

After deploying, compare thirdweb RPC/Insight usage and production access logs for
`/api/terminal/check-payment` and `/api/split/reindex-all`. Scheduled duplicate runs
return `skipped: true`; budgeted payment polls return `chainCheckSkipped: true`.
Confirm a webhook payment updates immediately and a manual crypto transfer is
detected within the fallback interval. These local changes do not affect production
billing until deployed.
