#!/usr/bin/env node
// npm version のlifecycleフックから実行される。
// package.jsonのversionに合わせて frontend/changelog.js に
// APP_VERSION の更新と新バージョンのエントリ挿入を行う。
//
// リリース自動化ワークフロー（release-develop-to-main.yml）は、developへ取り込まれた
// 差分から利用者向けの更新履歴を生成し、環境変数 RELEASE_CHANGELOG で渡してくる。
// 設定されていればその内容を changes へ反映する。未設定・空のとき（ローカルで
// `npm version` を叩いた場合など）は、従来どおり手で埋めるための枠だけを作る。
'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'frontend', 'changelog.js');
const swPath = path.join(rootDir, 'frontend', 'sw.js');

const PLACEHOLDER = 'ここに変更内容を記載';

// RELEASE_CHANGELOG の文面を changes 配列へ整形する。
// 生成される文面は箇条書き・段落のどちらもありうるため、行単位に分解し、
// 箇条書き記号と番号を落として1行1項目にそろえる。
function parseReleaseChangelog(raw) {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, '').trim())
    .filter((line) => line !== '');
}

// changes は生成された文面をそのまま埋め込むため、JavaScriptの文字列リテラルを
// 壊さないようにエスケープする。
function escapeForJs(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const today = new Date().toISOString().slice(0, 10);

let content = readFileSync(changelogPath, 'utf8');

content = content.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

const changes = parseReleaseChangelog(process.env.RELEASE_CHANGELOG);
// リリースをやり直したときに同じバージョンが二重に並ばないようにする。
const alreadyListed = content.includes(`version: '${version}',`);

if (!alreadyListed) {
  const items = changes.length > 0 ? changes : [PLACEHOLDER];
  const entry = `  {
    version: '${version}',
    date: '${today}',
    changes: [
${items.map((item) => `      '${escapeForJs(item)}',`).join('\n')}
    ],
  },
`;
  content = content.replace(/const APP_CHANGELOG = \[\n/, `const APP_CHANGELOG = [\n${entry}`);
}

writeFileSync(changelogPath, content);

// sw.js自体のバイト内容がリリースごとに変化しないと、ブラウザのService Worker更新検知が
// 働かない（比較対象はimportScripts先ではなくsw.js自身のみのため）。SW_VERSIONもここで
// 合わせて更新する。
let swContent = readFileSync(swPath, 'utf8');
swContent = swContent.replace(/const SW_VERSION = '[^']*';/, `const SW_VERSION = '${version}';`);
writeFileSync(swPath, swContent);

if (alreadyListed) {
  console.log(
    `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。changelog.js には既に v${version} のエントリがあるため追記していません。`
  );
} else if (changes.length > 0) {
  console.log(
    `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。RELEASE_CHANGELOG から ${changes.length} 件の変更内容を反映しました。`
  );
} else {
  console.log(
    `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。changelog.js の changes の内容を編集してからコミットしてください。`
  );
}
