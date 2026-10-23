#!/usr/bin/env node
// ADK Hub tools. Run from the repository root:
//   node tools/cli.mjs validate [--adk DIR]             Check every skill and plugin entry
//   node tools/cli.mjs build [--commit SHA] [--out index.json] [--if-changed]
//                            [--adk DIR [--adk-commit SHA]]
//                                                       Generate the index read by devkit and the website
//   node tools/cli.mjs verify-plugin plugins/<name>.json [...]
//                                                       Fetch each plugin at its pinned commit and check it
// --adk points at a checkout of the ADK repository so its built-in skills (apps/Mcp/skills) are
// validated and listed too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildIndex, checkoutPinned, loadHub, validatePluginEntry, verifyPluginSource } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    commit: { type: 'string' },
    out: { type: 'string' },
    repository: { type: 'string' },
    'if-changed': { type: 'boolean' },
    adk: { type: 'string' },
    'adk-commit': { type: 'string' },
  },
});
const adk = values.adk ? resolve(values.adk) : undefined;
const [command, ...files] = positionals;

/** The index content apart from the commit it points at and the date. */
const sameContent = (a, b) => {
  const strip = ({ commit: _commit, generatedAt: _generatedAt, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
};

/** False when the commit no longer exists here (e.g. history was rewritten), so the index must move. */
function isKnownCommit(directory, sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: directory, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function report(problems) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exitCode = 1;
}

switch (command) {
  case 'validate': {
    const hub = loadHub(root, { adk });
    if (hub.errors.length) report(hub.errors);
    else console.log(`ok: ${hub.skills.length} skills and ${hub.plugins.length} plugins are valid`);
    break;
  }
  case 'build': {
    const index = buildIndex(root, {
      ...(values.commit ? { commit: values.commit } : {}),
      ...(values.repository ? { repository: values.repository } : {}),
      ...(adk ? { adk: { root: adk, ...(values['adk-commit'] ? { commit: values['adk-commit'] } : {}) } } : {}),
    });
    const out = resolve(values.out ?? join(root, 'index.json'));
    if (values['if-changed'] && existsSync(out)) {
      const previous = JSON.parse(readFileSync(out, 'utf8'));
      if (sameContent(previous, index) && isKnownCommit(root, previous.commit)) {
        console.log(`unchanged: ${out} already lists this content at ${String(previous.commit).slice(0, 12)}`);
        break;
      }
    }
    writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`wrote ${out}: ${index.skills.length} skills, ${index.plugins.length} plugins at ${index.commit.slice(0, 12)}`);
    break;
  }
  case 'verify-plugin': {
    const hub = loadHub(root);
    const categories = hub.categories.plugins.map((category) => category.id);
    for (const file of files) {
      const entry = JSON.parse(readFileSync(resolve(file), 'utf8'));
      const structural = validatePluginEntry(entry, { fileName: basename(file), categories, removed: hub.removed });
      if (structural.length) {
        report(structural.map((problem) => `${file}: ${problem}`));
        continue;
      }
      const workdir = mkdtempSync(join(tmpdir(), 'adk-hub-plugin-'));
      try {
        checkoutPinned(entry.repo, entry.sha, workdir);
        const problems = verifyPluginSource(join(workdir, entry.subdir ?? ''), entry, {
          categories: hub.categories.skills.map((category) => category.id),
        });
        if (problems.length) report(problems.map((problem) => `${file}: ${problem}`));
        else console.log(`ok: ${entry.name} at ${entry.sha.slice(0, 12)}`);
      } catch (error) {
        report([`${file}: could not fetch ${entry.repo} at ${entry.sha} (${error.message.split('\n')[0]})`]);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    }
    break;
  }
  default:
    console.error('Usage: node tools/cli.mjs validate [--adk DIR] | build [--commit SHA] [--out FILE] [--if-changed] [--adk DIR [--adk-commit SHA]] | verify-plugin FILE...');
    process.exitCode = 1;
}
