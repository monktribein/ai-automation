# Tenant isolation

Isolation is **logical** (shared database, per-document `tenantId`) and enforced in depth.

## Where the tenant comes from

| Entry point | Tenant source | Never trusted |
|---|---|---|
| Authenticated API | `tid` selected at login/switch-tenant **and** an ACTIVE membership in an ACTIVE tenant, re-checked on **every** request (`requireTenant`) | Body/query/header tenant ids (unknown fields are rejected by strict schemas; headers ignored) |
| Public API | Server-side lookup of `:slug` → ACTIVE tenant (`resolvePublicTenant`) | Any client-supplied id |
| Appointment self-service | Slug tenant **and** a signed token whose `tid` and `aid` must match | Appointment id alone |
| WhatsApp webhook | Signature-verified payload → `phone_number_id` → the single tenant owning that number (globally unique index) | Payload tenant hints |
| Jobs | `tenantId` written by trusted code at enqueue time; validated by `assertTenantJob` | — |
| AI tools | The conversation's tenant context; tools have no tenant parameter | Model output |

## Enforcement layers

1. **Context**: a `TenantContext` (tenantId, permissions, actor) is built server-side and is the only way handlers
   learn the tenant. Missing/invalid → `403` (fail closed).
2. **Repository**: `TenantRepository` is constructed with the tenantId and adds it to every filter, create,
   update, delete and aggregation (`$match` prepended). It strips `tenantId`/`_id` from caller data.
3. **Model guard plugin**: rejects any tenant-owned query/update/delete/aggregate/insert without `tenantId`
   and any attempt to modify `tenantId`, even when code bypasses the repository.
4. **Indexes**: unique constraints are tenant-prefixed (e.g. `{tenantId, emailNormalized}`), so duplicates are
   per-tenant and lookups can't be satisfied by another tenant's data. The KB text index has `tenantId` as prefix key,
   making tenant equality mandatory for `$text` queries.
5. **Responses**: cross-tenant ids return **404**, indistinguishable from non-existent ids.
6. **Jobs and files**: storage keys are generated as `tenants/<tenantId>/...`; downloads go through an authenticated,
   tenant-scoped endpoint; no public URLs.

## Intentional platform-level (cross-tenant) queries

These use `{ skipTenantGuard: true }` and are limited to:

* Listing a user's memberships (`auth.service`, `tenant.service`): filter by `userId` only; returns the user's own tenants.
* Resolving a WhatsApp business number to its tenant (`whatsapp.service`): globally unique routing key.
* Sweepers: due notifications (`dispatchDueNotifications`) and expired import/export files (`jobs/cleanup.ts`). They
  only read ids and re-dispatch work under each record's own `tenantId`.
* Tests asserting raw stored state.

## Threat model

| Threat | Mitigation | Test |
|---|---|---|
| Guessing another tenant's object id | Tenant-scoped repository; 404 | `tenant-isolation.test.ts` (customers, appointments, services, staff, conversations) |
| Smuggling `tenantId` in body/query/header | Strict Zod schemas reject unknown fields; headers ignored | "ignores tenantId smuggled…" |
| Switching into a foreign tenant | Membership verification on switch and on every request | "cannot switch into a tenant…" |
| Revoked member keeps access via valid JWT | Membership re-checked per request | `security.test.ts` "revoked memberships…" |
| Privilege escalation via roles | Roles can't contain permissions the creator lacks; platform roles not in catalog; no self-membership edits; SUPER_ADMIN only via script | "Privilege boundaries…" |
| Public slug used to reach another tenant's resources | All public queries scoped to slug's tenant | "Public slug isolation" |
| Manage token replay across tenants/appointments | Token binds `tid` + `aid` with a separate secret | public tests + unit tests |
| Excel import into another tenant | `tenantId` column rejected; tenant from session | "import cannot write into another tenant…" |
| Export of another tenant's data / download by id | Export query includes tenant equality; job lookup scoped | "cannot export B records…" |
| Forged job payload | Handler loads via job tenant repository; mismatched id → no-op | "a notification job with a mismatched tenant…", tampered export job |
| AI prompt injection to act on other data | Tools are tenant-bound; appointment tools additionally require the appointment to belong to the conversation; all args Zod-validated | AI isolation + "cannot manage an appointment that does not belong…" |
| Code path that forgets the tenant filter | Guard plugin throws | "Data-access layer fails closed" |
| NoSQL operator injection | `$`-prefixed / prototype keys rejected; Zod primitives; regex input escaped | `security.test.ts` |
| Webhook spoofing | HMAC-SHA256 `X-Hub-Signature-256` over raw body, constant-time compare | `ai-whatsapp.test.ts` |

## Residual risks

* Logical isolation in a shared database: a database-level compromise exposes all tenants. Use network isolation,
  least-privilege credentials, encryption at rest (Atlas) and backups with access control.
* Audit logs are a platform collection; tenant reads always filter by tenantId in the route (covered by tests),
  but the guard plugin is not applied to it because platform events have no tenant.
