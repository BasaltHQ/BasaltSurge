# Admin notification delivery

Notification recipients use the existing AWS SES sender. Recipients need only an email address and enabled alerts in their notification panel.

## Event connections

| Scope | Alert | Source |
| --- | --- | --- |
| Merchant | Purchase completed | Cash payment handler and minute-by-minute scan of confirmed canonical receipts, including online payment reconciliation |
| Merchant | Funds released | Confirmed scheduled distributions and indexed on-chain merchant releases |
| Merchant | Low stock | Inventory save crossing to or below `attributes.lowStockThreshold`, default 5; `stockQty = -1` is unlimited |
| Merchant | Employee PIN modified | Merchant and terminal team PIN updates; the email never includes the PIN or hash |
| Merchant | Live customer message | Persisted inbound checkout messages |
| Partner | Merchant application | Successfully persisted client application |
| Partner | Split contract created | Newly deployed/bound merchant splitter, including credit splits |
| Partner | Device offline | Previously contacted device missing three minutes of config-poll heartbeats; one alert per offline episode |
| Platform | Partner application | Successfully persisted partner application |
| Platform | Contract upgrade | Published splitter version |
| Platform | Node error | Reported degraded/critical node metrics, at most once per node/severity/hour |
| Platform | System status | Published platform-wide update |

External wallet releases are discovered when the split index is refreshed. The existing full reindex job runs every six hours. Low-stock alerts use saved quantities; this change does not add inventory depletion to order processing.

## Delivery and settings

- Source handlers await durable queue insertion. A stable event ID prevents repeated reconciliation/indexing from creating another alert.
- `POST /api/cron/notifications` requires `x-cron-secret` matching `CRON_SECRET`. `scripts/start-scheduler.js` invokes it every minute, preserving the existing schedules for financial jobs. Deployment must run the application server/scheduler with that secret configured.
- The worker processes up to 50 queued events per run. Mongo uses deterministic `_id` values and atomic leases; Cosmos uses conditional writes with ETags. Successful recipients are recorded separately, so another recipient's failure does not resend their email.
- SES failures stay pending with exponential retry delays capped at one hour. One failing recipient does not prevent other recipients receiving the event.
- Settings are resolved by brand, level and merchant wallet. Partner broadcasts reach enabled partner subscriptions in that brand. Delegated merchant settings require `manage:settings` permission.
- Platform `portalpay` settings remain readable; the latest preferences win when a canonical `basaltsurge` record exists.
- A new subscription does not receive historical events. Receipt scans overlap ten minutes and checkpoint only after successful queue insertion. The first scan starts with recent receipts rather than replaying historical sales.
- The panel shows queued, retrying, skipped, or provider-accepted status for the latest alert. SES acceptance is not an inbox-delivery receipt.
- Like other email queues without provider idempotency, a process failure after SES accepts a message but before its result is saved can result in a duplicate retry. Queuing failures are logged; receipt/release monitors retry insertion without advancing their checkpoints.

## Regression checks

```sh
node --test src/lib/notifications/notifications.test.cjs server-scheduler.test.cjs src/app/api/merchant/team/route.test.cjs src/app/api/partner/client-requests/route.test.cjs
```

These tests mock all database, SES and network boundaries. They do not send email.
