#!/usr/bin/env node
// npm version のlifecycleフックから実行される。
// package.jsonのversionに合わせて frontend/changelog.js に
// APP_VERSION の更新と新バージョンのエントリ挿入を行う。
//
// リリース自動化ワークフロー（release-develop-to-main.yml）は、developへ取り込まれた
// 差分から利用者向けの更新履歴を生成し、環境変数 RELEASE_CHANGELOG で渡してくる。
// 設定されていればその内容を changes へ反映する。未設定・空のとき（ローカルで
// `npm version` を叩いた場合など）は、従来どおり手で埋めるための枠だけを作る。
//
// 同じ経路で、利用者向けの使い方（どこを開く / 何を押す・実行する / どうなれば成功か）が
// 環境変数 RELEASE_USAGE で渡ってくる。RELEASE_CHANGELOG が「何が変わったか」なのに対し、
// RELEASE_USAGE は「どう使うか」で、読む場面が違うため changes へ混ぜず usage として
// 別項目に持たせる。画面で使える変化が無いリリースでは空文字で渡るため、その場合は
// usage の項目ごと出力しない（空の見出しだけが残ると書き漏らしに見えるため）。
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

// RELEASE_CHANGELOG / RELEASE_USAGE の文面を配列へ整形する。
// 生成される文面は箇条書き・段落のどちらもありうるため、行単位に分解し、
// 箇条書き記号と番号を落として1行1項目にそろえる。
// RELEASE_USAGE は `1. ` で始まる番号付きの複数行で渡るため、この分解によって
// 行の区切り（改行）を1項目=1手順として保つ（1行へ潰さない）。番号自体は画面側の
// 番号付きリストで振り直す。
function parseReleaseLines(raw) {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, '').trim())
    .filter((line) => line !== '');
}

// changes / usage は生成された文面をそのまま埋め込むため、JavaScriptの文字列リテラルを
// 壊さないようにエスケープする。
function escapeForJs(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const today = new Date().toISOString().slice(0, 10);

let content = readFileSync(changelogPath, 'utf8');

content = content.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

const changes = parseReleaseLines(process.env.RELEASE_CHANGELOG);
const usage = parseReleaseLines(process.env.RELEASE_USAGE);
// リリースをやり直したときに同じバージョンが二重に並ばないようにする。
const alreadyListed = content.includes(`version: '${version}',`);

if (!alreadyListed) {
  const items = changes.length > 0 ? changes : [PLACEHOLDER];
  const usageBlock =
    usage.length > 0
      ? `    usage: [
${usage.map((item) => `      '${escapeForJs(item)}',`).join('\n')}
    ],
`
      : '';
  const entry = `  {
    version: '${version}',
    date: '${today}',
    changes: [
${items.map((item) => `      '${escapeForJs(item)}',`).join('\n')}
    ],
${usageBlock}  },
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
  const usageNote =
    usage.length > 0
      ? `RELEASE_USAGE から ${usage.length} 件の使い方も反映しました。`
      : 'RELEASE_USAGE は空のため使い方は追加していません。';
  console.log(
    `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。RELEASE_CHANGELOG から ${changes.length} 件の変更内容を反映しました。${usageNote}`
  );
} else {
  console.log(
    `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。changelog.js の changes の内容を編集してからコミットしてください。`
  );
}
