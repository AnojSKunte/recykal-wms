// POST /api/po          → submit new PO
// GET  /api/po?action=  → handle approval/reject from email link
import { sheetsGet, sheetsAppend, sheetsUpdate, driveUpload, jsonResponse, errorResponse } from './_sheets.js';

// ── Approval link handler (GET — no auth needed) ──────────────────
export async function onRequestGet(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const action = url.searchParams.get('action');
  const token  = url.searchParams.get('token');
  const remarks   = url.searchParams.get('remarks') || '';
  const confirmed = url.searchParams.get('confirmed') === '1';

  if ((action === 'approve' || action === 'reject') && token) {
    return handleApproval(env, action, token, remarks, confirmed, url.origin);
  }
  return new Response('Not found', { status: 404 });
}

// ── PO Submission (POST) ──────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();

    // Upload images
    const imageUrls = [];
    for (const img of (data.images || [])) {
      if (img?.base64) {
        const url = await driveUpload(env, img.base64, img.mimeType, img.fileName, env.PO_DRIVE_FOLDER_ID);
        imageUrls.push(url);
      }
    }

    // Totals
    let totalTaxable = 0, totalGst = 0;
    (data.items || []).forEach(item => {
      const tax = (parseFloat(item.qty)||0) * (parseFloat(item.rate)||0);
      totalTaxable += tax;
      totalGst     += tax * ((parseFloat(item.gstPct)||0) / 100);
    });
    const grandTotal = totalTaxable + totalGst;

    // Generate PO ID
    const existing = await sheetsGet(env, 'PO Requisition').catch(() => []);
    let maxNum = 0;
    existing.slice(1).forEach(r => {
      const m = String(r[0]||'').match(/^PO(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    const poId = 'PO' + String(maxNum + 1).padStart(3, '0');
    const token = crypto.randomUUID();
    const now   = new Date().toISOString();

    // Ensure headers exist
    if (!existing.length) {
      await sheetsAppend(env, 'PO Requisition', [
        'PO ID','Timestamp','Processing Center','Submitted By Email','Submitted By Name',
        'Category','Supplier Name','GSTIN','Supplier Address','Items (JSON)',
        'Taxable Value','Total GST','Grand Total','Payment Term','Terms & Conditions',
        'Image URLs','Remarks','Approver Name','Approver Email',
        'Status','Approval Timestamp','Approval Remarks','Token',
      ]);
    }

    await sheetsAppend(env, 'PO Requisition', [
      poId, now, data.processingCenter||'', data.submittedByEmail||'', data.submittedByName||'',
      data.category||'', data.supplierName||'', data.selectedGstin||'', data.selectedAddress||'',
      JSON.stringify(data.items||[]), totalTaxable, totalGst, grandTotal,
      data.paymentTerm||'', data.termsConditions||'', imageUrls.join('\n'), data.remarks||'',
      data.approvingAuthorityName||'', data.approvingAuthorityEmail||'',
      'Waiting for Approval', '', '', token,
    ]);

    // Send approval email
    await sendApprovalEmail(env, { ...data, poId, token, totalTaxable, totalGst, grandTotal, imageUrls, timestamp: now });

    return jsonResponse({ success: true, poId });
  } catch (err) {
    return errorResponse('PO submission failed: ' + err.message);
  }
}

// ── Approval handler ──────────────────────────────────────────────
async function handleApproval(env, action, token, remarks, confirmed, origin) {
  const rows = await sheetsGet(env, 'PO Requisition').catch(() => []);
  let rowIndex = -1, rd = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][22]||'').trim() === token) { rowIndex = i; rd = rows[i]; break; }
  }

  const html = (title, msg, color) => new Response(resultHtml(title, msg, color), {
    headers: { 'Content-Type': 'text/html' }
  });

  if (!rd) return html('Invalid Link', 'This link is not valid or has already been used.', '#dc3545');

  const status = String(rd[19]||'').trim();
  if (status !== 'Waiting for Approval')
    return html('Already Processed', `PO <strong>${rd[0]}</strong> is already <strong>${status}</strong>.`, '#e67e22');

  if (action === 'reject' && !confirmed) {
    return new Response(rejectReasonHtml(token, origin + '/api/po', rd[0]), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
  const now = new Date().toISOString();
  // Update row: col T=status(20), U=timestamp(21), V=remarks(22) — 1-indexed
  const sheetRow = rowIndex + 1;
  await sheetsUpdate(env, `PO Requisition!T${sheetRow}:V${sheetRow}`, [[newStatus, now, remarks]]);

  // Notify requester
  let items = []; try { items = JSON.parse(rd[9]); } catch(_) {}
  const pd = {
    poId: rd[0], processingCenter: rd[2], submittedByEmail: rd[3], submittedByName: rd[4],
    category: rd[5], supplierName: rd[6], totalTaxable: rd[10], totalGst: rd[11], grandTotal: rd[12],
    approvingAuthorityName: rd[17], approvingAuthorityEmail: rd[18],
    approvalTimestamp: now, approvalRemarks: remarks, status: newStatus, items,
    imageUrls: String(rd[15]||'').split('\n').filter(Boolean),
  };

  await sendStatusEmail(env, pd, action);
  if (action === 'approve') {
    await sendOpsEmail(env, pd);
    await createLotsFromPO(env, pd);
  }

  const msg = action === 'approve'
    ? `PO <strong>${pd.poId}</strong> has been <strong style="color:#276221">Approved</strong>.`
    : `PO <strong>${pd.poId}</strong> has been <strong style="color:#9c0006">Rejected</strong>.`;
  return html(action === 'approve' ? 'PO Approved' : 'PO Rejected', msg,
    action === 'approve' ? '#1a6b3c' : '#dc3545');
}

// ── Lot creation on approval ──────────────────────────────────────
async function createLotsFromPO(env, pd) {
  const existing = await sheetsGet(env, 'Lot Inventory').catch(() => []);
  const existingLots = new Set(existing.slice(1).map(r => String(r[0]).trim()));

  if (!existing.length) {
    await sheetsAppend(env, 'Lot Inventory', [
      'Lot No','Parent Lot','Generation','PO No','Processing Center',
      'Material','HSN','UOM','QTY In','QTY Processed','QTY Remaining',
      'Status','Created Date','Closed Date','Source PO Rate','Notes',
    ]);
  }

  const now = new Date().toISOString().split('T')[0];
  for (let i = 0; i < pd.items.length; i++) {
    const item  = pd.items[i];
    const lotNo = `${pd.poId}-L${i + 1}`;
    if (existingLots.has(lotNo)) continue;
    await sheetsAppend(env, 'Lot Inventory', [
      lotNo, '', 0, pd.poId, pd.processingCenter || '',
      item.materialName || '', item.hsn || '', item.uom || '',
      parseFloat(item.qty)||0, 0, parseFloat(item.qty)||0,
      'Active', now, '', parseFloat(item.rate)||0, 'Created on PO approval',
    ]);
  }
}

// ── Emails ────────────────────────────────────────────────────────
async function sendApprovalEmail(env, d) {
  const baseUrl    = env.APP_URL || '';
  const approveUrl = `${baseUrl}/api/po?action=approve&token=${d.token}`;
  const rejectUrl  = `${baseUrl}/api/po?action=reject&token=${d.token}`;
  const subject    = `[Action Required] PO ${d.poId} — ${d.supplierName}`;
  const body       = `PO ${d.poId} submitted by ${d.submittedByName} requires approval. Grand Total: Rs.${fmt(d.grandTotal)}\n\nApprove: ${approveUrl}\nReject: ${rejectUrl}`;
  await sendEmail(env, d.approvingAuthorityEmail, subject, body);
}

async function sendStatusEmail(env, d, action) {
  const word    = action === 'approve' ? 'Approved' : 'Rejected';
  const subject = `[${word}] PO ${d.poId} — ${d.supplierName}`;
  const body    = `Your PO ${d.poId} has been ${word} by ${d.approvingAuthorityName}.\n${d.approvalRemarks ? 'Remarks: ' + d.approvalRemarks : ''}`;
  await sendEmail(env, d.submittedByEmail, subject, body);
}

async function sendOpsEmail(env, d) {
  const to = env.OPS_EMAIL;
  if (!to) return;
  const subject = `[PO Creation Request] ${d.poId} — ${d.supplierName}`;
  const body    = `Please create a PO for ${d.supplierName}. Grand Total: Rs.${fmt(d.grandTotal)}. Approved by ${d.approvingAuthorityName}.`;
  await sendEmail(env, to, subject, body);
}

async function sendEmail(env, to, subject, text) {
  // Uses Gmail API via service account — requires domain-wide delegation
  // OR use a transactional email service like Resend/Mailgun
  // For now logs to console; wire up your preferred provider
  console.log(`EMAIL TO: ${to}\nSUBJECT: ${subject}\nBODY: ${text}`);
  // TODO: integrate Resend or Gmail API
}

function fmt(n) {
  return Number(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function resultHtml(title, msg, color) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f0f4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}.card{background:#fff;border-radius:14px;padding:44px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 6px 28px rgba(0,0,0,.1)}.pill{display:inline-block;background:${color};color:#fff;padding:7px 28px;border-radius:30px;font-size:12px;font-weight:700;letter-spacing:.8px;margin-bottom:20px}p{color:#555;line-height:1.8;font-size:14px;margin:0 0 8px}.note{margin-top:24px;font-size:11px;color:#bbb}</style>
  </head><body><div class="card"><div class="pill">${title.toUpperCase()}</div><p>${msg}</p><p class="note">You may close this window.</p></div></body></html>`;
}

function rejectReasonHtml(token, postUrl, poId) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f0f4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}.card{background:#fff;border-radius:14px;padding:36px;max-width:480px;width:100%;box-shadow:0 6px 28px rgba(0,0,0,.1)}.pill{display:inline-block;background:#dc3545;color:#fff;padding:5px 20px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:14px}h2{color:#222;font-size:20px;margin:0 0 6px}p{color:#555;font-size:13px;margin:0 0 12px}textarea{width:100%;padding:11px 13px;border:1px solid #ccc;border-radius:7px;font-size:14px;resize:vertical;min-height:110px;font-family:inherit}.btn{display:block;width:100%;padding:13px;background:#dc3545;color:#fff;border:none;border-radius:7px;font-size:15px;font-weight:700;cursor:pointer;margin-top:16px}.skip{text-align:center;margin-top:12px;font-size:12px;color:#aaa;cursor:pointer}</style>
  </head><body><div class="card"><div class="pill">REJECT PO</div><h2>Rejection Reason</h2><p>Ref: <strong>${poId}</strong></p><p>Provide a reason for rejection.</p>
  <textarea id="r" placeholder="Enter rejection reason…"></textarea>
  <button class="btn" onclick="go()">Confirm Rejection</button>
  <div class="skip" onclick="go()">Skip — reject without remarks</div>
  <script>function go(){var r=document.getElementById('r').value;window.location.href='${postUrl}?action=reject&token=${token}&confirmed=1&remarks='+encodeURIComponent(r);}<\/script>
  </div></body></html>`;
}
