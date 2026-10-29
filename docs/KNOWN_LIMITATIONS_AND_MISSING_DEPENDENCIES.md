# Known Limitations & Missing Backend Dependencies Report
## Bizwoke Nova AI Automation Platform

In strict compliance with architectural constraints (Section 2: *"Do not invent backend routes. If a required endpoint does not exist, document it as a missing backend dependency. Implement the corresponding frontend service interface, but do not pretend the feature works against the real backend"*), this document outlines all boundaries, API nuances, and graceful client-side mitigations.

---

## 1. Summary of Identified Backend Dependencies

| Platform Feature | Backend API Status | Frontend Mitigation Strategy |
| :--- | :--- | :--- |
| **Aggregated Dashboard KPIs** | Missing dedicated `/dashboard/kpis` endpoint | Client fetches parallel real-time summaries from `/appointments`, `/leads`, and `/usage` to accurately populate KPIs without fabricating data. |
| **Payment Gateway Checkout** | No payment gateway route (Stripe / Razorpay) | Subscription plans and quota overrides are displayed as administrative configurations. No fake payment screen is rendered. |
| **Real-time Conversation WebSocket** | Backend does not expose a WebSocket or SSE server | The conversation inbox uses polite, controlled polling (10-second interval with automatic cleanup when navigating away) to refresh message history. |
| **Customer Self-Registration** | No direct `/auth/register-customer` | Public customer bookings are treated as guest appointments with secure manage tokens (`X-Appointment-Token`). Tenant staff members are invited via email by tenant admins. |
| **WhatsApp Real-time Event Push** | Meta Webhook receiver is on backend | Frontend provides complete Meta Developer setup guidance and Webhook URL mapping (`/api/v1/webhooks/whatsapp`) without pretending direct browser-to-WhatsApp connectivity. |

---

## 2. In-Depth Feature Breakdown

### A. Dashboard Overview Metrics
- **Expected Specification:** Single API response returning today's appointment counts, upcoming confirmations, no-show rates, and AI resolution percentages.
- **Backend Reality:** The Express backend provides granular REST resources:
  - `GET /appointments?from=...&to=...`
  - `GET /leads?status=...`
  - `GET /usage`
- **Frontend Implementation:** The overview dashboard performs concurrent, lightweight queries against real endpoints, deriving counters and status distributions deterministically. If any resource request fails, that widget displays an explicit unavailable notice.

---

### B. Subscriptions & Billing
- **Expected Specification:** In-app credit card / UPI checkout flow to purchase plans.
- **Backend Reality:** The backend maintains subscription plans (`SubscriptionPlan` model) and tenant assignments (`TenantSubscription` model) managed by Super Administrators. No payment processor (e.g. Stripe checkout session or Razorpay order) is wired in `routes/subscriptions.routes.ts`.
- **Frontend Implementation:** The `/dashboard/billing` page displays current plan details, effective limits, and monthly quota progress bars. Plan upgrade buttons prompt the user with contact instructions rather than presenting a fake checkout flow.

---

### C. Omnichannel Inbox & Messaging
- **Expected Specification:** Live streaming message inbox with WebSocket notifications.
- **Backend Reality:** Backend provides:
  - `GET /conversations`
  - `GET /conversations/:id/messages`
  - `POST /conversations/:id/messages`
  - `PATCH /conversations/:id/ai-takeover`
- **Frontend Implementation:** The conversation detail view refreshes message history using controlled interval polling with active session cleanup. Outbound message sending displays optimistic sending indicators followed by authoritative server confirmation.

---

### D. Tenant Scoping & Isolation
- **Backend Contract:** The backend strictly resolves the tenant identity from the caller's JWT token payload (`req.user.tenantId` / `tid`).
- **Frontend Enforcement:** The centralized API client never appends arbitrary `tenantId` query or body parameters, ensuring that multi-tenant isolation is enforced at the cryptographic token layer by the backend.

---

## 3. Recommendations for Backend Team (Claude Code)

To further enhance the platform experience in future iterations, we recommend adding:
1. `GET /api/v1/dashboard/summary` — pre-aggregated summary cache for faster dashboard page loads.
2. `GET /api/v1/conversations/stream` — Server-Sent Events (SSE) endpoint to replace conversation polling.
3. Stripe / Razorpay Webhook Router — to automate tenant plan upgrades upon payment confirmation.
