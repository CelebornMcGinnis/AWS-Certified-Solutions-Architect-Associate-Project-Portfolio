import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');

// One directory per stage, not a single shared path: CDK's asset bundling
// doesn't hash a Source.asset() directory synchronously when this function
// runs -- it reads the directory later, after every stack in the app has
// already been constructed. A single shared staging path would mean
// whichever stage's build happened to run last "wins" the asset content
// for every stack that referenced that path, silently.
function stagingDirFor(stage: Stage): string {
  return path.join(__dirname, `../.website-dist-${stage}`);
}

export type Stage = 'prod' | 'beta';
export type ProjectKey = 'contactForm' | 'livePoll' | 'fanningSns' | 'workflowVisualizer';

interface ProjectMapping {
  key: ProjectKey;
  frontendDir: string;
  destPrefix: string;
  // repo filename -> production filename, per PROJECT_STRUCTURE.md's
  // "Website savepoint path" table (only entries that differ need listing).
  rename?: Record<string, string>;
  /**
   * Stages this project's frontend files (and homepage/nav entries below)
   * should be published to. Omitted entirely for the three already-live
   * projects, whose homepage card and nav links are permanent, hand-written
   * markup in website/index.html rather than anything injected here.
   */
  stages?: Stage[];
  /** Path (repo-relative) to an HTML fragment injected at the
   * STAGE_ONLY_PROJECT_CARDS marker in website/index.html, for stages
   * where this project applies. Lives outside frontendDir so it never
   * gets picked up by the plain file-copy loop below. */
  homepageCardFile?: string;
  navLinkHtml?: string;
  mobileNavLinkHtml?: string;
}

const PROJECTS: ProjectMapping[] = [
  {
    key: 'contactForm',
    frontendDir: 'projects/contact-form-api/frontend',
    destPrefix: 'project/contactform',
    rename: { 'index.html': 'project1.html' },
  },
  {
    key: 'livePoll',
    frontendDir: 'projects/realtime-polling-app/frontend',
    destPrefix: 'project/polling',
    rename: { 'index.html': 'project2.html' },
  },
  {
    key: 'fanningSns',
    frontendDir: 'projects/sns-notification-fan-out/frontend',
    destPrefix: 'project/fanningsns',
    rename: { 'index.html': 'project3.html' },
  },
  {
    key: 'workflowVisualizer',
    frontendDir: 'projects/workflow-visualizer/frontend',
    destPrefix: 'project/workflow',
    rename: { 'index.html': 'project4.html' },
    // Beta only, pending review -- flip to ['beta', 'prod'] to promote.
    // (Its backend now exists on both stages regardless -- see
    // workflow-visualizer-stack.ts -- this only gates the frontend page
    // and homepage/nav visibility.)
    stages: ['beta'],
    homepageCardFile: 'projects/workflow-visualizer/homepage-card.html',
    navLinkHtml: '<a href="/project/workflow/project4.html">Workflow Visualizer</a>',
    mobileNavLinkHtml: '<a class="mobile-menu-sublink" href="/project/workflow/project4.html">Workflow Visualizer</a>',
  },
];

const CONFIG_JS_PLACEHOLDER = '__API_ENDPOINT__';

function copyFileRenamed(srcDir: string, destDir: string, file: string, rename?: Record<string, string>) {
  const destName = rename?.[file] ?? file;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, destName));
}

function projectAppliesToStage(project: ProjectMapping, stage: Stage): boolean {
  return !project.stages || project.stages.includes(stage);
}

/**
 * Fills in website/index.html's three STAGE_ONLY_* marker comments with
 * whichever in-review projects apply to this stage -- a project not yet
 * promoted to prod (stages: ['beta']) shows up on beta's homepage card
 * grid and nav dropdown, but prod's build sees no applicable projects and
 * the markers are simply replaced with nothing, leaving prod's permanent
 * "Next project" placeholder as the only thing in that slot.
 */
function injectStageOnlyContent(stage: Stage, stagingDir: string) {
  const indexPath = path.join(stagingDir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  const applicable = PROJECTS.filter((project) => project.stages?.includes(stage));

  const cardsHtml = applicable
    .filter((project) => project.homepageCardFile)
    .map((project) => fs.readFileSync(path.join(REPO_ROOT, project.homepageCardFile!), 'utf8').trimEnd())
    .join('\n');
  const navLinksHtml = applicable
    .map((project) => project.navLinkHtml)
    .filter((html): html is string => Boolean(html))
    .join('\n            ');
  const mobileNavLinksHtml = applicable
    .map((project) => project.mobileNavLinkHtml)
    .filter((html): html is string => Boolean(html))
    .join('\n      ');

  html = html.replace('<!-- STAGE_ONLY_PROJECT_CARDS -->', cardsHtml);
  html = html.replace('<!-- STAGE_ONLY_NAV_LINKS -->', navLinksHtml);
  html = html.replace('<!-- STAGE_ONLY_MOBILE_NAV_LINKS -->', mobileNavLinksHtml);

  fs.writeFileSync(indexPath, html);
}

/**
 * Assembles a staging directory that mirrors the production S3 key layout
 * documented in PROJECT_STRUCTURE.md -- website/ at the bucket root, each
 * project's frontend/ under /project/<name>/, with index.html renamed to
 * the historical projectN.html production filename. BucketDeployment
 * uploads this directory as-is, replacing the manual `aws s3 sync` +
 * `cloudfront create-invalidation` workflow.
 *
 * config.js is deliberately excluded from this copy -- see
 * buildConfigJsSources() below. A plain file copy has no way to resolve
 * the CDK tokens that carry each stage's actual backend endpoint, so that
 * one file per project is generated separately, as a BucketDeployment
 * `Source.data()` entry that CloudFormation resolves at deploy time.
 */
export function buildWebsiteContentDir(stage: Stage): string {
  const stagingDir = stagingDirFor(stage);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  fs.cpSync(path.join(REPO_ROOT, 'website'), stagingDir, { recursive: true });
  // README.md ships alongside the source for GitHub browsing; it has no
  // production purpose and was never part of the documented path mapping.
  fs.rmSync(path.join(stagingDir, 'README.md'), { force: true });

  for (const project of PROJECTS) {
    if (!projectAppliesToStage(project, stage)) continue;
    const srcDir = path.join(REPO_ROOT, project.frontendDir);
    const destDir = path.join(stagingDir, project.destPrefix);
    for (const file of fs.readdirSync(srcDir)) {
      if (file === 'config.js') continue;
      copyFileRenamed(srcDir, destDir, file, project.rename);
    }
  }

  injectStageOnlyContent(stage, stagingDir);

  return stagingDir;
}

/**
 * One BucketDeployment `Source.data()` entry per project applicable to this
 * stage, with each project's config.js template's __API_ENDPOINT__
 * placeholder swapped for that stage's real backend endpoint token (a
 * CDK-token-bearing string, e.g. `fanningSnsStack.apiEndpoint` -- the same
 * technique already used throughout the backend stacks for building
 * endpoint URLs from `.ref`/`.attrArn`). CloudFormation resolves the
 * embedded token via Fn::Sub before the deployment's custom resource ever
 * runs, so the uploaded file has the real, deployed URL -- never manually
 * pasted in again after a deploy.
 */
export function buildConfigJsSources(stage: Stage, endpoints: Record<ProjectKey, string>): { destinationKey: string; content: string }[] {
  return PROJECTS.filter((project) => projectAppliesToStage(project, stage)).map((project) => {
    const templatePath = path.join(REPO_ROOT, project.frontendDir, 'config.js');
    const template = fs.readFileSync(templatePath, 'utf8');
    const content = template.replaceAll(CONFIG_JS_PLACEHOLDER, endpoints[project.key]);
    return { destinationKey: `${project.destPrefix}/config.js`, content };
  });
}
