'use strict';

// SWの更新検知はブラウザがこのファイル自体のバイト内容を比較して行われ、
// importScripts先（changelog.js）の変更だけでは新しいService Workerとして
// 認識されない。そのためリリースごとにこの値がバイト単位で変化するよう、
// scripts/version-changelog.mjs がバージョンアップ時に自動で書き換える。
const SW_VERSION = '0.9.6';

const CACHE_NAME = `shopping-list-${SW_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './auth.js',
  './changelog.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/auth/')) return;

  if (url.pathname.endsWith('/api/items')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.pathname.includes('/api/')) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await networkFetch) || Response.error();
}
