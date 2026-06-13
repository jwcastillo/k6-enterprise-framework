#!/usr/bin/env node

/**
 * sync-docs.mjs
 *
 * Syncs CLIENT documentation from clients/ directories into the Docusaurus
 * docs-site structure. Framework docs live directly in docs-site/docs/framework/
 * (single source of truth — no sync needed).
 *
 * Usage: node scripts/sync-docs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const CLIENTS_SRC = join(ROOT, 'clients');
const DOCS_DEST = join(import.meta.dirname, '..', 'docs');
const I18N_ES_DEST = join(import.meta.dirname, '..', 'i18n', 'es', 'docusaurus-plugin-content-docs', 'current');

// Client directories to sync
const CLIENTS = [
  '_reference',
  '_benchmark',
  'examples',
  'airline-accelerator',
  'latam-airlines',
  'falabella-seguros',
];

// Client display names
const CLIENT_NAMES = {
  '_reference': 'Reference Client',
  '_benchmark': 'Benchmark',
  'examples': 'Examples',
  'airline-accelerator': 'Airline Accelerator',
  'latam-airlines': 'LATAM Airlines',
  'falabella-seguros': 'Falabella Seguros',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1]
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
  }
  return 'Untitled';
}

function cleanContent(content) {
  const lines = content.split('\n');
  const cleaned = [];
  let skipNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip language toggle lines
    if (line.match(/^>\s*\[(?:Español|English)\]/i)) {
      skipNext = true;
      continue;
    }

    if (skipNext && line.trim() === '') {
      skipNext = false;
      continue;
    }
    skipNext = false;

    cleaned.push(line);
  }

  return cleaned.join('\n');
}

function addFrontmatter(content, { title, sidebarPosition }) {
  const fm = ['---', `title: "${title.replace(/"/g, '\\"')}"`];
  if (sidebarPosition !== undefined) {
    fm.push(`sidebar_position: ${sidebarPosition}`);
  }
  fm.push('---', '');
  return fm.join('\n') + content;
}

function processFile(srcPath, destPath, { sidebarPosition, isEs = false } = {}) {
  if (!existsSync(srcPath)) {
    return false;
  }

  const raw = readFileSync(srcPath, 'utf-8');
  const cleaned = cleanContent(raw);
  const title = extractTitle(cleaned);
  const finalContent = addFrontmatter(cleaned, { title, sidebarPosition });

  ensureDir(dirname(destPath));
  writeFileSync(destPath, finalContent, 'utf-8');
  console.log(`  ${isEs ? 'ES' : 'EN'}: ${relative(join(import.meta.dirname, '..'), destPath)}`);
  return true;
}

function findMarkdownFiles(dir, baseDir = dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'data', 'envs', 'scripts', 'tests', 'skill', 'bin'].includes(entry)) continue;
      results.push(...findMarkdownFiles(fullPath, baseDir));
    } else if (entry.endsWith('.md') && !entry.endsWith('.es.md') && entry !== 'CHANGELOG.md' && entry !== 'MIGRATION.md') {
      results.push({ fullPath, relativePath: relative(baseDir, fullPath) });
    }
  }
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== k6 Framework — Docs Sync ===\n');

  // ── Sync standalone framework docs (mcp-server, etc.) ───────────────────
  const mcpReadme = join(ROOT, 'mcp-server', 'README.md');
  if (existsSync(mcpReadme)) {
    console.log('[Framework extras]');
    processFile(mcpReadme, join(DOCS_DEST, 'framework', 'ai', 'mcp-server-setup.md'), { sidebarPosition: 3 });
    console.log('');
  }

  // ── Sync client docs ────────────────────────────────────────────────────
  // Clean previous client docs
  const clientsDestDir = join(DOCS_DEST, 'clients');
  if (existsSync(clientsDestDir)) {
    rmSync(clientsDestDir, { recursive: true });
    console.log('Cleaned previous clients docs.\n');
  }

  // Clients root category
  ensureDir(clientsDestDir);
  writeFileSync(join(clientsDestDir, '_category_.json'), JSON.stringify({
    label: 'Clients',
    position: 20,
    link: { type: 'generated-index', description: 'Per-client documentation, scenarios, and configurations.' },
  }, null, 2));

  for (const client of CLIENTS) {
    const clientDir = join(CLIENTS_SRC, client);
    if (!existsSync(clientDir)) {
      console.log(`SKIP (not found): ${client}`);
      continue;
    }

    const clientSlug = client.replace(/^_/, '');
    const clientDestDir = join(DOCS_DEST, 'clients', clientSlug);
    const clientEsDestDir = join(I18N_ES_DEST, 'clients', clientSlug);

    console.log(`Client: ${CLIENT_NAMES[client] || client}`);

    // Client category metadata
    ensureDir(clientDestDir);
    writeFileSync(join(clientDestDir, '_category_.json'), JSON.stringify({
      label: CLIENT_NAMES[client] || client,
    }, null, 2));

    // Helper to write _category_.json with unique key
    function writeClientCategory(subDir, label, position) {
      const key = `${clientSlug}-${subDir.replace(/\//g, '-')}`;
      const catData = JSON.stringify({ label, key, position }, null, 2);
      for (const base of [clientDestDir, clientEsDestDir]) {
        const catFile = join(base, subDir, '_category_.json');
        ensureDir(dirname(catFile));
        writeFileSync(catFile, catData);
      }
    }

    // README as index (create placeholder if missing)
    const readmeSrc = join(clientDir, 'README.md');
    if (existsSync(readmeSrc)) {
      processFile(readmeSrc, join(clientDestDir, 'index.md'), { sidebarPosition: 1 });
    } else {
      const placeholder = `---\ntitle: "${CLIENT_NAMES[client] || client}"\nsidebar_position: 1\n---\n\n# ${CLIENT_NAMES[client] || client}\n\nClient load testing scenarios and configuration.\n`;
      ensureDir(clientDestDir);
      writeFileSync(join(clientDestDir, 'index.md'), placeholder);
      console.log(`  EN: (placeholder) docs/clients/${clientSlug}/index.md`);
    }
    processFile(join(clientDir, 'README.es.md'), join(clientEsDestDir, 'index.md'), { sidebarPosition: 1, isEs: true });

    // CHANGELOG
    if (existsSync(join(clientDir, 'CHANGELOG.md'))) {
      processFile(join(clientDir, 'CHANGELOG.md'), join(clientDestDir, 'changelog.md'), { sidebarPosition: 99 });
    }

    // MIGRATION
    if (existsSync(join(clientDir, 'MIGRATION.md'))) {
      processFile(join(clientDir, 'MIGRATION.md'), join(clientDestDir, 'migration.md'), { sidebarPosition: 98 });
    }

    // docs/ subdirectory
    const clientDocsDir = join(clientDir, 'docs');
    if (existsSync(clientDocsDir)) {
      writeClientCategory('docs', 'Documentation', 10);
      const docFiles = findMarkdownFiles(clientDocsDir);
      let pos = 10;
      for (const { fullPath, relativePath } of docFiles) {
        // Rename docs/README.md to docs/overview.md to avoid collision with client index
        const destName = relativePath === 'README.md'
          ? 'overview.md'
          : relativePath.toLowerCase().replace(/\s+/g, '-');
        processFile(fullPath, join(clientDestDir, 'docs', destName), { sidebarPosition: pos++ });
        const esPath = fullPath.replace(/\.md$/, '.es.md');
        if (existsSync(esPath)) {
          processFile(esPath, join(clientEsDestDir, 'docs', destName), { sidebarPosition: pos - 1, isEs: true });
        }
      }
    }

    // lib/ markdown files
    const clientLibDir = join(clientDir, 'lib');
    if (existsSync(clientLibDir)) {
      const libDocs = findMarkdownFiles(clientLibDir);
      if (libDocs.length > 0) {
        writeClientCategory('lib', 'Library', 20);
        const hasServices = libDocs.some(f => f.relativePath.startsWith('services/'));
        const hasHelpers = libDocs.some(f => f.relativePath.startsWith('helpers/'));
        if (hasServices) writeClientCategory('lib/services', 'Services', 10);
        if (hasHelpers) writeClientCategory('lib/helpers', 'Helpers', 5);

        let pos = 20;
        for (const { fullPath, relativePath } of libDocs) {
          const destName = relativePath.toLowerCase().replace(/\s+/g, '-');
          processFile(fullPath, join(clientDestDir, 'lib', destName), { sidebarPosition: pos++ });
        }
      }
    }

    // config/ README
    const configReadme = join(clientDir, 'config', 'README.md');
    if (existsSync(configReadme)) {
      processFile(configReadme, join(clientDestDir, 'configuration.md'), { sidebarPosition: 5 });
    }

    // scenarios/ markdown files
    const clientScenariosDir = join(clientDir, 'scenarios');
    if (existsSync(clientScenariosDir)) {
      const scenarioDocs = findMarkdownFiles(clientScenariosDir);
      if (scenarioDocs.length > 0) {
        writeClientCategory('scenarios', 'Scenarios', 30);
        const subDirs = new Set();
        for (const { relativePath } of scenarioDocs) {
          const parts = relativePath.split('/');
          if (parts.length > 1) {
            let accum = '';
            for (let j = 0; j < parts.length - 1; j++) {
              accum = accum ? `${accum}/${parts[j]}` : parts[j];
              subDirs.add(accum);
            }
          }
        }
        for (const subDir of subDirs) {
          const label = subDir.split('/').pop().toUpperCase() + ' Scenarios';
          writeClientCategory(`scenarios/${subDir}`, label, 10);
        }

        let pos = 30;
        for (const { fullPath, relativePath } of scenarioDocs) {
          const destName = relativePath.toLowerCase().replace(/\s+/g, '-');
          processFile(fullPath, join(clientDestDir, 'scenarios', destName), { sidebarPosition: pos++ });
        }
      }
    }

    console.log('');
  }

  console.log('=== Sync complete! ===');
}

main();
