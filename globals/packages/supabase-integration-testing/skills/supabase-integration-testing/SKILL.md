---
name: supabase-integration-testing
description: "Use only when all or most conditions match: the repo uses Supabase, the task involves remote or real Supabase integration tests, RLS policies, RPC calls, migrations, service-role setup, anon access checks, or database/API behavior that is not mocked. Do not use for ordinary unit tests, mocked Supabase clients, or non-Supabase projects."
---

# Supabase Integration Testing

This skill is for tests that hit a real or remote Supabase instance. Keep it dormant for normal unit/component tests.

## Trigger Check

Use this only when all or most are true:

- Supabase markers exist: `supabase/`, `@supabase/supabase-js`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, migrations, RLS policies, or RPC SQL.
- Test uses a real Supabase client or remote database, not a mocked client.
- Task mentions RLS, policies, RPC, migrations, service role, anon key, remote DB, database integration, or API/database behavior.
- Verification needs seeded rows, cleanup, policy checks, or RPC result/error assertions.

If these conditions do not match, use the generic `test-harness` skill instead.

## Test Data

- Clean up before and after each test run.
- Always put cleanup in `finally` so it runs after failures.
- Use unique test prefixes and non-overlapping IDs per test file.
- Avoid hardcoded production/reference IDs unless the test explicitly validates seeded reference data.
- Clean all test IDs before broad queries so stale rows cannot affect assertions.
- Respect foreign-key order for setup and teardown.

## Supabase Calls

- Always capture `{ data, error }` from Supabase and RPC calls.
- Assert `error` explicitly. Fire-and-forget calls create false positives.
- For RPC tests, verify both return shape and relevant side effects when possible.
- Null-check database lookups before asserting fields.
- Use epsilon comparisons for floats and computed numeric values.

## RLS And Auth

- Use service-role/admin client for setup and teardown.
- Use anon or user-scoped client for the actual access check.
- For RLS denial tests, verify the denied client cannot read/write the target data, then use service role only as the control path.
- Keep service-role secrets out of browser/client code and test logs.

## Performance

- Parallelize independent reads with `Promise.all`.
- Do not parallelize dependent writes or teardown operations that rely on foreign-key order.
