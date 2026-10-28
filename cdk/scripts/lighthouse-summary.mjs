#!/usr/bin/env node
// Prints a markdown table of Lighthouse scores (average of the runs per page)
// from the .lighthouseci reports, for the GitHub Actions run summary.
import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = process.argv[2] ?? '.lighthouseci';
if (!fs.existsSync(dir)) {
  console.log('No Lighthouse reports were produced.');
  process.exit(0);
}
const byUrl = new Map();
for (const f of fs.readdirSync(dir).filter((n) => /^lhr-.*\.json$/.test(n))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const list = byUrl.get(r.finalUrl) ?? [];
  list.push(r);
  byUrl.set(r.finalUrl, list);
}
const cats = [['performance', 'Performance'], ['accessibility', 'Accessibility'], ['best-practices', 'Best practices'], ['seo', 'SEO']];
console.log('### Lighthouse (warn-only)\n');
console.log(`| Page | ${cats.map((c) => c[1]).join(' | ')} |`);
console.log(`|---|${cats.map(() => '---').join('|')}|`);
for (const [url, runs] of byUrl) {
  const cells = cats.map(([k]) => Math.round((runs.reduce((s, r) => s + r.categories[k].score, 0) / runs.length) * 100));
  console.log(`| ${new URL(url).pathname} | ${cells.join(' | ')} |`);
}
console.log('\nBeta is deliberately noindex, which lowers the SEO category score; the individual SEO audits are asserted separately.');
console.log('Full HTML/JSON reports are attached to this run as the `lighthouse-beta` artifact.');
