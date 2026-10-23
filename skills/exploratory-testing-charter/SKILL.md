---
name: exploratory-testing-charter
description: Use when the user wants to plan or run an exploratory testing session, write test charters for a feature or release, or turn session notes into findings and follow-up test cases.
category: test-design
author: ADK
version: 1.0.0
license: MIT
tier: official
tags: [exploratory, session-based, charters, heuristics]
toolsets: [brain, testplans]
---

# Exploratory testing charters

Plan time-boxed exploratory sessions with a clear mission, and turn what was found into actions.

## 1. Write the charters

Use the format **Explore** *target* **with** *resources* **to discover** *information*. Examples:

- Explore the checkout with expired and foreign credit cards to discover payment error handling.
- Explore the report export with 10 000 rows to discover performance and truncation problems.

Base the charters on risk: what changed (the PBI and the spec, from `pbi_get` and `spec_get`),
what broke before (search the Brain with `brain_search`), and what users depend on most. Aim for
three to six charters of 45 to 90 minutes each.

## 2. Heuristics to suggest during the session

- **CRUD** every entity; **Goldilocks** inputs (too small, too big, just right).
- **Interruptions**: back button, refresh, two tabs, lost connection, session expiry.
- **Configurations**: other roles, languages, time zones, small screens.
- **Follow the data**: create something, then find every place it appears.
- **Starve it**: empty lists, missing optional data, slow network.

## 3. Session notes

Keep notes with timestamps in four groups: **bugs**, **issues** (questions, doubts, things that
blocked testing), **ideas** for new tests, and **coverage** (what was actually explored). Note the
share of time spent testing, investigating bugs and setting up.

## 4. Debrief

After the session, summarise for the user:

1. What was covered and what was not, against the charter.
2. Bugs found, each ready to become a report.
3. Ideas worth keeping as regression test cases. Offer to save them in a test plan with
   `testplans_save`.
4. New charters the session suggested.
