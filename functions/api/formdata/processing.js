// GET /api/formdata/processing
import { sheetsGet, jsonResponse, errorResponse } from '../../_sheets.js';

export async function onRequestGet(context) {
  const { env } = context;
  const user    = context.data.user;
  const userPCs = user.processingCenters || [];

  try {
    const [pcRows, procRows, matRows, uomRows] = await Promise.all([
      sheetsGet(env, 'Processing Centers'),
      sheetsGet(env, 'Processes').catch(() => []),
      sheetsGet(env, 'Material Master'),
      sheetsGet(env, 'UOM'),
    ]);

    // Processing Centers
    const processingCenters = [];
    if (pcRows.length > 1) {
      const h  = pcRows[0].map(x => String(x).trim().toLowerCase());
      const ni = Math.max(0, h.indexOf('name'));
      for (let i = 1; i < pcRows.length; i++) {
        const nm = String(pcRows[i][ni]||'').trim();
        if (nm && (!userPCs.length || userPCs.includes(nm))) processingCenters.push(nm);
      }
    }

    // Processes
    const processes = procRows.slice(1).map(r => String(r[0]||'').trim()).filter(Boolean);

    // Output materials (with HSN)
    const mh    = matRows[0]?.map(h => String(h).trim()) || [];
    const mNI   = mh.indexOf('Name'), mHI = mh.indexOf('Hsn');
    const seen  = new Set();
    const materials = matRows.slice(1)
      .filter(r => r[mNI])
      .map(r => ({ name: String(r[mNI]).trim(), hsn: cleanHsn(r[mHI]) }))
      .filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; })
      .sort((a, b) => a.name.localeCompare(b.name));

    // UOM
    const uoms = uomRows.slice(1).filter(r => r[0])
      .map(r => ({ label: String(r[0]).trim(), abbr: String(r[1]||r[0]).trim() }));

    return jsonResponse({
      processingCenters, processes, materials, uoms,
      userName:  user.name  || '',
      userEmail: user.email || '',
    });
  } catch (err) {
    return errorResponse('Processing form data error: ' + err.message);
  }
}

function cleanHsn(val) {
  if (!val && val !== 0) return '';
  const s = String(val).trim();
  const n = parseFloat(s);
  if (!isNaN(n) && n > 0) return String(Math.round(n));
  return s;
}
