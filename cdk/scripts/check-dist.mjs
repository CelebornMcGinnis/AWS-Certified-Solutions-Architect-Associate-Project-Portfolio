#!/usr/bin/env node
// Offline checks on a staged website build (cdk/.website-dist-<stage>).
//
//   node scripts/check-dist.mjs .website-dist-beta .website-dist-prod
//
// Catches the kinds of problems that used to slip through: links to pages
// that aren't deployed on a stage (they silently fell back to the homepage),
// missing images/scripts, inline script/style that the site's CSP forbids,
// and basic accessibility mistakes. No dependencies; regex-based on purpose
// since the site's HTML is hand-written and regular.
import * as fs from 'node:fs';
import * as path from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: check-dist.mjs <staged-dir> [<staged-dir> ...]');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim();

let totalProblems = 0;

for (const dir of dirs) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) {
    console.error(`${dir}: not found (run \`npx cdk synth\` first)`);
    process.exit(2);
  }
  const files = walk(root);
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const fileSet = new Set(files.map(rel));
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const idsByPage = new Map();
  for (const f of htmlFiles) {
    const ids = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
    idsByPage.set(rel(f), ids);
  }

  const problems = [];
  const add = (page, msg) => problems.push(`${page}: ${msg}`);

  function resolveTarget(fromPage, href) {
    let [target, hash] = href.split('#');
    target = target.split('?')[0];
    let abs;
    if (target === '') abs = fromPage;
    else if (target.startsWith('/')) abs = target.slice(1);
    else abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromPage), target));
    if (abs === '' || abs.endsWith('/')) abs += 'index.html';
    return { abs, hash };
  }

  for (const f of htmlFiles) {
    const page = rel(f);
    const html = fs.readFileSync(f, 'utf8');
    const is404 = page === '404.html';

    // --- links and assets must exist in this stage's build ---
    for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
      const href = m[1];
      if (!href || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(href)) continue;
      if (href.includes('${') || href.includes('__')) continue;
      const { abs, hash } = resolveTarget(page, href);
      if (!fileSet.has(abs)) {
        // config.js is generated into the bucket by the stack, not staged here.
        if (abs.endsWith('/config.js')) continue;
        add(page, `broken link/asset "${href}" (no ${abs} in this build)`);
        continue;
      }
      if (hash && abs.endsWith('.html') && !idsByPage.get(abs)?.has(hash)) {
        add(page, `anchor "#${hash}" not found in ${abs}`);
      }
    }

    // --- things the CSP forbids ---
    if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) add(page, 'inline <script> (blocked by the CSP)');
    if (/<style[\s>]/.test(html)) add(page, 'inline <style> (blocked by the CSP)');
    if (/\sstyle="/.test(html)) add(page, 'inline style="" attribute (blocked by the CSP)');
    if (/\son[a-z]+="/.test(html)) add(page, 'inline event handler attribute (blocked by the CSP)');

    // --- basics every page should have ---
    if (!/<html[^>]*\blang="/.test(html)) add(page, '<html> has no lang attribute');
    if (!/<title>[^<]+<\/title>/.test(html)) add(page, 'missing <title>');
    if (!/<meta name="viewport"/.test(html)) add(page, 'missing viewport meta');
    if (!is404 && !/rel="canonical"/.test(html)) add(page, 'missing canonical link');
    const h1s = [...html.matchAll(/<h1[\s>]/g)].length;
    if (h1s !== 1) add(page, `expected exactly one <h1>, found ${h1s}`);

    // --- accessibility basics ---
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt=/.test(m[0])) add(page, `<img> without alt: ${m[0].slice(0, 80)}`);
    }
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const hasName = /aria-label=|aria-labelledby=|title=/.test(m[1]) || stripTags(m[2]) !== '' || /<img[^>]*\balt="[^"]+"/.test(m[2]);
      if (!hasName) add(page, `<button> with no accessible name: ${m[0].slice(0, 80).replace(/\s+/g, ' ')}`);
    }
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      const hasName = /aria-label=|aria-labelledby=|title=/.test(m[1]) || stripTags(m[2]) !== '' || /<img[^>]*\balt="[^"]+"/.test(m[2]);
      if (!hasName) add(page, `<a> with no accessible name: ${m[0].slice(0, 80).replace(/\s+/g, ' ')}`);
    }
    const seenIds = new Set();
    for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
      if (seenIds.has(m[1])) add(page, `duplicate id "${m[1]}"`);
      seenIds.add(m[1]);
    }
  }

  // --- crawler files ---
  if (!fileSet.has('robots.txt')) add('(site)', 'missing robots.txt');
  if (!fileSet.has('404.html')) add('(site)', 'missing 404.html');
  if (fileSet.has('sitemap.xml')) {
    const sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    for (const m of sm.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)) {
      const target = m[1].endsWith('/') ? `${m[1].slice(1)}index.html` : m[1].slice(1);
      if (!fileSet.has(target)) add('sitemap.xml', `lists ${m[1]} which is not in this build`);
    }
  }
  if (![...fileSet].some((f) => /^styles\.[0-9a-f]{10}\.css$/.test(f))) add('(site)', 'no fingerprinted stylesheet found');

  console.log(`${dir}: ${htmlFiles.length} pages checked, ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  totalProblems += problems.length;
}

process.exit(totalProblems === 0 ? 0 : 1);
