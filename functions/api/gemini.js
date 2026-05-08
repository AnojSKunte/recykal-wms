// POST /api/gemini
// Body: { prompt, context, mode }
// mode: 'query' | 'suggest' | 'summarise'
import { sheetsGet, jsonResponse, errorResponse } from './_sheets.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { prompt, mode, sheetContext } = await request.json();

    // Optionally fetch sheet context for grounded responses
    let dataContext = '';
    if (sheetContext === 'lots') {
      const rows = await sheetsGet(env, env.SHEET_NAME_LOT_INV || 'Lot Inventory');
      if (rows.length > 1) {
        // Send only headers + last 50 rows to keep token count low
        const sample = [rows[0], ...rows.slice(-50)];
        dataContext = '\n\nLot Inventory data (latest 50 rows):\n' +
          sample.map(r => r.join('\t')).join('\n');
      }
    }
    if (sheetContext === 'processing') {
      const rows = await sheetsGet(env, env.SHEET_NAME_PROC_LOG || 'Processing Log');
      if (rows.length > 1) {
        const sample = [rows[0], ...rows.slice(-30)];
        dataContext = '\n\nProcessing Log (latest 30 rows):\n' +
          sample.map(r => r.join('\t')).join('\n');
      }
    }

    // System instructions per mode
    const systemPrompts = {
      query: 'You are a warehouse management assistant for Recykal WMS. Answer questions about inventory, lots, and processing based on the data provided. Be concise and factual.',
      suggest: 'You are helping fill a processing form for a recycling warehouse. Based on the input material and job work, suggest likely output materials. Respond in JSON: {"suggestions": [{"material": "...", "hsn": "...", "estimatedPct": 80}]}',
      summarise: 'Summarise the warehouse activity in 3-4 bullet points. Be concise. Use numbers where available.',
    };

    const systemPrompt = systemPrompts[mode] || systemPrompts.query;
    const fullPrompt   = prompt + dataContext;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!res.ok) throw new Error('Gemini API error: ' + await res.text());
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse JSON if mode is suggest
    if (mode === 'suggest') {
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        return jsonResponse({ result: JSON.parse(clean), raw: text });
      } catch (_) {
        return jsonResponse({ result: null, raw: text });
      }
    }

    return jsonResponse({ result: text });
  } catch (err) {
    return errorResponse('Gemini error: ' + err.message);
  }
}
