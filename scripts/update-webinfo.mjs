import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }
      return [fullPath];
    })
  );
  return nested.flat();
}

function rel(filePath) {
  return path.relative(rootDir, filePath).replaceAll('\\', '/');
}

function extractFirstMatch(text, regex, fallback = 'N/A') {
  const match = text.match(regex);
  return match?.[1]?.trim() || fallback;
}

function extractExports(jsSource) {
  const names = new Set();
  for (const match of jsSource.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  for (const match of jsSource.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  for (const match of jsSource.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  for (const match of jsSource.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)) {
    const block = match[1];
    block
      .split(',')
      .map((part) => part.trim().split(' as ')[1] || part.trim().split(' as ')[0])
      .filter(Boolean)
      .forEach((name) => names.add(name));
  }
  return [...names].sort();
}

async function buildWebinfo() {
  const rootFiles = await fs.readdir(rootDir);
  const htmlFiles = rootFiles
    .filter((name) => name.endsWith('.html'))
    .map((name) => path.join(rootDir, name))
    .sort();

  const jsDir = path.join(rootDir, 'assets/js');
  const cssDir = path.join(rootDir, 'assets/css');

  const jsFiles = (await listFilesRecursive(jsDir)).filter((file) => file.endsWith('.js')).sort();
  const cssFiles = (await listFilesRecursive(cssDir)).filter((file) => file.endsWith('.css')).sort();

  const pageSection = [];
  for (const file of htmlFiles) {
    const source = await fs.readFile(file, 'utf8');
    const title = extractFirstMatch(source, /<title>([\s\S]*?)<\/title>/i);
    const heading = extractFirstMatch(source, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    pageSection.push(`- ${rel(file)} | title: ${title} | primary heading: ${heading}`);
  }

  const jsSection = [];
  for (const file of jsFiles) {
    const source = await fs.readFile(file, 'utf8');
    const exports = extractExports(source);
    const exportLabel = exports.length > 0 ? exports.join(', ') : 'No public exports';
    jsSection.push(`- ${rel(file)} | exports: ${exportLabel}`);
  }

  const cssSection = cssFiles.map((file) => `- ${rel(file)} | stylesheet module`);

  const generatedAt = new Date().toISOString();

  const contents = [
    'WEBINFO - Frontier Oil & Gas Company',
    `Generated: ${generatedAt}`,
    '',
    'PROJECT PURPOSE',
    '- Public-facing landing website for Frontier Oil & Gas Company.',
    '- Includes two key user paths: job application submission and employee intranet login.',
    '- Built for Cloudflare Pages with optional Pages Functions for authenticated intranet access.',
    '',
    'SITE STRUCTURE',
    ...pageSection,
    '',
    'JAVASCRIPT MODULES',
    ...jsSection,
    '',
    'CSS MODULES',
    ...cssSection,
    '',
    'DATA FLOW',
    '- Landing page imports company data from `assets/js/modules/company-data.js` and renders cards/stats via `renderHomeContent`.',
    '- Application form validates client-side inputs, displays status messages, and stores submissions in localStorage as `frontierApplications`.',
    '- Intranet login starts Discord OAuth2 at `/api/auth/discord/start` and enforces access by Discord role membership.',
    '- Cloudflare Pages Functions in `functions/api/auth/*` exchange Discord auth code, verify guild roles, and issue a signed session cookie with admin flag.',
    '- Admin role configuration is managed in the intranet dashboard and persisted in D1 via `functions/api/admin/roles.js`.',
    '- Protected intranet subpages (`voyage-tracker.html`, `my-fleet.html`, `my-details.html`) verify active session via `/api/auth/session` before rendering content.',
    '- Shared feedback UI is handled in `assets/js/modules/notice.js`.',
    '',
    'MAINTENANCE WORKFLOW',
    '- Regenerate this file at any time using: `npm run webinfo`.',
    '- If git hooks are enabled, this file auto-updates on every commit through `.githooks/pre-commit`.',
    '- For AI handoff, read this file first, then inspect referenced module files.',
    '',
    'DEPLOYMENT NOTES',
    '- Primary repo target: https://github.com/shaye104/frontieroilgasco',
    '- Cloudflare deployment command: `echo ok` when using Git-connected Pages deployments.',
    '- Static hosting is configured in `wrangler.jsonc` with `pages_build_output_dir` set to `.`.',
    '- Pages Functions auto-deploy with site code from `functions/`.',
    '- Bind your D1 database as `DB` in Cloudflare Pages project settings.',
    '- After deploy, attach your custom domain in Cloudflare and complete DNS routing.',
    '',
    'SECURITY NOTE',
    '- Configure secure environment variables before production OAuth use: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN, ADMIN_DISCORD_USER_ID, SESSION_SECRET, and optional DISCORD_REDIRECT_URI.',
    ''
  ].join('\n');

  await fs.writeFile(path.join(rootDir, 'WEBINFO.txt'), contents, 'utf8');
  process.stdout.write('WEBINFO.txt updated.\n');
}

buildWebinfo().catch((error) => {
  console.error(error);
  process.exit(1);
});
