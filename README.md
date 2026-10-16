# MCP Registry (working title)

An independent, read-only directory of Model Context Protocol (MCP) servers. Every entry states what was checked, when, and what was
not checked. Nothing is published without a recorded human approval. See `NOTICE` for attribution (Apache-2.0).

## How it fits together

| Part | Where | Purpose |
|---|---|---|
| Public site | `app/`, `components/`, `lib/`, `models/` | Next.js, server-rendered, reads only the `public_listing` view; no accounts, no writes, no third-party scripts |
| Import pipeline | `tools/upstream-import/` | collect public requests, normalise, de-duplicate, evaluate, load into the database, sample for hand-checks, review tooling |
| Database | `db/migrations/` | schema, row-level security, publication gates and audited transition functions |
| Tests | `tests/`, `db/tests/`, `tools/upstream-import/test/` | security guards, importer, SQL suites, end-to-end checks |
| Plan and evidence | `reports/` | master plan v5, policies, audit reports, `implementation-log.md` |

## Run it

```bash
npm ci
cp .env.example .env.local      # set SUPABASE_URL, SUPABASE_ANON_KEY (read-only) and SITE_* values
npm run dev
```

Only the public anon key belongs in this application. The service-role key is used by the importer and review tooling and must never
be present in this application's environment.

## Checks

```bash
npm run typecheck && npm run lint
npm test                        # security guards, app view-model, importer
npm run test:db                 # migrations + SQL suites + loader/review tests (in-process Postgres)
npm run test:e2e                # production build against a fake read-only data API
npm audit --omit=dev
```

## Status

Pre-launch. Open owner decisions (name and domain, hosting, rights and privacy sign-off) are tracked in `reports/master-plan-v5.md`;
what has been built and verified is tracked in `reports/implementation-log.md`.
