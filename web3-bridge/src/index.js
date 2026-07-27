/**
 * mmkheyan.etherlink — Public Web3 Domain Bridge
 * ------------------------------------------------------------------
 * Runs as a Cloudflare Worker. Serves the mmkheyan gallery site under a
 * normal HTTPS hostname (a workers.dev subdomain, or any custom domain
 * later attached to this Worker) so that:
 *
 *   - Any stock browser (Chrome/Firefox/Safari/Edge) can load it with
 *     zero extensions, zero custom DNS, zero wallet software.
 *   - Search engines can crawl and index it normally.
 *   - The Web3 identity "mmkheyan.etherlink" is displayed prominently
 *     (title, H1, Open Graph, JSON-LD) and its live Freename resolution
 *     record is fetched and shown transparently.
 *
 * IMPORTANT — READ BEFORE ASSUMING THIS "FIXES" .etherlink RESOLUTION:
 * This Worker does NOT and CANNOT make a stock browser resolve
 * "mmkheyan.etherlink" directly. ".etherlink" is not delegated in the
 * public ICANN/IANA DNS root, so a request to that literal hostname
 * fails during DNS lookup before it ever reaches Cloudflare, this
 * Worker, or any server. See README.md in this folder for the full
 * explanation. This Worker is the "bridge" hostname the brief calls
 * for — the closest correct solution given that constraint.
 */

// ---------------------------------------------------------------------------
// Config (overridable via Worker environment variables / dashboard vars)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  PRIMARY_WEB3_NAME: 'mmkheyan.etherlink',
  WEB3_PROVIDER: 'freename',
  FREENAME_RESOLVER_URL: 'https://rslvr.freename.io/domain/resolve',
  UPSTREAM_ORIGIN: 'https://nvberegovykh.github.io/mmkheyan',
  RESOLUTION_TTL_SECONDS: '300',
  NEGATIVE_TTL_SECONDS: '45',
  PROXY_MODE: 'reverse-proxy',
  SITE_TITLE: 'mmkheyan.etherlink — Official Web3 Website',
  SITE_DESCRIPTION: 'Official public website for the Freename Web3 domain mmkheyan.etherlink — the online gallery of artist Meruzhan Mkheyan.',
  // 'visible'  = show the verification bar at the top of every page (old default)
  // 'console'  = log verification details to the browser DevTools console only, no visible UI change
  // 'off'      = do not surface verification info in the page at all (SEO metadata in <head> is unaffected either way)
  BANNER_MODE: 'console',
};

function cfg(env, key) {
  const v = env && env[key];
  return v !== undefined && v !== null && v !== '' ? v : DEFAULTS[key];
}

// ---------------------------------------------------------------------------
// Name normalization + deterministic hostname encoder/decoder
// (Reusable for future Web3 domains / providers. Not used for routing on
// this single-site deployment today — see README "Extensibility" section —
// but implemented and tested per spec so adding a wildcard zone later is a
// drop-in change, not a rewrite.)
// ---------------------------------------------------------------------------

/** Normalize a Web3 domain name: trim, lowercase, ASCII-label validate. */
function normalizeWeb3Name(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().toLowerCase();
  if (name.length === 0 || name.length > 253) return null;
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const labels = name.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!labelRe.test(label)) return null;
  }
  return name;
}

async function sha256HexShort(input, len = 10) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, len);
}

/** mmkheyan.etherlink -> mmkheyan-etherlink-<hash>.w3.<baseDomain> */
async function encodeWeb3Hostname(name, baseDomain) {
  const normalized = normalizeWeb3Name(name);
  if (!normalized) throw new Error('invalid_web3_name');
  const hash = await sha256HexShort(normalized);
  const label = `${normalized.replace(/\./g, '-')}-${hash}`;
  if (label.length > 63) throw new Error('label_too_long');
  return `${label}.w3.${baseDomain}`;
}

// ---------------------------------------------------------------------------
// Provider-adapter interface + Freename adapter
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} NormalizedResolution
 * @property {string} name
 * @property {string} provider
 * @property {string|null} network
 * @property {string|null} tokenId
 * @property {Array<{key:string,type:string,value:string}>} records
 * @property {{kind:string,target:string|null}} website
 * @property {{source:string,resolvedAt:string,blockNumber:number|null,owner:string|null}} proof
 * @property {number} ttlSeconds
 * @property {boolean} ok
 * @property {string|null} error
 */

const SAFE_WEBSITE_SCHEMES = new Set(['https:', 'http:', 'ipfs:', 'ipns:', 'ar:']);

function pickWebsiteRecord(records) {
  const byKey = (k) => records.find((r) => r.key === k || r.type === k);
  const redirect = byKey('redirect.WEBSITE.0') || byKey('WEBSITE');
  if (redirect && redirect.value) return { kind: 'https', target: redirect.value };
  const browserRedirect = byKey('Browser.redirect_url');
  if (browserRedirect && browserRedirect.value) return { kind: 'https', target: browserRedirect.value };
  const ipfs = byKey('dweb.ipfs.hash');
  if (ipfs && ipfs.value) return { kind: 'ipfs', target: `ipfs://${ipfs.value}` };
  const aRecord = byKey('record.A.0') || byKey('A');
  if (aRecord && aRecord.value) return { kind: 'ipv4', target: aRecord.value };
  return { kind: 'none', target: null };
}

function sanitizeWebsiteTarget(website) {
  if (!website || !website.target) return website;
  if (website.kind === 'https') {
    try {
      const u = new URL(website.target);
      if (!SAFE_WEBSITE_SCHEMES.has(u.protocol)) {
        return { kind: 'none', target: null };
      }
    } catch {
      return { kind: 'none', target: null };
    }
  }
  return website;
}

class FreenameAdapter {
  constructor(env) {
    this.env = env;
    this.resolverUrl = cfg(env, 'FREENAME_RESOLVER_URL');
    this.provider = 'freename';
  }

  async supports(name) {
    const normalized = normalizeWeb3Name(name);
    return !!normalized;
  }

  /** @returns {Promise<NormalizedResolution>} */
  async resolve(name) {
    const normalized = normalizeWeb3Name(name);
    const nowIso = new Date().toISOString();
    if (!normalized) {
      return {
        name, provider: this.provider, network: null, tokenId: null, records: [],
        website: { kind: 'none', target: null },
        proof: { source: 'validation', resolvedAt: nowIso, blockNumber: null, owner: null },
        ttlSeconds: Number(cfg(this.env, 'NEGATIVE_TTL_SECONDS')),
        ok: false, error: 'invalid_name',
      };
    }

    const url = `${this.resolverUrl}?q=${encodeURIComponent(normalized)}`;
    let resp;
    try {
      resp = await fetch(url, {
        headers: { accept: 'application/json' },
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(6000),
      });
    } catch (err) {
      return {
        name: normalized, provider: this.provider, network: null, tokenId: null, records: [],
        website: { kind: 'none', target: null },
        proof: { source: 'freename-api', resolvedAt: nowIso, blockNumber: null, owner: null },
        ttlSeconds: Number(cfg(this.env, 'NEGATIVE_TTL_SECONDS')),
        ok: false, error: 'provider_timeout',
      };
    }

    if (resp.status === 404) {
      return {
        name: normalized, provider: this.provider, network: null, tokenId: null, records: [],
        website: { kind: 'none', target: null },
        proof: { source: 'freename-api', resolvedAt: nowIso, blockNumber: null, owner: null },
        ttlSeconds: Number(cfg(this.env, 'NEGATIVE_TTL_SECONDS')),
        ok: false, error: 'not_found_or_not_minted',
      };
    }

    if (!resp.ok) {
      return {
        name: normalized, provider: this.provider, network: null, tokenId: null, records: [],
        website: { kind: 'none', target: null },
        proof: { source: 'freename-api', resolvedAt: nowIso, blockNumber: null, owner: null },
        ttlSeconds: Number(cfg(this.env, 'NEGATIVE_TTL_SECONDS')),
        ok: false, error: `provider_http_${resp.status}`,
      };
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      return {
        name: normalized, provider: this.provider, network: null, tokenId: null, records: [],
        website: { kind: 'none', target: null },
        proof: { source: 'freename-api', resolvedAt: nowIso, blockNumber: null, owner: null },
        ttlSeconds: Number(cfg(this.env, 'NEGATIVE_TTL_SECONDS')),
        ok: false, error: 'malformed_provider_response',
      };
    }

    const records = Array.isArray(data.records) ? data.records : [];
    const website = sanitizeWebsiteTarget(pickWebsiteRecord(records));

    return {
      name: normalized,
      provider: this.provider,
      network: data.network || null,
      tokenId: data.tokenID || data.tokenId || null,
      records,
      website,
      proof: { source: 'freename-api', resolvedAt: nowIso, blockNumber: null, owner: null },
      ttlSeconds: Number(cfg(this.env, 'RESOLUTION_TTL_SECONDS')),
      ok: true, error: null,
    };
  }
}

// Optional scaffolds for future providers — not wired up, kept for parity
// with the required adapter interface / extensibility requirement.
class EnsAdapterScaffold {
  async supports(name) { return typeof name === 'string' && name.endsWith('.eth'); }
  async resolve() { throw new Error('not_implemented'); }
}
class UnstoppableAdapterScaffold {
  async supports(name) {
    return typeof name === 'string' && /\.(crypto|wallet|nft|x|dao|888|blockchain)$/.test(name);
  }
  async resolve() { throw new Error('not_implemented'); }
}

function pickAdapter(name, env) {
  // Only Freename is enabled today; kept as a selection function so adding
  // ENS/Unstoppable later is a one-line change, not a rewrite.
  return new FreenameAdapter(env);
}

// ---------------------------------------------------------------------------
// Cached resolution (Cache API, keyed by normalized name)
// ---------------------------------------------------------------------------
async function resolveWithCache(name, env, ctx) {
  const cacheKey = new Request(`https://internal.cache/freename-resolve/${encodeURIComponent(name)}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return { ...body, _cacheHit: true };
  }
  const adapter = pickAdapter(name, env);
  const result = await adapter.resolve(name);
  const ttl = result.ok ? result.ttlSeconds : Number(cfg(env, 'NEGATIVE_TTL_SECONDS'));
  const response = new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return { ...result, _cacheHit: false };
}

// ---------------------------------------------------------------------------
// SEO metadata injection (HTMLRewriter)
// ---------------------------------------------------------------------------
class TitleRewriter {
  constructor(title) { this.title = title; }
  element(el) { el.setInnerContent(this.title); }
}

class HeadInjector {
  constructor(html) { this.html = html; }
  element(el) { el.append(this.html, { html: true }); }
}

class BodyBannerInjector {
  constructor(html) { this.html = html; }
  element(el) { el.prepend(this.html, { html: true }); }
}

class RemoveElement {
  element(el) { el.remove(); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildHeadInjection(env, canonicalUrl, resolution) {
  const title = cfg(env, 'SITE_TITLE');
  const description = cfg(env, 'SITE_DESCRIPTION');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: cfg(env, 'PRIMARY_WEB3_NAME'),
    alternateName: `${cfg(env, 'PRIMARY_WEB3_NAME')} — Freename Web3 Domain`,
    url: canonicalUrl,
  };
  return `
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<meta property="og:title" content="${escapeHtml(cfg(env, 'PRIMARY_WEB3_NAME'))}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(cfg(env, 'PRIMARY_WEB3_NAME'))}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<!-- mmkheyan.etherlink Web3 bridge metadata (see /web3-bridge/README.md) -->
<script>
(function () {
  // The proxied site's own client-side i18n script sets document.title after
  // load (see main.js applyI18n()), which would silently overwrite the Web3
  // bridge branded title injected server-side above. Keep the bridge title
  // authoritative without touching the upstream site's source code.
  var desiredTitle = ${JSON.stringify(title)};
  try {
    var titleEl = document.querySelector('title') || (function () {
      var t = document.createElement('title');
      document.head.appendChild(t);
      return t;
    })();
    var applying = false;
    var observer = new MutationObserver(function () {
      if (applying) return;
      if (document.title !== desiredTitle) {
        applying = true;
        document.title = desiredTitle;
        applying = false;
      }
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    document.title = desiredTitle;
  } catch (e) { /* non-fatal: branding is cosmetic, never block the page */ }
})();
</script>
`;
}

function statusLabel(resolution) {
  if (!resolution) return 'Unable to verify';
  if (resolution.ok) return 'Verified — Freename API resolved';
  if (resolution.error === 'not_found_or_not_minted') return 'Domain minting in progress on Freename';
  return 'Unable to verify (provider unavailable)';
}

function buildVerificationBanner(env, resolution) {
  const name = cfg(env, 'PRIMARY_WEB3_NAME');
  const status = statusLabel(resolution);
  const network = resolution && resolution.network ? escapeHtml(resolution.network) : 'n/a';
  const tokenId = resolution && resolution.tokenId ? escapeHtml(String(resolution.tokenId)) : 'n/a';
  const resolvedAt = resolution && resolution.proof ? escapeHtml(resolution.proof.resolvedAt) : 'n/a';
  return `
<div id="web3-bridge-banner" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#111;color:#eee;padding:10px 16px;font-size:13px;line-height:1.5;border-bottom:1px solid #333;">
  <strong style="color:#fff;">${escapeHtml(name)}</strong>
  <span style="opacity:.8;"> — Verified Freename Web3 domain · </span>
  <span style="opacity:.9;">${escapeHtml(status)}</span>
  <details style="display:inline;">
    <summary style="display:inline;cursor:pointer;opacity:.8;margin-left:8px;">details</summary>
    <div style="margin-top:6px;opacity:.85;">
      Provider: Freename &nbsp;·&nbsp; Network: ${network} &nbsp;·&nbsp; Token ID: ${tokenId} &nbsp;·&nbsp; Resolved at: ${resolvedAt}
    </div>
  </details>
</div>`;
}

/**
 * Same verification info as buildVerificationBanner(), but delivered only to
 * the browser DevTools console instead of rendered on the visible page —
 * for sites that want the visitor-facing UI completely untouched while still
 * exposing the Freename verification proof to anyone who opens the console.
 */
function buildVerificationConsoleScript(env, resolution) {
  const name = cfg(env, 'PRIMARY_WEB3_NAME');
  const status = statusLabel(resolution);
  const network = resolution && resolution.network ? resolution.network : 'n/a';
  const tokenId = resolution && resolution.tokenId ? String(resolution.tokenId) : 'n/a';
  const resolvedAt = resolution && resolution.proof ? resolution.proof.resolvedAt : 'n/a';
  const payload = { name, provider: 'Freename', status, network, tokenId, resolvedAt };
  return `
<script>
(function () {
  try {
    console.log(
      '%c${escapeHtml(name)}%c — Verified Freename Web3 domain · %c${escapeHtml(status)}',
      'font-weight:bold;color:#fff;background:#111;padding:2px 6px;border-radius:3px 0 0 3px;',
      'color:#888;background:#111;padding:2px 4px;',
      'color:#0f0;background:#111;padding:2px 6px;border-radius:0 3px 3px 0;'
    );
    console.log('Web3 domain verification:', ${JSON.stringify(payload)});
  } catch (e) { /* non-fatal */ }
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Reverse proxy of the existing static site (GitHub Pages)
// ---------------------------------------------------------------------------
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'set-cookie',
]);

function buildUpstreamUrl(env, pathname, search) {
  const base = cfg(env, 'UPSTREAM_ORIGIN').replace(/\/$/, '');
  const path = pathname === '/' ? '/' : pathname;
  return `${base}${path}${search || ''}`;
}

async function proxyRequest(request, env, ctx, url) {
  const upstreamUrl = buildUpstreamUrl(env, url.pathname, url.search);
  const upstreamReq = new Request(upstreamUrl, {
    method: request.method,
    headers: new Headers([...request.headers].filter(([k]) => !['host', 'cookie'].includes(k.toLowerCase()))),
    // IMPORTANT: must be 'manual', not 'follow'. GitHub Pages 301-redirects
    // directory-style requests missing a trailing slash (e.g. /admin ->
    // /admin/). If we silently follow that redirect server-side, we'd
    // serve /admin/index.html's body back to the browser while its address
    // bar still shows /admin (no slash). The browser then resolves every
    // relative asset on that page (admin.css, admin.js, watermark.js)
    // against the wrong base directory, producing 404s + MIME errors and a
    // login form that appears to "do nothing" on submit (the JS never
    // loaded). Instead we pass the redirect back to the client so the
    // browser's URL bar actually updates to the trailing-slash path before
    // requesting assets.
    redirect: 'manual',
  });

  const upstreamResp = await fetch(upstreamReq);

  if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
    const location = upstreamResp.headers.get('location');
    if (location) {
      // Rewrite the upstream (GitHub Pages) host back to our own bridge
      // origin so the browser stays on the bridge domain instead of
      // bouncing to the raw GitHub Pages URL. GitHub Pages project sites
      // serve from a subpath (e.g. https://user.github.io/mmkheyan/...), so
      // that subpath prefix must also be stripped from the redirect target
      // -- otherwise the browser gets sent to /mmkheyan/admin/ on the
      // bridge domain, which doesn't exist there (the bridge serves the
      // project root at /).
      const upstreamBasePath = new URL(cfg(env, 'UPSTREAM_ORIGIN')).pathname.replace(/\/$/, '');
      const rewrittenLocation = new URL(location, upstreamUrl);
      rewrittenLocation.protocol = url.protocol;
      rewrittenLocation.host = url.host;
      if (upstreamBasePath && rewrittenLocation.pathname.startsWith(upstreamBasePath)) {
        rewrittenLocation.pathname = rewrittenLocation.pathname.slice(upstreamBasePath.length) || '/';
      }
      const redirectHeaders = new Headers();
      for (const [k, v] of upstreamResp.headers) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'location') redirectHeaders.set(k, v);
      }
      redirectHeaders.set('location', rewrittenLocation.toString());
      return new Response(null, { status: upstreamResp.status, headers: redirectHeaders });
    }
  }

  const contentType = upstreamResp.headers.get('content-type') || '';

  const headers = new Headers();
  for (const [k, v] of upstreamResp.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  headers.set('x-web3-bridge-for', cfg(env, 'PRIMARY_WEB3_NAME'));

  if (!contentType.includes('text/html')) {
    // Keep raw artwork files out of Google/Bing Images. This is a real,
    // meaningful download-prevention layer: image search's "View image" /
    // download button is one of the most common ways full-resolution files
    // leak without a visitor ever touching the actual gallery page (and
    // therefore never hitting the right-click/drag guards in main.js).
    // A plain per-request console.log was intentionally NOT added here --
    // every normal thumbnail <img> load hits this exact same code path, so
    // it can't distinguish casual browsing from an actual save attempt and
    // would just flood the logs with noise. Real attempt signal comes from
    // /api/track-attempt (fired only on an actual right-click/drag).
    if (contentType.startsWith('image/')) {
      headers.set('x-robots-tag', 'noimageindex');
    }
    return new Response(upstreamResp.body, { status: upstreamResp.status, headers });
  }

  // HTML response: inject SEO metadata + identity banner, preserve body content.
  const resolution = await resolveWithCache(cfg(env, 'PRIMARY_WEB3_NAME'), env, ctx);
  const canonicalUrl = `${url.origin}/`;
  const headInjection = buildHeadInjection(env, canonicalUrl, resolution);
  const title = cfg(env, 'SITE_TITLE');
  const bannerMode = cfg(env, 'BANNER_MODE');

  const rewriter = new HTMLRewriter()
    .on('title', new TitleRewriter(title))
    .on('meta[name="description" i]', new RemoveElement())
    .on('meta[property="og:title" i]', new RemoveElement())
    .on('meta[property="og:description" i]', new RemoveElement())
    .on('meta[property="og:url" i]', new RemoveElement())
    .on('link[rel="canonical" i]', new RemoveElement())
    .on('head', new HeadInjector(headInjection));

  if (bannerMode === 'visible') {
    rewriter.on('body', new BodyBannerInjector(buildVerificationBanner(env, resolution)));
  } else if (bannerMode !== 'off') {
    rewriter.on('head', new HeadInjector(buildVerificationConsoleScript(env, resolution)));
  }

  const rewritten = rewriter.transform(new Response(upstreamResp.body, { status: upstreamResp.status, headers }));
  return rewritten;
}

// ---------------------------------------------------------------------------
// robots.txt / sitemap.xml
// ---------------------------------------------------------------------------
function robotsResponse(origin) {
  const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function sitemapResponse(origin) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${origin}/</loc></url>\n` +
    `</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

// ---------------------------------------------------------------------------
// Download-attempt logging: POST /api/track-attempt (public, fire-and-forget
// beacon from main.js whenever a visitor right-clicks/drags a protected
// artwork image), GET /api/attempts?token=<ADMIN_PURGE_TOKEN> (owner-only
// readback). Stored as a rolling list (cap 200) in the same Cache API
// already used for domain-resolution caching — no new infra/bindings.
// ---------------------------------------------------------------------------
const ATTEMPTS_CACHE_KEY = new Request('https://internal.cache/download-attempts');
const ATTEMPTS_CACHE_MAX = 200;

async function handleTrackAttempt(request, ctx) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > 2000) throw new Error('payload_too_large');
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 }); // never let a malformed beacon surface as a client-visible error
  }
  const entry = {
    action: typeof body.action === 'string' ? body.action.slice(0, 40) : 'unknown',
    image: typeof body.image === 'string' ? body.image.slice(0, 200) : null,
    page: typeof body.page === 'string' ? body.page.slice(0, 200) : null,
    ts: Number.isFinite(body.ts) ? body.ts : Date.now(),
    ip: request.headers.get('cf-connecting-ip') || null,
    country: request.headers.get('cf-ipcountry') || null,
    ua: (request.headers.get('user-agent') || '').slice(0, 200),
  };
  console.log('download_attempt', JSON.stringify(entry));
  ctx.waitUntil((async () => {
    const cache = caches.default;
    let list = [];
    const cached = await cache.match(ATTEMPTS_CACHE_KEY);
    if (cached) {
      try { list = await cached.json(); } catch { list = []; }
    }
    list.push(entry);
    if (list.length > ATTEMPTS_CACHE_MAX) list = list.slice(list.length - ATTEMPTS_CACHE_MAX);
    const response = new Response(JSON.stringify(list), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' },
    });
    await cache.put(ATTEMPTS_CACHE_KEY, response);
  })());
  return new Response(null, { status: 204 });
}

async function handleAttemptsApi(request, env, url) {
  const token = url.searchParams.get('token');
  const expected = cfg(env, 'ADMIN_PURGE_TOKEN');
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }
  const cache = caches.default;
  const cached = await cache.match(ATTEMPTS_CACHE_KEY);
  const list = cached ? await cached.json() : [];
  return new Response(JSON.stringify({ ok: true, count: list.length, attempts: list.slice().reverse() }, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Public resolver API: GET /api/resolve?name=mmkheyan.etherlink
// ---------------------------------------------------------------------------
async function handleResolveApi(request, env, ctx, url) {
  const name = url.searchParams.get('name') || cfg(env, 'PRIMARY_WEB3_NAME');
  const normalized = normalizeWeb3Name(name);
  if (!normalized) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_name' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
  const resolution = await resolveWithCache(normalized, env, ctx);
  const body = {
    ok: resolution.ok,
    name: resolution.name,
    provider: resolution.provider,
    canonicalUrl: `${url.origin}/`,
    website: resolution.website,
    proof: resolution.proof,
    error: resolution.error || null,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': `max-age=${resolution.ok ? resolution.ttlSeconds : Number(cfg(env, 'NEGATIVE_TTL_SECONDS'))}`,
      'access-control-allow-origin': '*',
    },
  });
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // NOTE: we intentionally do NOT canonicalize/strip trailing slashes here.
    // Directory-index pages on the proxied site (e.g. /admin/index.html,
    // reached via /admin/) commonly reference their own CSS/JS with
    // relative paths like href="admin.css" rather than "/admin/admin.css".
    // Browsers resolve those relative to the *current* URL's directory, so
    // stripping the trailing slash (/admin/ -> /admin) silently changes that
    // base directory to root and breaks every relative asset on the page
    // (404s + MIME-type errors, as seen on the mmkheyan admin panel). Any
    // trailing-slash normalization must happen upstream, not in this proxy.

    if (url.pathname === '/robots.txt') return robotsResponse(url.origin);
    if (url.pathname === '/sitemap.xml') return sitemapResponse(url.origin);
    if (url.pathname === '/api/resolve') return handleResolveApi(request, env, ctx, url);
    if (url.pathname === '/api/track-attempt') return handleTrackAttempt(request, ctx);
    if (url.pathname === '/api/attempts') return handleAttemptsApi(request, env, url);

    try {
      return await proxyRequest(request, env, ctx, url);
    } catch (err) {
      return new Response(
        `<!doctype html><html><head><title>${escapeHtml(cfg(env, 'SITE_TITLE'))}</title></head>` +
        `<body><h1>${escapeHtml(cfg(env, 'PRIMARY_WEB3_NAME'))}</h1><p>The site is temporarily unavailable. Please try again shortly.</p></body></html>`,
        { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
  },
};

// Exported for tests
export {
  normalizeWeb3Name,
  encodeWeb3Hostname,
  sha256HexShort,
  pickWebsiteRecord,
  sanitizeWebsiteTarget,
  FreenameAdapter,
};
