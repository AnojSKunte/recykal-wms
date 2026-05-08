// ═══════════════════════════════════════════════════════════════════
//  Google Sheets API helper
//  All sheet reads/writes go through these functions.
//  Auth uses a Service Account — key stored in GOOGLE_SERVICE_ACCOUNT_JSON secret
// ═══════════════════════════════════════════════════════════════════

// ── Get access token from service account ─────────────────────────
let _tokenCache = null;

async function getAccessToken(env) {
  // Return cached token if still valid (with 60s buffer)
  if (_tokenCache && _tokenCache.exp > Date.now() + 60000) {
    return _tokenCache.token;
  }

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  // Build JWT for service account
  const now    = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim  = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  };

  const enc  = (obj) => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = enc(header) + '.' + enc(claim);

  // Sign with RS256
  const keyData = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = unsigned + '.' + sigB64;

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!res.ok) throw new Error('Failed to get access token: ' + await res.text());
  const data = await res.json();

  _tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in * 1000) };
  return data.access_token;
}

// ── Read a full sheet ─────────────────────────────────────────────
export async function sheetsGet(env, sheetName, range) {
  const token   = await getAccessToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;
  const r       = range || sheetName + '!A:ZZ';
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(r)}`;
  const res     = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('sheetsGet failed: ' + await res.text());
  const data = await res.json();
  return data.values || [];
}

// ── Append a row ──────────────────────────────────────────────────
export async function sheetsAppend(env, sheetName, values) {
  const token   = await getAccessToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res     = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) throw new Error('sheetsAppend failed: ' + await res.text());
  return res.json();
}

// ── Update a specific cell or range ──────────────────────────────
export async function sheetsUpdate(env, range, values) {
  const token   = await getAccessToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res     = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  });
  if (!res.ok) throw new Error('sheetsUpdate failed: ' + await res.text());
  return res.json();
}

// ── Batch update multiple ranges ──────────────────────────────────
export async function sheetsBatchUpdate(env, data) {
  const token   = await getAccessToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res     = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
  if (!res.ok) throw new Error('sheetsBatchUpdate failed: ' + await res.text());
  return res.json();
}

// ── Get spreadsheet metadata (sheet names, IDs) ───────────────────
export async function sheetsMetadata(env) {
  const token   = await getAccessToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;
  const url     = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`;
  const res     = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('sheetsMetadata failed: ' + await res.text());
  return res.json();
}

// ── Ensure a sheet exists, create if not ─────────────────────────
export async function sheetsEnsure(env, sheetName, headers, headerColor) {
  const token    = await getAccessToken(env);
  const sheetId  = env.GOOGLE_SHEET_ID;
  const meta     = await sheetsMetadata(env);
  const exists   = meta.sheets.some(s => s.properties.title === sheetName);
  if (exists) return;

  // Add sheet
  const addRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  if (!addRes.ok) throw new Error('sheetsEnsure addSheet failed');

  // Write headers
  if (headers && headers.length) {
    await sheetsAppend(env, sheetName, headers);
  }
}

// ── Upload file to Drive ──────────────────────────────────────────
export async function driveUpload(env, base64Data, mimeType, fileName, folderId) {
  const token = await getAccessToken(env);

  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const bytes    = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  // Multipart upload
  const boundary = '----RecykalBoundary';
  const body = [
    '--' + boundary,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    '--' + boundary,
    'Content-Type: ' + mimeType,
    'Content-Transfer-Encoding: base64',
    '',
    base64Data,
    '--' + boundary + '--',
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body,
    }
  );

  if (!res.ok) throw new Error('driveUpload failed: ' + await res.text());
  const file = await res.json();

  // Make publicly viewable
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return file.webViewLink;
}

// ── JSON response helper ──────────────────────────────────────────
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}
