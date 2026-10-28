#!/usr/bin/env node
// Post-deploy smoke test for a live stage of the website.
//
//   node scripts/smoke-test.mjs https://betaweb.mcginnisarchitecture.com beta .website-dist-beta
//
// Walks every page in the staged build against the live site and checks the
// things that have actually gone wrong before: pages missing or falling back
// to the homepage, security/caching/indexing headers not applied, and
// crawler files wrong for the stage. Retries for a few minutes because
// CloudFront can take a moment to serve a fresh deploy everywhere.
import * as fs from 'node:fs';
import * as path from 'node:path';

const [baseUrlArg, stage, distDir] = process.argv.slice(2);
if (!baseUrlArg || !['beta', 'prod'].includes(stage) || !distDir) {
  console.error('usage: smoke-test.mjs <baseUrl> <beta|prod> <staged-dir>');
  process.exit(2);
}
const base = baseUrlArg.replace(/\/$/, '');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const root = path.resolve(distDir);
const pages = walk(root)
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.relative(root, f).split(path.sep).join('/'))
  .filter((rel) => rel !== '404.html')
  .map((rel) => (rel === 'index.html' ? '/' : `/${rel}`));
const stylesheet = fs.readdirSync(root).find((f) => /^styles\.[0-9a-f]{10}\.css$/.test(f));

async function get(urlPath, init) {
  return fetch(base + urlPath, { redirect: 'manual', ...init });
}

async function runOnce() {
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };

  for (const page of pages) {
    const res = await get(page);
    check(res.status === 200, `${page}: expected 200, got ${res.status}`);
    check((res.headers.get('content-type') || '').includes('text/html'), `${page}: content-type is ${res.headers.get('content-type')}`);
    if (page === '/') {
      const csp = res.headers.get('content-security-policy') || '';
      check(csp.includes("default-src 'self'"), 'home: Content-Security-Policy header missing');
      check(!csp.includes('unsafe-inline'), "home: CSP still allows 'unsafe-inline'");
      check((res.headers.get('strict-transport-security') || '').includes('max-age'), 'home: Strict-Transport-Security header missing');
      check(res.headers.get('x-content-type-options') === 'nosniff', 'home: X-Content-Type-Options header missing');
      const robots = res.headers.get('x-robots-tag') || '';
      if (stage === 'beta') check(robots.includes('noindex'), 'beta home: X-Robots-Tag noindex missing');
      else check(!robots.includes('noindex'), 'prod home: unexpectedly sends noindex');
      check((res.headers.get('cache-control') || '').includes('no-cache'), `home: cache-control is "${res.headers.get('cache-control')}", expected no-cache`);
    }
  }

  const missing = await get(`/definitely-not-a-page-${Date.now()}`);
  const missingBody = await missing.text();
  check(missing.status === 404, `missing page: expected 404, got ${missing.status}`);
  check(missingBody.includes('Page not found'), 'missing page: body is not the 404 page');

  const robots = await get('/robots.txt');
  const robotsBody = await robots.text();
  check(robots.status === 200 && (robots.headers.get('content-type') || '').includes('text/plain'), `robots.txt: status ${robots.status}, type ${robots.headers.get('content-type')}`);
  if (stage === 'beta') check(/Disallow:\s*\/\s*$/m.test(robotsBody), 'beta robots.txt should disallow everything');
  else check(robotsBody.includes('Sitemap:'), 'prod robots.txt should list the sitemap');

  if (stage === 'prod') {
    const sm = await get('/sitemap.xml');
    const smBody = await sm.text();
    check(sm.status === 200 && (sm.headers.get('content-type') || '').includes('xml'), `sitemap.xml: status ${sm.status}, type ${sm.headers.get('content-type')}`);
    for (const m of smBody.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)) {
      const r = await get(m[1]);
      check(r.status === 200, `sitemap lists ${m[1]} but it returns ${r.status}`);
    }
  }

  if (stylesheet) {
    const css = await get(`/${stylesheet}`);
    check(css.status === 200, `/${stylesheet}: expected 200, got ${css.status}`);
    check((css.headers.get('cache-control') || '').includes('immutable'), `/${stylesheet}: cache-control is "${css.headers.get('cache-control')}"`);
  }

  return failures;
}

const ATTEMPTS = 6;
const DELAY_MS = 20000;
let failures = [];
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    failures = await runOnce();
  } catch (e) {
    failures = [`request failed: ${e.message}`];
  }
  if (failures.length === 0) {
    console.log(`Smoke test passed for ${base} (${stage}): ${pages.length} pages, headers, 404, crawler files OK (attempt ${attempt}).`);
    process.exit(0);
  }
  console.log(`Attempt ${attempt}/${ATTEMPTS} failed:\n  - ${failures.join('\n  - ')}`);
  if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.error(`Smoke test FAILED for ${base} (${stage}).`);
process.exit(1);
