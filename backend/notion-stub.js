'use strict';

const crypto = require('node:crypto');

const CATEGORY_LABELS = ['食品', '消耗品', '日用品', '趣味', 'その他'];
const PRIORITY_LABELS = ['高', '中', '低'];

// CI画面確認用の固定ダミーデータ。メモリ上のみで保持するため、プロセス再起動でリセットされる。
let items = [
  { id: crypto.randomUUID(), name: '牛乳', category: '食品', memo: '', priority: '高', bought: false },
  { id: crypto.randomUUID(), name: 'キッチンペーパー', category: '消耗品', memo: '', priority: '中', bought: false },
  { id: crypto.randomUUID(), name: 'シャンプー', category: '日用品', memo: '詰め替え用', priority: '低', bought: false },
  { id: crypto.randomUUID(), name: '雑誌', category: '趣味', memo: '', priority: '低', bought: true },
  { id: crypto.randomUUID(), name: '卵', category: '食品', memo: '', priority: '中', bought: false },
];

async function listItems(_token, _dataSourceId) {
  return items.map((item) => ({ ...item }));
}

async function createItem(_token, _dataSourceId, input) {
  const item = {
    id: crypto.randomUUID(),
    name: input.name,
    category: input.category ?? null,
    memo: input.memo ?? '',
    priority: input.priority ?? null,
    bought: false,
  };
  items.push(item);
  return { ...item };
}

async function updateItem(_token, pageId, input) {
  const index = items.findIndex((item) => item.id === pageId);
  if (index === -1) throw new Error('項目が見つかりません');
  items[index] = { ...items[index], ...input };
  return { ...items[index] };
}

async function archiveItem(_token, pageId) {
  items = items.filter((item) => item.id !== pageId);
}

module.exports = {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  listItems,
  createItem,
  updateItem,
  archiveItem,
};
