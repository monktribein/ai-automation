import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import ExcelJS from 'exceljs';
import {
  setupTestApp,
  teardownTestApp,
  createTenant,
  auth,
  addMember,
  setupBookable,
  futureDate,
  at,
  drainInlineQueue,
  type TenantFixture,
} from '../helpers';
import { XLSX_MIME } from '../../modules/imports-exports/excel';
import { CustomerModel } from '../../modules/customers/customer.models';
import { ImportJobModel } from '../../modules/imports-exports/import-export.models';
import { resetEnvCache } from '../../config/env';

let app: Express;
let t: TenantFixture;
beforeAll(async () => {
  app = await setupTestApp();
  t = await createTenant(app);
});
afterAll(teardownTestApp);

async function xlsx(rows: unknown[][], mutate?: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('data');
  for (const r of rows) ws.addRow(r);
  mutate?.(ws);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const upload = (
  path: string,
  buf: Buffer,
  who: { token: string } = t,
  filename = 'data.xlsx',
  contentType = XLSX_MIME,
) => request(app).post(path).set(auth(who)).attach('file', buf, { filename, contentType });

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function download(path: string, who: { token: string } = t) {
  const res = await request(app).get(path).set(auth(who)).buffer(true).parse(binary).expect(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return { res, ws: wb.worksheets[0]! };
}

describe('templates', () => {
  it('generates a valid template per resource', async () => {
    for (const r of ['customers', 'leads', 'services', 'staff', 'appointments']) {
      const { ws, res } = await download(`/api/v1/imports/${r}/template`);
      expect(res.headers['content-type']).toContain(XLSX_MIME);
      expect(ws.getRow(1).values).toContain(r === 'appointments' ? 'serviceName' : 'name');
    }
  });
});

describe('import validation (dry run)', () => {
  it('validates a good file without writing anything', async () => {
    const buf = await xlsx([
      ['name', 'email', 'phone', 'tags', 'consentEmail'],
      ['Ana Example', 'ana@example.test', '+15550101', 'vip, new', 'yes'],
      ['Ben Example', 'ben@example.test', '', '', 'no'],
    ]);
    const res = await upload('/api/v1/imports/customers/validate', buf).expect(200);
    expect(res.body.data).toMatchObject({ dryRun: true, rows: 2, valid: 2, invalid: 0 });
    expect(await CustomerModel.countDocuments({ tenantId: t.tenantId, email: 'ana@example.test' })).toBe(0);
  });

  it('rejects invalid headers, missing required columns and duplicate headers', async () => {
    const unknown = await upload(
      '/api/v1/imports/customers/validate',
      await xlsx([
        ['name', 'email', 'password'],
        ['a', 'a@example.test', 'x'],
      ]),
    ).expect(422);
    expect(unknown.body.error.message).toMatch(/Unsupported column\(s\): password/);
    const missing = await upload(
      '/api/v1/imports/services/validate',
      await xlsx([['name'], ['Thing']]),
    ).expect(422);
    expect(missing.body.error.message).toMatch(/Missing required column\(s\): durationminutes/);
    const dup = await upload(
      '/api/v1/imports/customers/validate',
      await xlsx([
        ['name', 'name'],
        ['a', 'b'],
      ]),
    ).expect(422);
    expect(dup.body.error.message).toMatch(/Duplicate column/);
  });

  it('reports row-level errors with row numbers and columns', async () => {
    const buf = await xlsx([
      ['name', 'email', 'phone'],
      ['Valid', 'valid@example.test', ''],
      ['', 'noname@example.test', ''],
      ['Bad Email', 'not-an-email', ''],
      ['No Contact', '', ''],
    ]);
    const res = await upload('/api/v1/imports/customers/validate', buf).expect(200);
    expect(res.body.data).toMatchObject({ rows: 4, valid: 1, invalid: 3 });
    const errs = res.body.data.errors as { row: number; column?: string; message: string }[];
    expect(errs).toContainEqual(expect.objectContaining({ row: 3, column: 'name' }));
    expect(errs).toContainEqual(expect.objectContaining({ row: 4, column: 'email' }));
    expect(errs.find((e) => e.row === 5)?.message).toMatch(/Email or phone/);
  });

  it('detects duplicate rows within the file and against existing data', async () => {
    await request(app)
      .post('/api/v1/customers')
      .set(auth(t))
      .send({ name: 'Existing', email: 'exists@example.test' })
      .expect(201);
    const buf = await xlsx([
      ['name', 'email'],
      ['One', 'dup@example.test'],
      ['Two', 'DUP@example.test'],
      ['Three', 'exists@example.test'],
    ]);
    const skip = await upload('/api/v1/imports/customers/validate', buf).expect(200);
    expect(skip.body.data).toMatchObject({ duplicatesInFile: 1, existingMatches: 1, valid: 2 });
    const fail = await upload('/api/v1/imports/customers/validate?duplicateStrategy=fail', buf).expect(200);
    expect(fail.body.data.invalid).toBe(2);
  });

  it('rejects formula cells (formula injection on import)', async () => {
    const buf = await xlsx(
      [
        ['name', 'email'],
        ['x', 'f@example.test'],
      ],
      (ws) => {
        ws.getCell('A2').value = { formula: 'HYPERLINK("http://evil.test","click")', result: 'click' };
      },
    );
    const res = await upload('/api/v1/imports/customers/validate', buf).expect(200);
    expect(res.body.data.errors[0]).toMatchObject({
      row: 2,
      column: 'name',
      message: 'Formulas are not allowed',
    });
  });

  it('rejects non-xlsx uploads by extension, MIME type and magic bytes', async () => {
    const good = await xlsx([['name'], ['x']]);
    await upload('/api/v1/imports/customers/validate', good, t, 'data.csv', 'text/csv').expect(415);
    await upload('/api/v1/imports/customers/validate', good, t, 'data.xlsx', 'text/plain').expect(415);
    await upload('/api/v1/imports/customers/validate', Buffer.from('name,email\nx,y'), t, 'data.xlsx').expect(
      415,
    );
    // Valid ZIP header but not a workbook.
    const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
    const r = await upload('/api/v1/imports/customers/validate', fakeZip).expect(422);
    expect(r.body.error.message).toMatch(/not a readable/);
    await request(app).post('/api/v1/imports/customers/validate').set(auth(t)).expect(422);
  });

  it('rejects oversized uploads and too many rows', async () => {
    const big = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(6 * 1024 * 1024)]);
    const r = await upload('/api/v1/imports/customers/validate', big).expect(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    process.env.IMPORT_MAX_ROWS = '3';
    resetEnvCache();
    try {
      const rows = [
        ['name', 'email'],
        ...Array.from({ length: 5 }, (_, i) => [`n${i}`, `n${i}@example.test`]),
      ];
      const res = await upload('/api/v1/imports/customers/validate', await xlsx(rows)).expect(422);
      expect(res.body.error.message).toMatch(/maximum of 3/);
    } finally {
      delete process.env.IMPORT_MAX_ROWS;
      resetEnvCache();
    }
  });
});

describe('import commit', () => {
  it('imports valid customers asynchronously with skip/update duplicate strategies', async () => {
    const first = await xlsx([
      ['name', 'email', 'tags'],
      ['Imp One', 'imp1@example.test', 'a'],
      ['Imp Two', 'imp2@example.test', ''],
    ]);
    const job = await upload('/api/v1/imports/customers', first).expect(202);
    await drainInlineQueue();
    const done = await request(app).get(`/api/v1/imports/${job.body.data.id}`).set(auth(t)).expect(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', totals: { created: 2, skipped: 0 } });
    expect(done.body.data.fileKey).toBeUndefined();

    const second = await xlsx([
      ['name', 'email'],
      ['Renamed One', 'imp1@example.test'],
      ['Imp Three', 'imp3@example.test'],
    ]);
    const skipJob = await upload('/api/v1/imports/customers', second).expect(202);
    await drainInlineQueue();
    expect(
      (await request(app).get(`/api/v1/imports/${skipJob.body.data.id}`).set(auth(t))).body.data.totals,
    ).toMatchObject({ created: 1, skipped: 1 });

    const updJob = await upload('/api/v1/imports/customers?duplicateStrategy=update', second).expect(202);
    await drainInlineQueue();
    expect(
      (await request(app).get(`/api/v1/imports/${updJob.body.data.id}`).set(auth(t))).body.data.totals,
    ).toMatchObject({ updated: 2 });
    const c = await CustomerModel.findOne({
      tenantId: t.tenantId,
      emailNormalized: 'imp1@example.test',
    }).lean();
    expect(c!.name).toBe('Renamed One');
  });

  it('writes nothing when any row is invalid (all-or-nothing validation)', async () => {
    const buf = await xlsx([
      ['name', 'email'],
      ['Good', 'aon-good@example.test'],
      ['Bad', 'nope'],
    ]);
    const job = await upload('/api/v1/imports/customers', buf).expect(202);
    await drainInlineQueue();
    const r = await request(app).get(`/api/v1/imports/${job.body.data.id}`).set(auth(t)).expect(200);
    expect(r.body.data.status).toBe('FAILED');
    expect(r.body.data.rowErrors[0].row).toBe(3);
    expect(await CustomerModel.countDocuments({ tenantId: t.tenantId, email: 'aon-good@example.test' })).toBe(
      0,
    );
    const stored = await ImportJobModel.findOne({ _id: job.body.data.id, tenantId: t.tenantId }).lean();
    expect(stored!.fileKey).toBeUndefined(); // temp upload deleted
  });

  it('imported appointments go through the booking engine (overlaps rejected per row)', async () => {
    const { serviceId } = await setupBookable(app, t);
    const svc = await request(app).get(`/api/v1/services/${serviceId}`).set(auth(t)).expect(200);
    const start = at(futureDate(20), '10:00');
    const buf = await xlsx([
      ['serviceName', 'startAt', 'customerName', 'customerEmail'],
      [svc.body.data.name, start, 'Appt One', 'ap1@example.test'],
      [svc.body.data.name, start, 'Appt Two', 'ap2@example.test'],
    ]);
    const job = await upload('/api/v1/imports/appointments', buf).expect(202);
    await drainInlineQueue();
    const r = await request(app).get(`/api/v1/imports/${job.body.data.id}`).set(auth(t)).expect(200);
    expect(r.body.data.totals.created).toBe(1);
    expect(r.body.data.rowErrors[0]).toMatchObject({ row: 3 });
  });
});

describe('export', () => {
  it('exports authorized fields only and neutralises formula injection', async () => {
    await request(app)
      .post('/api/v1/customers')
      .set(auth(t))
      .send({ name: '=HYPERLINK("http://evil.test","x")', email: 'formula@example.test', tags: ['@SUM(A1)'] })
      .expect(201);
    const job = await request(app).post('/api/v1/exports/customers').set(auth(t)).send({}).expect(202);
    expect(job.body.data.columns).toContain('email');
    await drainInlineQueue();
    const status = await request(app).get(`/api/v1/exports/${job.body.data.id}`).set(auth(t)).expect(200);
    expect(status.body.data.downloadPath).toBe(`/api/v1/exports/${job.body.data.id}/download`);
    const { ws, res } = await download(status.body.data.downloadPath);
    expect(res.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="${t.slug}-customers-\\d{8}T\\d{6}\\.xlsx"`),
    );
    let found = false;
    ws.eachRow((row) => {
      if (String(row.getCell(3).value) === 'formula@example.test') {
        found = true;
        expect(row.getCell(2).value).toBe(`'=HYPERLINK("http://evil.test","x")`);
        expect(row.getCell(2).formula).toBeUndefined();
        expect(row.getCell(5).value).toBe(`'@SUM(A1)`);
      }
    });
    expect(found).toBe(true);
  });

  it('drops PII columns for roles without customers:pii', async () => {
    await request(app)
      .post('/api/v1/roles')
      .set(auth(t))
      .send({ key: 'ANALYST', name: 'Analyst', permissions: ['customers:read', 'exports:run'] })
      .expect(201);
    const analyst = await addMember(app, t, ['ANALYST']);
    const job = await request(app).post('/api/v1/exports/customers').set(auth(analyst)).send({}).expect(202);
    expect(job.body.data.columns).not.toContain('email');
    expect(job.body.data.columns).not.toContain('phone');
    await drainInlineQueue();
    const { ws } = await download(`/api/v1/exports/${job.body.data.id}/download`, analyst);
    expect(ws.getRow(1).values).not.toContain('email');
  });

  it('rejects unauthorized exports and unsupported resources', async () => {
    const op = await addMember(app, t, ['SERVICE_PROVIDER']);
    await request(app).post('/api/v1/exports/customers').set(auth(op)).send({}).expect(403);
    await request(app).post('/api/v1/exports/users').set(auth(t)).send({}).expect(422);
    await request(app)
      .post('/api/v1/exports/leads')
      .set(auth(t))
      .send({ from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' })
      .expect(422);
  });

  it('supports date-range filters for appointment exports', async () => {
    const job = await request(app)
      .post('/api/v1/exports/appointments')
      .set(auth(t))
      .send({ from: '2000-01-01T00:00:00Z', to: '2000-01-02T00:00:00Z' })
      .expect(202);
    await drainInlineQueue();
    const s = await request(app).get(`/api/v1/exports/${job.body.data.id}`).set(auth(t)).expect(200);
    expect(s.body.data).toMatchObject({ status: 'COMPLETED', rowCount: 0 });
  });
});
