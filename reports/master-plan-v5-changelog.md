# Revision 4 to Revision 5 Changelog

| Area | Rev 4 | Rev 5 |
|---|---|---|
| Central decision | import, dedup, evaluate, selectively publish | **unchanged**; strengthened (full historical import stays first-class, publication in controlled batches) |
| Count reconciliation | table with mixed units; "197 renames merged"; "import-ready 3,467"; merge-rule counts presented as decisions; exact/probable split summed mixed units | unit-explicit figures; 197 = repositories mapped, 235 records re-keyed, 21 candidates joined by a rename; 1,184 = duplicate **records** with a per-basis breakdown; 228 ambiguous = distinct projects (0 eligible); N6 = 196 projects / 246 entries; 39 identities incl. independent recount of raw files and lanes; corrections table; reproduced from the raw snapshot (IDENTICAL) |
| Terminology | `import-ready` meant importable, eligible and approvable | `importable`, `eligible` (and derived `eligible_unblocked`), `approved_for_publication` are separate in policy, schema, statuses and reports; `import_ready` field retired |
| Statuses | candidate … published, rejected, unavailable | added `approved` and `withdrawn`; only audited functions set `approved`/`published`; import never changes status |
| D7 | open | resolved as a proposed default: evidence levels 0/1/2 with required wording, declared-only never bulk and hidden from the default catalogue, forbidden words list |
| Publication boundary | policy text and a draft schema | gates P1-P8 as tested code (9 tests), DB guard triggers, transition/bulk/undo/clear functions and a SQL test suite (**drafted, not executed**); bulk exclusions cannot be bypassed; re-import cannot resurrect suppressed items |
| Rights workflow | questions listed | field-by-field retain/public/decision table; Q1-Q7 each with blocked use, resolver and interim behaviour; import not paused |
| MVP | long P1 list | reduced launch scope; compatibility matrix, install snippets, API/export, feeds, advisory intelligence, advanced ownership re-classified post-launch; security/legal remain launch gates |
| Execution plan | phases A-E summary | per phase: changes, dependencies, tests, acceptance, migration/rollback, blocking flag; one-engineer estimates; sample before full run |
| Schema | draft 0001 | 0001 revised (concept separation, no FORCE RLS), 0002 added; open checks listed |
| Source-data findings | none on drift | fresh collection: +8 new, 1 vanished, 3 body edits in 2 h 20 min; 0 labels on 4,869 issues |
| Code | reconcile (rev 4), classify with `import_ready` | dedup unit-explicit statistics, classify (`importable`, `eligible_unblocked`, `approved_for_publication`, suppression input, summaries), `lib/gates.mjs`, `approval_lanes.mjs`, new `reconcile.mjs`, `count_definitions.py`, `count_overlaps.py`, `snapshot_diff.py`, `reproduce-from-raw.sh`; 55 tests |

Not changed: independence requirements, Apache-2.0 compliance, mandatory audit security findings, "eligible is not verified or safe", no automatic publication.
