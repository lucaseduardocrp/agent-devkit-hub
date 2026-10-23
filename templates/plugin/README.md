# my-plugin

Starter layout of an ADK Hub plugin. Copy this folder into your own repository, rename everything
called `my-*` and delete what the plugin does not use.

| Path | What it is | Installed by `devkit plugins install` into |
| --- | --- | --- |
| `adk-plugin.json` | Name, version and description. The name must match the hub entry. | — |
| `skills/<name>/SKILL.md` | Skills for the assistant, same format as the hub skills | `<client>/skills/<name>` |
| `agents/<name>.md` | Subagent definitions (Claude Code format) | `.claude/agents/<name>.md` (Claude only) |
| `.mcp.json` | MCP servers the skills rely on (`{ "mcpServers": { ... } }`) | Printed as `claude mcp add` / `codex mcp add` commands for the user to run |

## Before submitting

- Pin exact versions in `.mcp.json` (`my-service-mcp@1.2.3`, not `@latest`): the pinned commit is
  the whole trust model, and a floating version would let code nobody reviewed run on install.
- Reference secrets as `${VARIABLE}` and list every variable in the entry's
  `capabilities.requiresEnv`. Never commit a token.
- Describe in this README every network call, every third party that receives data, and every
  credential the plugin needs.
- Run the hub check against your commit from a clone of the ADK Hub:
  `node tools/cli.mjs verify-plugin plugins/my-plugin.json`.
