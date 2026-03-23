import { promises as fs } from 'node:fs';
import path from 'node:path';

let build = null;
let transform = null;
try {
  const esbuild = await import('esbuild');
  build = esbuild.build;
  transform = esbuild.transform;
} catch {
  // Optional locally; CI/deploy installs it.
}

const rootDir = process.cwd();
const distCssDir = path.join(rootDir, 'assets', 'dist', 'css');
const distJsDir = path.join(rootDir, 'assets', 'dist', 'js');
const cssSources = ['tokens.css', 'base.css', 'components.css', 'pages.css'].map((name) =>
  path.join(rootDir, 'assets', 'css', name)
);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function ensureDistDirs() {
  await fs.mkdir(distCssDir, { recursive: true });
  await fs.mkdir(distJsDir, { recursive: true });
}

async function collectHtmlFiles() {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => path.join(rootDir, entry.name));
}

async function buildCssBundle(versionToken) {
  const rawCss = (await Promise.all(cssSources.map((file) => fs.readFile(file, 'utf8')))).join('\n');
  const transformed = await transform(rawCss, {
    loader: 'css',
    minify: true,
    sourcemap: false
  });
  const outPath = path.join(distCssDir, 'app.bundle.css');
  await fs.writeFile(outPath, transformed.code, 'utf8');
  return `/assets/dist/css/app.bundle.css?v=${encodeURIComponent(versionToken)}`;
}

function extractPageEntry(html) {
  const scriptMatch = html.match(/<script\s+type="module"\s+src="(\/assets\/js\/pages\/[^"?]+\.js)(?:\?[^"]*)?"\s*><\/script>/i);
  return scriptMatch ? scriptMatch[1] : null;
}

async function bundlePageEntry(entryPath) {
  const absEntry = path.join(rootDir, entryPath.replace(/^\//, ''));
  const baseName = path.basename(entryPath, '.js');
  const outFile = path.join(distJsDir, `${baseName}.bundle.js`);
  await build({
    entryPoints: [absEntry],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    treeShaking: true
  });
  return `/assets/dist/js/${baseName}.bundle.js`;
}

function rewriteHtmlDocument(html, cssHref, scriptHref, versionToken) {
  let next = html;

  next = next.replace(/\s*<link rel="stylesheet" href="\/assets\/css\/(?:tokens|base|components|pages)\.css(?:\?[^"]*)?"\s*\/>\n?/g, '\n');
  if (!next.includes('/assets/dist/css/app.bundle.css')) {
    next = next.replace(/<\/head>/i, `    <link rel="stylesheet" href="${cssHref}" />\n  </head>`);
  } else {
    next = next.replace(
      /\/assets\/dist\/css\/app\.bundle\.css(?:\?[^"]*)?/g,
      `/assets/dist/css/app.bundle.css?v=${encodeURIComponent(versionToken)}`
    );
  }

  if (scriptHref) {
    next = next.replace(
      /<script\s+type="module"\s+src="\/assets\/js\/pages\/[^"?]+\.js(?:\?[^"]*)?"\s*><\/script>/i,
      `<script type="module" src="${scriptHref}?v=${encodeURIComponent(versionToken)}"></script>`
    );
    next = next.replace(
      /<script\s+type="module"\s+src="\/assets\/dist\/js\/[^"?]+\.bundle\.js(?:\?[^"]*)?"\s*><\/script>/i,
      `<script type="module" src="${scriptHref}?v=${encodeURIComponent(versionToken)}"></script>`
    );
  }

  return next;
}

async function rewriteHtmlFiles(cssHref, versionToken) {
  const htmlFiles = await collectHtmlFiles();
  const bundledPages = new Map();

  for (const htmlFile of htmlFiles) {
    const original = await fs.readFile(htmlFile, 'utf8');
    const entry = extractPageEntry(original);
    let scriptHref = null;
    if (entry) {
      if (!bundledPages.has(entry)) {
        const bundled = await bundlePageEntry(entry);
        bundledPages.set(entry, bundled);
      }
      scriptHref = bundledPages.get(entry);
    }

    const rewritten = rewriteHtmlDocument(original, cssHref, scriptHref, versionToken);
    if (rewritten !== original) {
      await fs.writeFile(htmlFile, rewritten, 'utf8');
    }
  }

  return bundledPages.size;
}

async function main() {
  if (!build || !transform) {
    console.warn('Skipping asset build: esbuild is not installed in this environment.');
    return;
  }
  await ensureDistDirs();
  const versionToken = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const cssHref = await buildCssBundle(versionToken);
  const pageCount = await rewriteHtmlFiles(cssHref, versionToken);
  console.log(`Built asset bundles. CSS: 1, JS page bundles: ${pageCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
