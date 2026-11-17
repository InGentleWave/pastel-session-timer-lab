/* 세션 스톱워치 서비스 워커
 * 네트워크 우선: 온라인이면 항상 최신 파일을 받고, 실패하거나 3초 안에 응답이 없으면 캐시 사용.
 * 재배포 시 CACHE 값의 버전을 올리면 이전 캐시가 삭제됩니다. */
var CACHE = 'session-stopwatch-v2.0.0';
var PREFIX = 'session-stopwatch-';
var ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
var TIMEOUT_MS = 3000;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 파일 하나가 없어도 설치가 실패하지 않도록 개별 저장 */
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

/* 리디렉션을 거친 응답은 페이지 이동 응답으로 쓸 수 없으므로 새 응답으로 복사 */
function clean(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

function fromCache(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (res) {
      if (res || req.mode !== 'navigate') return res;
      return cache.match('./index.html');
    });
  }).then(clean);
}

function networkFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    function finish(res) {
      if (settled || !res) return;
      settled = true;
      resolve(res);
    }
    var timer = setTimeout(function () { fromCache(req).then(finish); }, TIMEOUT_MS);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { return cache.put(req, copy); }).catch(function () {});
      }
      finish(res);
    }).catch(function () {
      clearTimeout(timer);
      fromCache(req).then(function (res) {
        if (settled) return;
        settled = true;
        resolve(res || Response.error());
      });
    });
  });
}
