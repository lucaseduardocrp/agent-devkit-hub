---
name: test-cases-from-acceptance-criteria
description: Use when the user wants test cases written from a user story, PBI or acceptance criteria, or asks which scenarios, edge cases and negative cases a feature needs before it is tested.
category: test-design
author: ADK
version: 1.0.0
license: MIT
tier: official
tags: [test-cases, acceptance-criteria, boundary-values, bdd]
toolsets: [pbi, testplans]
---

# Test cases from acceptance criteria

Turn a backlog item into a small, complete set of test cases: every acceptance criterion
covered, the risky edges tested, and nothing duplicated.

## 1. Read the source

- In ADK, load the item with `pbi_get` and its discussion with `pbi_comments`. Comments often
  hold decisions that never reached the description.
- List each acceptance criterion as one line. When a criterion is ambiguous (no expected result,
  "should work properly", undefined limits), write the question down and ask the user before
  inventing an answer.

## 2. Derive the scenarios

For each criterion, apply in this order and keep only cases that can fail differently:

1. **Main flow**: the criterion exactly as written.
2. **Equivalence partitions**: one representative per class of input (valid, each kind of
   invalid, empty).
3. **Boundary values**: the limit, one below and one above (lengths, amounts, dates, counts).
4. **States and permissions**: other roles, a disabled or expired entity, a concurrent change.
5. **Negative and recovery**: what the user sees when the operation fails and how they recover.

Mark each case with its criterion so coverage can be checked, and its priority: P1 when a failure
blocks the criterion, P2 for edges, P3 for cosmetic checks.

## 3. Write each case

- **Title**: behaviour and condition, e.g. "Rejects a discount code after its end date".
- **Preconditions**: data and role needed, created by the test itself where possible.
- **Steps**: one action per step, written for someone who has never seen the feature.
- **Expected result** for every step that changes what the user sees.
- Use Given/When/Then only if the team already does.

## 4. Save in ADK

Show the list to the user first. When they agree, save the cases in a test plan with
`testplans_prepare` and `testplans_save`, or create a suite with `testplans_create_suite`.
Publish to the test-management tool only when asked (`testplans_push_suite`).

## Checks before finishing

- Every acceptance criterion has at least one P1 case.
- No two cases differ only in data that falls in the same partition.
- Open questions are listed separately, not hidden inside steps.
