# Bizwoke Nova — AI Automation Platform (Frontend)
## Next.js Dashboard + Node.js Backend Integration

Bizwoke Nova is an enterprise-grade AI automation, omnichannel customer engagement, and appointment management platform designed for multi-tenant service businesses (clinics, salons, consulting, coaching, hospitality).

This repository contains the **Next.js 15 Frontend**, engineered to connect seamlessly to the existing **Node.js + Express + TypeScript + MongoDB** backend.

---

## 🚀 Key Features

- **Omnichannel AI Automation:** WhatsApp Meta Cloud integration, AI conversational assistant playground, and searchable knowledge-base repository.
- **Enterprise Booking Engine:** Real-time slot availability, double-booking prevention, multi-staff calendar, and self-service appointment reschedule/cancel tokens (`X-Appointment-Token`).
- **CRM & Pipeline:** Customer directory with GDPR PII compliance, lead qualification pipeline, and communication preference controls.
- **Data Management:** Bulk Excel spreadsheet import with dry-run validation error reports and background export downloads.
- **Multi-Tenant Security:** Role-based access control (RBAC), tenant switching, immutable audit compliance logs, and separate Platform Super-Admin registry.
- **Responsive Design System:** Clean, modern enterprise UI built with Vanilla Tailwind CSS v4, Lucide icons, Recharts, and accessible keyboard navigation.

---

## 🛠️ Technology Stack

- **Framework:** Next.js 15 (App Router, strict mode)
- **Language:** TypeScript 5+
- **Styling:** Tailwind CSS v4 with custom SaaS tokens
- **Data Visualization:** Recharts
- **Forms & Validation:** React Hook Form + Zod
- **Icons:** Lucide React
- **Testing:** Vitest + React Testing Library + JSDOM
- **Deployment:** Vercel (Frontend) & Render (Backend API)

---

## 📋 Environment Variables

Create `.env.local` for local development:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1
```

For production on Vercel:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com/api/v1
```

> [!IMPORTANT]
> Next.js is used **strictly for the frontend**. No Next.js API routes or direct database connections are permitted. All application data flows through the centralized API client in `src/lib/api/client.ts`.

---

## 💻 Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Test Suite
```bash
npm test
```

### 3. Run Development Server
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to open the dashboard.

---

## 🏗️ Production Build & Verification

To validate type checks and build the optimized production bundle:

```bash
npm run build
```

---

## 📂 Project Structure

```
bizwoke-nova-frontend/
├── src/
│   ├── app/
│   │   ├── (auth)/             # Login, register, password recovery
│   │   ├── dashboard/          # Authenticated tenant management modules
│   │   │   ├── appointments/   # Appointment list and detail state machine
│   │   │   ├── calendar/       # Month calendar and slot filtering
│   │   │   ├── customers/      # Customer directory and consent
│   │   │   ├── leads/          # Sales enquiries and qualification pipeline
│   │   │   ├── services/       # Service catalog and buffer rules
│   │   │   ├── staff/          # Staff profiles and weekly capacity
│   │   │   ├── availability/   # Shift schedules, breaks, and holidays
│   │   │   ├── conversations/  # Omnichannel inbox and AI handoff
│   │   │   ├── ai/             # AI model playground and tool registry
│   │   │   ├── knowledge-base/ # Searchable tenant articles
│   │   │   ├── workflows/      # Event-driven automation workflows
│   │   │   ├── notifications/  # Dispatch audit logs
│   │   │   ├── reports/        # Recharts visualizations
│   │   │   ├── data-management/# Excel import/export dry-run engine
│   │   │   ├── settings/       # Business profile and booking policies
│   │   │   ├── team/           # Tenant members and invitations
│   │   │   ├── roles/          # Granular permission matrix
│   │   │   ├── billing/        # Live quota consumption progress bars
│   │   │   ├── audit-logs/     # Immutable activity logs
│   │   │   └── integrations/   # Meta WhatsApp Cloud API setup
│   │   ├── platform/           # Super Admin Tenant & Plan Governance
│   │   ├── book/[slug]/        # Public business booking experience
│   │   └── onboarding/         # Initial business setup wizard
│   ├── components/
│   │   ├── layout/             # Sidebar, Header, and DashboardLayout
│   │   └── ui/                 # Reusable design system primitives
│   ├── lib/
│   │   ├── api/                # Centralized typed API client & services
│   │   └── auth/               # React AuthContext & RBAC guard
│   └── tests/                  # Vitest test suite
├── docs/                       # Architecture, API mapping, and Vercel guides
└── vitest.config.ts            # Test runner configuration
```

---

## 🔒 Security Architecture

1. **Bearer JWT Token Rotation:** Access tokens are kept in secure browser memory with session storage backup and automatic refresh rotation against `POST /auth/refresh`.
2. **Zero Client Secret Exposure:** Sensitive tokens (`MONGODB_URI`, `JWT_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `OPENAI_API_KEY`) reside exclusively on Render.
3. **Idempotency Protection:** Crucial mutations send an `Idempotency-Key` header to prevent duplicate charges or double bookings.
4. **Self-Service Verification:** Appointment modification requires an `X-Appointment-Token` header generated cryptographically upon booking.
