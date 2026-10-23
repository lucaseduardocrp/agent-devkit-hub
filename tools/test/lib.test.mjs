// Run with: npm test --prefix tools
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  checkoutPinned,
  loadHub,
  overviewOf,
  parseFrontmatter,
  validatePluginEntry,
  validateSkill,
  verifyPluginSource,
} from '../lib.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const categories = ['test-design', 'other'];
const body = `\n# Title\n\nA first paragraph that explains what the skill does.\n\n${'Detailed procedure. '.repeat(15)}\n`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function skillDir(name, frontmatter, extra = body) {
  const dir = join(mkdtempSync(join(tmpdir(), 'hub-skill-')), name);
  write(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${extra}`);
  return dir;
}

const fullFrontmatter = (name) =>
  [
    `name: ${name}`,
    'description: Use when the user wants to test something specific.',
    'category: test-design',
    'author: Ana',
    'version: 1.0.0',
    'license: MIT',
    'tags: [qa, "edge-cases"]',
    'toolsets: [testplans]',
  ].join('\n');

const pluginEntry = (overrides = {}) => ({
  name: 'jira-qa',
  description: 'Jira skills and MCP server for QA teams.',
  repo: 'https://github.com/acme/adk-jira',
  sha: 'a'.repeat(40),
  maintainer: 'acme',
  category: 'integrations',
  license: 'MIT',
  version: '1.0.0',
  capabilities: { skills: ['jira-triage'], agents: [], mcpServers: ['jira'], requiresEnv: ['JIRA_TOKEN'] },
  ...overrides,
});

test('front matter supports quoted values and inline lists, and refuses nested keys', () => {
  const parsed = parseFrontmatter('---\nname: a\ndescription: "x: y"\ntags: [a, \'b\']\n---\nbody');
  assert.deepEqual(parsed.fields, { name: 'a', description: 'x: y', tags: ['a', 'b'] });
  assert.equal(parsed.body, 'body');
  assert.match(parseFrontmatter('---\nmetadata:\n  a: b\n---\n').errors[0], /nested/);
  assert.match(parseFrontmatter('no front matter').errors[0], /must start/);
});

test('the overview is the first prose paragraph after the title', () => {
  assert.equal(
    overviewOf('\n# Title\n\n- list\n\nThe **real** paragraph\ncontinues.\n'),
    'The real paragraph continues.',
  );
});

test('a complete hub skill is valid and hashed', () => {
  const { skill, errors } = validateSkill(skillDir('edge-hunter', fullFrontmatter('edge-hunter')), {
    categories,
  });
  assert.deepEqual(errors, []);
  assert.equal(skill.tier, 'community');
  assert.deepEqual(skill.tags, ['qa', 'edge-cases']);
  assert.equal(skill.files.length, 1);
  assert.match(skill.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(skill.overview, 'A first paragraph that explains what the skill does.');
});

test('hub skills must declare their metadata; built-in skills only need a name and a description', () => {
  const minimal = 'name: tiny\ndescription: Use when the user wants something small.';
  const hub = validateSkill(skillDir('tiny', minimal), { categories });
  assert.ok(hub.errors.some((error) => error.startsWith('category')));
  assert.ok(hub.errors.some((error) => error.startsWith('version')));
  assert.deepEqual(validateSkill(skillDir('tiny', minimal), { builtIn: true }).errors, []);
});

test('skill names, unknown fields, toolsets and short bodies are refused', () => {
  const { errors } = validateSkill(
    skillDir('Bad_Name', `${fullFrontmatter('other')}\nhomepage: x\ntoolsets: [nope]`, '\nshort\n'),
    { categories },
  );
  for (const expected of [
    /folder name/,
    /must match the folder/,
    /unknown front matter field "homepage"/,
    /toolsets/,
    /body/,
  ]) {
    assert.ok(
      errors.some((error) => expected.test(error)),
      `missing ${expected}`,
    );
  }
});

test('binaries, hidden files and unknown file types are refused in skills', () => {
  const dir = skillDir('payload', fullFrontmatter('payload'));
  write(join(dir, 'tool.exe'), 'MZ');
  write(join(dir, 'notes.md'), Buffer.from([0x61, 0x00, 0x62]));
  write(join(dir, '.env'), 'SECRET=1');
  const { errors } = validateSkill(dir, { categories });
  assert.ok(errors.some((error) => error.includes('tool.exe') && error.includes('not allowed')));
  assert.ok(errors.some((error) => error.includes('notes.md: binary')));
  assert.ok(errors.some((error) => error.includes('.env: hidden')));
});

test('symbolic links are refused in skills', (t) => {
  const dir = skillDir('linked', fullFrontmatter('linked'));
  try {
    symlinkSync(join(dir, 'SKILL.md'), join(dir, 'copy.md'));
  } catch {
    return t.skip('symbolic links are not available on this system');
  }
  assert.ok(validateSkill(dir, { categories }).errors.some((error) => error.includes('symbolic links')));
});

test('a plugin entry needs an exact SHA, an https repository and declared capabilities', () => {
  const options = { fileName: 'jira-qa.json', categories: ['integrations'] };
  assert.deepEqual(validatePluginEntry(pluginEntry(), options), []);
  const errors = validatePluginEntry(
    pluginEntry({ sha: 'main', repo: 'http://example.com/a/b', subdir: '../x', tier: 'gold', extra: 1 }),
    options,
  );
  for (const expected of [/sha must be/, /repo must be/, /subdir/, /tier/, /unknown field "extra"/]) {
    assert.ok(
      errors.some((error) => expected.test(error)),
      `missing ${expected}`,
    );
  }
  const empty = pluginEntry({ capabilities: { skills: [], agents: [], mcpServers: [], requiresEnv: [] } });
  assert.ok(validatePluginEntry(empty, options).some((error) => /at least one/.test(error)));
  assert.ok(
    validatePluginEntry(pluginEntry(), { ...options, fileName: 'other.json' }).some((error) =>
      /named jira-qa.json/.test(error),
    ),
  );
});

test('removed plugins cannot come back under the same name or repository', () => {
  const removed = [
    {
      name: 'evil',
      repo: 'https://github.com/acme/adk-jira',
      reason: 'credential theft',
      date: '2026-10-01',
    },
  ];
  const errors = validatePluginEntry(pluginEntry(), {
    fileName: 'jira-qa.json',
    categories: ['integrations'],
    removed,
  });
  assert.ok(errors.some((error) => /removed from the hub: credential theft/.test(error)));
});

function pluginSource({
  skills = ['jira-triage'],
  mcp = { jira: { command: 'npx', args: ['-y', 'jira-mcp@1.0.0'], env: { JIRA_TOKEN: '${JIRA_TOKEN}' } } },
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-plugin-'));
  write(join(dir, 'adk-plugin.json'), JSON.stringify({ name: 'jira-qa', version: '1.0.0' }));
  for (const skill of skills)
    write(
      join(dir, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: Use when triaging Jira issues for QA.\n---\n${body}`,
    );
  write(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: mcp }));
  return dir;
}

test('a plugin source must ship exactly what its entry declares', () => {
  assert.deepEqual(verifyPluginSource(pluginSource(), pluginEntry()), []);
  const undeclared = verifyPluginSource(
    pluginSource({ skills: ['jira-triage', 'secret-skill'] }),
    pluginEntry(),
  );
  assert.ok(undeclared.some((error) => /capabilities.skills/.test(error)));
  const env = verifyPluginSource(
    pluginSource({ mcp: { jira: { command: 'npx', env: { API_KEY: 'x' } } } }),
    pluginEntry(),
  );
  assert.ok(env.some((error) => /requiresEnv is missing API_KEY/.test(error)));
});

test('a plugin source may not ship compiled binaries or bytecode', () => {
  const dir = pluginSource();
  write(join(dir, 'bin', 'helper'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2]));
  write(join(dir, 'cache.pyc'), 'x');
  const errors = verifyPluginSource(dir, pluginEntry());
  assert.ok(errors.some((error) => error.startsWith('bin/helper')));
  assert.ok(errors.some((error) => error.startsWith('cache.pyc')));
});

test('checkoutPinned fetches exactly the pinned commit', (t) => {
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const origin = mkdtempSync(join(tmpdir(), 'hub-origin-'));
  try {
    git(origin, 'init', '--quiet');
  } catch {
    return t.skip('git is not available');
  }
  write(join(origin, 'file.txt'), 'first');
  git(origin, 'add', '.');
  git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'one');
  const first = git(origin, 'rev-parse', 'HEAD');
  write(join(origin, 'file.txt'), 'second');
  git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-am', 'two');
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');

  const target = mkdtempSync(join(tmpdir(), 'hub-checkout-'));
  checkoutPinned(`file://${origin.replaceAll('\\', '/')}`, first, target);
  assert.equal(git(target, 'show', 'HEAD:file.txt'), 'first');
});

test('the repository hub is valid and builds a sorted index', () => {
  const hub = loadHub(repositoryRoot);
  assert.deepEqual(hub.errors, []);
  const index = buildIndex(repositoryRoot, { commit: 'b'.repeat(40) });
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.commit, 'b'.repeat(40));
  assert.ok(index.skills.every((skill) => skill.path.startsWith('skills/') && !('commit' in skill)));
  const names = index.skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length);
});

test('built-in skills come from an ADK checkout, pinned to their own repository and commit', () => {
  const adk = mkdtempSync(join(tmpdir(), 'hub-adk-'));
  write(join(adk, 'apps', 'Mcp', 'package.json'), '{ "version": "0.3.0" }');
  write(
    join(adk, 'apps', 'Mcp', 'skills', 'adk-basics', 'SKILL.md'),
    `---\nname: adk-basics\ndescription: Use when the user starts with ADK.\n---${body}`,
  );
  const index = buildIndex(repositoryRoot, {
    commit: 'b'.repeat(40),
    adk: { root: adk, commit: 'd'.repeat(40) },
  });
  const [first] = index.skills;
  assert.equal(first.name, 'adk-basics');
  assert.equal(first.tier, 'built-in');
  assert.equal(first.version, '0.3.0');
  assert.equal(first.path, 'apps/Mcp/skills/adk-basics');
  assert.equal(first.repository, 'lucaseduardocrp/agent-devkit');
  assert.equal(first.commit, 'd'.repeat(40));
  assert.throws(
    () => buildIndex(repositoryRoot, { commit: 'b'.repeat(40), adk: { root: adk, commit: 'main' } }),
    /ADK commit/,
  );
  assert.ok(
    loadHub(repositoryRoot, { adk: tmpdir() }).errors.some((error) =>
      /apps\/Mcp\/skills is missing/.test(error),
    ),
  );
});
