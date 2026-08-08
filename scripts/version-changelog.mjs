#!/usr/bin/env node
// npm version のlifecycleフックから実行される。
// package.jsonのversionに合わせて frontend/changelog.js に
// APP_VERSION の更新と新バージョンのスタブエントリ挿入を行う。
'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'frontend', 'changelog.js');
const swPath = path.join(rootDir, 'frontend', 'sw.js');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const today = new Date().toISOString().slice(0, 10);

let content = readFileSync(changelogPath, 'utf8');

content = content.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

const stubEntry = `  {
    version: '${version}',
    date: '${today}',
    changes: [
      'ここに変更内容を記載',
    ],
  },
`;

content = content.replace(/const APP_CHANGELOG = \[\n/, `const APP_CHANGELOG = [\n${stubEntry}`);

writeFileSync(changelogPath, content);

// sw.js自体のバイト内容がリリースごとに変化しないと、ブラウザのService Worker更新検知が
// 働かない（比較対象はimportScripts先ではなくsw.js自身のみのため）。SW_VERSIONもここで
// 合わせて更新する。
let swContent = readFileSync(swPath, 'utf8');
swContent = swContent.replace(/const SW_VERSION = '[^']*';/, `const SW_VERSION = '${version}';`);
writeFileSync(swPath, swContent);

console.log(
  `frontend/changelog.js と frontend/sw.js を v${version} 用に更新しました。changelog.js の changes の内容を編集してからコミットしてください。`
);
