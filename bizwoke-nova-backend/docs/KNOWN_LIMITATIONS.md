# Known limitations

These are deliberate scope gaps or items not verified in this repository.

## Not verified against real providers

| Integration | Status |
|---|---|
| Anthropic / OpenAI-compatible AI adapters | Implemented to documented APIs; exercised only with mock providers. No live API call has been made. |
| WhatsApp (Meta Cloud API) sending | Implemented to the Graph API contract; mock-tested. Needs a Meta app, verified business, approved templates and a permanent token. |
| WhatsApp webhooks | Verification, HMAC signatures, payload parsing and dedupe are tested with locally signed payloads, not real Meta deliveries. |
| SMTP email | Uses nodemailer; mock-tested only. |
| S3-compatible storage | Implemented with AWS SDK v3; tests use local storage only. |
| BullMQ + Redis | Queue/worker code is implemented but tests run the inline queue. The standalone worker and repeatable jobs have not been run against Redis. |
| Docker image / Compose | Written but **not built or run here** (Docker was unavailable in this environment). The compiled server was smoke-tested directly with Node against a MongoDB replica set. |

## Functional gaps

* **Intent classification** is implicit in the LLM's tool selection; there is no separate classifier model or endpoint.
* **Cost estimates**: token usage is recorded per tenant (`aiTokens`); monetary cost isn't calculated (no price table).
* **Email verification** flow is not implemented (`emailVerifiedAt` field exists; spec marks it optional).
* **Member invitations**: tenant admins can add only users who already registered; there are no invite emails.
* **CUSTOMER self-service accounts**: the CUSTOMER role sees appointments whose customer email matches the account
  email, but there is no API for a customer to self-join a tenant (an admin adds the membership). Guest booking with
  manage tokens is the primary customer flow.
* **Automatic retention**: erasure (anonymisation) is available on demand. Time-based retention policies (e.g. purge
  leads after N days) are not scheduled. TTLs cover tokens, idempotency records, webhook events and job records.
* **Workflows** support one action type (`send_notification`) with delays; no branching or other action types.
* **Knowledge retrieval** is keyword/text-index based (tenant-prefixed), not vector search.
* **Medical-advice prevention** is enforced by platform rules in the system prompt plus the handoff tool. Model free text
  isn't post-filtered. Likewise "confirm only after commit" is guaranteed for state (tools return real results), but
  the model's wording isn't verified.
* **Data migrations**: `npm run db:indexes` manages collections and indexes; there's no versioned data-migration framework.
* **Recurring appointments, payments, waitlists, multi-resource bookings** (e.g. staff + room) are out of scope.

## Operational limitations

* **Rate limiting** uses an in-memory store per instance. Behind several instances, plug a shared store
  (e.g. `rate-limit-redis`) into `src/common/middleware/rate-limit.ts`.
* **Excel import** loads the workbook in memory (ExcelJS's streaming reader failed on valid files in testing). Memory is
  bounded by the 5 MB upload limit, but a highly compressed workbook can still expand considerably.
* **Export generation** buffers the finished file in memory before upload (bounded by `EXPORT_MAX_ROWS`).
* **Import atomicity**: validation is all-or-nothing; writes are atomic per row, not one transaction for the whole file.
  Write-time failures (e.g. a slot taken meanwhile) are reported per row while other rows commit.
* **Inline queue** (no Redis) is non-durable: an in-flight job is lost if the process dies. Notification state is in
  MongoDB and is re-dispatched by the sweeper, but imports/exports interrupted mid-run are marked failed by cleanup and must be retried.
* **Isolation is logical** (shared database). Database-per-tenant or field-level encryption are not implemented.
* **OpenAPI** is maintained by hand alongside the routes; no automated route ↔ spec diff runs in CI.
* **Audit log reads** for tenants are filtered by tenantId in the route; the collection is platform-owned, so the tenant
  guard plugin doesn't apply to it.
