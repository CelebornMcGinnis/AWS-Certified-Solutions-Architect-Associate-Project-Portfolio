import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');
const STAGING_DIR = path.join(__dirname, '../.website-dist');

interface ProjectMapping {
  frontendDir: string;
  destPrefix: string;
  // repo filename -> production filename, per PROJECT_STRUCTURE.md's
  // "Website savepoint path" table (only entries that differ need listing).
  rename?: Record<string, string>;
}

const PROJECTS: ProjectMapping[] = [
  {
    frontendDir: 'projects/contact-form-api/frontend',
    destPrefix: 'project/contactform',
    rename: { 'index.html': 'project1.html' },
  },
  {
    frontendDir: 'projects/realtime-polling-app/frontend',
    destPrefix: 'project/polling',
    rename: { 'index.html': 'project2.html' },
  },
  {
    frontendDir: 'projects/sns-notification-fan-out/frontend',
    destPrefix: 'project/fanningsns',
    rename: { 'index.html': 'project3.html' },
  },
];

function copyFileRenamed(srcDir: string, destDir: string, file: string, rename?: Record<string, string>) {
  const destName = rename?.[file] ?? file;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, destName));
}

/**
 * Assembles a staging directory that mirrors the production S3 key layout
 * documented in PROJECT_STRUCTURE.md -- website/ at the bucket root, each
 * project's frontend/ under /project/<name>/, with index.html renamed to
 * the historical projectN.html production filename. BucketDeployment
 * uploads this directory as-is, replacing the manual `aws s3 sync` +
 * `cloudfront create-invalidation` workflow.
 */
export function buildWebsiteContentDir(): string {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  fs.cpSync(path.join(REPO_ROOT, 'website'), STAGING_DIR, { recursive: true });
  // README.md ships alongside the source for GitHub browsing; it has no
  // production purpose and was never part of the documented path mapping.
  fs.rmSync(path.join(STAGING_DIR, 'README.md'), { force: true });

  for (const project of PROJECTS) {
    const srcDir = path.join(REPO_ROOT, project.frontendDir);
    const destDir = path.join(STAGING_DIR, project.destPrefix);
    for (const file of fs.readdirSync(srcDir)) {
      copyFileRenamed(srcDir, destDir, file, project.rename);
    }
  }

  return STAGING_DIR;
}
