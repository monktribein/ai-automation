// Paste into Google Sheet > Extensions > Apps Script, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone). Put the Web App URL in GOOGLE_SHEET_WEBHOOK_URL.
// SECRET must equal GOOGLE_SHEET_SECRET in the backend .env.
const SECRET = 'CHANGE_ME_same_as_GOOGLE_SHEET_SECRET';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return json({ ok: false, error: 'unauthorized' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(data.sheet) || ss.insertSheet(data.sheet);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
      sheet.getRange(1, 1, 1, data.headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Update the existing row for this booking reference, otherwise add a new one.
    const row = data.row.map(String);
    const last = sheet.getLastRow();
    const refs = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
    const idx = refs.findIndex((r) => String(r[0]) === row[0]);
    sheet.getRange(idx >= 0 ? idx + 2 : last + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
