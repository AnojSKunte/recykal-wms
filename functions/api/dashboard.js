// GET /api/dashboard?centers=Center+A,Center+B
import { sheetsGet, jsonResponse, errorResponse } from '../_sheets.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url     = new URL(request.url);
  const centers = url.searchParams.get('centers')
    ? url.searchParams.get('centers').split(',').map(s => s.trim()).filter(Boolean)
    : [];

  try {
    const tz    = 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-GB', {
      day:'2-digit', month:'short', year:'2-digit', timeZone: tz
    }).format(new Date()).replace(/ /g, '-'); // "07-May-25"

    function matchesCenter(val) {
      if (!centers.length) return true;
      return centers.map(c => c.toLowerCase()).includes(String(val||'').toLowerCase().trim());
    }

    // Run all reads in parallel
    const [attRows, poRows, workerRows, lotRows, pcRows] = await Promise.all([
      sheetsGet(env, env.SHEET_NAME_ATT_LOG  || 'Attendance Log').catch(() => []),
      sheetsGet(env, env.SHEET_NAME_PO        || 'PO Requisition').catch(() => []),
      sheetsGet(env, env.SHEET_NAME_WORKERS   || 'Workers').catch(() => []),
      sheetsGet(env, env.SHEET_NAME_LOT_INV   || 'Lot Inventory').catch(() => []),
      sheetsGet(env, env.SHEET_NAME_PROC_CENTER|| 'Processing Centers').catch(() => []),
    ]);

    // Attendance today
    let todayAttendance = 0;
    if (attRows.length > 1) {
      const h   = attRows[0].map(x => String(x).trim().toLowerCase());
      const dI  = h.indexOf('date');
      const pcI = h.indexOf('processing center');
      for (let i = 1; i < attRows.length; i++) {
        const dateVal = String(attRows[i][dI]||'').trim();
        if (dateVal === today && matchesCenter(attRows[i][pcI])) todayAttendance++;
      }
    }

    // PO counts
    let pendingPOs = 0, approvedToday = 0;
    if (poRows.length > 1) {
      const h   = poRows[0].map(x => String(x).trim().toLowerCase());
      const pcI = h.indexOf('processing center');
      const stI = h.indexOf('status');
      const tsI = h.indexOf('approval timestamp');
      for (let i = 1; i < poRows.length; i++) {
        if (!matchesCenter(poRows[i][pcI])) continue;
        const status = String(poRows[i][stI]||'').trim();
        if (status === 'Waiting for Approval') pendingPOs++;
        if (status === 'Approved') {
          const ts = String(poRows[i][tsI]||'').trim();
          if (ts.startsWith(today.substring(0,6))) approvedToday++; // "07-May" prefix match
        }
      }
    }

    // Workers
    let totalWorkers = 0;
    if (workerRows.length > 1) {
      const h   = workerRows[0].map(x => String(x).trim().toLowerCase());
      const pcI = h.indexOf('processing center');
      for (let i = 1; i < workerRows.length; i++) {
        if (workerRows[i][0] && matchesCenter(workerRows[i][pcI])) totalWorkers++;
      }
    }

    // Active lots
    let activeLots = 0;
    if (lotRows.length > 1) {
      const h   = lotRows[0].map(x => String(x).trim().toLowerCase());
      const stI = h.indexOf('status');
      const pcI = h.indexOf('processing center');
      for (let i = 1; i < lotRows.length; i++) {
        if (String(lotRows[i][stI]||'').trim().toLowerCase() === 'active'
            && matchesCenter(lotRows[i][pcI])) activeLots++;
      }
    }

    // All accessible PCs for filter pills
    const allPCs = [];
    if (pcRows.length > 1) {
      const h  = pcRows[0].map(x => String(x).trim().toLowerCase());
      const ni = Math.max(0, h.indexOf('name'));
      for (let i = 1; i < pcRows.length; i++) {
        const nm = String(pcRows[i][ni]||'').trim();
        if (nm) allPCs.push(nm);
      }
    }

    return jsonResponse({ todayAttendance, pendingPOs, approvedToday, totalWorkers, activeLots, allPCs, today });
  } catch (err) {
    return errorResponse('Dashboard error: ' + err.message);
  }
}
