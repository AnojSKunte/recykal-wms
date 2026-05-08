// POST /api/attendance
import { sheetsGet, sheetsAppend, sheetsUpdate, driveUpload, jsonResponse, errorResponse } from './_sheets.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { payload, photoBase64, photoMimeType } = await request.json();

    const now     = new Date();
    const tz      = 'Asia/Kolkata';
    const dateStr = new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:tz})
      .format(now).replace(/ /g,'-');
    const shiftCode = payload.shift === 'Morning' ? 'M' : 'E';
    const colHeader = dateStr + ' ' + shiftCode;
    const subId     = 'ATT-' + now.toISOString().replace(/[-:.TZ]/g,'').slice(0,14);

    if (!payload.processingCenter) throw new Error('Processing Center missing');

    // Photo upload
    let photoUrl = '';
    if (photoBase64) {
      const fn = (payload.processingCenter + '_' + dateStr + '_' + shiftCode + '_' + payload.managerName + '.jpg')
        .replace(/[^a-zA-Z0-9._-]/g,'_');
      photoUrl = await driveUpload(env, photoBase64, photoMimeType || 'image/jpeg', fn, env.ATT_DRIVE_FOLDER_ID);
    }

    // Attendance Log
    const logRows = await sheetsGet(env, 'Attendance Log').catch(() => []);
    if (!logRows.length) {
      await sheetsAppend(env, 'Attendance Log', [
        'Submission ID','Timestamp','Date','Shift','Processing Center',
        'Manager Name','Manager Email','Workers JSON','Photo URL','Remarks',
      ]);
    }
    await sheetsAppend(env, 'Attendance Log', [
      subId, now.toISOString(), dateStr, payload.shift, payload.processingCenter,
      payload.managerName, payload.managerEmail, JSON.stringify(payload.workers),
      photoUrl, payload.remarks || '',
    ]);

    // Workers tracker — find or create date column (starts at col H = index 7)
    const wRows = await sheetsGet(env, 'Workers');
    const wH    = (wRows[0] || []).map(h => String(h).trim().toLowerCase());
    const wNI   = wH.indexOf('name');
    const wPCI  = wH.indexOf('processing center');
    const wPrI  = wH.indexOf('worker aprovider') >= 0 ? wH.indexOf('worker aprovider') : wH.indexOf('labour provider');

    let dateColIdx = wH.indexOf(colHeader.toLowerCase());
    if (dateColIdx === -1) {
      dateColIdx = Math.max(7, (wRows[0] || []).length);
      await sheetsUpdate(env, `Workers!${colToLetter(dateColIdx + 1)}1`, [[colHeader]]);
    }

    const colLetter = colToLetter(dateColIdx + 1);

    for (const w of (payload.workers || [])) {
      let rowIdx = -1;
      for (let i = 1; i < wRows.length; i++) {
        if (String(wRows[i][wNI]||'').trim().toLowerCase() === w.name.toLowerCase() &&
            String(wRows[i][wPCI]||'').trim().toLowerCase() === payload.processingCenter.toLowerCase()) {
          rowIdx = i; break;
        }
      }
      if (rowIdx !== -1) {
        await sheetsUpdate(env, `Workers!${colLetter}${rowIdx + 1}`, [['P']]);
      } else if (w.isNew) {
        const newRow = new Array(dateColIdx + 1).fill('');
        newRow[wNI]  = w.name;
        newRow[wPCI] = payload.processingCenter;
        if (wPrI >= 0) newRow[wPrI] = w.provider;
        newRow[dateColIdx] = 'P';
        await sheetsAppend(env, 'Workers', newRow);
      }
    }

    return jsonResponse({ success: true, submissionId: subId });
  } catch (err) {
    return errorResponse('Attendance submission failed: ' + err.message);
  }
}

function colToLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
