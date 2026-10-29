# Excel import and export

Backend-only `.xlsx` processing with ExcelJS. Requires the tenant feature `excel` (on by default), `imports:run` or
`exports:run`, **and** the resource's own read/write permission.

## Supported worksheets

Only the **first worksheet** is read. Row 1 holds headers (case-insensitive, any order). Unknown columns, duplicate
headers or missing required columns reject the whole file. There is no `tenantId` column; one in a file is rejected
as unsupported.

| Resource | Columns (required in bold) | Duplicate key | Notes |
|---|---|---|---|
| `customers` | **name**, email, phone, preferredLanguage, tags (comma-separated), consentEmail, consentWhatsapp, consentMarketing (yes/no/true/false/1/0), notes | email, else phone | Email or phone required |
| `leads` | **name**, email, phone, interest, message, status | email, else phone | Email or phone required |
| `services` | **name**, description, **durationMinutes**, bufferMinutes, price, currency, category | name | Minutes must be multiples of 5 |
| `staff` | **name**, email, phone, title, capacity | email | |
| `appointments` | **serviceName**, staffEmail, **startAt** (ISO-8601 with offset), **customerName**, customerEmail, customerPhone, notes | — | Each row goes through the booking engine: schedule and overlap rules apply |

Download a template with example (fictional) values: `GET /api/v1/imports/:resource/template`.

## Import flow

1. **Upload checks** (`multipart/form-data`, field `file`): `.xlsx` extension, the exact XLSX MIME type, ZIP
   magic bytes, max `IMPORT_MAX_FILE_BYTES` (5 MB) → otherwise `415`/`413`.
2. **Dry run**: `POST /imports/:resource/validate?duplicateStrategy=skip|update|fail` returns
   `{ rows, valid, invalid, duplicatesInFile, existingMatches, errors[{row, column, message}] }`. Nothing is written.
3. **Import**: `POST /imports/:resource` stores the file under a server-generated key, creates an `importJobs` record,
   and enqueues `import.process` → `202`. Poll `GET /imports/:jobId`.
4. **Processing** (job): re-resolves the uploader's membership and permissions (revoked access stops the job), then
   re-validates the full file. **If any row is invalid, nothing is written** (`FAILED` + row errors).
   Otherwise rows are written in batches of 100. Duplicates follow the strategy: `skip` (count as skipped),
   `update` (update matched record), `fail` (treated as invalid during validation).
5. Each row is written atomically. Rows that fail at write time (e.g. an appointment slot taken meanwhile) are reported
   with their row number; other rows still commit. The uploaded file is **deleted** after processing (and by the
   cleanup job if a worker crashed).

Cell handling: formula cells are rejected (`Formulas are not allowed`), rich text is flattened, hyperlinks keep only their
text, and strings are trimmed and length-bounded. Row limit: `IMPORT_MAX_ROWS` (5000).

## Export flow

1. `POST /exports/:resource` with optional `{ from, to, status }` → `202 { id, columns }`.
2. The `export.generate` job re-checks permissions, queries with explicit tenant equality, streams rows into an
   ExcelJS streaming writer, and stores the file at `tenants/<tenantId>/exports/<jobId>.xlsx`.
3. `GET /exports/:jobId` returns status and `downloadPath`; `GET /exports/:jobId/download` streams the file to an
   authorized member of the same tenant (`Cache-Control: no-store`, audited). No public URLs.
4. Files expire after `EXPORT_RETENTION_HOURS` (TTL on the job + cleanup job deletes the file).

Field permissions: columns marked PII (email/phone) are included only with `customers:pii`, checked both at request
time and again at execution time. **Formula injection**: every string cell starting with `= + - @ \t \r` is prefixed
with `'`. Filenames are `<slug>-<resource>-<UTCstamp>.xlsx`, sanitised. Row cap: `EXPORT_MAX_ROWS` (the job records
`truncated: true` when reached). Exports and imports consume the `exports`/`imports` usage quotas and are audited.
