/*
 * 오프라인 저장(서비스 워커)
 *
 * - 처음 열 때 아래 ASSETS를 휴대폰에 저장해 두고, 이후에는 저장본을 바로 보여줍니다.
 * - 인터넷이 될 때 앱을 열면 뒤에서 새 파일을 확인하고, 바뀐 것이 있으면 저장본을 바꾼 뒤 화면을 새로고침합니다.
 *   그래서 data.js만 고쳐도 가족 휴대폰에 반영됩니다.
 * - 화면 구성이 크게 바뀌었거나 반영이 안 될 때는 VERSION 숫자를 1 올리면 저장본 전체를 새로 받습니다.
 */
var VERSION = 2;
var CACHE = "qingdao-v" + VERSION;
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];
// 다시 확인할 글자 파일들 (내용이 바뀌었는지 비교)
var TEXT_ASSETS = ["./index.html", "./styles.css", "./data.js", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf("qingdao-") === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 바뀐 파일이 있는지 확인하고, 있으면 저장본을 바꾼 뒤 화면에 알립니다.
var lastCheck = 0;
function refreshAll() {
  if (Date.now() - lastCheck < 10 * 1000) return Promise.resolve();
  lastCheck = Date.now();
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(TEXT_ASSETS.map(function (url) {
      return fetch(url, { cache: "no-cache" }).then(function (fresh) {
        if (!fresh.ok) return false;
        return Promise.all([fresh.clone().text(), cache.match(url).then(function (r) { return r ? r.text() : null; })])
          .then(function (texts) {
            if (texts[0] === texts[1]) return false;
            var puts = [];
            if (url === "./index.html") puts.push(cache.put("./", fresh.clone()));
            puts.push(cache.put(url, fresh));
            return Promise.all(puts).then(function () { return true; });
          });
      }).catch(function () { return false; });
    }));
  }).then(function (changed) {
    if (changed.indexOf(true) === -1) return;
    return self.clients.matchAll({ type: "window" }).then(function (clients) {
      clients.forEach(function (c) { c.postMessage({ type: "content-updated" }); });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 화면 열기: 주소 뒤 ?now= 등과 관계없이 저장된 index.html
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then(function (hit) {
        return hit || fetch(req);
      }).catch(function () { return fetch(req); })
    );
    event.waitUntil(refreshAll());
    return;
  }

  // 그 밖의 파일: 저장본 먼저, 없으면 받아서 저장
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});

// data.js에 적힌 사진을 미리 저장
self.addEventListener("message", function (event) {
  var d = event.data;
  if (!d || d.type !== "cache-images" || !Array.isArray(d.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(d.urls.map(function (u) {
        return cache.match(u).then(function (hit) {
          if (hit) return;
          return fetch(u).then(function (res) { if (res.ok) return cache.put(u, res); }).catch(function () {});
        });
      }));
    })
  );
});
