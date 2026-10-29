# Database

MongoDB via Mongoose. All schemas use `strict: 'throw'` (unknown fields fail), timestamps, and ObjectId `_id`s.
**Transactions are required**: run a replica set (Compose and the test suite do) or Atlas.

Ownership legend: **T** = tenant-owned (`tenantId` required, immutable, guarded) · **P** = platform-owned ·
**G** = globally shared catalog.

Tenant-owned schemas are built with `tenantSchema()` which adds `tenantId` and the **tenant guard plugin**: queries,
updates, deletes, `insertMany`, `bulkWrite` and aggregations without a `tenantId` (aggregations: as the first `$match`)
throw `TenantGuardError`; updates that touch `tenantId` are rejected. Platform maintenance code opts out explicitly
with `{ skipTenantGuard: true }` (used only in the places listed in TENANT_ISOLATION.md).

| Collection | Own | Key indexes | Deletion / retention |
|---|---|---|---|
| `users` | P | `email` unique | Never hard-deleted; `status` ACTIVE/DEACTIVATED |
| `tenants` | P | `slug` unique; `status,createdAt` | Status ACTIVE/SUSPENDED/DEACTIVATED |
| `tenantSettings` | T | `tenantId` unique; `integrations.whatsapp.phoneNumberId` unique (partial) | Lives with tenant |
| `memberships` | T | `{tenantId,userId}` unique; `{userId,status}` | Status REVOKED instead of delete |
| `roles` | T | `{tenantId,key}` unique | Custom roles deletable when unused; system roles immutable |
| `permissions` | G | `code` unique | Synced from code (`syncPermissionCatalog`) |
| `businessLocations` | T | `{tenantId,name}` unique | Archived |
| `services` | T | `{tenantId,name}` unique (partial: non-archived); `{tenantId,status}` | Archived |
| `staff` | T | `{tenantId,status}`; `{tenantId,email}` unique (partial) | Archived |
| `staffServiceAssignments` | T | `{tenantId,staffId,serviceId}` unique; `{tenantId,serviceId}` | Hard delete (link rows) |
| `staffAvailability` | T | `{tenantId,staffId}` unique | Replaced on PUT |
| `availabilityExceptions` | T | `{tenantId,staffId,startsAt,endsAt}` | Hard delete allowed |
| `reservationSlots` | T | **`{tenantId,staffId,slotStart,seat}` unique**; `{tenantId,appointmentId}` | Deleted when time is released |
| `customers` | T | `{tenantId,emailNormalized}` unique (partial); `{tenantId,phoneNormalized}` unique (partial); `{tenantId,createdAt}`; `{tenantId,name}` | Erasure = anonymisation (PII removed, history kept) |
| `appointments` | T | `{tenantId,reference}` unique; `{tenantId,startAt}`; `{tenantId,staffId,startAt}`; `{tenantId,customerId,startAt}`; `{tenantId,status,startAt}` | **Never deleted**; cancelled via status |
| `appointmentEvents` | T | `{tenantId,appointmentId,createdAt}` | Append-only |
| `idempotencyRecords` | T | `{tenantId,scope,key}` unique; TTL `expiresAt` (24h) | TTL |
| `leads` | T | `{tenantId,status,createdAt}`; `{tenantId,emailNormalized}`; `{tenantId,phoneNormalized}` | Status LOST/CONVERTED |
| `conversationSessions` | T | `{tenantId,status,lastMessageAt}`; `{tenantId,channel,externalUserId}` unique for open sessions | Status CLOSED |
| `conversationMessages` | T | `{tenantId,sessionId,createdAt}`; `{tenantId,externalMessageId}` unique (partial) | Kept with session |
| `knowledgeArticles` | T | `{tenantId,status}`; text index **prefixed by tenantId** | Archived |
| `aiToolExecutions` | T | `{tenantId,sessionId,createdAt}`; `{tenantId,toolName,createdAt}` | Kept (audit of AI actions) |
| `automationWorkflows` | T | `{tenantId,trigger,enabled}` | Hard delete allowed |
| `workflowExecutions` | T | `{tenantId,workflowId,eventKey}` unique (run-once) | Kept |
| `notifications` | T | `{tenantId,dedupeKey}` unique (partial); `{status,scheduledFor}` (sweeper); `{tenantId,createdAt}`; `{tenantId,appointmentId}`; `providerMessageId` | Status CANCELLED/SKIPPED |
| `webhookEvents` | P | `{provider,eventKey}` unique (dedupe); TTL `expiresAt` (30d) | TTL |
| `subscriptionPlans` | G | `code` unique; one `isDefault` (partial unique) | `active=false` |
| `tenantSubscriptions` | T | `{tenantId}` unique | Status CANCELLED |
| `usageRecords` | T | `{tenantId,metric,period}` unique | Kept (billing history) |
| `auditLogs` | P (with optional `tenantId`) | `{tenantId,createdAt}`; `{tenantId,action,createdAt}`; `{actorUserId,createdAt}` | Append-only |
| `refreshTokens` | P | `tokenHash` unique; `familyId`; `{userId,revokedAt}`; TTL `expiresAt` | TTL + cleanup job |
| `passwordResetTokens` | P | `tokenHash` unique; TTL `expiresAt` | TTL, single use |
| `importJobs` | T | `{tenantId,createdAt}`; TTL `expiresAt` (30d) | Upload file deleted after processing |
| `exportJobs` | T | `{tenantId,createdAt}`; TTL `expiresAt` (`EXPORT_RETENTION_HOURS`) | File deleted by cleanup job |

### Globally shared records and how tenants get access

* `permissions`: read-only catalog. A tenant uses a permission only by listing its code in one of its own `roles`.
* `subscriptionPlans`: managed by SUPER_ADMIN. A tenant receives a plan's limits **only** through its own
  `tenantSubscriptions` document (assigned by SUPER_ADMIN or the default plan at provisioning). Tenants cannot modify either.

### Relationships

`users` 1—n `memberships` n—1 `tenants`; `tenants` 1—1 `tenantSettings`, 1—n everything tenant-owned.
`appointments` → `customers`, `services`, `staff`, `businessLocations`; `appointmentEvents`/`reservationSlots` → `appointments`.
`conversationSessions` → `customers`, linked `appointments`; `conversationMessages`/`aiToolExecutions` → session.

### Index management and migrations

* Development: Mongoose `autoIndex` creates indexes.
* Production: `autoIndex` is **off**; run `npm run db:indexes` as a release step (`-- --dry` prints pending changes).
  The script is idempotent and also syncs the permission catalog.
* Schema changes are additive; there is no versioned data-migration framework yet (see KNOWN_LIMITATIONS.md).

### Credentials

Use a least-privilege MongoDB user with `readWrite` on the application database only (no `dbAdmin`/cluster roles
for the API). Index sync can run under a separate user with `dbAdmin` during releases.
