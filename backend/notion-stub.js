'use strict';

const crypto = require('node:crypto');

const PRIORITY_LABELS = ['高', '中', '低'];

// CI画面確認用の固定ダミーデータ。メモリ上のみで保持するため、プロセス再起動でリセットされる。
let categoryOptions = ['食品', '消耗品', '日用品', '趣味', 'その他'].map((name) => ({
  id: crypto.randomUUID(),
  name,
  color: 'default',
}));

// 期限（due）とタスク連携（taskId）はNotionのTask DBを相手にする機能のため、
// スタブでも同じ形のデータを返せるようメモリ上に簡易のタスク一覧を持つ（#145）。
function today(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function stamp() {
  return new Date().toISOString();
}

let items = [
  { id: crypto.randomUUID(), name: '牛乳', category: '食品', memo: '', priority: '高', bought: false, due: today(0), taskId: null, updatedAt: stamp() },
  { id: crypto.randomUUID(), name: 'キッチンペーパー', category: '消耗品', memo: '', priority: '中', bought: false, due: null, taskId: null, updatedAt: stamp() },
  { id: crypto.randomUUID(), name: 'シャンプー', category: '日用品', memo: '詰め替え用', priority: '低', bought: false, due: today(3), taskId: null, updatedAt: stamp() },
  { id: crypto.randomUUID(), name: '雑誌', category: '趣味', memo: '', priority: '低', bought: true, due: null, taskId: null, updatedAt: stamp() },
  { id: crypto.randomUUID(), name: '卵', category: '食品', memo: '', priority: '中', bought: false, due: today(-1), taskId: null, updatedAt: stamp() },
];

let tasks = [];

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
    due: input.due ?? null,
    taskId: null,
    updatedAt: stamp(),
  };
  items.push(item);
  return { ...item };
}

async function updateItem(_token, pageId, input) {
  const index = items.findIndex((item) => item.id === pageId);
  if (index === -1) throw new Error('項目が見つかりません');
  items[index] = { ...items[index], ...input, updatedAt: stamp() };
  return { ...items[index] };
}

async function getItem(_token, pageId) {
  const item = items.find((it) => it.id === pageId);
  if (!item) throw new Error('項目が見つかりません');
  return { ...item };
}

async function archiveItem(_token, pageId) {
  items = items.filter((item) => item.id !== pageId);
}

async function listLinkedTasks(_token, _taskDataSourceId) {
  return tasks.filter((task) => task.itemId).map((task) => ({ ...task }));
}

async function getTask(_token, taskPageId) {
  const task = tasks.find((t) => t.id === taskPageId);
  return task ? { ...task } : null;
}

async function createTask(_token, _taskDataSourceId, input) {
  const task = {
    id: crypto.randomUUID(),
    title: input.title ?? '',
    due: input.due ?? null,
    done: input.done ?? false,
    itemId: input.itemId ?? null,
    updatedAt: stamp(),
  };
  tasks.push(task);
  return { ...task };
}

async function updateTask(_token, taskPageId, input) {
  const index = tasks.findIndex((task) => task.id === taskPageId);
  if (index === -1) throw new Error('タスクが見つかりません');
  tasks[index] = { ...tasks[index], ...input, updatedAt: stamp() };
  return { ...tasks[index] };
}

async function archiveTask(_token, taskPageId) {
  tasks = tasks.filter((task) => task.id !== taskPageId);
}

async function getCategoryOptions(_token, _dataSourceId) {
  return categoryOptions.map((c) => ({ ...c }));
}

async function addCategoryOption(_token, _dataSourceId, name) {
  if (categoryOptions.some((c) => c.name === name)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }
  categoryOptions = [...categoryOptions, { id: crypto.randomUUID(), name, color: 'default' }];
  return categoryOptions.map((c) => ({ ...c }));
}

async function renameCategoryOption(_token, _dataSourceId, optionId, name) {
  const target = categoryOptions.find((c) => c.id === optionId);
  if (!target) throw new Error('カテゴリが見つかりません');
  if (categoryOptions.some((c) => c.id !== optionId && c.name === name)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }
  const oldName = target.name;
  categoryOptions = categoryOptions.map((c) => (c.id === optionId ? { ...c, name } : c));
  // Notionのselectはid参照のため、既存アイテムのカテゴリ名もリネームに追従させる
  items = items.map((item) => (item.category === oldName ? { ...item, category: name } : item));
  return categoryOptions.map((c) => ({ ...c }));
}

async function reorderCategoryOptions(_token, _dataSourceId, orderedIds) {
  const currentIds = new Set(categoryOptions.map((c) => c.id));
  const orderedIdsSet = new Set(orderedIds);
  if (
    orderedIds.length !== categoryOptions.length ||
    orderedIds.some((id) => !currentIds.has(id)) ||
    categoryOptions.some((c) => !orderedIdsSet.has(c.id))
  ) {
    throw new Error('カテゴリの並び替え内容が現在の状態と一致しません');
  }
  categoryOptions = orderedIds.map((id) => categoryOptions.find((c) => c.id === id));
  return categoryOptions.map((c) => ({ ...c }));
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
