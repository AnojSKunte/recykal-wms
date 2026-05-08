// GET /api/formdata/attendance
import { sheetsGet, jsonResponse, errorResponse } from '../../_sheets.js';

export async function onRequestGet(context) {
  const { env } = context;
  const user    = context.data.user;
  const userPCs = user.processingCenters || [];

  try {
    const [pcRows, empRows, wRows, procRows] = await Promise.all([
      sheetsGet(env, 'Processing Centers'),
      sheetsGet(env, 'Employee Master'),
      sheetsGet(env, 'Workers'),
      sheetsGet(env, 'Processes').catch(() => []),
    ]);

    // Processing Centers filtered to user
    const processingCenters = [];
    if (pcRows.length > 1) {
      const h = pcRows[0].map(x => String(x).trim().toLowerCase());
      const ni = Math.max(0, h.indexOf('name'));
      for (let i = 1; i < pcRows.length; i++) {
        const nm = String(pcRows[i][ni]||'').trim();
        if (nm && (!userPCs.length || userPCs.includes(nm))) processingCenters.push(nm);
      }
    }

    // Employees filtered to user's PCs
    const eh = empRows[0]?.map(h => String(h).trim().toLowerCase()) || [];
    const employees = empRows.slice(1).filter(r => r[eh.indexOf('name')]).map(r => ({
      name:  String(r[eh.indexOf('name')]||'').trim(),
      email: String(r[eh.indexOf('official mail id')]||'').trim(),
      pc:    String(r[eh.indexOf('processing center')]||'').trim(),
    })).filter(e => !userPCs.length || userPCs.includes(e.pc));

    // Workers
    const wh = wRows[0]?.map(h => String(h).trim().toLowerCase()) || [];
    const wNameI = wh.indexOf('name');
    const wProvI = wh.indexOf('worker aprovider') >= 0 ? wh.indexOf('worker aprovider') : wh.indexOf('labour provider');
    const wPCI   = wh.indexOf('processing center');
    const workers = wRows.slice(1).filter(r => r[wNameI]).map(r => ({
      name:     String(r[wNameI]||'').trim(),
      provider: wProvI >= 0 ? String(r[wProvI]||'').trim() : '',
      pc:       wPCI   >= 0 ? String(r[wPCI]  ||'').trim() : '',
    }));

    const labourProviders = [...new Set(workers.map(w => w.provider).filter(Boolean))].sort();
    const processes       = procRows.slice(1).map(r => String(r[0]||'').trim()).filter(Boolean);

    return jsonResponse({ processingCenters, employees, workers, labourProviders, processes });
  } catch (err) {
    return errorResponse('Attendance form data error: ' + err.message);
  }
}
