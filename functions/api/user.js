// GET /api/user — returns current user from session
export async function onRequestGet(context) {
  const { jsonResponse } = await import('../_sheets.js');
  return jsonResponse(context.data.user || null);
}
