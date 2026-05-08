// ═══════════════════════════════════════════════════════════════════
//  Google OAuth flow
//  GET  /api/auth/google          → redirect to Google consent screen
//  GET  /api/auth/google/callback → handle code, set session, redirect to app
// ═══════════════════════════════════════════════════════════════════
import { createSession } from '../_middleware.js';
import { sheetsGet } from '../_sheets.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname;

  // ── Step 1: Initiate OAuth ──────────────────────────────────────
  if (path === '/api/auth/google') {
    const params = new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      redirect_uri:  getRedirectUri(url),
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'online',
      prompt:        'select_account',
    });
    return Response.redirect(
      'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 302
    );
  }

  // ── Step 2: Handle callback ─────────────────────────────────────
  if (path === '/api/auth/google/callback') {
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) {
      return Response.redirect('/?error=auth_failed', 302);
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  getRedirectUri(url),
        grant_type:    'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return Response.redirect('/?error=token_exchange_failed', 302);
    }

    const tokens = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    const googleUser = await userRes.json();

    // Look up user in Employee Master to get role + permissions
    let wmsUser = { email: googleUser.email, name: googleUser.name, role: '', processingCenters: [], permissions: {} };
    try {
      wmsUser = await lookupEmployee(googleUser.email, env);
    } catch (e) {
      console.error('Employee lookup failed:', e);
      // Allow login even if sheet lookup fails — permissions will be empty
    }

    // Create session cookie
    const sessionToken = await createSession(wmsUser, env.SESSION_SECRET);
    const cookie = `wms_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;

    return new Response(null, {
      status: 302,
      headers: { Location: '/', 'Set-Cookie': cookie }
    });
  }

  return new Response('Not found', { status: 404 });
}

// ── Logout ────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  if (url.pathname === '/api/auth/logout') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'wms_session=; Path=/; HttpOnly; Secure; Max-Age=0'
      }
    });
  }
  return new Response('Not found', { status: 404 });
}

// ── Helpers ───────────────────────────────────────────────────────
function getRedirectUri(url) {
  return url.origin + '/api/auth/google/callback';
}

async function lookupEmployee(email, env) {
  const data = await sheetsGet(env, env.SHEET_NAME_EMPLOYEE || 'Employee Master');
  if (!data || data.length < 2) throw new Error('No employee data');

  const headers  = data[0].map(h => String(h).trim());
  const headersL = headers.map(h => h.toLowerCase());
  const emailIdx = headersL.indexOf('official mail id');
  const nameIdx  = headersL.indexOf('name');
  const pcIdx    = headersL.indexOf('processing center');
  const roleIdx  = headersL.indexOf('role');
  const roleColPos  = roleIdx >= 0 ? roleIdx : 3;
  const permHeaders = headers.slice(roleColPos + 1).filter(h => h);

  const emailL = email.toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[emailIdx]||'').trim().toLowerCase() !== emailL) continue;

    const pcRaw = String(row[pcIdx]||'');
    const pcs   = pcRaw.split(',').map(s => s.trim()).filter(Boolean);

    const perms = {};
    permHeaders.forEach(col => {
      const ci = headers.indexOf(col);
      if (ci >= 0) perms[col] = String(row[ci]||'').trim().toUpperCase() === 'Y';
    });

    return {
      email:             emailL,
      name:              String(row[nameIdx]||'').trim(),
      role:              roleIdx >= 0 ? String(row[roleIdx]||'').trim() : '',
      processingCenters: pcs,
      permissions:       perms,
    };
  }

  // Not found in sheet — basic profile only
  return { email: emailL, name: email, role: '', processingCenters: [], permissions: {} };
}
