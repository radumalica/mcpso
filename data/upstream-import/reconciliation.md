# Import reconciliation

Generated 2026-10-16T11:29:44.803Z; upstream collected 2026-10-16T09:58:33.644Z. All figures come from stored pipeline summaries.

| Stage | Figure | Count |
|---|---|---|
| 1 Retrieved | issues | 4869 |
| 1 Retrieved | pull requests | 43 |
| 1 Retrieved | comments (all) / submission-thread | 2412 / 1450 |
| 1 Retrieved | API errors / retry events / source-number gaps | 0 / 0 / 595 |
| 2 Normalized | records | 6362 |
| 3 Relevant | submission-type records (with / without identity) | 6149 (6052 / 97) |
| 4 Dedup | canonical candidates | 4868 |
| 4 Dedup | duplicate records merged | 1184 |
| 5 Eligibility | eligible / needs_review / ineligible | 3502 / 1353 / 13 |
| 5 Eligibility | import-ready | 3467 |
| 6 Review | approved / published | 0 / 0 |

## Identities

| Check | Left | Right | OK |
|---|---|---|---|
| normalized records = issues + PRs + submission-thread comments | 6362 | 6362 | yes |
| normalized records = sum of intents | 6362 | 6362 | yes |
| submission-type records = grouped + without identity | 6149 | 6149 | yes |
| submission-type records = submission + submission_unclear | 6149 | 6149 | yes |
| normalized records = submission-type + non-submission | 6362 | 6362 | yes |
| grouped records = projects + duplicate records | 6052 | 6052 | yes |
| projects = eligible + needs_review + ineligible | 4868 | 4868 | yes |
| dedup projects = classification projects | 4868 | 4868 | yes |
| import_ready + security-flagged eligible + removal-held eligible <= eligible | true | true | yes |

All checks pass: **true**
