// ADK Hub: validation of skills and plugin entries, and generation of index.json.
// Dependency-free so it runs in CI and on a contributor's computer alike.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SCHEMA_VERSION = 1;
export const DEFAULT_REPOSITORY = process.env.GITHUB_REPOSITORY ?? 'lucaseduardocrp/agent-devkit-hub';
/** The ADK repository, home of the built-in skills (apps/Mcp/skills) that ship with devkit. */
export const ADK_REPOSITORY = 'lucaseduardocrp/agent-devkit';

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RANGE_PATTERN = /^>=\d+\.\d+(?:\.\d+)?$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const LICENSE_PATTERN = /^[A-Za-z0-9.+-]{2,40}$/;
const SUBDIR_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export const SKILL_TIERS = ['official', 'community'];
export const PLUGIN_TIERS = ['official', 'verified', 'community'];
export const PLATFORMS = ['linux', 'macos', 'windows'];
/** ADK MCP toolsets (apps/Mcp/src/core/tool.ts) a skill may declare it uses. */
export const TOOLSETS = [
  'account',
  'workspaces',
  'integrations',
  'brain',
  'agents',
  'issues',
  'pbi',
  'spec',
  'testplans',
  'design',
  'e2e',
  'releasenotes',
  'audit',
];

/** Text files a skill may ship. Anything else (binaries, archives, images) is refused. */
const SKILL_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.html',
  '.xml',
  '.js',
  '.mjs',
  '.ts',
  '.py',
  '.sh',
  '.ps1',
  '.feature',
  '.sql',
]);
export const SKILL_LIMITS = { files: 50, fileBytes: 256 * 1024, totalBytes: 1024 * 1024 };
export const PLUGIN_LIMITS = { totalBytes: 20 * 1024 * 1024 };

const SKILL_FIELDS = new Set([
  'name',
  'description',
  'category',
  'author',
  'version',
  'license',
  'tier',
  'tags',
  'toolsets',
]);
const PLUGIN_FIELDS = new Set([
  '$schema',
  'name',
  'title',
  'description',
  'repo',
  'sha',
  'subdir',
  'version',
  'maintainer',
  'tier',
  'category',
  'license',
  'homepage',
  'image',
  'platforms',
  'requiresDevkit',
  'capabilities',
  'disclosure',
]);
const CAPABILITY_FIELDS = ['skills', 'agents', 'mcpServers', 'requiresEnv'];

/**
 * Parses the YAML front matter of a SKILL.md: one `key: value` per line, quoted strings and
 * inline lists (`[a, b]`). Nested keys and multi-line values are refused so every tool that
 * reads skills (this one, the MCP server, the assistants) sees the same fields.
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match)
    return { fields: null, body: text, errors: ['SKILL.md must start with a --- front matter block'] };
  const fields = {};
  const errors = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      errors.push(`front matter: nested or multi-line values are not supported ("${line.trim()}")`);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      errors.push(`front matter: expected "key: value", got "${line}"`);
      continue;
    }
    fields[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1).trim());
  }
  return { fields, body: text.slice(match[0].length), errors };
}

function parseValue(raw) {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => unquote(item.trim())) : [];
  }
  return unquote(raw);
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** First paragraph of the body after the title, for cards and search results. */
export function overviewOf(body) {
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((block) => block.trim());
  const paragraph = paragraphs.find((block) => block && !/^(#|```|[-*>|]|\d+\.)/.test(block)) ?? '';
  const text = paragraph.replace(/\s+/g, ' ').replace(/[*_`]/g, '');
  return text.length > 280 ? `${text.slice(0, 277).trimEnd()}…` : text;
}

const toPosix = (path) => path.split(sep).join('/');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Lists every file under `directory` with its hash, refusing symlinks, hidden files and
 * anything that is not reviewable text. Returns the files and the problems found.
 */
export function readTree(directory, { extensions = SKILL_EXTENSIONS, limits = SKILL_LIMITS } = {}) {
  const files = [];
  const errors = [];
  let total = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      const shown = toPosix(relative(directory, path));
      if (lstatSync(path).isSymbolicLink()) {
        errors.push(`${shown}: symbolic links are not allowed`);
        continue;
      }
      if (entry.name.startsWith('.')) {
        errors.push(`${shown}: hidden files and folders are not allowed`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const extension = entry.name.includes('.')
        ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
        : '';
      const content = readFileSync(path);
      total += content.length;
      if (!extensions.has(extension))
        errors.push(`${shown}: file type "${extension || 'none'}" is not allowed`);
      else if (content.includes(0)) errors.push(`${shown}: binary content is not allowed`);
      if (content.length > limits.fileBytes)
        errors.push(`${shown}: larger than ${limits.fileBytes / 1024} KB`);
      files.push({ path: shown, size: content.length, sha256: sha256(content) });
    }
  };
  walk(directory);
  if (files.length > limits.files) errors.push(`more than ${limits.files} files`);
  if (total > limits.totalBytes) errors.push(`larger than ${limits.totalBytes / 1024} KB in total`);
  return { files, errors };
}

/**
 * Validates one skill folder. `builtIn` skills (apps/Mcp/skills) only need a name and a
 * description; hub skills must declare the full metadata shown on the hub.
 */
export function validateSkill(directory, { builtIn = false, categories = [], lenient = false } = {}) {
  const folder = directory.split(/[\\/]/).filter(Boolean).at(-1);
  const errors = [];
  const skillFile = join(directory, 'SKILL.md');
  if (!NAME_PATTERN.test(folder) || folder.length > 64) {
    errors.push(`folder name "${folder}" must be lowercase words joined by hyphens (max 64 characters)`);
  }
  if (!existsSync(skillFile)) return { skill: null, errors: [...errors, 'SKILL.md is missing'] };

  const text = readFileSync(skillFile, 'utf8');
  const { fields, body, errors: parseErrors } = parseFrontmatter(text);
  errors.push(...parseErrors);
  if (!fields) return { skill: null, errors };

  const string = (key) => (typeof fields[key] === 'string' ? fields[key].trim() : '');
  const list = (key) => (Array.isArray(fields[key]) ? fields[key] : fields[key] === undefined ? [] : null);

  if (string('name') !== folder) errors.push(`name must match the folder name "${folder}"`);
  const description = string('description');
  if (description.length < 20 || description.length > 1024) {
    errors.push('description must say when to use the skill in 20 to 1024 characters');
  }
  if (body.trim().length < 200) errors.push('the body must explain the procedure (at least 200 characters)');

  const strict = !builtIn && !lenient;
  if (strict) {
    for (const key of Object.keys(fields)) {
      if (!SKILL_FIELDS.has(key)) errors.push(`unknown front matter field "${key}"`);
    }
    if (!categories.includes(string('category'))) {
      errors.push(`category must be one of: ${categories.join(', ')}`);
    }
    if (!string('author')) errors.push('author is required');
    if (!SEMVER_PATTERN.test(string('version'))) errors.push('version must be SemVer, e.g. 1.0.0');
    if (!LICENSE_PATTERN.test(string('license'))) errors.push('license must be an SPDX identifier, e.g. MIT');
    if (fields['tier'] !== undefined && !SKILL_TIERS.includes(string('tier'))) {
      errors.push(`tier must be one of: ${SKILL_TIERS.join(', ')}`);
    }
  }
  const tags = list('tags');
  if (tags === null || tags.length > 8 || tags.some((tag) => !TAG_PATTERN.test(tag))) {
    errors.push('tags must be a list of up to 8 lowercase words, e.g. [playwright, flaky]');
  }
  const toolsets = list('toolsets');
  if (toolsets === null || toolsets.some((toolset) => !TOOLSETS.includes(toolset))) {
    errors.push(`toolsets must be a list of ADK toolsets: ${TOOLSETS.join(', ')}`);
  }

  const tree = readTree(directory);
  errors.push(...tree.errors);

  return {
    errors,
    skill: {
      name: folder,
      description,
      overview: overviewOf(body),
      category: builtIn ? 'adk' : string('category') || 'other',
      tags: tags ?? [],
      toolsets: toolsets ?? [],
      author: builtIn ? 'ADK' : string('author'),
      version: builtIn ? '' : string('version'),
      license: builtIn ? 'AGPL-3.0-only' : string('license'),
      tier: builtIn ? 'built-in' : string('tier') || 'community',
      files: tree.files,
    },
  };
}

function isHttpsUrl(value, hosts) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    return !hosts || hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

const REPO_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org'];
const IMAGE_HOSTS = ['github.com', 'githubusercontent.com'];

/** Validates one hub/plugins/<name>.json entry (structure only; the source is checked by verifyPluginSource). */
export function validatePluginEntry(entry, { fileName, categories = [], removed = [] } = {}) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['the entry must be a JSON object'];
  for (const key of Object.keys(entry)) {
    if (!PLUGIN_FIELDS.has(key)) errors.push(`unknown field "${key}"`);
  }
  const text = (key) => (typeof entry[key] === 'string' ? entry[key].trim() : '');
  const name = text('name');

  if (!NAME_PATTERN.test(name) || name.length > 64)
    errors.push('name must be lowercase words joined by hyphens (max 64 characters)');
  if (fileName && fileName !== `${name}.json`) errors.push(`the file must be named ${name}.json`);
  if (entry.title !== undefined && (!text('title') || text('title').length > 60))
    errors.push('title must have 1 to 60 characters');
  if (text('description').length < 20 || text('description').length > 600)
    errors.push('description must have 20 to 600 characters');
  if (
    !isHttpsUrl(text('repo'), REPO_HOSTS) ||
    !/^https:\/\/[^/]+\/[^/]+\/[^/]+$/.test(text('repo').replace(/\.git$/, ''))
  ) {
    errors.push(`repo must be an https URL of a repository on ${REPO_HOSTS.join(', ')}`);
  }
  if (!SHA_PATTERN.test(text('sha')))
    errors.push('sha must be a full 40-character commit SHA (branches and tags are not accepted)');
  if (
    entry.subdir !== undefined &&
    entry.subdir !== '' &&
    !text('subdir')
      .split('/')
      .every((segment) => SUBDIR_SEGMENT.test(segment) && segment !== '..')
  ) {
    errors.push('subdir must be a plain relative path inside the repository');
  }
  if (entry.version !== undefined && !SEMVER_PATTERN.test(text('version')))
    errors.push('version must be SemVer, e.g. 1.0.0');
  if (!text('maintainer')) errors.push('maintainer is required');
  if (!PLUGIN_TIERS.includes(entry.tier ?? 'community'))
    errors.push(`tier must be one of: ${PLUGIN_TIERS.join(', ')}`);
  if (!categories.includes(text('category')))
    errors.push(`category must be one of: ${categories.join(', ')}`);
  if (!LICENSE_PATTERN.test(text('license'))) errors.push('license must be an SPDX identifier, e.g. MIT');
  if (entry.homepage !== undefined && !isHttpsUrl(text('homepage')))
    errors.push('homepage must be an https URL');
  if (entry.image !== undefined && !isHttpsUrl(text('image'), IMAGE_HOSTS))
    errors.push(`image must be an https URL on ${IMAGE_HOSTS.join(' or ')}`);
  if (
    entry.platforms !== undefined &&
    (!Array.isArray(entry.platforms) || entry.platforms.some((platform) => !PLATFORMS.includes(platform)))
  ) {
    errors.push(`platforms must be a list of: ${PLATFORMS.join(', ')}`);
  }
  if (entry.requiresDevkit !== undefined && !RANGE_PATTERN.test(text('requiresDevkit')))
    errors.push('requiresDevkit must be a floor such as ">=0.2.0"');
  if (
    entry.disclosure !== undefined &&
    (typeof entry.disclosure !== 'string' || entry.disclosure.length > 1000)
  ) {
    errors.push('disclosure must be a string of up to 1000 characters');
  }

  const capabilities = entry.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    errors.push(`capabilities must be an object with ${CAPABILITY_FIELDS.join(', ')}`);
  } else {
    for (const key of Object.keys(capabilities)) {
      if (!CAPABILITY_FIELDS.includes(key)) errors.push(`unknown capability "${key}"`);
    }
    for (const key of CAPABILITY_FIELDS) {
      const values = capabilities[key];
      const pattern = key === 'requiresEnv' ? ENV_PATTERN : NAME_PATTERN;
      if (
        !Array.isArray(values) ||
        values.some((value) => typeof value !== 'string' || !pattern.test(value))
      ) {
        errors.push(
          `capabilities.${key} must be a list of ${key === 'requiresEnv' ? 'UPPER_CASE variable names' : 'lowercase names'}`,
        );
      }
    }
    if (
      CAPABILITY_FIELDS.slice(0, 3).every(
        (key) => Array.isArray(capabilities[key]) && capabilities[key].length === 0,
      )
    ) {
      errors.push('a plugin must provide at least one skill, agent or MCP server');
    }
  }

  const repo = text('repo')
    .replace(/\.git$/, '')
    .toLowerCase();
  const blocked = removed.find(
    (item) => item.name === name || (item.repo && item.repo.replace(/\.git$/, '').toLowerCase() === repo),
  );
  if (blocked) errors.push(`"${blocked.name}" was removed from the hub: ${blocked.reason}`);
  return errors;
}

const BINARY_SIGNATURES = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // PE / MZ
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal / Java class
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
];

function isExecutablePayload(path, content) {
  if (/\.py[co]$/i.test(path)) return true;
  return BINARY_SIGNATURES.some((signature) => signature.every((byte, index) => content[index] === byte));
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Checks a plugin checked out at its pinned commit: the manifest matches the entry, the declared
 * capabilities match what the package really ships, and there is nothing that cannot be reviewed.
 */
export function verifyPluginSource(directory, entry, { categories = [] } = {}) {
  const errors = [];
  const manifestPath = join(directory, 'adk-plugin.json');
  if (!existsSync(manifestPath)) return ['adk-plugin.json is missing at the plugin root'];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return [`adk-plugin.json is not valid JSON: ${error.message}`];
  }
  if (manifest.name !== entry.name)
    errors.push(`adk-plugin.json name "${manifest.name}" does not match the entry "${entry.name}"`);
  if (entry.version && manifest.version !== entry.version) {
    errors.push(`adk-plugin.json version "${manifest.version}" does not match the entry "${entry.version}"`);
  }

  const declared = entry.capabilities ?? {};
  const skillsDir = join(directory, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
    : [];
  for (const skill of skills) {
    const result = validateSkill(join(skillsDir, skill), { lenient: true, categories });
    errors.push(...result.errors.map((error) => `skills/${skill}: ${error}`));
  }
  if (!sameSet(skills, declared.skills ?? [])) {
    errors.push(
      `capabilities.skills [${(declared.skills ?? []).join(', ')}] does not match skills/ [${skills.join(', ')}]`,
    );
  }

  const agentsDir = join(directory, 'agents');
  const agents = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.slice(0, -3))
    : [];
  if (!sameSet(agents, declared.agents ?? [])) {
    errors.push(
      `capabilities.agents [${(declared.agents ?? []).join(', ')}] does not match agents/ [${agents.join(', ')}]`,
    );
  }

  const mcpPath = join(directory, '.mcp.json');
  let servers = {};
  if (existsSync(mcpPath)) {
    try {
      servers = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers ?? {};
    } catch (error) {
      errors.push(`.mcp.json is not valid JSON: ${error.message}`);
    }
  }
  if (!sameSet(Object.keys(servers), declared.mcpServers ?? [])) {
    errors.push(
      `capabilities.mcpServers [${(declared.mcpServers ?? []).join(', ')}] does not match .mcp.json [${Object.keys(servers).join(', ')}]`,
    );
  }
  for (const [id, server] of Object.entries(servers)) {
    if (server.url !== undefined && !isHttpsUrl(server.url))
      errors.push(`.mcp.json ${id}: url must be https`);
    if (server.url === undefined && typeof server.command !== 'string')
      errors.push(`.mcp.json ${id}: needs a command or an https url`);
  }
  const referenced = new Set(
    JSON.stringify(servers)
      .match(/\$\{([A-Z][A-Z0-9_]*)\}/g)
      ?.map((match) => match.slice(2, -1)),
  );
  for (const variable of Object.values(servers).flatMap((server) => Object.keys(server.env ?? {})))
    referenced.add(variable);
  const missingEnv = [...referenced].filter((variable) => !(declared.requiresEnv ?? []).includes(variable));
  if (missingEnv.length)
    errors.push(`capabilities.requiresEnv is missing ${missingEnv.join(', ')} used by .mcp.json`);

  let total = 0;
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      if (item.name === '.git') continue;
      const path = join(current, item.name);
      const shown = toPosix(relative(directory, path));
      if (lstatSync(path).isSymbolicLink()) {
        errors.push(`${shown}: symbolic links are not allowed`);
      } else if (item.isDirectory()) {
        walk(path);
      } else {
        const content = readFileSync(path);
        total += content.length;
        if (isExecutablePayload(shown, content))
          errors.push(`${shown}: compiled binaries and bytecode are not allowed`);
      }
    }
  };
  walk(directory);
  if (total > PLUGIN_LIMITS.totalBytes)
    errors.push(`the plugin is larger than ${PLUGIN_LIMITS.totalBytes / 1024 / 1024} MB`);
  return errors;
}

/** Fetches exactly `sha` of `repo` into `directory` (an empty folder) without running any of its code. */
export function checkoutPinned(repo, sha, directory) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  git('init', '--quiet');
  git('-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet', '--depth', '1', repo, sha);
  git('-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
  const head = git('rev-parse', 'HEAD');
  if (head !== sha) throw new Error(`checked out ${head}, expected ${sha}`);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const subfolders = (path) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort()
    : [];

/**
 * Reads and validates everything in the hub. `errors` lists every problem as "path: message".
 * `adk` is a checkout of the ADK repository; when given, its built-in skills are listed too.
 */
export function loadHub(root, { adk } = {}) {
  const categories = readJson(join(root, 'categories.json'));
  const skillCategories = categories.skills.map((category) => category.id);
  const pluginCategories = categories.plugins.map((category) => category.id);
  const removed = readJson(join(root, 'removed.json'));
  const errors = [];
  const skills = [];

  // Built-in skills ship with devkit (`devkit install-skills`) and carry its version.
  if (adk) {
    const builtInRoot = join(adk, 'apps', 'Mcp', 'skills');
    const mcpPackage = join(adk, 'apps', 'Mcp', 'package.json');
    const builtInVersion = existsSync(mcpPackage) ? readJson(mcpPackage).version : '';
    if (!existsSync(builtInRoot))
      errors.push(`${adk}: apps/Mcp/skills is missing; is it a checkout of ${ADK_REPOSITORY}?`);
    for (const folder of subfolders(builtInRoot)) {
      const result = validateSkill(join(builtInRoot, folder), { builtIn: true });
      errors.push(...result.errors.map((error) => `apps/Mcp/skills/${folder}: ${error}`));
      if (result.skill)
        skills.push({ ...result.skill, version: builtInVersion, path: `apps/Mcp/skills/${folder}` });
    }
  }
  for (const folder of subfolders(join(root, 'skills'))) {
    const result = validateSkill(join(root, 'skills', folder), { categories: skillCategories });
    errors.push(...result.errors.map((error) => `skills/${folder}: ${error}`));
    if (result.skill) skills.push({ ...result.skill, path: `skills/${folder}` });
  }
  const seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.name)) errors.push(`${skill.path}: another skill is already named "${skill.name}"`);
    seen.add(skill.name);
    if (removed.some((item) => item.name === skill.name))
      errors.push(`${skill.path}: "${skill.name}" was removed from the hub`);
  }

  const plugins = [];
  const pluginsDir = join(root, 'plugins');
  const pluginFiles = existsSync(pluginsDir)
    ? readdirSync(pluginsDir)
        .filter((file) => !file.startsWith('.'))
        .sort()
    : [];
  for (const file of pluginFiles) {
    if (!file.endsWith('.json')) {
      errors.push(`plugins/${file}: only <name>.json entries belong here`);
      continue;
    }
    let entry;
    try {
      entry = readJson(join(pluginsDir, file));
    } catch (error) {
      errors.push(`plugins/${file}: not valid JSON (${error.message})`);
      continue;
    }
    const entryErrors = validatePluginEntry(entry, { fileName: file, categories: pluginCategories, removed });
    errors.push(...entryErrors.map((error) => `plugins/${file}: ${error}`));
    if (!entryErrors.length) plugins.push(normalizePlugin(entry));
  }
  return { skills, plugins, removed, categories, errors };
}

function normalizePlugin(entry) {
  const { $schema: _schema, ...rest } = entry;
  return {
    ...rest,
    repo: entry.repo.replace(/\.git$/, ''),
    title: entry.title ?? entry.name,
    tier: entry.tier ?? 'community',
    subdir: entry.subdir ?? '',
    platforms: entry.platforms ?? [],
    capabilities: Object.fromEntries(CAPABILITY_FIELDS.map((key) => [key, entry.capabilities[key]])),
  };
}

function gitOutput(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Builds the index the CLI and the website read. Files are fetched by the CLI at `commit`, so
 * the index must be generated from a commit that contains them (CI passes GITHUB_SHA).
 *
 * Built-in skills live in the ADK repository (`adk.root` is a checkout of it) and carry their
 * own `repository` and `commit`: by default the last ADK commit that changed them, so the index
 * only moves when they do.
 */
export function buildIndex(root, { commit, repository = DEFAULT_REPOSITORY, adk } = {}) {
  const hub = loadHub(root, { adk: adk?.root });
  if (hub.errors.length) {
    const error = new Error(
      `The hub has ${hub.errors.length} problem(s):\n${hub.errors.map((item) => `  - ${item}`).join('\n')}`,
    );
    error.problems = hub.errors;
    throw error;
  }
  const resolved = commit ?? gitOutput(root, ['rev-parse', 'HEAD']);
  const generatedAt = gitOutput(root, ['show', '-s', '--format=%cI', resolved]) || new Date().toISOString();
  const adkSource = adk && {
    repository: adk.repository ?? ADK_REPOSITORY,
    commit:
      adk.commit ??
      gitOutput(adk.root, ['log', '-1', '--format=%H', '--', 'apps/Mcp/skills', 'apps/Mcp/package.json']),
  };
  if (adkSource && !SHA_PATTERN.test(adkSource.commit)) {
    throw new Error(
      `Could not tell which ADK commit the built-in skills come from ("${adkSource.commit}"); pass --adk-commit.`,
    );
  }
  const skills = hub.skills.map((skill) => (skill.tier === 'built-in' ? { ...skill, ...adkSource } : skill));
  const tierRank = { 'built-in': 0, official: 1, verified: 2, community: 3 };
  const byTier = (a, b) => tierRank[a.tier] - tierRank[b.tier] || a.name.localeCompare(b.name);
  return {
    schemaVersion: SCHEMA_VERSION,
    repository,
    commit: resolved,
    generatedAt,
    categories: hub.categories,
    skills: skills.sort(byTier),
    plugins: hub.plugins.sort(byTier),
    removed: hub.removed,
  };
}
