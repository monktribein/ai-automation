# Frontend to Backend API Mapping Document
## Bizwoke Nova — AI Automation Platform

This document defines the complete contract mapping between the **Bizwoke Nova Next.js Frontend** and the existing **Node.js/Express.js Backend** (`bizwoke-nova-backend`).

---

## 1. Global API Standards

- **Base URL (Local):** `http://localhost:5000/api/v1`
- **Base URL (Render Production):** `https://YOUR-RENDER-BACKEND-URL/api/v1`
- **Standard Success Envelope:**
  ```json
  {
    "success": true,
    "data": {},
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    },
    "requestId": "req-uuid"
  }
  ```
- **Standard Error Envelope:**
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Human readable explanation",
      "details": [
        { "path": "field", "message": "Field error explanation" }
      ]
    },
    "requestId": "req-uuid"
  }
  ```
- **Error Codes:** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `SLOT_UNAVAILABLE`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `FEATURE_DISABLED`, `TENANT_INACTIVE`, `INTEGRATION_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `PROVIDER_ERROR`, `INTERNAL_ERROR`.
- **Tenant Scoping Mechanism:** Tenant context is strictly determined server-side from the verified session membership (claim `tid` inside JWT) or selected via `/auth/switch-tenant`. Never pass `tenantId` in client request bodies or query params for tenant-scoped endpoints!

---

## 2. Authentication & Session Management

### 2.1 Register
- **Screen:** `/register`
- **Method & Path:** `POST /auth/register`
- **Auth:** None (Public)
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "MinLength10LettersDigits",
    "name": "Jane Doe",
    "phone": "+919876543210",
    "business": {
      "name": "Nova Clinic",
      "slug": "nova-clinic",
      "timezone": "Asia/Kolkata",
      "locale": "en",
      "category": "clinic"
    }
  }
  ```
- **Response Structure:** `{ success: true, data: { user: { id, email, name }, tokens: { accessToken, refreshToken, expiresIn, tenantId } } }`
- **States:**
  - *Loading:* Spinner on submit button, form disabled.
  - *Success:* Store session tokens, redirect to `/dashboard` or `/onboarding`.
  - *Error:* 409 (Email or slug conflict), 422 (Zod validation), 403 (Self-signup disabled).

### 2.2 Login
- **Screen:** `/login`
- **Method & Path:** `POST /auth/login`
- **Auth:** None (Public)
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "Password123",
    "tenantSlug": "nova-clinic" // optional
  }
  ```
- **Response Structure:**
  ```json
  {
    "success": true,
    "data": {
      "user": { "id": "...", "email": "...", "name": "...", "platformRole": "USER|SUPER_ADMIN" },
      "memberships": [
        { "tenantId": "...", "name": "...", "slug": "...", "status": "ACTIVE", "roleKeys": ["TENANT_ADMIN"] }
      ],
      "tokens": { "accessToken": "...", "refreshToken": "...", "expiresIn": "15m", "tenantId": "..." }
    }
  }
  ```
- **States:**
  - *Loading:* Inline button spinner.
  - *Success:* Set tokens in memory / cookie storage, evaluate platformRole / active tenant. If multiple memberships and no slug provided, open tenant selector or pick first active tenant.
  - *Error:* 401 (Invalid email or password / locked account after 5 attempts), 429 (Rate limited).

### 2.3 Token Refresh
- **Trigger:** Background timer / 401 interceptor before token expiry (15m TTL).
- **Method & Path:** `POST /auth/refresh`
- **Auth:** None (Public with refresh token body)
- **Request Body:** `{ "refreshToken": "<string>" }`
- **Response Structure:** `{ success: true, data: { accessToken, refreshToken, expiresIn, tenantId } }`
- **Error Behavior:** If 401 received or token was reused, family is invalidated. Redirect user immediately to `/session-expired` or `/login`.

### 2.4 Logout
- **Screen:** User menu dropdown -> Logout
- **Method & Path:** `POST /auth/logout`
- **Auth:** Bearer JWT
- **Request Body:** `{ "allSessions": false }`
- **Response:** `{ success: true, data: { loggedOut: true } }`
- **States:** Clear client memory/tokens, navigate to `/login`.

### 2.5 Forgot Password & Reset Password
- **Screens:** `/forgot-password`, `/reset-password`
- **Paths:**
  - `POST /auth/forgot-password` -> Body: `{ "email": "..." }` -> 202 Accepted `{ message: "..." }`
  - `POST /auth/reset-password` -> Body: `{ "token": "...", "newPassword": "..." }` -> 200 Ok `{ reset: true }`
- **States:**
  - *Forgot Success:* Friendly notification that if account exists, instructions were dispatched.
  - *Reset Success:* Success confirmation banner with link to login.

### 2.6 Tenant Switching
- **Screen:** Header Tenant Switcher Dropdown
- **Method & Path:** `POST /auth/switch-tenant`
- **Auth:** Bearer JWT
- **Request Body:** `{ "tenantId": "<objectId>" }`
- **Response:** `{ success: true, data: { accessToken, refreshToken, expiresIn, tenantId } }`
- **States:** On success, update active token, purge tenant cache, reload route `/dashboard`.

### 2.7 Current User & Memberships
- **Method & Path:** `GET /auth/me`
- **Auth:** Bearer JWT
- **Response Structure:** `{ success: true, data: { user: { email, name, phone, platformRole, status }, memberships: [...] } }`

---

## 3. Business Settings & Tenant Profile

### 3.1 Get Settings
- **Screen:** `/dashboard/settings`
- **Method & Path:** `GET /business`
- **Auth:** Bearer JWT (`business:read`)
- **Response:** `{ success: true, data: { tenant: { name, slug, status, timezone, locale }, settings: { profile, branding, timezone, locale, currency, operatingHours, bookingPolicy, ai, features, integrations }, limits: { ... } } }`

### 3.2 Update Settings
- **Screen:** `/dashboard/settings`
- **Method & Path:** `PATCH /business`
- **Auth:** Bearer JWT (`business:manage`)
- **Request Body:** Partial `BusinessPatch` (profile, branding, operatingHours, bookingPolicy, ai [requires `ai:configure`])
- **Response:** Updated settings object.

### 3.3 Change Business Slug
- **Screen:** `/dashboard/settings` (Branding/URL tab)
- **Method & Path:** `PATCH /business/slug`
- **Auth:** Bearer JWT (`business:manage`)
- **Request Body:** `{ "slug": "new-slug" }`
- **Response:** `{ success: true, data: { slug: "new-slug" } }`
- **Error:** 409 if slug is taken.

### 3.4 Business Closures & Holidays
- **Screen:** `/dashboard/availability`
- **Paths:**
  - `GET /business/closures` (`staff:read`) -> list closures
  - `POST /business/closures` (`availability:write`) -> Body: `{ type: "LEAVE"|"HOLIDAY"|"BLOCK", startsAt, endsAt, reason }`
  - `DELETE /business/closures/:id` (`availability:write`)

---

## 4. Services Management

- **Screens:** `/dashboard/services`, Create/Edit Service Dialogs
- **Paths:**
  - `GET /services` -> Query: `page, limit, status, search, sort` -> Paginated list
  - `POST /services` (`services:write`) -> Body: `{ name, description, durationMinutes, bufferMinutes, price, currency, category, locationIds, publiclyBookable, metadata }`
  - `GET /services/:id` (`services:read`) -> Service details with assigned staff IDs
  - `PATCH /services/:id` (`services:write`) -> Partial service update
  - `DELETE /services/:id` (`services:write`) -> Archive service (soft archive)

---

## 5. Staff & Availability

- **Screens:** `/dashboard/staff`, `/dashboard/staff/[id]`, `/dashboard/availability`
- **Paths:**
  - `GET /staff` (`staff:read`) -> Query: `page, limit, serviceId, status`
  - `POST /staff` (`staff:write`) -> Body: `{ name, email, phone, title, bio, locationId, capacity, publiclyVisible, serviceIds, metadata }`
  - `GET /staff/:id` (`staff:read`)
  - `PATCH /staff/:id` (`staff:write`)
  - `DELETE /staff/:id` (`staff:write`)
  - `GET /staff/:id/availability` (`staff:read`) -> Returns `{ weekly: [...], breaks: [...] }`
  - `PUT /staff/:id/availability` (`availability:write`) -> Replaces weekly schedules and breaks
  - `POST /staff/:id/exceptions` (`availability:write`) -> Adds staff leave/blocked period
  - `DELETE /staff/:id/exceptions/:id` (`availability:write`)

---

## 6. Appointments & Calendar

### 6.1 Listing & Calendar View
- **Screens:** `/dashboard/appointments`, `/dashboard/calendar`
- **Method & Path:** `GET /appointments`
- **Auth:** Bearer JWT (`appointments:read` or `appointments:read:own`)
- **Query Params:** `page, limit, status, staffId, serviceId, customerId, from, to, sort`
- **Response:** Paginated appointments list with customer, service, and staff refs.

### 6.2 Available Slots Lookup
- **Screen:** New Appointment Modal, Calendar Slot Selection
- **Method & Path:** `GET /appointments/slots`
- **Query Params:** `serviceId` (required), `from` (required YYYY-MM-DD), `to` (YYYY-MM-DD, max 31 days), `staffId`
- **Response:** Array of `{ startAt, endAt, staffId, staffName }`

### 6.3 Create Appointment
- **Screen:** `/dashboard/appointments` (New Appointment Modal)
- **Method & Path:** `POST /appointments`
- **Auth:** Bearer JWT (`appointments:write`)
- **Headers:** Optional `Idempotency-Key`
- **Request Body:**
  ```json
  {
    "serviceId": "<objectId>",
    "staffId": "<objectId>",
    "startAt": "2026-11-05T10:00:00+05:30",
    "customerId": "<objectId>", // OR "customer": { "name": "...", "email": "...", "phone": "..." }
    "customerNotes": "Optional note"
  }
  ```
- **Response:** 201 Created or 200 Replay.
- **Errors:** 409 (Slot unavailable / conflict), 422 (Invalid time alignment / validation).

### 6.4 Status Transition & Rescheduling
- **Paths:**
  - `PATCH /appointments/:id/status` -> Body: `{ "status": "CONFIRMED"|"CHECKED_IN"|"COMPLETED"|"CANCELLED"|"NO_SHOW"|"PENDING_CONFIRMATION", "reason": "..." }`
  - `POST /appointments/:id/reschedule` -> Body: `{ "startAt": "...", "staffId": "..." }`
  - `GET /appointments/:id/history` -> Audit events for appointment lifecycle

---

## 7. Customers & Leads

### 7.1 Customers
- **Screens:** `/dashboard/customers`, `/dashboard/customers/[id]`
- **Paths:**
  - `GET /customers` (`customers:read`) -> Query: `page, limit, search, tag, sort` (PII masked unless user has `customers:pii`)
  - `POST /customers` (`customers:write`) -> Body: `{ name, email, phone, preferredLanguage, consent, tags, notes }`
  - `GET /customers/:id` (`customers:read`)
  - `PATCH /customers/:id` (`customers:write`)
  - `DELETE /customers/:id` (`customers:delete`) -> Erase/Anonymize customer PII
  - `GET /customers/:id/appointments` -> History of appointments

### 7.2 Leads
- **Screens:** `/dashboard/leads`, `/dashboard/leads/[id]`
- **Paths:**
  - `GET /leads` (`leads:read`) -> Query: `page, limit, status, source, search, assignedMembershipId`
  - `POST /leads` (`leads:write`) -> Body: `{ name, email, phone, message, interest, sourceDetail }`
  - `GET /leads/:id` (`leads:read`)
  - `PATCH /leads/:id` (`leads:write`) -> Update status (`NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST`) or assign staff.

---

## 8. Customer Conversations & AI Assistant

### 8.1 Conversations Inbox
- **Screens:** `/dashboard/conversations`, `/dashboard/conversations/[id]`
- **Paths:**
  - `GET /conversations` (`conversations:read`) -> Query: `page, limit, status (OPEN|HANDOFF|CLOSED), channel (API|WHATSAPP)`
  - `GET /conversations/:id` (`conversations:read`) -> Session with complete message transcript
  - `GET /conversations/:id/tool-executions` (`conversations:read`) -> Log of AI tool invocations
  - `PATCH /conversations/:id/status` (`conversations:write`) -> Handoff / Takeover / Close
  - `POST /conversations/:id/messages` (`conversations:write`) -> Agent sends message to customer

### 8.2 AI Status & Test Chat
- **Screen:** `/dashboard/ai`
- **Paths:**
  - `GET /ai/status` (`ai:use`) -> `{ provider, available, model, tools }`
  - `POST /ai/chat` (`ai:use`) -> Body: `{ message, sessionId, customerId, contactName }`

### 8.3 Knowledge Base
- **Screen:** `/dashboard/knowledge-base`
- **Paths:**
  - `GET /knowledge-base` (`knowledge:read`) -> Query: `page, limit, status (DRAFT|APPROVED|ARCHIVED)`
  - `POST /knowledge-base` (`knowledge:write`) -> Body: `{ title, content, tags }`
  - `GET /knowledge-base/search` (`knowledge:read`) -> Query: `q`
  - `GET /knowledge-base/:id`
  - `PATCH /knowledge-base/:id` -> Edit / approve (edits reset status to DRAFT)
  - `DELETE /knowledge-base/:id` -> Soft archive

---

## 9. Automations & Workflows

- **Screen:** `/dashboard/workflows`
- **Paths:**
  - `GET /workflows` (`workflows:manage`) -> Paginated workflows
  - `POST /workflows` (`workflows:manage`) -> Body: `{ name, trigger, conditions, actions, enabled }`
    - Supported Triggers: `appointment.created`, `appointment.status_changed`, `appointment.rescheduled`, `lead.created`
    - Actions: `send_notification` via `EMAIL` or `WHATSAPP`
  - `GET /workflows/:id`
  - `PATCH /workflows/:id`
  - `DELETE /workflows/:id`
  - `GET /workflows/:id/executions` -> Workflow execution history

---

## 10. Notifications Log

- **Screen:** `/dashboard/notifications`
- **Path:** `GET /notifications` (`notifications:read`)
- **Query:** `page, limit, status, channel, appointmentId`
- **Statuses:** `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`, `CANCELLED`

---

## 11. Excel Import & Export

- **Screen:** `/dashboard/data-management`
- **Resources:** `customers`, `leads`, `services`, `staff`, `appointments`
- **Paths:**
  - `GET /imports/:resource/template` (`imports:run`) -> Download `.xlsx` template
  - `POST /imports/:resource/validate` (`imports:run`) -> Multi-part form-data `file`, Query: `duplicateStrategy (skip|update|fail)`. Returns dry-run report.
  - `POST /imports/:resource` (`imports:run`) -> Start async import job. Returns 202 `{ id, status, resource }`.
  - `GET /imports/:jobId` (`imports:run`) -> Poll import job status and row-level errors.
  - `POST /exports/:resource` (`exports:run`) -> Body: `{ from, to, status }`. Returns 202 `{ id, status, columns }`.
  - `GET /exports/:jobId` (`exports:run`) -> Poll export status and downloadPath.
  - `GET /exports/:jobId/download` (`exports:run`) -> Download completed `.xlsx` file.

---

## 12. Team, Memberships & Custom Roles

- **Screens:** `/dashboard/team`, `/dashboard/roles`
- **Paths:**
  - `GET /members` (`members:read`) -> Paginated members list
  - `POST /members` (`members:manage`) -> Body: `{ email, roleKeys, staffId }`
  - `PATCH /members/:id` (`members:manage`) -> Body: `{ roleKeys, status (ACTIVE|SUSPENDED|REVOKED), staffId }`
  - `GET /roles` (`roles:manage`) -> All tenant roles
  - `GET /roles/permissions` (`roles:manage`) -> Full permission catalog
  - `POST /roles` (`roles:manage`) -> Create custom role `{ key, name, description, permissions }`
  - `PATCH /roles/:id`, `DELETE /roles/:id`

---

## 13. Subscriptions & Usage

- **Screen:** `/dashboard/billing`
- **Paths:**
  - `GET /subscriptions/plans` -> Platform subscription plans
  - `GET /subscriptions/current` (`usage:read`) -> Tenant subscription & effective limits
  - `GET /usage` (`usage:read`) -> Query: `period (YYYY-MM)`. Returns current consumption counters vs plan limits.

---

## 14. Governance & Audit Logs

- **Screen:** `/dashboard/audit-logs`
- **Path:** `GET /audit-logs` (`audit:read`)
- **Query:** `page, limit, action, resourceType, actorUserId, from, to`

---

## 15. Platform Super Administration (Platform Role: SUPER_ADMIN)

- **Screen:** `/platform/tenants`
- **Paths:**
  - `GET /tenants` -> All tenants across the platform (filters: `search`, `status`)
  - `POST /tenants` -> Create new tenant
  - `GET /tenants/:id`
  - `PATCH /tenants/:id`
  - `PATCH /tenants/:id/status` -> Activate, suspend, or deactivate
  - `GET /users` -> List all user accounts across platform
  - `PATCH /users/:id/status` -> Activate or deactivate user
  - `POST /subscriptions/plans` -> Create plan
  - `PATCH /subscriptions/plans/:id` -> Update plan
  - `PUT /subscriptions/tenants/:tenantId` -> Assign plan and overrides to tenant

---

## 16. Public Booking Experience

- **Routes:** `/book/[slug]`, `/book/[slug]/manage/[id]`
- **Paths:**
  - `GET /public/:slug` -> Public profile, branding, operating hours, booking rules
  - `GET /public/:slug/services` -> Bookable services
  - `GET /public/:slug/staff?serviceId=...` -> Available staff (no private contact details)
  - `GET /public/:slug/slots?serviceId=...&from=...&to=...` -> Policy-filtered open slots
  - `POST /public/:slug/appointments` -> Guest booking. Returns `{ appointment, manageToken }`.
  - `POST /public/:slug/appointment-access` -> Resend access link via Email/WhatsApp
  - `GET /public/:slug/appointments/:id` -> Header: `X-Appointment-Token: <manageToken>`
  - `PATCH /public/:slug/appointments/:id` -> Header: `X-Appointment-Token: <manageToken>`, Body: `{ action: "cancel", reason }` or `{ action: "reschedule", startAt, staffId }`
  - `POST /public/:slug/enquiries` -> Submit general enquiry lead

---

## 17. Identified Missing Backend Dependencies & Mitigation

| Missing Feature / Endpoint | Reason / Inspection Note | Frontend Strategy & UI Handling |
|---|---|---|
| `GET /api/v1/dashboard/metrics` (Pre-aggregated KPIs) | No aggregated KPI endpoint exists in backend router. | The frontend computes accurate summary metrics from real backend endpoints: `/appointments` (by status & date), `/leads` (by status), `/usage` (monthly metrics), and `/conversations`. If any query fails, display an explicit error or unavailable card — never fabricate numbers. |
| `GET /api/v1/reports` (Analytics aggregate endpoint) | Backend provides raw list endpoints and `/usage`, but no multi-dimensional report generator. | The Reports page computes trends using actual time-bounded `/appointments` and `/usage` records. An explicit note and filter controls are displayed. |
| Customer Self-Signup for Tenant Membership | Backend requires Tenant Admin to add existing users via `POST /members`; no public member invitation signup exists. | Team settings clearly indicate that users must first register their account, then an admin assigns their membership. |
| Online Payment / Checkout Gateway | Out of scope in current backend (no Stripe/Razorpay endpoints). | The billing and public booking screens do not present fake payment buttons or mock checkouts. Plans and pricing are shown as configuration details. |
| User Profile Self-Update (Password/Email) | `PATCH /users/me` does not exist; only `/auth/reset-password` and `GET /auth/me` exist. | Profile page allows viewing account details and triggering the standard password reset flow via `/auth/forgot-password`. |
