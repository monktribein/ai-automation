# Deployment

## Runtime requirements

* Node.js 20+ (image: `node:22-bookworm-slim`), stateless API instances behind a TLS-terminating proxy.
* MongoDB **replica set or sharded cluster** (MongoDB Atlas recommended). Standalone mongod will fail booking transactions.
* Redis 6.2+ for BullMQ in production (managed Redis, e.g. Upstash, ElastiCache, Render Key Value).
* S3-compatible bucket when more than one host handles files (API and worker on different machines).

## Environments

Keep **separate** variable sets per environment (development, staging, production); never reuse secrets.
In `staging`/`production` startup refuses wildcard CORS, `localhost` MongoDB, placeholder secrets, and identical JWT /
appointment secrets. Missing required variables print a clear list and exit with code 1. Optional integrations
left blank are reported as `unavailable`.

Minimum production variables: `NODE_ENV=production`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `APPOINTMENT_TOKEN_SECRET`,
`CORS_ORIGINS`, `REDIS_URL`, `TRUST_PROXY` (1 behind a single proxy), and `STORAGE_PROVIDER=s3` + bucket settings.

## MongoDB Atlas

1. Create a cluster (M10+ for production; any tier supports transactions).
2. Database Access: user with **readWrite on `bizwoke_nova` only** for the app; a separate `dbAdmin` user for index sync.
3. Network Access: allow only your hosting provider's egress IPs / private endpoint.
4. `MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/bizwoke_nova?retryWrites=true&w=majority`
5. Release step: `npm run db:indexes` (with the dbAdmin user's URI).

## Render (example)

* **Web Service** (Docker or Node): build `npm ci && npm run build`, start `npm start`, health check path `/health/ready`.
* **Background Worker**: same repo, start `npm run start:worker`.
* **Key Value (Redis)** → `REDIS_URL`. Atlas → `MONGODB_URI`. Add secrets in an Environment Group shared by both.
* Pre-deploy command: `npm run db:indexes`.
* Render sets `PORT`; the server binds to it. Set `TRUST_PROXY=1`.

Any Node host works the same way (Railway, Fly.io, ECS, Kubernetes): one API deployment, one worker deployment.
Use `/health/live` for liveness and `/health/ready` for readiness.

## Docker

```bash
docker build -t bizwoke-nova .
docker run --env-file .env -p 5000:5000 bizwoke-nova                         # API
docker run --env-file .env bizwoke-nova node dist/jobs/worker.js             # worker
```

The image runs as the unprivileged `node` user, contains production dependencies only, and has a `HEALTHCHECK`.
`docker-compose.yml` is for **local development** (single-node replica set + Redis).

## Graceful shutdown

On `SIGTERM`/`SIGINT` the API stops accepting connections, finishes in-flight requests, waits for post-commit event
handlers, closes the queue and the database (forced exit after 15 s). The worker waits for active jobs (`worker.close()`).

## Backup and restore

* **Atlas**: enable Cloud Backup with point-in-time restore; test restores into a staging project regularly.
* **Self-managed**: `mongodump --uri "$MONGODB_URI" --gzip --archive=backup-$(date +%F).gz` and
  `mongorestore --uri "$TARGET_URI" --gzip --archive=backup.gz --nsInclude 'bizwoke_nova.*'`.
  Encrypt backups at rest and restrict access; they contain every tenant's data.
* After restore, run `npm run db:indexes`. TTL collections (tokens, idempotency, webhook events) self-clean.
* Per-tenant export for offboarding can be done with Excel exports or `mongodump --query '{"tenantId":{"$oid":"..."}}'`
  per collection.

## Logging, monitoring and troubleshooting

* Logs are JSON (Pino) on stdout with `requestId`, method, URL, status and latency; authorization headers, cookies,
  passwords, tokens, secrets and API keys are redacted. Ship stdout to your log platform.
* Every response carries `X-Request-Id`; search logs by it. Error responses never include stack traces.
* Error monitoring hook: `errorHandler` logs every 5xx at `error` level; attach Sentry/Datadog via a Pino transport or
  by wrapping `logger.error` in `src/common/logging/logger.ts`.

| Symptom | Likely cause |
|---|---|
| `Transaction numbers are only allowed on a replica set member` | MongoDB is standalone; use a replica set/Atlas |
| `/health/ready` 503 | Database unreachable: check URI, IP allowlist, credentials |
| `TenantGuardError` in logs | A code path queried tenant data without a tenantId: a bug, intentionally blocked |
| Notifications stuck `QUEUED` | No worker running (Redis mode) or `scheduledFor` in the future |
| Notifications `SKIPPED` | Provider not configured, WhatsApp not enabled, or no approved template mapped |
| 429 on login | `AUTH_RATE_LIMIT_MAX` reached for that IP; check `TRUST_PROXY` behind proxies |
| Exports `FAILED` across hosts | Local storage with separate API/worker hosts: switch to `STORAGE_PROVIDER=s3` |

## Security checklist for production

TLS everywhere · strong unique secrets in a secret manager · `CORS_ORIGINS` explicit · least-privilege DB user ·
Redis with auth/TLS (`rediss://`) · `npm run audit:deps` in CI · rotate `JWT_ACCESS_SECRET` by redeploying (all
sessions require re-login) · keep `SWAGGER_ENABLED=false` if API docs should not be public.
