# Contributing to the ADK Hub

Pull requests that add or change a skill (`skills/<name>/`) or a plugin entry
(`plugins/<name>.json`) are welcome. The format, the checks and the admission rules are in the
[README](README.md).

- Run `node tools/cli.mjs validate` before opening the pull request.
- Bump `version` in every change to an existing skill.
- Do not edit `index.json`; it is regenerated after merge.
- Changes to `tools/`, the workflows or `categories.json` are made by the maintainers; open an
  issue to propose one.
- ADK itself lives in [lucaseduardocrp/agent-devkit](https://github.com/lucaseduardocrp/agent-devkit)
  and does not accept pull requests; report its bugs there as issues.
