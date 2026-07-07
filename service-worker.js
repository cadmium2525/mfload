// service-worker.js
// モンスターファーム ガッツロード - PWA用サービスワーカー
//
// キャッシュのバージョンを上げると、ユーザー環境の古いキャッシュが破棄され、
// 新しいファイル一式が再取得されます。js/images 等を更新した場合は
// 必ず CACHE_VERSION の値を変更してください（変更しないと更新が反映されません）。
const CACHE_VERSION = 'v5';
const CACHE_NAME = `guts-road-cache-${CACHE_VERSION}`;

// 同一オリジンの静的アセット（アプリ本体）。ここに列挙したファイルは
// インストール時に事前キャッシュされ、オフラインでも起動できるようになります。
const PRECACHE_URLS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/database.js',
  'js/game_adventure.js',
  'js/game_battle.js',
  'js/game_core.js',
  'js/game_ranking.js',
  'js/masmon.js',
  'js/masmon_battle.js',
  'js/masmon_rating.js',
  'js/masmon_realtime.js',
  'js/masmon_realtime_battle.js',
  'js/masmon_team.js',
  'js/masmon_transfer.js',
  'images/Rプラント.png',
  'images/アローヘッド.png',
  'images/キュービ.png',
  'images/ゴビ.png',
  'images/スエゾー.png',
  'images/ディノ.png',
  'images/デュラハン.png',
  'images/ネンドロ.png',
  'images/ハム.png',
  'images/プラント.png',
  'images/ヘンガー.png',
  'images/モスト.png',
  'images/モッチー.png',
  'images/モノリス.png',
  'images/覚醒キュービ.png',
  'images/覚醒スエゾー.png',
  'images/覚醒ディノ.png',
  'images/覚醒プラント.png',
  'images/覚醒モッチー.png',
  'images/覚醒モノリス.png',
];

// --- インストール: アプリ本体を事前キャッシュ ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 1つでも取得失敗すると install 全体が失敗するため、
      // 個別に addAll を試みつつ失敗を握りつぶす（画像1枚の404等で全体を壊さない）
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Precache failed for', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// --- 有効化: 古いバージョンのキャッシュを削除 ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('guts-road-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --- フェッチ: 同一オリジンの静的アセットのみキャッシュ制御する ---
// Firebase (Realtime Database / SDK) や Tailwind CDN, FontAwesome CDN など
// 外部オリジンへのリクエストは一切横取りせず、そのままネットワークに流す。
// (Firebase Realtime Database は WebSocket/独自プロトコルを使うため fetch では
//  そもそも扱われないが、念のためクロスオリジンは完全にスルーする)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML(ナビゲーション)は「まずネットワーク、失敗したらキャッシュ」
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('index.html')))
    );
    return;
  }

  // それ以外の同一オリジン静的アセットは「まずキャッシュ、なければネットワーク」
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      });
    })
  );
});
