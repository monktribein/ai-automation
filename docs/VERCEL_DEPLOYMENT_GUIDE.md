# Vercel & Render Production Deployment Guide
## Bizwoke Nova AI Automation Platform

This guide documents the production deployment architecture for the **Bizwoke Nova** frontend on Vercel and the existing Node.js/Express backend on Render.

---

## 1. Architecture Overview

```
+------------------------------------+          HTTPS / JSON          +------------------------------------+
|          VERCEL FRONTEND           | -----------------------------> |           RENDER BACKEND           |
| https://bizwoke-nova.vercel.app    |   Bearer JWT + Idempotency     | https://bizwoke-nova-api.onrender  |
|                                    |                                |                                    |
| - Next.js 15 (App Router)          | <----------------------------- | - Node.js + Express + TypeScript   |
| - React 19 Client Side Navigation  |   Envelopes + Status Codes     | - MongoDB Atlas primary database   |
| - Tailwind CSS Design System       |                                | - Meta Cloud WhatsApp Webhook      |
+------------------------------------+                                +------------------------------------+
```

- **Frontend Hosting:** Vercel (Edge Network / Static & Serverless).
- **Backend Hosting:** Render Web Service (Docker / Node.js).
- **Primary Database:** MongoDB Atlas (accessed exclusively by the Express backend).

---

## 2. Environment Variables Configuration

### Frontend (Vercel Project Settings)

Add the following environment variable in the **Vercel Project Dashboard** (`Settings` -> `Environment Variables`):

| Variable Name | Environments | Example Value | Description |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_API_BASE_URL` | Production, Preview, Development | `https://bizwoke-nova-api.onrender.com/api/v1` | Public API gateway base URL. |

> [!CAUTION]
> **Zero Secret Exposure Guarantee:**
> Never add `MONGODB_URI`, `JWT_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `OPENAI_API_KEY`, or any database credentials to Vercel environment variables. All business secrets must remain securely inside Render.

### Backend (Render Environment Settings)

Ensure the Render backend environment is configured with:

| Variable Name | Production Value | Purpose |
| :--- | :--- | :--- |
| `PORT` | `5000` (or Render default) | Server port |
| `NODE_ENV` | `production` | Production mode |
| `CORS_ORIGIN` | `https://bizwoke-nova.vercel.app,https://*.vercel.app` | Allowed origins |
| `MONGODB_URI` | `mongodb+srv://...` | MongoDB connection |
| `JWT_ACCESS_SECRET` | `<64-char-random-secret>` | Access token signing |
| `JWT_REFRESH_SECRET`| `<64-char-random-secret>` | Refresh token signing |
| `WHATSAPP_ACCESS_TOKEN` | `<meta-cloud-system-token>` | WhatsApp Meta API |
| `WHATSAPP_VERIFY_TOKEN` | `<meta-webhook-verify-token>` | Webhook challenge |

---

## 3. Cross-Origin (CORS) & Cookie Configuration

Because Vercel hosts the frontend on `vercel.app` (or your custom domain) and Render hosts the API on `onrender.com`, both domains belong to different Public Suffix List boundaries:

1. **Token Transport Design:**
   - Browsers block third-party cookies across different TLDs by default (Safari ITP and Chrome Third-Party Cookie Phaseout).
   - Bizwoke Nova uses **Authorization Bearer JWTs** stored in secure browser memory and scoped to `sessionStorage` with automatic token refresh rotation.
   - Long-lived refresh tokens are never persisted in unencrypted `localStorage`.

2. **CORS Rules on Render Backend:**
   - Render's Express CORS middleware must whitelist your production Vercel domain and your custom domain:
   ```ts
   const allowedOrigins = [
     'https://bizwoke-nova.vercel.app',
     'https://app.bizwokenova.com',
     /^https:\/\/bizwoke-nova-[a-z0-9]+-team\.vercel\.app$/, // Vercel preview URLs
   ];
   ```
   - Standard headers allowed: `Content-Type`, `Authorization`, `X-Request-Id`, `Idempotency-Key`, `X-Appointment-Token`.
   - Exposed headers: `X-Request-Id`, `Content-Disposition`.

---

## 4. Handling Render Free-Tier Cold Starts

If the backend runs on a Render free or starter instance, it automatically spins down after 15 minutes of inactivity. When a new request arrives, a cold start takes approximately **30 to 50 seconds**.

### Frontend Mitigations Implemented:
1. **Health Check Probing:**
   - The frontend API client includes timeout detection.
2. **Skeleton & Polling UI:**
   - Dashboard widgets, appointment slots, and forms render polite skeleton loaders and informative status badges rather than hard-crashing.
3. **Automatic Idempotent Retries:**
   - Read queries (`GET`) automatically retry upon connection timeout.
   - Destructive operations (`POST`, `DELETE`) do **not** blindly retry without an `Idempotency-Key` to prevent duplicate billing or duplicate bookings.

---

## 5. Step-by-Step Vercel Deployment Instructions

1. **Push Code to GitHub:**
   - Ensure repository `https://github.com/monktribein/ai-automation.git` is synced with the latest changes on `main`.

2. **Import Project into Vercel:**
   - Log into [Vercel Dashboard](https://vercel.com).
   - Click **Add New...** -> **Project**.
   - Select repository `ai-automation`.

3. **Configure Project Settings:**
   - **Framework Preset:** `Next.js`
   - **Root Directory:** Edit and select `bizwoke-nova-frontend`.
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`
   - **Install Command:** `npm install`

4. **Add Environment Variables:**
   - Key: `NEXT_PUBLIC_API_BASE_URL`
   - Value: `https://YOUR-RENDER-BACKEND-URL/api/v1`

5. **Deploy:**
   - Click **Deploy**. Vercel will build and launch your production dashboard.

---

## 6. Post-Deployment Verification Checklist

- [ ] Open `https://<your-vercel-app>.vercel.app/login` and verify login screen renders with high visual polish.
- [ ] Test health check: open browser console network tab; requests should target `https://<render-url>/api/v1/health`.
- [ ] Register a tenant business or log in with administrator credentials.
- [ ] Verify active tenant context loads properly from backend `GET /auth/me`.
- [ ] Create a test service and check that real-time calendar availability slots update on `/book/<slug>`.
- [ ] Confirm no secrets or private keys are visible in client bundle sources.
