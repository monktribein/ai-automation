# Architecture

## Layers

```
HTTP (Express 5)
  └─ middleware: request-id → pino-http → helmet → CORS allowlist → JSON (size-limited, raw body kept)
                 → operator-key rejection → global rate limit → route group
       └─ route group middleware: authenticate → requireTenant → requirePermission(...) → validate(zod)
            └─ route handler ("controller"): reads ONLY res.locals.valid, calls a service
                 └─ application service (business rules, transactions, quotas, audit, events)
                      └─ TenantRepository<T> (always tenant-scoped) → Mongoose model (+ tenant guard plugin)
                      └─ provider interfaces (AI, WhatsApp, email, storage, queue)
```

* **Controllers** are the route handlers in `modules/*/*.routes.ts`: validation, permission, call a service, shape the response.
  They never pass `req.body` to the data layer: only Zod-parsed data in `res.locals.valid` (no mass assignment).
* **Services** (`*.service.ts`) hold business logic. They take a `TenantContext` or a `tenantId`, never an Express request,
  and never import provider SDKs directly.
* **Repositories**: `infrastructure/mongodb/tenant-repository.ts`. Constructed with a tenantId; every method injects it.
* **Providers**: `infrastructure/{ai,messaging,email,storage,queue}`. Each exposes an interface plus a `get*()` factory that
  returns `null` (or the inline queue) when not configured, so callers handle "unavailable" explicitly.

## Modules (`src/modules`)

| Module | Responsibility |
|---|---|
| `auth` | Registration, login, refresh rotation, logout, password reset, tenant switching, JWT/appointment tokens |
| `users` | Platform user identity; SUPER_ADMIN account activation/deactivation |
| `tenants` | Tenant registry, provisioning (settings + system roles + membership + default plan), slug resolution |
| `memberships` | User ↔ tenant links; builds the `TenantContext` |
| `roles`, `permissions` | Tenant roles (system + custom) and the permission catalog |
| `business-config` | Profile, branding, hours, booking policy, feature flags, AI settings, WhatsApp integration |
| `locations`, `services`, `staff` | Catalog and resources (schedules, breaks, exceptions, capacity) |
| `availability` | Slot engine and schedule re-validation |
| `appointments` | Booking engine, state machine, reschedule, idempotency, events |
| `customers` | Customers, consent, PII masking, anonymisation; leads (`lead.*`) |
| `public` | Slug-scoped public profile, slots, guest booking, token-protected self-service |
| `conversations`, `knowledge-base`, `ai` | Sessions/messages, approved KB, provider-agnostic AI orchestration with tools |
| `whatsapp` | Webhook verification, signed intake, dedupe, async processing |
| `notifications` | Durable notification store, delivery, reminders, delivery receipts |
| `workflows` | Event-triggered, delayed notification automations |
| `imports-exports` | Excel templates, validation, import/export jobs, downloads |
| `subscriptions`, `usage` | Plans, tenant subscriptions, atomic quota consumption |
| `audit-logs`, `health` | Audit trail; liveness/readiness |

Cross-module calls go service → service (e.g. `appointments` → `availability`, `customers`, `usage`).
Side effects after a commit (notifications, workflows) flow through the in-process **domain event bus**
(`common/utils/events.ts`), emitted only after the transaction commits, so booking never depends on them.

## Booking concurrency strategy

See [TENANT_ISOLATION.md](TENANT_ISOLATION.md) for scoping. For allocation:

1. A booking computes its block `[startAt, endAt + buffer)` and splits it into fixed **5-minute units**
   (independent of the tenant's display interval, so policy changes never misalign existing reservations).
2. Inside **one MongoDB transaction** it inserts one `reservationSlots` document per unit for a *seat*
   (`0 … capacity-1`), then the appointment and its `CREATED` event.
3. `reservationSlots` has a **unique index** `{tenantId, staffId, slotStart, seat}`. Any overlap with another
   booking on that seat raises a duplicate-key error, aborting the whole transaction (no partial state).
4. On conflict the next seat is tried; when all seats fail (or every eligible staff member fails) the API returns
   `409 SLOT_UNAVAILABLE`.
5. Cancellation / no-show deletes the slot documents in the same transaction as the status change.
   Rescheduling deletes the old units and inserts the new ones in one transaction, so a failed move keeps the
   original reservation.

This is enforced by the database, so it holds across any number of API instances. Schedule/policy checks run
before the transaction as a fast path; the unique index is the guarantee. Tests fire 8 concurrent identical
requests, 4 overlapping-but-different requests, and 6 requests against capacity 3 (see `booking.test.ts`).

## Background processing

`infrastructure/queue/queue.ts` exposes `JobQueue` with two implementations:

* **BullMQ** (when `REDIS_URL` is set): bounded exponential backoff (5 attempts), deduplicating `jobId`s,
  failed jobs retained 14 days (dead-letter equivalent), repeatable schedules, graceful worker shutdown.
* **Inline** (development/tests): in-process with 3 attempts. Not durable, but durable *state* lives in MongoDB
  (notifications have `scheduledFor`; the `notifications.dispatch-due` sweep re-dispatches them), so reminders
  survive restarts in both modes.

Every tenant-owned job carries `tenantId`, validated by `assertTenantJob`, and the handler loads data through a
`TenantRepository` for that tenant: a job pointing at another tenant's record finds nothing.

## Request lifecycle example: `POST /api/v1/appointments`

`authenticate` (JWT + live session + active user) → `requireTenant` (session tenant + ACTIVE membership + ACTIVE tenant
→ permission set) → `requirePermission('appointments:write')` → Zod body → `createAppointment()`:
idempotency record → load settings/service/staff (tenant repo) → quota reserve → schedule re-validation →
transaction (slots + customer + appointment + event) → mark idempotency complete → emit `appointment.created` →
notification + workflow handlers enqueue durable work.
