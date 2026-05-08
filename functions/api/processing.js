// /api/processing  POST=submit
// /api/processing/lots?po=&pc=  GET
// /api/processing/pos?pc=        GET
// /api/processing/inventory?lot= GET
// /api/processing/drafts         GET/POST/DELETE
import { sheetsGet, sheetsAppend, sheetsUpdate, jsonResponse, errorResponse } from './_sheets.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname;

  try {
    // GET /api/processing/pos?pc=
    if (path.endsWith('/pos')) {
      const pc   = url.searchParams.get('pc') || '';
      const rows = await sheetsGet(env, 'PO Requisition').catch(() => []);
      if (rows.length < 2) return jsonResponse([]);
      const h   = rows[0].map(x => String(x).trim().toLowerCase());
      const pcI = h.indexOf('processing center');
      const stI = h.indexOf('status');
      const result = rows.slice(1)
        .filter(r => String(r[pcI]||'').trim() === pc && String(r[stI]||'').trim() === 'Approved')
        .map(r => ({ poId: String(r[0]).trim() }));
      return jsonResponse(result);
    }

    // GET /api/processing/lots?po=&pc=
    if (path.endsWith('/lots')) {
      const poId = url.searchParams.get('po') || '';
      const pc   = url.searchParams.get('pc') || '';
      const rows = await sheetsGet(env, 'Lot Inventory').catch(() => []);
      if (rows.length < 2) return jsonResponse([]);
      const result = rows.slice(1)
        .filter(r =>
          String(r[3]||'').trim() === poId &&
          String(r[4]||'').trim() === pc   &&
          String(r[11]||'').trim().toLowerCase() === 'active')
        .map(r => ({
          lotNo: String(r[0]).trim(), material: String(r[5]).trim(),
          hsn: String(r[6]).trim(), uom: String(r[7]).trim(),
          qtyIn: r[8], qtyRemaining: r[10],
        }));
      return jsonResponse(result);
    }

    // GET /api/processing/inventory?lot=
    if (path.endsWith('/inventory')) {
      const lotNo = url.searchParams.get('lot') || '';
      const rows  = await sheetsGet(env, 'Lot Inventory').catch(() => []);
      const row   = rows.slice(1).find(r => String(r[0]).trim() === lotNo);
      if (!row) return jsonResponse(null);
      return jsonResponse({
        lotNo: row[0], parentLot: row[1], generation: row[2], poNo: row[3],
        pc: row[4], material: row[5], hsn: row[6], uom: row[7],
        qtyIn: row[8], qtyProcessed: row[9], qtyRemaining: row[10],
        status: row[11], createdDate: row[12],
      });
    }

    // GET /api/processing/drafts
    if (path.endsWith('/drafts')) {
      const user  = context.data.user;
      const userPCs = user.processingCenters || [];
      const rows  = await sheetsGet(env, 'Processing Drafts').catch(() => []);
      if (rows.length < 2) return jsonResponse([]);
      const drafts = rows.slice(1)
        .filter(r => String(r[6]||'').trim() === 'Open')
        .filter(r => !userPCs.length || userPCs.includes(String(r[2]||'').trim()))
        .map(r => ({
          draftId: String(r[0]).trim(),
          savedAt: String(r[1]).trim(),
          processingCenter: String(r[2]).trim(),
          savedByName: String(r[4]).trim(),
          state: (() => { try { return JSON.parse(r[5]); } catch(_) { return {}; } })(),
        }));
      return jsonResponse(drafts);
    }

    return new Response('Not found', { status: 404 });
  } catch (err) {
    return errorResponse(err.message);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname;

  try {
    // POST /api/processing/drafts — save draft
    if (path.endsWith('/drafts')) {
      const user = context.data.user;
      const body = await request.json();
      const now  = new Date().toISOString();
      const draftId = body.draftId || 'DFT-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();

      const rows = await sheetsGet(env, 'Processing Drafts').catch(() => []);
      if (!rows.length) {
        await sheetsAppend(env, 'Processing Drafts', [
          'Draft ID','Saved At','Processing Center','Saved By Email','Saved By Name','Form State JSON','Status',
        ]);
      }

      // Check if updating existing draft
      if (body.draftId) {
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0]).trim() === body.draftId) {
            await sheetsUpdate(env, `Processing Drafts!B${i+1}:F${i+1}`, [[
              now, body.processingCenter || '', user.email, user.name, JSON.stringify(body.state || {}),
            ]]);
            return jsonResponse({ success: true, draftId: body.draftId });
          }
        }
      }

      await sheetsAppend(env, 'Processing Drafts', [
        draftId, now, body.processingCenter || '', user.email, user.name,
        JSON.stringify(body.state || {}), 'Open',
      ]);
      return jsonResponse({ success: true, draftId });
    }

    // POST /api/processing — submit processing
    const payload = await request.json();

    const now     = new Date();
    const tz      = 'Asia/Kolkata';
    const dateStr = new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:tz})
      .format(now).replace(/ /g,'-');
    const subId = 'PROC-' + now.toISOString().replace(/[-:.TZ]/g,'').slice(0,14);

    // Ensure Processing Log
    const logRows = await sheetsGet(env, 'Processing Log').catch(() => []);
    if (!logRows.length) {
      await sheetsAppend(env, 'Processing Log', [
        'Submission ID','Timestamp','Date','Processing Center','Submitted By Name','Submitted By Email',
        'Input Lot No','Input PO No','Input Material','Input HSN','Input QTY',
        'Job Work','Close Lot','Output Items JSON','Remarks','Draft ID',
      ]);
    }

    const lotRows = await sheetsGet(env, 'Lot Inventory').catch(() => []);

    for (const sec of (payload.sections || [])) {
      // Generate daughter lot number
      const daughterLotNo = nextDaughterLot(sec.inputLotNo, lotRows);

      // Log row
      await sheetsAppend(env, 'Processing Log', [
        subId, now.toISOString(), dateStr, payload.processingCenter,
        payload.submittedByName, payload.submittedByEmail,
        sec.inputLotNo, sec.inputPoNo, sec.inputMaterial, sec.inputHsn,
        sec.inputQty, sec.jobWork, sec.closeLot ? 'Yes' : 'No',
        JSON.stringify(sec.outputs || []), sec.remarks || '', payload.draftId || '',
      ]);

      // Update parent lot qty
      await updateLotQty(env, lotRows, sec.inputLotNo, sec.inputQty, sec.closeLot);

      // Create daughter lot rows — one per output
      const gen = (sec.inputLotGeneration || 0) + 1;
      for (const out of (sec.outputs || [])) {
        await sheetsAppend(env, 'Lot Inventory', [
          daughterLotNo, sec.inputLotNo, gen, sec.inputPoNo, payload.processingCenter,
          out.material, out.hsn || '', out.uom || '',
          parseFloat(out.qty)||0, 0, parseFloat(out.qty)||0,
          'Active', dateStr, '', '', `From: ${sec.jobWork} on ${sec.inputLotNo}`,
        ]);
      }
    }

    // Delete draft if submitted
    if (payload.draftId) await markDraftDone(env, payload.draftId);

    return jsonResponse({ success: true, submissionId: subId });
  } catch (err) {
    return errorResponse('Processing submit failed: ' + err.message);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const { draftId } = await request.json();
    await markDraftDone(env, draftId);
    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function nextDaughterLot(parentLotNo, lotRows) {
  let maxD = 0;
  for (const r of lotRows.slice(1)) {
    if (String(r[1]).trim() !== parentLotNo) continue;
    const m = String(r[0]).match(/-D(\d+)$/);
    if (m) maxD = Math.max(maxD, parseInt(m[1], 10));
  }
  return parentLotNo + '-D' + (maxD + 1);
}

async function updateLotQty(env, lotRows, lotNo, qtyUsed, closeLot) {
  for (let i = 1; i < lotRows.length; i++) {
    if (String(lotRows[i][0]).trim() !== lotNo) continue;
    const remaining = Math.max(0, (parseFloat(lotRows[i][10])||0) - (parseFloat(qtyUsed)||0));
    const processed = (parseFloat(lotRows[i][9])||0) + (parseFloat(qtyUsed)||0);
    const newStatus = (closeLot || remaining <= 0) ? 'Closed' : 'Active';
    const closedDate = newStatus === 'Closed' ? new Date().toISOString().split('T')[0] : '';
    await sheetsUpdate(env, `Lot Inventory!J${i+1}:N${i+1}`, [[processed, remaining, newStatus, closedDate, '']]);
    break;
  }
}

async function markDraftDone(env, draftId) {
  const rows = await sheetsGet(env, 'Processing Drafts').catch(() => []);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === draftId) {
      await sheetsUpdate(env, `Processing Drafts!G${i+1}`, [['Submitted']]);
      break;
    }
  }
}
