---
name: playwright-flaky-test-triage
description: Use when a Playwright end-to-end test passes and fails without code changes, when the user asks why an E2E test is flaky, or before quarantining or deleting an unstable test.
category: e2e-automation
author: ADK
version: 1.0.0
license: MIT
tier: official
tags: [playwright, flaky, e2e, debugging]
toolsets: [e2e]
---

# Playwright flaky test triage

Find the real cause of an intermittent Playwright failure and fix it in the test or in the
application, instead of adding retries or longer timeouts that hide the problem.

## 1. Collect the evidence

- In ADK, list the run with `e2e_get { creationId }` and read the failed test with
  `e2e_get_test`. Open the script with `e2e_get_script` and the video with `e2e_get_video_url`.
- Locally, run the test many times in isolation and in the suite:
  `npx playwright test path/to.spec.ts --repeat-each=20 --workers=1`, then the same with the
  default workers. A failure only under parallel workers points to shared state.
- Keep the trace of a failing attempt (`--trace=retain-on-failure`) and compare it with a passing
  one. Look at the last action before the failure and at the network requests still pending.

## 2. Classify the cause

| Signal in the trace | Likely cause | Fix |
| --- | --- | --- |
| Action on an element that re-rendered or was still animating | Race with the UI | Web-first assertions (`await expect(locator).toBeVisible()`), locators by role or test id |
| `waitForTimeout`, fixed sleeps | Timing guess | Wait for the condition: a response (`page.waitForResponse`), a URL, a visible state |
| Fails only after another test | Shared data or order dependence | Create the test's own data, isolate storage state, never depend on test order |
| Fails only in CI or on the ADK worker | Environment | Viewport, timezone, locale, slower CPU, missing seed data, feature flags |
| Assertion on dates, random ids, sorting | Non-deterministic data | Freeze the clock (`page.clock`), assert on stable fields, sort before comparing |
| Third-party script, ads, chat widget | External dependency | Route and stub the request (`page.route`) |

## 3. Fix and prove it

1. Change one thing at a time and rerun with `--repeat-each=20`. A fix is proven only when the
   repeated run is fully green, in parallel as well as alone.
2. When the bug is in the application (a real race the user can hit), stop and report it as a
   bug with the trace attached instead of making the test tolerate it.
3. Update the script in ADK with `e2e_update_script` so the stored script matches the fix, and
   rerun the test there with `e2e_run_test`.

## Rules

- Do not raise global timeouts or add `test.retry` to make a test pass. Retries are for
  reporting flakiness, not for hiding it.
- Do not use `force: true` on clicks unless the element is intentionally covered.
- If the cause cannot be found in the time available, quarantine the test with
  `test.fixme()` and a comment that links the investigation, and tell the user.
