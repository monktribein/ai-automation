# Bizwoke Nova — Backend

Multi-tenant, configuration-driven backend for appointment booking, enquiry/lead management and
AI-assisted customer conversations (API and WhatsApp). Backend only: everything is exposed as a
REST API under `/api/v1`, documented with OpenAPI (`/docs`).

**Stack:** Node.js (≥ 20) · TypeScript (strict) · Express 5 · MongoDB + Mongoose · Zod · JWT ·
bcrypt · Pino · Helmet · BullMQ/Redis (optional) · ExcelJS · Vitest + Supertest.

> No frontend, no Next.js, no NestJS. The only HTML served is Swagger UI at `/docs`.

## Quick start (local)

Prerequisites: Node.js 20+ (tested on 24), and a **MongoDB replica set** (transactions are
required for booking). Docker Compose provides one; so does MongoDB Atlas.

```bash
cd bizwoke-nova-backend
npm install
cp .env.example .env
# generate two different secrets and paste them into .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # APPOINTMENT_TOKEN_SECRET

npm run db:indexes      # create collections + indexes, sync permission catalog
npm run dev             # http://localhost:5000  (docs: /docs)
```

### With Docker Compose (API + worker + MongoDB replica set + Redis)

```bash
cp .env.example .env    # set the two secrets
docker compose up --build
```

### Bootstrap a platform administrator

There is intentionally no API that grants `SUPER_ADMIN`.

```bash
SUPER_ADMIN_EMAIL=admin@yourco.com SUPER_ADMIN_PASSWORD='a-long-passphrase-123' npm run db:seed-admin
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run worker:dev` | API / BullMQ worker with reload |
| `npm run build` → `npm start` / `npm run start:worker` | Production build and start |
| `npm test` | Full test suite (in-memory MongoDB replica set; no external services) |
| `npm run typecheck` · `npm run lint` · `npm run format` | Quality gates |
| `npm run db:indexes` (`-- --dry` to preview) | Index/migration sync |
| `npm run db:seed-admin` | Create/promote a SUPER_ADMIN |
| `npm run audit:deps` | Production dependency vulnerability scan |

## A first API walkthrough

```bash
API=http://localhost:5000/api/v1
# 1. Register + provision a business (you become TENANT_ADMIN)
curl -s -X POST $API/auth/register -H 'content-type: application/json' -d '{
  "email":"owner@example.com","password":"ChangeMe12345","name":"Owner",
  "business":{"name":"Glow Studio","slug":"glow-studio","timezone":"Asia/Kolkata"}}'
TOKEN=...   # data.tokens.accessToken

# 2. Create a service and a staff member who provides it
curl -s -X POST $API/services -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Haircut","durationMinutes":45,"bufferMinutes":15}'
curl -s -X POST $API/staff -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Asha","serviceIds":["<serviceId>"]}'

# 3. Public, unauthenticated booking flow
curl -s "$API/public/glow-studio/slots?serviceId=<serviceId>&from=2026-11-05"
curl -s -X POST $API/public/glow-studio/appointments -H 'Idempotency-Key: 7f3c9a1e-booking' \
  -H 'content-type: application/json' \
  -d '{"serviceId":"<serviceId>","startAt":"2026-11-05T10:00:00+05:30","customer":{"name":"Ravi","email":"ravi@example.com"}}'
```

## Documentation

| Document | Contents |
|---|---|
| [openapi.yaml](openapi.yaml) | Full API specification (served at `/docs` and `/openapi.json`) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, module boundaries, request lifecycle |
| [docs/DATABASE.md](docs/DATABASE.md) | Collections, ownership, indexes, deletion behaviour |
| [docs/TENANT_ISOLATION.md](docs/TENANT_ISOLATION.md) | Isolation enforcement and threat model |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | JWT, refresh rotation, roles, permissions |
| [docs/EXCEL_IMPORT_EXPORT.md](docs/EXCEL_IMPORT_EXPORT.md) | Worksheets, validation and processing |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | AI, WhatsApp, email, storage, queue |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, Atlas, backups, troubleshooting |
| [docs/TESTING.md](docs/TESTING.md) | Test commands and coverage map |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | What is not done / not verified |
| [docs/ACCEPTANCE_CHECKLIST.md](docs/ACCEPTANCE_CHECKLIST.md) | Requirement-by-requirement verification |
