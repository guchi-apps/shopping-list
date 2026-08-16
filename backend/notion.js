'use strict';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';

const PROP = {
  name: '項目',
  category: 'カテゴリ',
  memo: 'メモ',
  priority: '優先度',
  bought: '購入済み',
  due: '期限',
  task: 'タスク',
};

// Notionの「☑️ Task」データベース側のプロパティ名（#145）。
// 買い物リストとは別のデータベースのため、プロパティ名も別に持つ。
const TASK_PROP = {
  title: 'タイトル',
  due: '期限',
  done: '完了',
  memo: 'メモ',
  priority: '優先度',
  // 買い物リストの「タスク」relationに対して自動生成される逆方向のrelation。
  // 連携済みタスクだけを1回のクエリで引くために使う。
  shoppingItem: '買い物リスト',
};

const PRIORITY_LABELS = ['高', '中', '低'];

function assertConfig(token, dataSourceId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  if (!dataSourceId) throw new Error('NOTION_DATA_SOURCE_ID が設定されていません');
}

async function notionFetch(token, path, options = {}) {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Notion API error (${res.status}): ${body}`);
    err.notionStatus = res.status;
    throw err;
  }
  return res.json();
}

function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? t.text?.content ?? '').join('');
}

// Notionのdateプロパティは日付のみなら YYYY-MM-DD、時刻ありなら時刻部分を含む。
// 買い物リスト側は日付だけを扱うため、日付部分に切り詰めて比較・表示する。
function dateToDay(prop) {
  const start = prop?.date?.start;
  return start ? String(start).slice(0, 10) : null;
}

function pageToItem(page) {
  const props = page.properties;
  return {
    id: page.id,
    name: richTextToPlain(props[PROP.name]?.title) || '',
    category: props[PROP.category]?.select?.name ?? null,
    memo: richTextToPlain(props[PROP.memo]?.rich_text),
    priority: props[PROP.priority]?.select?.name ?? null,
    bought: props[PROP.bought]?.checkbox === true,
    due: dateToDay(props[PROP.due]),
    // 「タスク」relationはIntegrationがTask DBへ接続されていないとプロパティごと
    // 返らない。その場合はnullになり、タスク連携だけが無効化される（#145）。
    taskId: props[PROP.task]?.relation?.[0]?.id ?? null,
    updatedAt: page.last_edited_time ?? null,
  };
}

function buildProperties({ name, category, memo, priority, bought, due, taskId }) {
  const properties = {};
  if (name !== undefined) {
    properties[PROP.name] = { title: [{ type: 'text', text: { content: name } }] };
  }
  if (category !== undefined) {
    properties[PROP.category] = category ? { select: { name: category } } : { select: null };
  }
  if (memo !== undefined) {
    properties[PROP.memo] = {
      rich_text: memo ? [{ type: 'text', text: { content: memo } }] : [],
    };
  }
  if (priority !== undefined) {
    properties[PROP.priority] = priority ? { select: { name: priority } } : { select: null };
  }
  if (bought !== undefined) {
    properties[PROP.bought] = { checkbox: Boolean(bought) };
  }
  if (due !== undefined) {
    properties[PROP.due] = due ? { date: { start: due } } : { date: null };
  }
  if (taskId !== undefined) {
    properties[PROP.task] = { relation: taskId ? [{ id: taskId }] : [] };
  }
  return properties;
}

async function listItems(token, dataSourceId) {
  assertConfig(token, dataSourceId);
  const items = [];
  let cursor;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const data = await notionFetch(token, `/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const page of data.results) items.push(pageToItem(page));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

async function createItem(token, dataSourceId, input) {
  assertConfig(token, dataSourceId);
  const properties = buildProperties({
    name: input.name,
    category: input.category ?? null,
    memo: input.memo ?? '',
    priority: input.priority ?? null,
    bought: false,
    due: input.due ?? null,
  });
  const page = await notionFetch(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
    }),
  });
  return pageToItem(page);
}

async function updateItem(token, pageId, input) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  const properties = buildProperties(input);
  const page = await notionFetch(token, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
  return pageToItem(page);
}

async function getItem(token, pageId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  return pageToItem(await notionFetch(token, `/pages/${pageId}`));
}

async function archiveItem(token, pageId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  await notionFetch(token, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

// ---- Task DB（#145：買い物リストの期限をタスクへ連携する） ----

function pageToTask(page) {
  const props = page.properties ?? {};
  return {
    id: page.id,
    title: richTextToPlain(props[TASK_PROP.title]?.title) || '',
    due: dateToDay(props[TASK_PROP.due]),
    done: props[TASK_PROP.done]?.checkbox === true,
    updatedAt: page.last_edited_time ?? null,
    // 買い物リスト側の項目ID。1タスクに複数項目を結び付ける運用は想定しないため先頭のみ見る。
    itemId: props[TASK_PROP.shoppingItem]?.relation?.[0]?.id ?? null,
  };
}

function buildTaskProperties({ title, due, done, memo, priority, itemId }) {
  const properties = {};
  if (title !== undefined) {
    properties[TASK_PROP.title] = { title: [{ type: 'text', text: { content: title } }] };
  }
  if (due !== undefined) {
    properties[TASK_PROP.due] = due ? { date: { start: due } } : { date: null };
  }
  if (done !== undefined) {
    properties[TASK_PROP.done] = { checkbox: Boolean(done) };
  }
  if (memo !== undefined) {
    properties[TASK_PROP.memo] = {
      rich_text: memo ? [{ type: 'text', text: { content: memo } }] : [],
    };
  }
  if (priority !== undefined) {
    properties[TASK_PROP.priority] = priority ? { select: { name: priority } } : { select: null };
  }
  if (itemId !== undefined) {
    properties[TASK_PROP.shoppingItem] = { relation: itemId ? [{ id: itemId }] : [] };
  }
  return properties;
}

/**
 * 買い物リストと結び付いているタスクを一括で取得する。
 * ゴミ箱へ入れたページはクエリ結果に出ないため、「結果に無い＝タスクが消された」と判断できる。
 * このクエリが成功すること自体がTask DBへのアクセス可否の判定も兼ねる（#145）。
 */
async function listLinkedTasks(token, taskDataSourceId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  if (!taskDataSourceId) throw new Error('NOTION_TASK_DATA_SOURCE_ID が設定されていません');
  const tasks = [];
  let cursor;
  do {
    const data = await notionFetch(token, `/data_sources/${taskDataSourceId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 100,
        filter: { property: TASK_PROP.shoppingItem, relation: { is_not_empty: true } },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    for (const page of data.results) tasks.push(pageToTask(page));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return tasks;
}

/** タスク1件を取得する。ゴミ箱にある・見つからない場合はnullを返す。 */
async function getTask(token, taskPageId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  try {
    const page = await notionFetch(token, `/pages/${taskPageId}`);
    if (page.archived === true || page.in_trash === true) return null;
    return pageToTask(page);
  } catch (err) {
    if (err.notionStatus === 404) return null;
    throw err;
  }
}

async function createTask(token, taskDataSourceId, input) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  if (!taskDataSourceId) throw new Error('NOTION_TASK_DATA_SOURCE_ID が設定されていません');
  const page = await notionFetch(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: taskDataSourceId },
      properties: buildTaskProperties(input),
    }),
  });
  return pageToTask(page);
}

async function updateTask(token, taskPageId, input) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  const page = await notionFetch(token, `/pages/${taskPageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: buildTaskProperties(input) }),
  });
  return pageToTask(page);
}

async function archiveTask(token, taskPageId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  await notionFetch(token, `/pages/${taskPageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

function selectOptionsToCategories(options) {
  return (options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }));
}

async function getCategoryOptions(token, dataSourceId) {
  assertConfig(token, dataSourceId);
  const dataSource = await notionFetch(token, `/data_sources/${dataSourceId}`);
  return selectOptionsToCategories(dataSource.properties?.[PROP.category]?.select?.options);
}

async function updateCategorySelectOptions(token, dataSourceId, options) {
  const dataSource = await notionFetch(token, `/data_sources/${dataSourceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        [PROP.category]: { type: 'select', select: { options } },
      },
    }),
  });
  return selectOptionsToCategories(dataSource.properties?.[PROP.category]?.select?.options);
}

async function addCategoryOption(token, dataSourceId, name) {
  assertConfig(token, dataSourceId);
  const current = await getCategoryOptions(token, dataSourceId);
  if (current.some((c) => c.name === name)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }
  const nextOptions = [...current.map((c) => ({ id: c.id })), { name }];
  return updateCategorySelectOptions(token, dataSourceId, nextOptions);
}

async function renameCategoryOption(token, dataSourceId, optionId, name) {
  assertConfig(token, dataSourceId);
  const current = await getCategoryOptions(token, dataSourceId);
  if (!current.some((c) => c.id === optionId)) {
    throw new Error('カテゴリが見つかりません');
  }
  if (current.some((c) => c.id !== optionId && c.name === name)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }
  const nextOptions = current.map((c) => (c.id === optionId ? { id: c.id, name } : { id: c.id }));
  return updateCategorySelectOptions(token, dataSourceId, nextOptions);
}

async function reorderCategoryOptions(token, dataSourceId, orderedIds) {
  assertConfig(token, dataSourceId);
  const current = await getCategoryOptions(token, dataSourceId);
  const currentIds = new Set(current.map((c) => c.id));
  const orderedIdsSet = new Set(orderedIds);
  if (
    orderedIds.length !== current.length ||
    orderedIds.some((id) => !currentIds.has(id)) ||
    current.some((c) => !orderedIdsSet.has(c.id))
  ) {
    throw new Error('カテゴリの並び替え内容が現在の状態と一致しません');
  }
  const nextOptions = orderedIds.map((id) => ({ id }));
  return updateCategorySelectOptions(token, dataSourceId, nextOptions);
}

module.exports = {
  PRIORITY_LABELS,
  listItems,
  createItem,
  updateItem,
  getItem,
  archiveItem,
  listLinkedTasks,
  getTask,
  createTask,
  updateTask,
  archiveTask,
  getCategoryOptions,
  addCategoryOption,
  renameCategoryOption,
  reorderCategoryOptions,
};
