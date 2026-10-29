# Testing

```bash
npm test               # all suites
npx vitest run src/tests/integration/booking.test.ts   # one file
npm run typecheck && npm run lint
```

The suite needs no external services. `src/tests/global-setup.ts` starts a throwaway **single-node MongoDB replica
set** (`mongodb-memory-server`, downloaded on first run), so real multi-document transactions run. Each test file
uses its own randomly named database, dropped afterwards. AI, WhatsApp and email use in-process mock providers;
storage uses a temp directory; the queue runs inline and tests wait with `drainInlineQueue()`.
Environment for tests is fixed in `src/tests/setup-env.ts`. It never points at a real database.

## Coverage map

| File | What it proves |
|---|---|
| `unit/core.test.ts` | Interval maths, DST-aware local→UTC, 5-min units, state machine, formula neutralisation, regex escaping, fingerprints, env validation (required vars, unsafe prod config, optional integrations), permission catalog, manage-token binding |
| `integration/auth.test.ts` | Health; register/login; duplicate/validation errors; mass-assignment rejection; generic login errors; lockout; missing/malformed/forged/**expired** tokens; refresh **rotation + reuse detection**; logout revocation; password reset (single use, revokes sessions); platform privileges unavailable to tenant admins; tenant suspension; account deactivation; **login rate limit** |
| `integration/tenant-isolation.test.ts` | Tenant A can't read B's customer, update/cancel/reschedule B's appointment, archive/modify B's service/staff, use B's ids in A records, access B's conversations, switch into B, see B's audit/notifications; smuggled `tenantId` ignored/rejected; A's export contains no B data and B can't download it; tampered export job; import `tenantId` column rejected; public slug isolation and cross-tenant manage token; jobs with mismatched tenant are no-ops; **AI tools can't reach B**; guard plugin fails closed; tenant reassignment blocked; role escalation blocked; PII masking |
| `integration/booking.test.ts` | Real slots vs hours/bookings; breaks and leave; **timezone** (Asia/Kolkata) storage in UTC; notice/advance windows; reservation-slot rows; invalid bookings; **idempotency** replay and key conflict; **8 concurrent identical** and **4 concurrent overlapping** requests → exactly 1 success; **capacity 3 under 6 concurrent** → 3 seats; state transitions; cancellation frees time without deletion; atomic reschedule (failed move keeps reservation); filters/pagination; guest booking with signed manage token (missing/invalid/cross-appointment tokens rejected); access-link endpoint never leaks tokens; confirmation and guest policies |
| `integration/excel.test.ts` | Templates; dry-run; invalid/missing/duplicate headers; row errors with row/column; in-file and DB duplicates; **formula cells rejected**; extension/MIME/magic-byte checks; **oversized upload** (413) and row limit; async import with skip/update; all-or-nothing validation and temp-file deletion; appointment imports through the booking engine; **export formula neutralisation**; **PII column restrictions**; **unauthorized exports**; date filters |
| `integration/ai-whatsapp.test.ts` | AI unavailable → controlled errors, booking unaffected; tool-calling booking with real slots; invented slot rejected; argument validation and unknown tools; prompt-injection cancel of unrelated appointment blocked; handoff and silence; provider failure masked; max turns; WhatsApp handshake; unsigned/bad signatures rejected; processing, reply, **webhook dedupe**, delivery receipts (SENT→DELIVERED only by provider); honest handoff when AI is down; STOP opt-out; unknown business numbers ignored; confirmation email + durable reminder + cancellation of reminders; SKIPPED without provider; failed booking sends nothing |
| `integration/security.test.ts` | Helmet headers, CORS allowlist, error envelope, malformed JSON, body size limit, request-id sanitisation, OpenAPI served; NoSQL operator injection; regex literalisation; malformed ids; 403 for missing permissions; no-tenant users; **revoked memberships lose access immediately**; https-only URLs; audit logs record sensitive operations without secrets |
| `integration/workflows.test.ts` | Delayed follow-up relative to appointment start, interpolation, run-once execution; validation; status conditions |

## Last recorded run

8 files, 114 tests, all passing (Windows 11, Node 24.20, mongodb-memory-server 11 single-node replica set).
Also clean at that point: `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --omit=dev` (0 vulnerabilities).

## Not covered by automated tests

Live provider calls (Anthropic/OpenAI, Meta Graph, SMTP, S3), BullMQ/Redis mode and the standalone worker, and the
Docker image build. See KNOWN_LIMITATIONS.md.
