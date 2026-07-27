// Node test runner: `node --test web3-bridge/test/index.test.mjs`
// Requires Node >= 19 (global crypto.subtle + Web fetch API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWeb3Name,
  encodeWeb3Hostname,
  pickWebsiteRecord,
  sanitizeWebsiteTarget,
} from '../src/index.js';

test('normalizeWeb3Name: valid domain lowercases and passes', () => {
  assert.equal(normalizeWeb3Name('mmkheyan.etherlink'), 'mmkheyan.etherlink');
  assert.equal(normalizeWeb3Name('MMKheyan.EtherLink'), 'mmkheyan.etherlink');
});

test('normalizeWeb3Name: mixed case canonicalizes deterministically', () => {
  const a = normalizeWeb3Name('Foo.Bar');
  const b = normalizeWeb3Name('foo.bar');
  assert.equal(a, b);
});

test('normalizeWeb3Name: rejects malformed names', () => {
  assert.equal(normalizeWeb3Name(''), null);
  assert.equal(normalizeWeb3Name('nodothere'), null);
  assert.equal(normalizeWeb3Name('-bad.start'), null);
  assert.equal(normalizeWeb3Name('bad-.end'), null);
  assert.equal(normalizeWeb3Name('has space.tld'), null);
  assert.equal(normalizeWeb3Name('a'.repeat(300) + '.tld'), null);
  assert.equal(normalizeWeb3Name(null), null);
  assert.equal(normalizeWeb3Name(undefined), null);
});

test('encodeWeb3Hostname: produces one DNS label under w3.<base>, deterministic', async () => {
  const h1 = await encodeWeb3Hostname('mmkheyan.etherlink', 'example.com');
  const h2 = await encodeWeb3Hostname('mmkheyan.etherlink', 'example.com');
  assert.equal(h1, h2, 'must be deterministic for the same input');
  assert.match(h1, /^mmkheyan-etherlink-[0-9a-f]{10}\.w3\.example\.com$/);
  const label = h1.split('.')[0];
  assert.ok(label.length <= 63, 'DNS label must be <= 63 chars');
});

test('encodeWeb3Hostname: different names produce different hashes (collision resistance, sanity)', async () => {
  const h1 = await encodeWeb3Hostname('aaa.etherlink', 'example.com');
  const h2 = await encodeWeb3Hostname('bbb.etherlink', 'example.com');
  assert.notEqual(h1, h2);
});

test('encodeWeb3Hostname: throws on invalid name', async () => {
  await assert.rejects(() => encodeWeb3Hostname('not a domain', 'example.com'));
});

test('pickWebsiteRecord: prefers redirect.WEBSITE.0 first', () => {
  const records = [
    { key: 'record.A.0', type: 'A', value: '1.2.3.4' },
    { key: 'redirect.WEBSITE.0', type: 'WEBSITE', value: 'https://example.com' },
  ];
  const result = pickWebsiteRecord(records);
  assert.equal(result.kind, 'https');
  assert.equal(result.target, 'https://example.com');
});

test('pickWebsiteRecord: falls back to IPFS then A record then none', () => {
  const ipfsOnly = pickWebsiteRecord([{ key: 'dweb.ipfs.hash', type: 'IPFS', value: 'QmABC' }]);
  assert.equal(ipfsOnly.kind, 'ipfs');
  assert.equal(ipfsOnly.target, 'ipfs://QmABC');

  const aOnly = pickWebsiteRecord([{ key: 'record.A.0', type: 'A', value: '3.120.39.71' }]);
  assert.equal(aOnly.kind, 'ipv4');
  assert.equal(aOnly.target, '3.120.39.71');

  const none = pickWebsiteRecord([]);
  assert.equal(none.kind, 'none');
  assert.equal(none.target, null);
});

test('sanitizeWebsiteTarget: blocks dangerous schemes', () => {
  const bad1 = sanitizeWebsiteTarget({ kind: 'https', target: 'javascript:alert(1)' });
  assert.equal(bad1.kind, 'none');

  const bad2 = sanitizeWebsiteTarget({ kind: 'https', target: 'data:text/html,hi' });
  assert.equal(bad2.kind, 'none');

  const bad3 = sanitizeWebsiteTarget({ kind: 'https', target: 'file:///etc/passwd' });
  assert.equal(bad3.kind, 'none');

  const good = sanitizeWebsiteTarget({ kind: 'https', target: 'https://example.com' });
  assert.equal(good.kind, 'https');
  assert.equal(good.target, 'https://example.com');
});

test('sanitizeWebsiteTarget: passes through non-https kinds unchanged', () => {
  const ipfs = sanitizeWebsiteTarget({ kind: 'ipfs', target: 'ipfs://QmABC' });
  assert.equal(ipfs.kind, 'ipfs');
  const none = sanitizeWebsiteTarget({ kind: 'none', target: null });
  assert.equal(none.kind, 'none');
});
