# Integrations

All integrations sit behind interfaces in `src/infrastructure`. The backend starts with **none** configured; each
reports `unavailable` at `GET /health`, and dependent operations fail with explicit errors instead of fake results.

> **Verification status.** The AI, WhatsApp, SMTP and S3 adapters are implemented against the providers' documented
> HTTP/SDK contracts but were **not tested against live accounts** here. Tests use in-process mock providers.

## AI (`infrastructure/ai/ai.provider.ts`)

| `AI_PROVIDER` | Adapter | Notes |
|---|---|---|
| `anthropic` | Messages API (`/v1/messages`, `anthropic-version: 2023-06-01`), native tool use | `AI_MODEL` defaults to `claude-sonnet-5-5` |
| `openai` | OpenAI-compatible Chat Completions with function tools | `AI_MODEL` required; `AI_BASE_URL` for compatible gateways |

Timeout `AI_TIMEOUT_MS`, retries `AI_MAX_RETRIES` on 429/5xx/network with exponential backoff, tool loop bounded by
`AI_MAX_TOOL_ITERATIONS`. Per tenant: `features.ai` (platform/feature flag) **and** `ai.enabled` (tenant setting),
`ai.maxTurns`, `ai.instructions` (lower priority than platform rules), `ai.model` override, and the
`aiMessagesPerMonth`/`aiTokensPerMonth` quotas. Token usage is recorded in `usageRecords` (`aiTokens`).

**Tools** (`modules/ai/ai.tools.ts`): `get_business_information`, `list_services`, `list_staff`,
`get_available_slots`, `create_appointment`, `get_appointment`, `reschedule_appointment`, `cancel_appointment`,
`create_lead`, `request_human_handoff`. Every call is Zod-validated, executed through the same application services as
the REST API with a tenant context (`actor: ai`), and logged in `aiToolExecutions`. The model never touches MongoDB.
Safeguards:

* Slots only come from the real engine; `create_appointment` re-validates and uses a deterministic idempotency key
  per tool call, so provider retries can't double-book.
* Appointment lookup/change tools only work on appointments created in, or belonging to the customer of, the conversation.
* On WhatsApp the customer phone comes from the verified channel identity, not from model output.
* KB content is retrieved only from APPROVED articles and labelled as untrusted data; platform rules forbid following
  instructions found in messages or tool results, revealing prompts/secrets, and giving medical/legal/financial advice.
* Provider failure → `502 PROVIDER_ERROR` (API) or human handoff with an honest holding message (WhatsApp). Not
  configured → `503 INTEGRATION_UNAVAILABLE`. Booking APIs never depend on AI.

## WhatsApp Business Platform (`infrastructure/messaging/whatsapp.provider.ts`)

Official **Meta Cloud API** only (`WHATSAPP_PROVIDER=meta`). No WhatsApp Web or personal-session automation.

Setup:
1. In Meta for Developers create an app with WhatsApp, get a permanent **system-user access token**
   (`WHATSAPP_ACCESS_TOKEN`) and the **app secret** (`WHATSAPP_APP_SECRET`).
2. Choose a random `WHATSAPP_VERIFY_TOKEN`; set the webhook URL to `https://<host>/api/v1/webhooks/whatsapp`
   and subscribe to `messages`.
3. Per tenant: `PUT /api/v1/business/integrations/whatsapp` with its `phoneNumberId`, `enabled: true`, and
   **approved template** mappings for business-initiated messages (confirmation, reminder, cancellation, reschedule,
   access link). Unmapped templates → notification `SKIPPED` (no unapproved sends).

Behaviour: GET handshake with constant-time token check; POST requires a valid `X-Hub-Signature-256` over the raw body;
each delivery is stored once (SHA-256 of body, unique index) and processed asynchronously; per-message dedupe by
WhatsApp message id; tenant resolved from `phone_number_id`; `STOP`/`START` keywords update WhatsApp consent;
free-text replies are sent only in response to inbound messages (24h window). Outbound status: `SENT` means
**accepted by the API**; `DELIVERED`/`READ`/`FAILED` are set only from provider status webhooks.

## WhatsApp via AK Nexus (`WHATSAPP_PROVIDER=aknexus`)

AK Nexus API v2 (`https://app.aknexus.in/api/v2`, `Authorization: Bearer wz_...`, 60 requests/min).

* **Outbound:** `POST /whatsapp/send/text { instance_id, to, message }`. Every notification (confirmation,
  reminder, cancellation, AI reply, agent reply) is sent as rendered text; no Meta template mapping is needed.
  The tenant's WhatsApp setting holds the **AK Nexus instance id** (e.g. `6ADC3724DD691`).
  The API returns `{ status: "success", data: { sent: true } }` without a message id, so the notification stores a local
  reference (`aknexus-<uuid>`) and stays `SENT` (accepted). **Delivery/read receipts are not available.**
* **Inbound:** create a webhook in AK Nexus (API & Automation → Webhooks) pointing to
  `{API}/webhooks/aknexus/<AK_NEXUS_WEBHOOK_SECRET>`. AK Nexus does not sign requests, so the secret in the URL is the
  authentication (constant-time comparison, 401 otherwise). Bodies are stored once (SHA-256 dedupe), then parsed by a
  tolerant parser (`modules/whatsapp/aknexus-webhook.ts`). The tenant is resolved from the payload's instance id, else
  `AK_NEXUS_INSTANCE_ID`. Payloads that contain no inbound text are kept as `IGNORED` (30 days) with the reason, so the
  format can be checked in `webhookEvents`.
* `WHATSAPP_DRY_RUN=true` never calls AK Nexus; notifications are recorded as `SKIPPED`. `WHATSAPP_ENABLED=false` disables WhatsApp.
* `npm run whatsapp:check` verifies token, account and instance status (read-only); `-- --send-to=<number>` sends one test message.

## Email (`infrastructure/email/email.provider.ts`)

`EMAIL_PROVIDER=smtp`, `SMTP_URL` (e.g. `smtps://user:pass@smtp.example.com:465`), `EMAIL_FROM`. Used for password
resets, appointment notifications, handoff alerts and workflow messages. Without it, notifications are stored with
status `SKIPPED` and reason `Email provider not configured`.

## Storage (`infrastructure/storage/storage.provider.ts`)

`STORAGE_PROVIDER=local` (default; `STORAGE_LOCAL_DIR`, files mode 0600, path-traversal protected) or `s3` for any
S3-compatible store (`STORAGE_BUCKET`, `STORAGE_ENDPOINT` for R2/MinIO, `STORAGE_REGION`, keys,
`STORAGE_FORCE_PATH_STYLE`). Objects are written with SSE (AES256) on S3. Files are only served via authenticated
download endpoints. **Use `s3` whenever the API and worker run on different hosts.**

## Queue (`infrastructure/queue/queue.ts`)

`REDIS_URL` set → BullMQ (run `npm run start:worker` as a separate process; it also registers repeatable jobs:
due-notification sweep every minute, cleanup hourly). Unset → inline, in-process, non-durable queue intended for
development; the API process then runs the sweeps on intervals. Inspect failed jobs in Redis (e.g. with Bull Board or
`redis-cli`); they are retained 14 days.
