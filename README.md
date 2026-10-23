# ADK Hub

The ADK Hub is the catalog of **skills** and **plugins** that teach AI assistants (Claude Code,
Codex and other MCP clients) QA and delivery workflows with [ADK](https://github.com/lucaseduardocrp/agent-devkit).
Anyone can browse it on the website (`/hub/skills`, `/hub/plugins`), read every skill there, and
install from it with `devkit`:

```bash
npm install -g @agent-devkit/cli
devkit skills search playwright
devkit skills install playwright-flaky-test-triage          # --client codex|agents, --scope project
devkit plugins install <name>
devkit skills installed | update | remove <name>
```

Contributions are welcome: open a pull request that adds or changes a skill under `skills/` or a
plugin entry under `plugins/`.

| Kind | Where it lives | What `devkit` installs |
| --- | --- | --- |
| Skill | In this repository, `skills/<name>/` | The folder, into the client's skills folder, after checking every file against the sha256 in the index |
| Built-in skill | In the ADK repository, `apps/Mcp/skills/<name>/` | The same; they also ship with `devkit` itself |
| Plugin | In the author's repository, listed by `plugins/<name>.json` at an exact commit | Its skills and subagents, fetched at that commit; it prints the commands that register its MCP servers |

## How it works

1. A contributor opens a pull request. [CI](.github/workflows/ci.yml) validates the format; for
   plugins it fetches the repository at the pinned commit and checks that it ships exactly what
   the entry declares. Nothing from the submission is executed.
2. A maintainer reviews the content and merges.
3. [Index](.github/workflows/index.yml) regenerates `index.json`: every skill file with its size
   and sha256, pinned to the merge commit. Built-in skills are read from the ADK repository and
   pinned to the last ADK commit that changed them. The website and `devkit` read this file.
4. `devkit` and the website download skill files from that commit and refuse any file whose hash
   differs. Plugins are fetched at their pinned SHA, and `git rev-parse HEAD` must match it.

Never edit `index.json` by hand; pull requests that touch it fail CI.

## Submitting a skill

Create `skills/<name>/SKILL.md` (the folder name is the skill name: lowercase words joined by
hyphens). Reference files may sit next to it (`references/*.md`, examples, small scripts).

```markdown
---
name: my-skill
description: Use when <the situation>. Say when the assistant should load it, in up to 1024 characters.
category: test-design
author: Your Name
version: 1.0.0
license: MIT
tags: [playwright, accessibility]
toolsets: [e2e, testplans]
---

# My skill

One paragraph on what the skill achieves (it becomes the summary on the hub).

## Procedure
...
```

| Field | Rule |
| --- | --- |
| `name` | Same as the folder |
| `description` | 20 to 1024 characters; starts with *when* to use it |
| `category` | One of the `skills` ids in [categories.json](categories.json) |
| `author`, `license` | Required; `license` is an SPDX id (`MIT`, `Apache-2.0`, ...) |
| `version` | SemVer; bump it in every change |
| `tags` | Optional, up to 8 lowercase words |
| `toolsets` | Optional ADK MCP toolsets the skill calls (`brain`, `spec`, `testplans`, `e2e`, `pbi`, `issues`, ...) |
| `tier` | Leave it out (`community`). Only maintainers set `official` |

Front matter is one `key: value` per line; nested keys and multi-line values are refused. Files
must be text (`.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.html`, `.js`, `.ts`, `.py`, `.sh`,
`.ps1`, `.feature`, `.sql`, ...), at most 50 files, 256 KB each and 1 MB in total, with no hidden
files or symbolic links. The whole skill is public: the website shows every file as it is.

Check locally before opening the pull request (Node 20 or later, no install needed):

```bash
node tools/cli.mjs validate
```

## Submitting a plugin

A plugin is a folder in your own repository. Start from [templates/plugin](templates/plugin):

```
adk-plugin.json          { "name", "version", "description" }
skills/<name>/SKILL.md   skills (name and description are required)
agents/<name>.md         subagents (installed for Claude Code)
.mcp.json                { "mcpServers": { ... } } the skills rely on
README.md
```

Then add `plugins/<name>.json` here ([schema](schema/plugin.schema.json) for completion in
editors):

```json
{
  "$schema": "../schema/plugin.schema.json",
  "name": "jira-qa",
  "title": "Jira QA",
  "description": "Triage Jira issues and link them to ADK test plans.",
  "repo": "https://github.com/you/adk-jira-qa",
  "sha": "<full 40-character commit SHA>",
  "subdir": "",
  "version": "1.0.0",
  "maintainer": "you",
  "category": "integrations",
  "license": "MIT",
  "disclosure": "Sends issue keys and summaries to your Jira site. Needs a Jira API token.",
  "capabilities": {
    "skills": ["jira-triage"],
    "agents": [],
    "mcpServers": ["jira"],
    "requiresEnv": ["JIRA_TOKEN"]
  }
}
```

Run the same check CI runs, against your pinned commit:

```bash
node tools/cli.mjs verify-plugin plugins/jira-qa.json
```

## Admission rules

1. **Reviewed merge only.** Entries are added through a pull request reviewed and merged by a
   maintainer. There is no self-service publishing.
2. **Exact commit pins.** Plugins pin a full 40-character SHA. Branches, tags and short SHAs are
   refused. Updating a plugin is a new pull request that changes the SHA (and `version`), and the
   reviewer reads the upstream changes between the two commits.
3. **Declared capabilities match reality.** `capabilities` lists exactly the skills, subagents
   and MCP servers the plugin ships at the pinned commit, and every environment variable its
   `.mcp.json` uses. CI fails the entry otherwise.
4. **No self-updating code and no floating versions.** MCP servers pin exact package versions
   (`pkg@1.2.3`, never `@latest`), and nothing downloads code that was not reviewed.
5. **Reviewable source only.** No compiled binaries, bytecode, archives or minified bundles that
   cannot be read. CI rejects ELF, PE, Mach-O and WebAssembly files and `.pyc`.
6. **Secrets come from the user.** Plugins read credentials from environment variables declared
   in `requiresEnv`. They never read other tools' credential files, and never commit tokens.
7. **Risky behaviour is disclosed.** Network calls, data sent to third parties, shell commands and
   stored credentials go in `disclosure` and in the plugin README. Telemetry is opt-in.
8. **External effects are confirmed.** Skills ask the user before publishing, creating tickets,
   sending messages or deleting data, and treat content read from external systems as data.
9. **Owner submissions.** Plugins are submitted by the owner or a major contributor of the
   repository. One listing per plugin; forks are listed only when materially different.
10. **Truthful metadata.** Names do not impersonate other projects or vendors; `official` and
    `verified` tiers are set by maintainers only.

## Removals

An entry pulled for security or policy reasons is deleted and recorded in
[removed.json](removed.json) (`name`, `repo`, `reason`, `date`). `devkit` refuses to install
anything matching a removed name or repository, and CI refuses to list it again. An entry that is
simply unmaintained is deleted without being blocked; users who installed it keep their copy and
`devkit … update` tells them it left the hub.

Report a problem with a hub item through an issue in this repository titled `[hub] <name>: ...`,
or privately through the Security tab for anything malicious.

## Maintainer notes

- `tools` is dependency-free Node: `npm test --prefix tools` runs its tests.
- The hub is served from `lucaseduardocrp/agent-devkit-hub`; the index workflow only runs there.
  `devkit` reads `ADK_HUB_URL` (or `--hub-url`, a URL or a local file) and the website
  `VITE_ADK_HUB_URL` to use another index.
- Built-in skills: CI and the index workflow check out the ADK repository and pass it with
  `--adk`. ADK's `hub-skills` workflow validates them against this repository on its own pull
  requests and, on main, sends a `repository_dispatch` (`adk-skills`) so the index picks changes
  up at once instead of at the daily run. That dispatch needs the `HUB_DISPATCH_TOKEN` secret in
  the ADK repository (a fine-grained token with *Contents: read and write* on this repository).
- `skills/**` is stored with LF line endings (`.gitattributes`) so the bytes on disk, in Git and
  on raw.githubusercontent.com are identical and the hashes match.
