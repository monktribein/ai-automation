# Bizwoke Nova: run locally and deploy

Backend: `bizwoke-nova-backend` (Express + MongoDB). Frontend: `bizwoke-nova-frontend` (Next.js).
WhatsApp goes through **AK Nexus** (`https://app.aknexus.in/api/v2`).

## 1. Run everything locally (no installs besides Node)

Three terminals:

```bash
# 1) database: persistent local MongoDB replica set (data in bizwoke-nova-backend/storage/mongo-data)
cd bizwoke-nova-backend && npm run db:local

# 2) backend: first time only -> npm run db:indexes
cd bizwoke-nova-backend && npm run dev          # http://localhost:5001  (API docs: /docs; PORT=5001 in .env)

# 3) frontend
cd bizwoke-nova-frontend && npm run dev         # http://localhost:3000
```

Register at http://localhost:3000/register. The backend reads `bizwoke-nova-backend/.env` (git-ignored).

Check WhatsApp at any time (read-only):

```bash
cd bizwoke-nova-backend && npm run whatsapp:check
# send ONE real test message to a number you own:
npm run whatsapp:check -- --send-to=91XXXXXXXXXX
```

Locally, AK Nexus cannot reach `localhost`, so **incoming** WhatsApp messages only work after deployment
(or through a tunnel such as `cloudflared tunnel --url http://localhost:5001`). Outgoing messages work locally.

## 2. Database: MongoDB Atlas (production)

1. https://cloud.mongodb.com → create a free **M0** cluster (region: Mumbai `ap-south-1`).
2. **Database Access** → add user `bizwoke_app`, role *Read and write to any database* (or `readWrite` on `bizwoke_nova`).
3. **Network Access** → add `0.0.0.0/0` (Render has no fixed IPs on standard plans) — the strong password protects it.
4. **Connect → Drivers** → copy the string and add the database name:
   `mongodb+srv://bizwoke_app:<password>@<cluster>.mongodb.net/bizwoke_nova?retryWrites=true&w=majority`

Atlas clusters are replica sets, so booking transactions work out of the box.

## 3. Backend: Render

1. Push this repo to GitHub (`.env` files are git-ignored and are never pushed).
2. Render → **New → Blueprint** → select the repo. It reads `render.yaml`.
3. Fill in the prompted values:
   - `MONGODB_URI` = the Atlas string from step 2
   - `AK_NEXUS_API_TOKEN` = your `wz_...` token
   - `CORS_ORIGINS` = your Vercel URL (set after step 4, e.g. `https://bizwoke-nova.vercel.app`)
   - `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` = AI key for automated replies (see "AI" below)
   - email (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`) optional
4. Deploy. Indexes are created automatically (`preDeployCommand`). Check `https://<service>.onrender.com/health`.
5. Create your platform admin once (Render → Shell):
   `SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='long-pass-123' npx tsx scripts/create-super-admin.ts`

The blueprint uses the paid **Starter** plan: free Render instances sleep and would miss WhatsApp webhooks.

## 4. Frontend: Vercel

1. Vercel → **Add New Project** → same repo → **Root Directory: `bizwoke-nova-frontend`**.
2. Environment variable: `NEXT_PUBLIC_API_BASE_URL = https://<service>.onrender.com/api/v1`
3. Deploy, then put the Vercel URL into Render's `CORS_ORIGINS` and redeploy the backend.

## 5. Connect AK Nexus to the deployed backend

1. Render → backend service → **Environment** → copy the generated `AK_NEXUS_WEBHOOK_SECRET`.
2. AK Nexus → **API & Automation → Webhooks → Create Webhook**
   - URL: `https://<service>.onrender.com/api/v1/webhooks/aknexus/<AK_NEXUS_WEBHOOK_SECRET>`
   - Event: new / incoming message
3. In the app: **Dashboard → Integrations → WhatsApp** → Instance ID `6ADC3724DD691`, enable, save.
4. Send a WhatsApp message to +91 89208 77101 and watch it appear under **Conversations**.

## AI (automated WhatsApp replies)

Inbound messages are answered by the AI assistant, which books, reschedules and cancels through the
backend's own tools. Set `AI_PROVIDER=anthropic` + `AI_API_KEY` (or `openai` + `AI_MODEL`). Without a key,
WhatsApp messages are still received, the conversation is handed to your team, and the customer gets an
honest "a team member will reply" message. AK Nexus's own `/ai/chat` endpoint has no tool calling, so it
can't book appointments and isn't used.

Then enable it per business, in two steps:
1. Platform admin grants the feature: `PATCH /api/v1/tenants/<tenantId>/features { "ai": true }` (SUPER_ADMIN token; try it in `/docs`).
2. The business turns it on: Dashboard → Settings → AI, or `PATCH /api/v1/business { "ai": { "enabled": true } }`.
