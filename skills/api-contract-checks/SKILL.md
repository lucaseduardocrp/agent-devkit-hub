---
name: api-contract-checks
description: Use when the user wants test scenarios or automated checks for a REST API from an OpenAPI document, a route list or example requests, including status codes, schemas, authentication, pagination and idempotency.
category: api-testing
author: ADK
version: 1.0.0
license: MIT
tier: official
tags: [api, openapi, rest, contract]
toolsets: [testplans, e2e]
---

# API contract checks

Design API tests that catch the breaking changes and security gaps unit tests miss.

## 1. Build the inventory

From the OpenAPI document (or the routes and examples the user gives), list each operation with
its method, path, authentication, request schema, success status and documented errors. Flag
operations with no documented errors or no schema: they are the first questions for the team.

## 2. Checks per operation

| Area | What to check |
| --- | --- |
| Contract | Success status and response body match the schema: required fields, types, enums, formats, no unexpected nulls |
| Validation | Missing required field, wrong type, value out of range, unknown field: 400 or 422 with a useful message, never 500 |
| Authentication | No token, expired token, malformed token: 401 |
| Authorization | Valid user without permission, another tenant's resource id: 403 or 404, and no data leak in the body |
| Not found | Unknown id: 404 with the documented error format |
| Pagination | First page, last page, empty page, page size limit, stable order between pages |
| Idempotency | Repeating a PUT or DELETE, or a POST with an idempotency key, does not duplicate effects |
| Concurrency | Two updates with the same version or ETag: one wins, the other gets 409 or 412 |
| Headers | Content type, caching headers, rate-limit headers when documented |

Skip checks that do not apply and say why. Prioritise authorization and validation: they are the
most common source of production incidents and data leaks.

## 3. Automate

Write the checks with Playwright's `request` fixture so they run with the team's E2E suite (in ADK
through `e2e_prepare` and `e2e_save_plan`), or in the stack the team already uses. Keep test data
created and removed by the tests themselves, and never run destructive checks against production.

## 4. Record the cases

Save the scenarios as test cases (`testplans_save`) so manual testers and automation share the same
list, grouped by resource.
