'use strict';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';

const PROP = {
  name: '項目',
  category: 'カテゴリ',
  memo: 'メモ',
  priority: '優先度',
  bought: '購入済み',
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
    throw new Error(`Notion API error (${res.status}): ${body}`);
  }
  return res.json();
}

function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? t.text?.content ?? '').join('');
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
  };
}

function buildProperties({ name, category, memo, priority, bought }) {
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

async function archiveItem(token, pageId) {
  if (!token) throw new Error('NOTION_TOKEN が設定されていません');
  await notionFetch(token, `/pages/${pageId}`, {
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
  archiveItem,
  getCategoryOptions,
  addCategoryOption,
  renameCategoryOption,
  reorderCategoryOptions,
};
