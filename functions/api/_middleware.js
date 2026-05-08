// ═══════════════════════════════════════════════════════════════════
//  API Middleware — runs before every /api/* request
//  Verifies the session cookie and attaches user to request context
// ═══════════════════════════════════════════════════════════════════

export async function onRequest(context) {
  const { request, env, next } = context;

  // Skip auth check for the auth endpoints themselves
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  // Read session cookie
  const cookie = request.headers.get('Cookie') || '';
  const sessionToken = getCookie(cookie, 'wms_session');

  if (!sessionToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized', code: 401 }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Verify and decode session (simple HMAC check)
  try {
    const user = await verifySession(sessionToken, env.SESSION_SECRET);
    context.data.user = user;
    return next();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Session expired', code: 401 }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Session helpers ───────────────────────────────────────────────
export async function createSession(user, secret) {
  const payload = JSON.stringify({
    email: user.email,
    name:  user.name,
    exp:   Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  });
  const encoded  = btoa(payload);
  const sig      = await hmacSign(encoded, secret);
  return encoded + '.' + sig;
}

export async function verifySession(token, secret) {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) throw new Error('Invalid token format');
  const expectedSig = await hmacSign(encoded, secret);
  if (sig !== expectedSig) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(encoded));
  if (Date.now() > payload.exp) throw new Error('Token expired');
  return payload;
}

async function hmacSign(data, secret) {
  const enc     = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(data);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgData);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function getCookie(cookieStr, name) {
  const match = cookieStr.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}
