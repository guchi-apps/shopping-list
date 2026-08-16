'use strict';

// 買い物リストの「期限」とNotionの「☑️ Task」データベースを同期する（#145）。
//
// 対応関係
//   買い物リストの項目 --(relation「タスク」)--> Taskのページ
//   逆方向はNotionが自動生成する「買い物リスト」relationで辿れる。
//
// 同期の方向
//   - 期限を入れた項目には「<項目名>を買う」タスクを作り、relationで結び付ける
//   - 項目名・期限・購入済みの変更はタスクへ反映する（買い物リスト → タスク）
//   - タスク側で変えた期限・完了は、一覧取得時に買い物リストへ戻す（タスク → 買い物リスト）
//   - 期限を消す・項目を削除する操作ではタスクもゴミ箱へ入れる
//
// 突き合わせのタイミングは一覧取得（GET /api/items）だけで、常駐の監視は持たない。
// このアプリはNotionを唯一の情報源とし、状態を保持するDBを持たないため、
// 「アプリを開いたときに双方の最新を突き合わせる」以上のことはできない。
//
// 競合時（両方で違う値になっている場合）はページのlast_edited_timeが新しい側を採用する。
// メモの編集などでも更新時刻は動くため厳密な因果関係ではないが、単一利用者のアプリでは
// 「最後に触ったほうが正しい」で実用上足りる。

/** タスク側のタイトル。買い物リストの項目名から機械的に決める。 */
function taskTitleFor(name) {
  return `${name}を買う`;
}

function toDay(value) {
  return value ? String(value).slice(0, 10) : null;
}

/**
 * Task DBを扱えない状態（Integrationが未接続、プロパティ名の変更など）でも、
 * 買い物リスト自体の操作は成功させる。呼び出し側へは警告文字列だけを返す。
 */
function warn(err) {
  console.error('[task-sync]', err);
  return 'Notionのタスクとの同期に失敗しました（Task DBがIntegrationに共有されているか確認してください）';
}

/** 項目に対応するタスクを新規作成し、双方をrelationで結び付ける。 */
async function createTaskForItem({ notion, token, taskDataSourceId }, item) {
  const task = await notion.createTask(token, taskDataSourceId, {
    title: taskTitleFor(item.name),
    due: item.due,
    done: item.bought,
    memo: item.memo || '',
    priority: item.priority,
    itemId: item.id,
  });
  // relationは片側を書けばNotionが逆側も張るが、買い物リスト側を正として明示的に書く。
  const updated = await notion.updateItem(token, item.id, { taskId: task.id });
  return { item: updated, task };
}

/** 項目の追加直後に呼ぶ。期限が入っている場合だけタスクを作る。 */
async function afterCreateItem(deps, item) {
  if (!item.due) return { item, warning: null };
  try {
    const { item: linked } = await createTaskForItem(deps, item);
    return { item: linked, warning: null };
  } catch (err) {
    return { item, warning: warn(err) };
  }
}

/**
 * 項目の更新直後に呼ぶ。
 * 期限が付いた／外れた／変わった、項目名・購入済みが変わった、のいずれもここで反映する。
 * itemは更新後の状態で、relation（taskId）は今回の更新では変化していない。
 */
async function afterUpdateItem(deps, item) {
  const { notion, token } = deps;
  try {
    if (!item.taskId) {
      if (!item.due) return { item, warning: null };
      const { item: linked } = await createTaskForItem(deps, item);
      return { item: linked, warning: null };
    }

    if (!item.due) {
      // 期限を消した＝タスクとして扱うのをやめた、とみなす
      await notion.archiveTask(token, item.taskId);
      const updated = await notion.updateItem(token, item.id, { taskId: null });
      return { item: updated, warning: null };
    }

    // 期限に時刻を入れているタスクを日付だけで上書きしないよう、現状と突き合わせて差分だけ送る
    const task = await notion.getTask(token, item.taskId);
    if (!task) {
      // タスク側が消えていたので作り直す
      const { item: linked } = await createTaskForItem(deps, item);
      return { item: linked, warning: null };
    }

    const patch = {};
    const title = taskTitleFor(item.name);
    if (task.title !== title) patch.title = title;
    if (task.due !== item.due) patch.due = item.due;
    if (task.done !== item.bought) patch.done = item.bought;
    if (Object.keys(patch).length > 0) await notion.updateTask(token, item.taskId, patch);
    return { item, warning: null };
  } catch (err) {
    return { item, warning: warn(err) };
  }
}

/** 項目の削除前に呼ぶ。結び付いているタスクもゴミ箱へ入れる。 */
async function beforeDeleteItem({ notion, token }, item) {
  if (!item?.taskId) return { warning: null };
  try {
    await notion.archiveTask(token, item.taskId);
    return { warning: null };
  } catch (err) {
    return { warning: warn(err) };
  }
}

/**
 * 一覧取得時の突き合わせ。返り値は同期後の項目一覧。
 *
 * ここでは削除を行わない（タスクのゴミ箱送りは利用者の明示操作でのみ起きる）。
 * 例外は「結び付いていたタスクが消えていた」場合で、このときだけ買い物リスト側の
 * 期限とrelationを外す。そうしないと次回の突き合わせで消したはずのタスクが復活する。
 */
async function reconcileItems(deps, items) {
  const { notion, token, taskDataSourceId } = deps;
  const needsSync = items.some((item) => item.due || item.taskId);
  if (!needsSync) return { items, warning: null };

  let tasks;
  try {
    tasks = await notion.listLinkedTasks(token, taskDataSourceId);
  } catch (err) {
    // Task DBを読めないときは何もしない。消えたと誤認して期限を消さないための保険。
    return { items, warning: warn(err) };
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const synced = [];
  let warning = null;

  for (const item of items) {
    try {
      synced.push(await reconcileItem(deps, item, taskById.get(item.taskId)));
    } catch (err) {
      warning = warning || warn(err);
      synced.push(item);
    }
  }
  return { items: synced, warning };
}

async function reconcileItem(deps, item, task) {
  const { notion, token } = deps;

  if (!item.taskId) {
    // Notion側で直接期限を入れた項目もここでタスク化される
    if (!item.due) return item;
    const { item: linked } = await createTaskForItem(deps, item);
    return linked;
  }

  if (!task) {
    return notion.updateItem(token, item.id, { due: null, taskId: null });
  }

  const dueDiffers = toDay(item.due) !== toDay(task.due);
  const doneDiffers = item.bought !== task.done;
  if (!dueDiffers && !doneDiffers) return item;

  const taskIsNewer = (task.updatedAt ?? '') > (item.updatedAt ?? '');
  if (taskIsNewer) {
    const patch = {};
    if (dueDiffers) patch.due = task.due;
    if (doneDiffers) patch.bought = task.done;
    return notion.updateItem(token, item.id, patch);
  }

  const patch = {};
  if (dueDiffers) patch.due = item.due;
  if (doneDiffers) patch.done = item.bought;
  await notion.updateTask(token, task.id, patch);
  return item;
}

module.exports = {
  taskTitleFor,
  afterCreateItem,
  afterUpdateItem,
  beforeDeleteItem,
  reconcileItems,
};
