/*
 * Fabula bez připojení.
 *
 * Při první návštěvě si zařízení uloží stránku i soubory aplikace. Při dalším otevření se nejdřív zkusí
 * síť (aby se hned ukázala nejnovější verze) a když není dostupná, použije se uložená kopie.
 * Příběhy tudy nejdou: ty jsou uložené v prohlížeči a server je nikdy nevidí.
 */
const CACHE = 'fabula-v2';
const SCOPE = self.registration.scope;
const SHELL = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const NETWORK_TIMEOUT = 4000;

/** Soubory aplikace, na které odkazuje úvodní stránka (mají v názvu otisk verze). */
const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href);

/** Uloží úvodní stránku, stáhne její soubory a smaže soubory starších verzí. */
async function storeIndex(response) {
  const cache = await caches.open(CACHE);
  const wanted = assetsOf(await response.clone().text());
  await Promise.all(wanted.map(async (url) => (await cache.match(url, { ignoreVary: true })) || cache.add(url)));
  // Stránku ukládáme až po souborech, aby uložená verze byla vždy úplná.
  await cache.put(SCOPE, response.clone());
  for (const request of await cache.keys()) {
    if (request.url.includes('/assets/') && !wanted.includes(request.url)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((path) => new URL(path, SCOPE).href));
      await storeIndex(await fetch(SCOPE, { cache: 'no-store' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Úvodní stránka: síť s časovým limitem, jinak uložená kopie. */
async function page(event) {
  const cached = () => caches.match(SCOPE, { ignoreVary: true, ignoreSearch: true });
  try {
    const response = await Promise.race([
      fetch(event.request, { cache: 'no-store' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
    if (!response.ok) return (await cached()) ?? response;
    event.waitUntil(storeIndex(response.clone()).catch(() => undefined));
    return response;
  } catch {
    return (await cached()) ?? Response.error();
  }
}

/** Ostatní soubory: uložená kopie, jinak síť (a výsledek si uložíme). */
async function file(request) {
  // Hlavičku Vary ignorujeme: skript stránky posílá Origin, kdežto při ukládání se neposílal.
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  event.respondWith(request.mode === 'navigate' ? page(event) : file(request));
});
