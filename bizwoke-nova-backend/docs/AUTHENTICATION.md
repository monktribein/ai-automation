# Authentication and authorization

## Identity

Users are **platform-level** (`users`), independent of any tenant. Access to a tenant comes only from an
ACTIVE `membership`. A user may belong to many tenants.

Passwords: bcrypt (`BCRYPT_ROUNDS`, default 12), minimum 10 chars with letters and digits. Login returns the
same error for unknown email and wrong password, runs a dummy hash for unknown emails (timing), and locks the
account for 15 minutes after 5 failures. Login, register, refresh, forgot and reset are rate limited
(`AUTH_RATE_LIMIT_MAX` per window per IP).

## Tokens

| Token | Format | Lifetime | Storage |
|---|---|---|---|
| Access | HS256 JWT, `iss`/`aud` checked, claims `sub`, `sid` (session family), `prl`, `tid` (selected tenant) | `JWT_ACCESS_TTL` (15m) | Client memory |
| Refresh | 48 random bytes, opaque | `JWT_REFRESH_TTL` (7d) | Server stores **SHA-256 hash** only |
| Appointment manage | HS256 JWT with a **separate secret**, `aud=appointment`, claims `tid`, `aid` | `APPOINTMENT_TOKEN_TTL` (30d) | Given to the customer |
| Password reset | 32 random bytes | `PASSWORD_RESET_TTL_MINUTES` | Hash only, single use, TTL index |

`authenticate` verifies the JWT **and** that its session family still has a live refresh token and that the user is
ACTIVE, so logout, password reset, deactivation and reuse detection take effect immediately, not at access-token expiry.
The platform role is read from the database on every request.

### Refresh rotation and reuse detection

Each refresh token works once. `POST /auth/refresh` atomically marks the presented token `rotated` and issues a new
pair in the same family. Presenting an already-rotated token is treated as theft: **every** token in the family is
revoked (`reuse_detected`) and an audit event is written.

### Tenant selection

`POST /auth/login` with `tenantSlug`, or automatic when the user has exactly one active membership.
`POST /auth/switch-tenant { tenantId }` verifies an ACTIVE membership in an ACTIVE tenant, then rotates the session.

### Password reset

`POST /auth/forgot-password` always returns 202 with the same message. If an email provider is configured the
token is emailed; otherwise it is **not delivered** (logged as a warning). `POST /auth/reset-password` consumes the
token and revokes all sessions.

Email verification: `users.emailVerifiedAt` exists, but no verification flow is implemented (optional per spec;
see KNOWN_LIMITATIONS.md).

## Roles and permissions

**Platform roles** (on the user): `SUPER_ADMIN`, `USER`. `SUPER_ADMIN` can manage tenants, plans and accounts.
It is granted only by `scripts/create-super-admin.ts`; no API can grant it. `SUPER_ADMIN` does not automatically
see tenant business data; it needs a membership like anyone else (least privilege).

**Tenant roles** (per tenant, `roles` collection). Provisioning creates the system roles:

| Role | Summary |
|---|---|
| `TENANT_ADMIN` | All tenant permissions |
| `OPERATOR` | Day-to-day operations; cannot manage members/roles/business settings/integrations/AI config, delete customers or read audit |
| `SERVICE_PROVIDER` | Read catalog, manage own availability, read/write appointments, see customers |
| `CUSTOMER` | Business info, services, and only their own appointments (`appointments:read:own`, matched by verified account email) |

Custom roles (`POST /roles`) choose from the catalog in `modules/permissions/permissions.ts`. A role can never contain
a permission its creator doesn't hold, system roles can't be edited, and nobody can change their own membership.

Permission catalog: `business:read|manage`, `members:read|manage`, `roles:manage`, `locations:read|write`,
`services:read|write`, `staff:read|write`, `availability:write`, `customers:read|write|pii|delete`,
`appointments:read|read:own|write`, `leads:read|write`, `conversations:read|write`, `knowledge:read|write`,
`ai:use|configure`, `workflows:manage`, `notifications:read`, `integrations:manage`, `imports:run`, `exports:run`,
`audit:read`, `usage:read`.

Field-level: without `customers:pii`, customer email/phone are masked in API responses and dropped from exports.

## Status codes

`401 UNAUTHENTICATED` (missing/invalid/expired/revoked credentials) · `403 FORBIDDEN` / `TENANT_INACTIVE` /
`FEATURE_DISABLED` (authenticated but not allowed) · `409 CONFLICT` (duplicates, concurrent modification) ·
`422 VALIDATION_ERROR` (schema/business validation) · `429 RATE_LIMITED` / `QUOTA_EXCEEDED`.
