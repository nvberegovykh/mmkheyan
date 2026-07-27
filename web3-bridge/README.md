# mmkheyan.etherlink Web3 Bridge

This directory contains the Cloudflare Worker that makes the Web3 domain
**`mmkheyan.etherlink`** (registered on [Freename](https://freename.io)) reachable
by **normal web browsers and search engines**, with zero installs, zero browser
extensions, and zero custom DNS/VPN configuration on the visitor's side.

Live bridge URL: **https://mmkheyan-web3-bridge.mmkheyan-liber.workers.dev/**

## Why a bridge is needed (the ICANN/DNS root problem)

`.etherlink` is **not a delegated top-level domain in the ICANN DNS root**. It only
exists inside Freename's own blockchain-based naming registry (and any wallet /
resolver that chooses to look it up there — e.g. a browser extension, a
Freename-aware wallet app, or a device configured to use Freename's DNS
resolvers).

Concretely, this means:

- Cloudflare (or any standard authoritative DNS provider) **cannot create a zone
  for `.etherlink`** — the TLD isn't in the root zone, so no registrar, registry,
  or DNS host in the traditional system will ever resolve it.
- A stock Chrome/Safari/Firefox/Edge browser, with no extension and no custom
  DNS server configured, will **never** resolve `mmkheyan.etherlink` and show it
  in the address bar as a normal working site. This is true no matter how the
  destination server is configured — the failure happens before any HTTP request
  is even made, at the DNS resolution step, which happens on the visitor's own
  machine/OS/browser, entirely outside of our control.
- The Freename "Connect Web3 Domains to Website Builders" tutorial the client
  referenced confirms this too: even in that walkthrough, the presenter still
  switches their **local machine's DNS resolver** to Freename's resolvers (or
  installs the Freename browser extension) before Chrome will load the domain.
  Nothing about Carrd/Duda "publishing" changes this — those tools only let you
  attach a domain you already control at the registrar/DNS level, and
  `.etherlink` has no such level to attach to.

There is no server-side configuration — on Cloudflare, on GitHub Pages, or
anywhere else — that changes this. It is a client-side DNS-root limitation, not
a configuration problem, and it cannot be fixed by "trying harder" on the
hosting side.

## What this bridge actually does instead

Since the literal address bar can never show `mmkheyan.etherlink` in a stock
browser, the practical and honest solution is a **normal HTTPS website that
carries the Web3 identity as its branding**, while living at a URL that DNS,
browsers, and search engines can all resolve today:

```
https://mmkheyan-web3-bridge.mmkheyan-liber.workers.dev/
```

The Worker:

1. **Resolves `mmkheyan.etherlink` live** on every request (with caching) by
   calling Freename's public resolver API:
   `GET https://rslvr.freename.io/domain/resolve?q=mmkheyan.etherlink`
   — nothing about the Web3 identity, minting status, or record data is
   hardcoded; it reflects the real current on-chain state.
2. **Reverse-proxies the existing GitHub Pages site**
   (`https://nvberegovykh.github.io/mmkheyan`) transparently — the gallery,
   admin panel, images, and all existing functionality are untouched and
   continue to work exactly as before, just served through this URL.
3. **Injects SEO and identity metadata** into the proxied HTML: page `<title>`,
   meta description, canonical link (no trailing slash), Open Graph tags,
   Twitter card tags, and JSON-LD `WebSite` structured data — all naming
   `mmkheyan.etherlink` as the site's Web3 identity, so search engines and link
   previews surface it correctly.
4. **Displays a visible verification banner** at the top of every page showing
   the domain name, provider (Freename), network, token ID, on-chain status,
   and the timestamp of the last successful resolution — so any visitor can see
   exactly what has (or hasn't) been verified, live, in real time.
5. **Serves `/api/resolve`** as a public JSON endpoint exposing the same live
   resolution data programmatically (for status checks, monitoring, or the
   banner's own "details" panel).
6. **Serves `/robots.txt` and `/sitemap.xml`** so search engines can index the
   bridge URL properly.
7. **301-redirects trailing-slash paths** to their canonical non-trailing-slash
   form for clean, consistent URLs.

### Why the proxy target is a fixed origin, not the dynamically-resolved record

The brief asked for dynamic resolution rather than hardcoding. We resolve
**identity data** dynamically and live (name → status → token → records — see
`/api/resolve`), but the Worker **serves content from a fixed, developer-owned
origin** (`UPSTREAM_ORIGIN = https://nvberegovykh.github.io/mmkheyan`) rather
than blindly proxying to whatever URL a third-party registry record happens to
contain that day.

This is a deliberate safety boundary, not an oversight:

- Freename resolver records (`redirect.WEBSITE`, `dweb.ipfs.hash`, `record.A`)
  are **user-editable on-chain data**. Proxying live traffic to whatever target
  currently sits in those records would mean anyone who can edit the domain's
  DNS-like records (or a compromised/hijacked wallet) could redirect all bridge
  traffic to an arbitrary destination — a textbook SSRF/open-redirect risk.
- The resolver logic, adapter interface, priority order
  (`redirect.WEBSITE.0 > Browser.redirect_url > dweb.ipfs.hash > record.A.0 > none`),
  and scheme sanitizer (`sanitizeWebsiteTarget()` — blocks `javascript:`,
  `data:`, `file:`, and non-http(s) schemes) are all implemented and fully
  tested (see `test/index.test.mjs`), ready to drive the proxy target directly
  once/if that's wanted. Today they drive the **verification banner and
  `/api/resolve`** so the resolution is fully live and auditable, while actual
  page serving stays pinned to the origin the project owner controls.

Switching to record-driven proxying is a one-line change in `proxyRequest()`
(swap `UPSTREAM_ORIGIN` for `resolution.website.target` after validating it
with `sanitizeWebsiteTarget()`) — deliberately left as an opt-in for later,
once minting is finalized and the target has been confirmed stable.

## Why `workers.dev`, not a custom domain

The brief's preferred pattern was `https://<encoded-name>.w3.<CONTROLLED-DOMAIN>`.
We evaluated the available options:

- **liberpict.com (Ionos-hosted)** — no Ionos API connector is available in this
  environment, so DNS changes there aren't automatable from here. The client
  also explicitly declined adding a `mmkheyan.liberpict.com` CNAME earlier in
  this project, to avoid any risk to that domain's existing email/DNS records.
- **A brand-new domain** — would cost money and add a registration/verification
  delay for no functional benefit over the option below.
- **Cloudflare `workers.dev` subdomain** — free, instant, and needs **zero DNS
  changes anywhere**. We registered the account-level subdomain
  `mmkheyan-liber.workers.dev` and deployed the Worker as
  `mmkheyan-web3-bridge`, giving the permanent URL:

  ```
  https://mmkheyan-web3-bridge.mmkheyan-liber.workers.dev/
  ```

This satisfies "a better short public domain already controlled by the
project" from the brief — the domain is 100% under this Cloudflare account's
control, HTTPS is provisioned automatically by Cloudflare, and no existing
infrastructure (liberpict.com, GitHub Pages, Firebase) had to be touched or
put at risk.

If the client later wants a shorter/branded custom hostname (e.g.
`w3.someproject.com`), pointing a `CNAME`/Worker Route at that hostname to this
same Worker is a small follow-up — it doesn't require rewriting any of the
bridge logic.

## What this does **not** do (explicit non-claims)

Per the brief's acceptance criteria, to avoid any overstated or misleading
claims:

- ❌ This does **not** make a stock, unmodified browser resolve the literal
  string `mmkheyan.etherlink` in its address bar. That remains impossible
  without a browser extension, a wallet integration, or a custom DNS resolver
  on the visitor's device — see "Why a bridge is needed" above.
- ❌ This does **not** require, recommend, or silently install any resolver,
  browser extension, or MetaMask/wallet software for visitors.
- ❌ This does **not** require visitors to change their device or network DNS
  settings.
- ❌ This does **not** fake browser UI (no spoofed address bar, no fake "Web3
  browser" chrome) — it is a completely standard HTTPS website that happens to
  carry Web3 branding and live on-chain verification data.
- ❌ It does **not** claim `mmkheyan.etherlink` is "live" if Freename reports it
  isn't. As of this deployment, Freename's resolver returns
  `404 not_found_or_not_minted` for `mmkheyan.etherlink` (visible live at
  `/api/resolve`), matching the "Minting.." status shown in the Freename
  dashboard. This is independent of the bridge, which works correctly and will
  automatically start reporting `"ok": true` with full record data the moment
  minting finalizes on-chain — no redeploy needed.

## Files

- `src/index.js` — the Worker implementation:
  - `normalizeWeb3Name()` — Unicode NFC normalization + validation of Web3 names.
  - `encodeWeb3Hostname()` — deterministic SHA-256-based DNS-label encoder for
    future multi-domain support (e.g. `w3.<domain>` style subdomains per name);
    implemented and tested, not currently used for routing since this bridge
    serves a single domain today.
  - `FreenameAdapter` — calls the live Freename resolver API with timeout and
    malformed-response handling. `EnsAdapterScaffold` / `UnstoppableAdapterScaffold`
    are unimplemented stubs documenting how ENS/Unstoppable Domains support
    would plug into the same `pickAdapter()` interface later.
  - `pickWebsiteRecord()` — picks the resolved website target following the
    priority order specified in the brief.
  - `sanitizeWebsiteTarget()` — blocks `javascript:`/`data:`/`file:` and other
    dangerous schemes.
  - `resolveWithCache()` — wraps resolution in the Cloudflare Cache API with
    positive/negative TTLs (`RESOLUTION_TTL_SECONDS` / `NEGATIVE_TTL_SECONDS`).
  - `proxyRequest()` — reverse-proxies `UPSTREAM_ORIGIN`, strips hop-by-hop
    headers, adds security headers (`Strict-Transport-Security`,
    `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`), and
    injects SEO/branding only into HTML responses via `HTMLRewriter`.
  - `handleResolveApi()` — serves `/api/resolve` as JSON.
  - `robotsResponse()` / `sitemapResponse()` — serve `/robots.txt` and
    `/sitemap.xml`.
- `test/index.test.mjs` — Node built-in test runner suite (`node --test`)
  covering name normalization, hostname encoding (determinism, DNS label
  length, collision resistance), record-priority selection, and scheme
  sanitization. All 10 tests pass as of this deployment.
- `metadata.json` *(not committed — generated at deploy time, contains only
  non-secret plain-text env var names/values plus a secret binding name; the
  admin-purge token value itself is injected via the Cloudflare API as a
  `secret_text` binding, never committed to git)*.

## Configuration (environment bindings on the Worker)

| Variable | Value | Purpose |
|---|---|---|
| `PRIMARY_WEB3_NAME` | `mmkheyan.etherlink` | The Web3 domain this bridge represents |
| `WEB3_PROVIDER` | `freename` | Selects the `FreenameAdapter` |
| `FREENAME_RESOLVER_URL` | `https://rslvr.freename.io/domain/resolve` | Freename's public resolver endpoint |
| `UPSTREAM_ORIGIN` | `https://nvberegovykh.github.io/mmkheyan` | The real site being proxied (GitHub Pages) |
| `RESOLUTION_TTL_SECONDS` | `300` | Positive cache TTL for successful resolutions |
| `NEGATIVE_TTL_SECONDS` | `45` | Cache TTL for not-found/error resolutions (kept short so minting completion is picked up quickly) |
| `PROXY_MODE` | `reverse-proxy` | Documents the serving mode |
| `SITE_TITLE` | `mmkheyan.etherlink — Official Web3 Website` | Injected page `<title>`, kept authoritative client-side against the proxied site's own i18n script |
| `SITE_DESCRIPTION` | *(gallery description)* | Injected meta/OG description |
| `ADMIN_PURGE_TOKEN` | *(secret, not committed)* | Reserved for a future authenticated cache-purge endpoint |

## Deployment

Deployed directly via the Cloudflare REST API (no `wrangler` CLI needed):

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/mmkheyan-web3-bridge" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "metadata=@metadata.json;type=application/json" \
  -F "index.js=@src/index.js;type=application/javascript+module"
```

The `workers.dev` route only needs to be enabled once per script (already done):

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/mmkheyan-web3-bridge/subdomain" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"enabled": true, "previews_enabled": true}'
```

**Note:** the subdomain-enable endpoint requires `POST`, not `PUT` — the
Cloudflare API docs and several SDK examples show `PUT`, which returns
`405 Method not allowed for this authentication scheme` with a scoped API
token. `POST` is what actually works.

### Rollback

Re-deploy any previous version of `src/index.js` with the same `PUT` command
above — Cloudflare Workers deploys are atomic and instant, no separate
"activate" step is needed. To fully remove the bridge:

```bash
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/mmkheyan-web3-bridge" \
  -H "Authorization: Bearer <TOKEN>"
```

This does not affect the GitHub Pages site, Firebase project, or any other
part of the mmkheyan project — the Worker is a fully independent, additive
layer.

## Testing

```bash
node --test web3-bridge/test/index.test.mjs
```

End-to-end (already verified live):

- `GET /` → 200, injected title/OG/JSON-LD, verification banner visible,
  full gallery renders (Firestore-loaded artwork data confirmed working
  through the proxy in a real browser).
- `GET /api/resolve` → live JSON reflecting real Freename resolver state.
- `GET /robots.txt`, `GET /sitemap.xml` → 200.
- `GET /paintings/`  → 301 to `/paintings` (trailing-slash canonicalization).
- Static assets (`/styles.css`, `/main.js`, `/firebase-config.js`,
  `/content.json`, image files, `/admin`, `/admin/admin.js`) all proxy through
  correctly with proper `Content-Type` headers.
- No console errors in a real browser load (Firestore `Listen/channel`
  `net::ERR_ABORTED` events are normal long-polling behavior, not errors).

## Current live status

- Bridge: **live** at https://mmkheyan-web3-bridge.mmkheyan-liber.workers.dev/
- `mmkheyan.etherlink` on Freename: **minting in progress** as of this
  deployment (`/api/resolve` → `404 not_found_or_not_minted`). This does not
  block or affect the bridge, which works fully today; the verification banner
  and `/api/resolve` will automatically reflect the on-chain record the moment
  minting completes, with no code changes or redeploy required.
