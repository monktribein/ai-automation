# Acceptance checklist

Status: ✅ implemented and covered by automated tests · 🟡 implemented, not verified end-to-end (see KNOWN_LIMITATIONS.md) · ❌ not implemented

## Definition of done

| Requirement | Status | Evidence |
|---|---|---|
| Node.js + Express + TypeScript (strict) | ✅ | `src/app.ts`, `tsconfig.json`; `npm run typecheck` clean |
| MongoDB primary database (Mongoose) | ✅ | `src/config/database.ts`; tests on a replica set |
| No Next.js / NestJS / frontend | ✅ | Only Swagger UI at `/docs` |
| Tenant isolation enforced and tested | ✅ | Repository + guard plugin; `tenant-isolation.test.ts` (23 tests) |
| Authentication and RBAC | ✅ | `auth.test.ts`, `security.test.ts` |
| Core appointment and business APIs | ✅ | `booking.test.ts` |
| Concurrent booking protection tested | ✅ | 8 identical, 4 overlapping, capacity-3 races |
| Excel import/export with tenant authorization | ✅ | `excel.test.ts`, isolation Excel tests |
| AI and WhatsApp behind real provider interfaces; missing credentials explicit | ✅ / 🟡 | Interfaces + mock tests ✅; live providers 🟡 |
| No fake data or fake success responses | ✅ | Unavailable integrations → 503/SKIPPED; SENT ≠ DELIVERED |
| Environment configuration documented and validated | ✅ | `.env.example`, `src/config/env.ts`, unit tests |
| OpenAPI matches implementation | ✅ (manual) | `openapi.yaml`, served at `/openapi.json` |
| Automated tests pass | ✅ | 114/114 (see TESTING.md) |
| Docker and deployment instructions | 🟡 | Dockerfile/Compose written, not built here; DEPLOYMENT.md |
| Known limitations documented | ✅ | KNOWN_LIMITATIONS.md |

## Feature checklist

| Area | Item | Status |
|---|---|---|
| Auth | Register, login, refresh rotation + reuse detection, logout (one/all), forgot/reset (single-use, expiring), switch tenant, me | ✅ |
| Auth | Login rate limit + lockout; audit of account/session events | ✅ |
| Auth | Account activation/deactivation (SUPER_ADMIN, revokes sessions) | ✅ |
| Auth | Email verification | ❌ (optional) |
| Roles | 5 required roles; custom roles; platform vs tenant separation; no self-escalation | ✅ |
| Tenants | Create/list/get/update/status (SUPER_ADMIN); self-service provisioning | ✅ |
| Business | Profile, slug, timezone/locale, hours, policies, feature flags, limits view, branding, locations, members | ✅ |
| Services/staff | CRUD + archive, assignments, buffers, schedules, breaks, leave, business closures, capacity | ✅ |
| Availability | Real slots, timezone/UTC, notice/advance windows, overlap prevention, revalidation in booking | ✅ |
| Appointments | Create/get/list/filter/paginate, confirm, cancel, reschedule, check-in, complete, no-show, history, reference, idempotency | ✅ |
| Appointments | Event history separate; never deleted; valid transitions only | ✅ |
| Public | Profile, services, staff, slots, guest booking, signed manage token, access re-send, enquiries | ✅ |
| Customers | Records, consent, search, history, PII masking, duplicate detection, erasure | ✅ |
| Leads | Capture, source, status, assignment, duplicate flagging, conversion | ✅ |
| AI | Provider-agnostic layer, 10 tools, validation, usage tracking, quotas, max turns, retries/timeouts, handoff, KB | ✅ (mock) / 🟡 (live) |
| AI | Separate intent classifier, cost estimates | ❌ |
| WhatsApp | Verification, signatures, dedupe, message ids, tenant resolution, outbound queue, delivery statuses, templates, opt-in/out, handoff | ✅ (mock) / 🟡 (live) |
| Notifications | Confirmation, reminders, cancellation, rescheduling, handoff alerts, operational alerts, retries | ✅ |
| Jobs | BullMQ with backoff, dedupe, failed-job retention, tenant context, graceful shutdown; inline fallback | ✅ inline / 🟡 Redis |
| Workflows | Event triggers, conditions, delayed actions, run-once executions | ✅ |
| Governance | Plans, subscriptions, limit overrides, atomic quotas, usage summary, audit logs | ✅ |
| Excel | Templates, dry run, strategies, row errors, formula rejection/neutralisation, size/MIME/magic checks, PII column control, async jobs, authorized downloads, temp-file cleanup | ✅ |
| Security | Helmet, CORS allowlist, rate limits, body limits, operator-key rejection, redacted logs, https-only URLs, `npm audit` clean | ✅ |
| Ops | Health/live/ready, request ids, structured logs, index sync script, super-admin script, graceful shutdown | ✅ |
