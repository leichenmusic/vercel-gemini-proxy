import type { VercelRequest, VercelResponse } from '@vercel/node';

const ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// 允许的跨域源，逗号分隔，留空=允许所有
function getAllowedOrigins(): string[] {
  const list = process.env.ALLOWED_ORIGINS || '';
  return list.split(',').map(s => s.trim()).filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  const allowList = getAllowedOrigins();
  const allowOrigin = (!allowList.length || allowList.includes(origin)) ? (origin || '*') : '';

  // CORS
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Token');
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')  return res.status(405).json({ error: 'Only POST allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: missing GEMINI_API_KEY' });

  // （可选）简易鉴权，防滥用
  const requiredToken = process.env.CLIENT_TOKEN || '';
  if (requiredToken) {
    const got = (req.headers['x-client-token'] as string) || '';
    if (got !== requiredToken) return res.status(401).json({ error: 'Unauthorized' });
  }

  // 解析 JSON
  let body: any;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // 移除不被允许的 response_mime_type（否则会 400）
  try {
    if (body?.generationConfig?.response_mime_type) {
      delete body.generationConfig.response_mime_type;
    }
  } catch {}

  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    });

    const text = await upstream.text(); // 原样透传
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res.send(text);
  } catch (err: any) {
    return res.status(502).json({ error: 'Upstream fetch failed', detail: String(err?.message || err) });
  }
}
