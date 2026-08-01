'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const notion = require('./notion');
const { createVerifier } = require('./auth');

const PORT = Number(process.env.PORT) || 3101;
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DATA_SOURCE_ID =
  process.env.NOTION_DATA_SOURCE_ID || 'e011508b-b1b2-47aa-a604-178bf64158b8';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const ALLOWED_GOOGLE_EMAILS = new Set(
  (process.env.ALLOWED_GOOGLE_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const authVerifier = createVerifier({ supabaseUrl: SUPABASE_URL, allowedEmails: ALLOWED_GOOGLE_EMAILS });

async function requireAuth(req) {
  const match = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error('認証が必要です');
    err.status = 401;
    throw err;
  }
  return authVerifier.verify(match[1]);
}

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('リクエストボディが大きすぎます'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSONの解析に失敗しました'));
      }
    });
    req.on('error', reject);
  });
}

function validateCategory(category) {
  return category === null || category === undefined || notion.CATEGORY_LABELS.includes(category);
}

function validatePriority(priority) {
  return priority === null || priority === undefined || notion.PRIORITY_LABELS.includes(priority);
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    });
  }

  try {
    await requireAuth(req);
  } catch (err) {
    return sendJson(res, err.status || 401, { error: err.message });
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);

  if (pathname === '/api/items' && req.method === 'GET') {
    const items = await notion.listItems(NOTION_TOKEN, NOTION_DATA_SOURCE_ID);
    return sendJson(res, 200, { items });
  }

  if (pathname === '/api/items' && req.method === 'POST') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendJson(res, 400, { error: 'name は必須です' });
    if (!validateCategory(body.category)) return sendJson(res, 400, { error: 'category が不正です' });
    if (!validatePriority(body.priority)) return sendJson(res, 400, { error: 'priority が不正です' });
    const item = await notion.createItem(NOTION_TOKEN, NOTION_DATA_SOURCE_ID, {
      name,
      category: body.category ?? null,
      memo: typeof body.memo === 'string' ? body.memo.trim() : '',
      priority: body.priority ?? null,
    });
    return sendJson(res, 201, { item });
  }

  if (itemMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    if (body.category !== undefined && !validateCategory(body.category)) {
      return sendJson(res, 400, { error: 'category が不正です' });
    }
    if (body.priority !== undefined && !validatePriority(body.priority)) {
      return sendJson(res, 400, { error: 'priority が不正です' });
    }
    if (body.name !== undefined) {
      body.name = String(body.name).trim();
      if (!body.name) return sendJson(res, 400, { error: 'name を空にはできません' });
    }
    if (body.memo !== undefined) body.memo = String(body.memo).trim();
    const item = await notion.updateItem(NOTION_TOKEN, itemMatch[1], body);
    return sendJson(res, 200, { item });
  }

  if (itemMatch && req.method === 'DELETE') {
    await notion.archiveItem(NOTION_TOKEN, itemMatch[1]);
    res.writeHead(204);
    return res.end();
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

function serveStatic(req, res, pathname) {
  let relPath = pathname === '/' ? '/index.html' : pathname;
  if (relPath === '/auth/callback') relPath = '/auth/callback.html';
  relPath = relPath.split('?')[0];
  const resolved = path.normalize(path.join(FRONTEND_DIR, relPath));

  if (!resolved.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/healthz') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`shopping-list server listening on port ${PORT}`);
});
