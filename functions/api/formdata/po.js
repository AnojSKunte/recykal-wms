// GET /api/formdata/po
import { sheetsGet, jsonResponse, errorResponse } from '.././_sheets.js';

export async function onRequestGet(context) {
  const { env } = context;
  const user    = context.data.user;

  try {
    const [pcRows, suppRows, matRows, uomRows, appRows, empRows] = await Promise.all([
      sheetsGet(env, 'Processing Centers'),
      sheetsGet(env, 'Supplier Master Data'),
      sheetsGet(env, 'Material Master'),
      sheetsGet(env, 'UOM'),
      sheetsGet(env, 'Approving Authority'),
      sheetsGet(env, 'Employee Master'),
    ]);

    // Processing Centers (filtered to user's access)
    const userPCs = user.processingCenters || [];
    const processingCenters = [];
    if (pcRows.length > 1) {
      const h  = pcRows[0].map(x => String(x).trim().toLowerCase());
      const ni = Math.max(0, h.indexOf('name'));
      for (let i = 1; i < pcRows.length; i++) {
        const nm = String(pcRows[i][ni]||'').trim();
        if (nm && (!userPCs.length || userPCs.includes(nm))) processingCenters.push(nm);
      }
    }

    // Suppliers
    const sh       = suppRows[0]?.map(h => String(h).trim()) || [];
    const idx      = c => sh.indexOf(c);
    const suppMap  = {}, cats = new Set();
    const BAD      = new Set(['0','false','true','']);

    for (let i = 1; i < suppRows.length; i++) {
      const r = suppRows[i];
      const name = String(r[idx('business_name')]||'').trim();
      const cat  = String(r[idx('business_category')]||'').trim();
      if (!name || !cat) continue;
      cats.add(cat);
      if (!suppMap[cat]) suppMap[cat] = {};
      if (!suppMap[cat][name]) suppMap[cat][name] = { gstins:[], addresses:[] };
      const g = String(r[idx('gstin')]||'').trim();
      if (g && !suppMap[cat][name].gstins.includes(g)) suppMap[cat][name].gstins.push(g);
      const parts = ['pad_name','flat_building','street_address','city','state']
        .map(k => idx(k) >= 0 ? String(r[idx(k)]||'').trim() : '')
        .filter(p => p && !BAD.has(p.toLowerCase()));
      const zip  = idx('zip_code') >= 0 ? String(r[idx('zip_code')]||'').replace(/\.0+$/,'').trim() : '';
      const addr = [...new Set(parts)].join(', ') + (zip && zip !== '0' ? ' - ' + zip : '');
      if (addr.length > 5 && !suppMap[cat][name].addresses.includes(addr))
        suppMap[cat][name].addresses.push(addr);
    }
    const suppliers = {};
    for (const cat in suppMap) {
      suppliers[cat] = Object.entries(suppMap[cat])
        .map(([name, d]) => ({ name, gstins: d.gstins, addresses: d.addresses }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Materials
    const mh      = matRows[0]?.map(h => String(h).trim()) || [];
    const mNI     = mh.indexOf('Name'), mCI = mh.indexOf('Category ID'), mHI = mh.indexOf('Hsn');
    const mCgI    = mh.findIndex(h => h.toLowerCase().includes('cgst'));
    const mSgI    = mh.findIndex(h => h.toLowerCase().includes('sgst'));
    const materials = {}, hsnLookup = {};
    for (let i = 1; i < matRows.length; i++) {
      const r = matRows[i], name = String(r[mNI]||'').trim(), catId = String(r[mCI]||'').trim();
      if (!name) continue;
      const hsn    = cleanHsn(r[mHI]);
      const gstPct = (mCgI >= 0 ? parseFloat(r[mCgI])||0 : 0) + (mSgI >= 0 ? parseFloat(r[mSgI])||0 : 0);
      if (!materials[catId]) materials[catId] = [];
      if (!materials[catId].find(x => x.name === name)) materials[catId].push({ name, hsn, gstPct });
      if (!hsnLookup[name]) hsnLookup[name] = { hsn, gstPct };
    }

    // UOM
    const uoms = uomRows.slice(1).filter(r => r[0])
      .map(r => ({ label: String(r[0]).trim(), abbr: String(r[1]||r[0]).trim() }));

    // Approvers
    const approvers = appRows.slice(1).filter(r => r[1] && r[2])
      .map(r => ({ category: String(r[0]||''), name: String(r[1]), email: String(r[2]) }));

    // Employees
    const employees = empRows.slice(1).filter(r => r[0] && r[1])
      .map(r => ({ email: String(r[0]), name: String(r[1]) }));

    return jsonResponse({
      categories: [...cats].sort(), suppliers, materials, hsnLookup,
      uoms, approvers, employees, processingCenters,
      categoryMaterialMap: {
        'Plastic': ['PET001','PP0001','HDPE01','LDPE01'],
        'Paper':   ['Carton box001','White Waste Paper001','Old News paper (ONP)001',
                    'Mixed Paper001','Tetra Pak001','Premium Mixed Paper001'],
        'E-Waste': ['Electronic & Elecrical Equipments (EEE)001'],
        'Metal':   ['Mild Steel Scrap001','Stainless Steel Scrap001'],
      },
    });
  } catch (err) {
    return errorResponse('PO form data error: ' + err.message);
  }
}

function cleanHsn(val) {
  if (!val && val !== 0) return '';
  const s = String(val).trim();
  const n = parseFloat(s);
  if (!isNaN(n) && n > 0) return String(Math.round(n));
  return s;
}
