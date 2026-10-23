---
name: bug-report-from-e2e-failure
description: Use when an E2E test failed because of a real application defect and the user wants a bug report, a backlog item or an issue written from the failure, its video and screenshots.
category: reporting
author: ADK
version: 1.0.0
license: MIT
tier: official
tags: [bug-report, e2e, triage, defects]
toolsets: [e2e, pbi, issues]
---

# Bug report from an E2E failure

Write a bug report a developer can reproduce in minutes, from the evidence ADK recorded.

## 1. Confirm it is a defect

Read the failed test with `e2e_get_test` and watch the video (`e2e_get_video_url`). It is not
an application bug when the script used a stale selector, the test data was missing or the
environment was down. In those cases fix the test or the environment instead and tell the user.

## 2. Gather the facts

- The exact step that failed, the expected result from the test case and what happened instead.
- Environment: base URL, browser, viewport, build or commit when known, run id and test id.
- Evidence: the video link, the screenshot of the failing step, the console and network errors
  visible in the trace.
- Whether it reproduces: rerun once with `e2e_run_test`. Record "always", "intermittent (n of m)"
  or "once".

## 3. Write the report

```
Title: <component>: <what goes wrong> when <condition>

Steps to reproduce
1. ...
2. ...

Expected: ...
Actual: ...

Environment: <url>, <browser>, <build>
Reproducibility: always | intermittent (n of m) | once
Evidence: <video link>, <screenshot>, run <id>, test <id>
Severity: blocker | major | minor | trivial — <one-line reason>
```

- The title names the symptom, not the suspected cause.
- Steps start from a state anyone can reach (logged in as role X, with data Y).
- Severity follows the impact on the user, not the effort to fix it.

## 4. File it

Ask where the report goes. Create a backlog item with `pbi_create` (and `pbi_link` it to the
story the test covers), or an ADK issue with `issues_create`. Creating items in an external
tracker has an external effect, so confirm the destination and the text with the user first.
