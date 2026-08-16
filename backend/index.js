'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const notion = process.env.NOTION_STUB === '1' ? require('./notion-stub') : require('./notion');
const taskSync = require('./task-sync');
const { createVerifier } = require('./auth');

const PORT = Number(process.env.PORT) || 3101;
const CI_AUTH_BYPASS_TOKEN = process.env.CI_AUTH_BYPASS_TOKEN || '';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DATA_SOURCE_ID =
  process.env.NOTION_DATA_SOURCE_ID || 'e011508b-b1b2-47aa-a604-178bf64158b8';
// Notionの「☑️ Task」データソース。機密情報ではないため買い物リスト側と同じく既定値を持つ（#145）
const NOTION_TASK_DATA_SOURCE_ID =
  process.env.NOTION_TASK_DATA_SOURCE_ID || 'c8e9001c-d2a1-44c9-8ad7-cbe965fcc6d0';

const taskSyncDeps = {
  notion,
  token: NOTION_TOKEN,
  taskDataSourceId: NOTION_TASK_DATA_SOURCE_ID,
};

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const ALLOWED_GOOGLE_EMAILS = new Set(
  (process.env.ALLOWED_GOOGLE_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const authVerifier = createVerifier({
  supabaseUrl: SUPABASE_URL,
  allowedEmails: ALLOWED_GOOGLE_EMAILS,
  ciBypassToken: CI_AUTH_BYPASS_TOKEN,
});

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

async function validateCategory(category) {
  if (category === null || category === undefined) return true;
  const categories = await notion.getCategoryOptions(NOTION_TOKEN, NOTION_DATA_SOURCE_ID);
  return categories.some((c) => c.name === category);
}

function validatePriority(priority) {
  return priority === null || priority === undefined || notion.PRIORITY_LABELS.includes(priority);
}

// 期限は日付のみ（YYYY-MM-DD）。Notion側は時刻付きも扱えるが、買い物リストからは日付だけを送る。
function validateDue(due) {
  if (due === null || due === undefined || due === '') return true;
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  const date = new Date(`${due}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === due;
}

function normalizeDue(due) {
  return due === '' ? null : due;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      ...(CI_AUTH_BYPASS_TOKEN ? { ciAuthBypassToken: CI_AUTH_BYPASS_TOKEN } : {}),
    });
  }

  try {
    await requireAuth(req);
  } catch (err) {
    return sendJson(res, err.status || 401, { error: err.message });
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  const categoryMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);

  if (pathname === '/api/items' && req.method === 'GET') {
    const listed = await notion.listItems(NOTION_TOKEN, NOTION_DATA_SOURCE_ID);
    // 一覧を返すついでにNotionのタスクと突き合わせる（#145）。同期に失敗しても一覧は返す。
    const { items, warning } = await taskSync.reconcileItems(taskSyncDeps, listed);
    return sendJson(res, 200, { items, ...(warning ? { taskSyncWarning: warning } : {}) });
  }

  if (pathname === '/api/items' && req.method === 'POST') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendJson(res, 400, { error: 'name は必須です' });
    if (!(await validateCategory(body.category))) return sendJson(res, 400, { error: 'category が不正です' });
    if (!validatePriority(body.priority)) return sendJson(res, 400, { error: 'priority が不正です' });
    if (!validateDue(body.due)) return sendJson(res, 400, { error: 'due が不正です（YYYY-MM-DD形式）' });
    const created = await notion.createItem(NOTION_TOKEN, NOTION_DATA_SOURCE_ID, {
      name,
      category: body.category ?? null,
      memo: typeof body.memo === 'string' ? body.memo.trim() : '',
      priority: body.priority ?? null,
      due: normalizeDue(body.due ?? null),
    });
    const { item, warning } = await taskSync.afterCreateItem(taskSyncDeps, created);
    return sendJson(res, 201, { item, ...(warning ? { taskSyncWarning: warning } : {}) });
  }

  if (itemMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    if (body.category !== undefined && !(await validateCategory(body.category))) {
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
    if (body.due !== undefined) {
      if (!validateDue(body.due)) return sendJson(res, 400, { error: 'due が不正です（YYYY-MM-DD形式）' });
      body.due = normalizeDue(body.due);
    }
    // taskIdはNotionのrelationを指すサーバー側の管理項目のため、クライアントからは受け付けない
    delete body.taskId;
    const updated = await notion.updateItem(NOTION_TOKEN, itemMatch[1], body);
    const { item, warning } = await taskSync.afterUpdateItem(taskSyncDeps, updated);
    return sendJson(res, 200, { item, ...(warning ? { taskSyncWarning: warning } : {}) });
  }

  if (itemMatch && req.method === 'DELETE') {
    const item = await notion.getItem(NOTION_TOKEN, itemMatch[1]);
    const { warning } = await taskSync.beforeDeleteItem(taskSyncDeps, item);
    await notion.archiveItem(NOTION_TOKEN, itemMatch[1]);
    if (warning) return sendJson(res, 200, { taskSyncWarning: warning });
    res.writeHead(204);
    return res.end();
  }

  if (pathname === '/api/categories' && req.method === 'GET') {
    const categories = await notion.getCategoryOptions(NOTION_TOKEN, NOTION_DATA_SOURCE_ID);
    return sendJson(res, 200, { categories });
  }

  if (pathname === '/api/categories' && req.method === 'POST') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendJson(res, 400, { error: 'name は必須です' });
    const categories = await notion.addCategoryOption(NOTION_TOKEN, NOTION_DATA_SOURCE_ID, name);
    return sendJson(res, 201, { categories });
  }

  if (pathname === '/api/categories/order' && req.method === 'PATCH') {
    const body = await readBody(req);
    const order = body.order;
    if (!Array.isArray(order) || order.length === 0 || order.some((id) => typeof id !== 'string' || !id)) {
      return sendJson(res, 400, { error: 'order は空でない文字列の配列である必要があります' });
    }
    const categories = await notion.reorderCategoryOptions(NOTION_TOKEN, NOTION_DATA_SOURCE_ID, order);
    return sendJson(res, 200, { categories });
  }

  if (categoryMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendJson(res, 400, { error: 'name は必須です' });
    const categories = await notion.renameCategoryOption(
      NOTION_TOKEN,
      NOTION_DATA_SOURCE_ID,
      categoryMatch[1],
      name
    );
    return sendJson(res, 200, { categories });
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
