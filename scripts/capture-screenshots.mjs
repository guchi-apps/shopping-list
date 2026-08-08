#!/usr/bin/env node
// Issue #9: 開発サーバーの画面をPlaywrightで撮影する。
//
// 前提: CI_AUTH_BYPASS_TOKEN・NOTION_STUB=1 を設定した状態で起動済みの開発サーバーに対して
// アクセスする（ログイン画面をスキップし、Notionスタブのダミーデータで本体画面を描画できる）。
// 撮影対象: 本体画面・#addOverlay・#editOverlay・#changelogOverlay の4画面 ×
// デスクトップ／モバイル2ビューポート = 計8枚。
//
// 使い方: CAPTURE_BASE_URL（省略時 http://localhost:${PORT || 3101}）・
// CAPTURE_OUTPUT_DIR（省略時 ./tmp/screenshots）を必要に応じて指定して実行する。
//   node scripts/capture-screenshots.mjs
// 生成したPNGファイルの絶対パスを1行1件、標準出力に出す。

'use strict';

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.CAPTURE_BASE_URL || `http://localhost:${process.env.PORT || 3101}`;
const OUTPUT_DIR = process.env.CAPTURE_OUTPUT_DIR || path.join(process.cwd(), 'tmp', 'screenshots');

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

async function captureViewport(browser, viewport, outputPaths) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();

  async function shoot(name) {
    const filePath = path.join(OUTPUT_DIR, `${viewport.name}-${name}.png`);
    await page.screenshot({ path: filePath });
    outputPaths.push(filePath);
  }

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#appRoot:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('.item-row', { timeout: 15000 });
  await shoot('app');

  await page.click('#fabAdd');
  await page.waitForSelector('#addOverlay:not([hidden])');
  await shoot('add');
  await page.click('#addClose');
  await page.waitForSelector('#addOverlay[hidden]');

  await page.click('.item-row .item-name');
  await page.waitForSelector('#editOverlay:not([hidden])');
  await shoot('edit');
  await page.click('#editClose');
  await page.waitForSelector('#editOverlay[hidden]');

  await page.click('#versionBadge');
  await page.waitForSelector('#changelogOverlay:not([hidden])');
  await shoot('changelog');

  await context.close();
}

async function main() {
  if (!process.env.CI_AUTH_BYPASS_TOKEN || process.env.NOTION_STUB !== '1') {
    console.error(
      '警告: CI_AUTH_BYPASS_TOKEN・NOTION_STUB=1 が未設定です。通常のGoogleログイン画面で止まる可能性があります。'
    );
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const outputPaths = [];
  try {
    for (const viewport of VIEWPORTS) {
      await captureViewport(browser, viewport, outputPaths);
    }
  } finally {
    await browser.close();
  }

  for (const filePath of outputPaths) console.log(filePath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
