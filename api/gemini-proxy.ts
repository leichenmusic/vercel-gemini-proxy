// File: api/gemini-proxy.ts
// Patch: allow Origin 'null' (file://) and always return CORS headers.
// Usage: place under /api, deploy on Vercel. Configure env vars in Project Settings:
//   - GEMINI_API_KEY (required)
//   - ALLOWED_ORIGINS  (optional, comma-separated, e.g. "https://yourdomain.com,https://www.yourdomain.com")
//   - CLIENT_TOKEN     (optional; if set, frontend must send X-Client-Token header with same value)

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent';

function parseAllowed() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function setCors(res: VercelResponse, originHeader: string | undefined) {
  const origin = originHeader ?? '';
  const allowList = parseAllowed();
  // 允许条件：白名单命中，或没有白名单限制，或来自 file://（Origin === 'null'）
  const allowAny = !allowList.length || allowList.includes(origin) || origin === 'null';
  const allowOrigin = allowAny ? (origin || '*') : '';

  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin'); // 便于 CDN 正确缓存不同来源
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // 如需自定义更多请求头，加入到下面这行里：
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Token');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 总是先设置 CORS 头（包括预检与错误分支）
  setCors(res, req.headers.origin as string | undefined);

  if (req.method === 'OPTIONS') {
    // 预检直接返回 204
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing GEMINI_API_KEY' });
  }

  // 可选：简易鉴权，防滥用（设置了 CLIENT_TOKEN 才启用）
  const requiredToken = process.env.CLIENT_TOKEN || '';
  if (requiredToken) {
    const got = (req.headers['x-client-token'] as string) || '';
    if (got !== requiredToken) return res.status(401).json({ error: 'Unauthorized' });
  }

  // 解析 JSON Body
  let body: any;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse((req.body as any) || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // 移除不被允许的 response_mime_type，避免 400
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
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text(); // 原样透传，方便前端调试
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    // 再次确保 CORS 头存在于最终响应
    setCors(res, req.headers.origin as string | undefined);
    return res.send(text);
  } catch (err: any) {
    // 网络错误等，仍带上 CORS 头
    setCors(res, req.headers.origin as string | undefined);
    return res.status(502).json({ error: 'Upstream fetch failed', detail: String(err?.message || err) });
  }
}

// ------------------------------------------------------------
// File: vercel.json (minimal)
// 放在项目根目录，函数位于 /api/gemini-proxy.ts
// 如果你只有一个函数，也可以省略 routes；Vercel 默认会把 /api 目录映射为 API。
{
  "version": 2,
  "routes": [
    { "src": "/api/gemini-proxy", "dest": "/api/gemini-proxy.ts" }
  ]
}
