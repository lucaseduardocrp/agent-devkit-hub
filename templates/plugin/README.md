# 🔌 my-plugin

> Starter layout of an [ADK Hub](https://github.com/lucaseduardocrp/agent-devkit-hub) plugin.

Copy this folder into **your own repository**, rename everything called `my-*` and delete what the
plugin does not use.

## 📁 Layout

```
my-plugin/
├── adk-plugin.json
├── skills/my-skill/SKILL.md
├── agents/my-agent.md
├── .mcp.json
└── README.md
```

| Path | What it is | Installed by `devkit plugins install` into |
| --- | --- | --- |
| `adk-plugin.json` | Name, version and description. The name must match the hub entry. | — |
| `skills/<name>/SKILL.md` | Skills for the assistant, same format as the hub skills | `<client>/skills/<name>` |
| `agents/<name>.md` | Subagent definitions (Claude Code format) | `.claude/agents/<name>.md` (Claude only) |
| `.mcp.json` | MCP servers the skills rely on (`{ "mcpServers": { ... } }`) | Printed as `claude mcp add` / `codex mcp add` commands for the user to run |

## ✅ Before submitting

- [ ] **Pin exact versions** in `.mcp.json` (`my-service-mcp@1.2.3`, not `@latest`). The pinned
      commit is the whole trust model, and a floating version would let code nobody reviewed run
      on install.
- [ ] **Reference secrets as `${VARIABLE}`** and list every variable in the entry's
      `capabilities.requiresEnv`. Never commit a token.
- [ ] **Disclose behaviour** in this README: every network call, every third party that receives
      data, and every credential the plugin needs (see the section below).
- [ ] **Run the hub check** against your commit, from a clone of the ADK Hub:

  ```bash
  node tools/cli.mjs verify-plugin plugins/my-plugin.json
  ```

- [ ] **Open a pull request** to the ADK Hub adding `plugins/my-plugin.json` with the full
      40-character commit SHA.

## 📝 Disclosure (replace this section)

| Topic | Answer |
| --- | --- |
| Network calls | _Which hosts does the plugin contact, and why?_ |
| Data sent to third parties | _What leaves the user's machine?_ |
| Credentials needed | _Environment variables from `requiresEnv`, and what each one is for_ |
| Shell commands | _Any command the skills or MCP servers run_ |
