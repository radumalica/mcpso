# Import reconciliation

Generated 2026-10-16T14:49:23.025Z; upstream collected 2026-10-16T09:58:33.644Z. All figures come from stored pipeline summaries; each has a unit (see Definitions).

## Stage counts

| Stage | Figure (unit) | Count |
|---|---|---|
| 1 Retrieved | issues / pull requests / all comments (records) | 4869 / 43 / 2412 |
| 1 Retrieved | raw source records / importable source records with complete provenance (records) | 7324 / 7324 |
| 1 Retrieved | API errors / retry events / rate-limit waits / unretrievable numbers | 0 / 0 / 0 / 595 |
| 2 Normalised | normalised records / context-only comments (records) | 6362 / 962 |
| 3 Relevant | submission-type records = placed + unplaced (records) | 6149 = 6052 + 97 |
| 3 Relevant | non-submission records (records) | 213 |
| 4 Dedup | canonical candidates = placed - duplicates (projects) | 4868 |
| 4 Dedup | duplicate records (records) | 1184 |
| 4 Dedup | single-record / multi-record projects (projects) | 4207 / 661 |
| 4 Dedup | duplicate records by basis (records) | {"same_key_as_group":1083,"linked_by_R6":42,"linked_by_R2":11,"linked_by_R3":26,"linked_by_R5":22} |
| 4 Dedup | merge entries by rule (R1/R4 per project; R2/R3/R5/R6 per record) | {"R1":624,"R6":235,"R2":16,"R4":37,"R3":42,"R5":22} |
| 4 Dedup | renames: repositories mapped / records re-keyed / projects joined by rename | 197 / 235 / 21 |
| 4 Dedup | ambiguous projects (projects; flags: {"same_repo_incompatible_names":28,"shared_package_across_repos":139,"shared_endpoint_across_repos":73}) | 228 |
| 5 Evaluation | eligible / needs_review / ineligible (projects) | 3502 / 1353 / 13 |
| 5 Evaluation | needs_review by first rule (projects) | {"N1":357,"N3":279,"N7":194,"N9":73,"N2":221,"N6":196,"N4":6,"N8":24,"N5":3} |
| 5 Evaluation | ineligible by rule (projects) | {"I2":1,"I1":1,"I3":11} |
| 5 Evaluation | ambiguous projects by category / N6 projects (N6 entries) | {"eligible":0,"needs_review":227,"ineligible":1} / 196 (246) |
| 5 Evaluation | unavailable or under-documented: repos not found / N7 / N8 / N5 (projects) | 436 / 194 / 24 / 3 |
| 6 Gates | importable / suppressed (projects) | 4868 / 0 |
| 6 Gates | eligible = eligible_unblocked + blocked (security only 26, hold only 9, both 0) | 3502 = 3467 + 35 |
| 6 Gates | approval lanes (projects): {"bulk":1216,"individual":1949,"needs_review":1353,"not_eligible":13,"blocked":35,"family_sample":302}; eligible by evidence level {"0":644,"1":1286,"2":1572} | |
| 6 Gates | approved_for_publication / published (projects) | 0 / 0 |

## Identities (every stage transition)

| Check | Left | Right | OK |
|---|---|---|---|
| T0a raw issues file lines = collected issues | 4869 | = 4869 | yes |
| T0b raw pull-request file lines = collected pull requests | 43 | = 43 | yes |
| T0c raw comment file lines = collected comments | 2412 | = 2412 | yes |
| T0d comments on the submission thread in the raw file = thread comments normalised | 1450 | = 1450 | yes |
| T0e importable source records (all provenance fields present) = raw records | 7324 | = 7324 | yes |
| T0f raw record keys are distinct (idempotent upsert key (type, id) has no collisions) | 7324 | = 7324 | yes |
| T1 raw source records = normalised records + context-only comments | 7324 | = 7324 | yes |
| T2 normalised records = issues + PRs + submission-thread comments | 6362 | = 6362 | yes |
| T2b thread-comment count agrees between normalise and classify | 1450 | = 1450 | yes |
| T3 normalised records = sum of intents | 6362 | = 6362 | yes |
| T4 normalised records = submission-type + non-submission | 6362 | = 6362 | yes |
| T4b non-submission records agree between normalise and classify | 213 | = 213 | yes |
| T5 submission-type records = placed + unplaced | 6149 | = 6149 | yes |
| T5b submission-type = submission + submission_unclear | 6149 | = 6149 | yes |
| T6 placed records = projects + duplicate records | 6052 | = 6052 | yes |
| T6b placed records = single-record projects + records inside multi-record projects | 6052 | = 6052 | yes |
| T6c records inside multi-record projects = multi-record projects + duplicate records | 1845 | = 1845 | yes |
| T7 duplicate records = sum of duplicate records by basis | 1184 | = 1184 | yes |
| T8 multi-record projects = R1 + R4 entries (project-level labels) | 661 | = 661 | yes |
| T8b multi-record projects = sum by identity type | 661 | = 661 | yes |
| T8c dedup projects = classification projects | 4868 | = 4868 | yes |
| T9 projects joined by rename <= projects containing renamed records | 21 | <= 194 | yes |
| T9b projects joined by rename <= multi-record projects | 21 | <= 661 | yes |
| T9c R6 entries (records re-keyed) agree between summaries | 235 | = 235 | yes |
| T10 projects = eligible + needs_review + ineligible | 4868 | = 4868 | yes |
| T10b needs_review = sum by first rule | 1353 | = 1353 | yes |
| T10c ineligible = sum by rule | 13 | = 13 | yes |
| T11 ambiguous projects agree between dedup and classify | 228 | = 228 | yes |
| T11b ambiguous projects = sum of ambiguous projects by category | 228 | = 228 | yes |
| T11c no ambiguous project is eligible | 0 | = 0 | yes |
| T12 eligible = eligible_unblocked + security-only + hold-only + both | 3502 | = 3502 | yes |
| T13 eligible_unblocked <= importable | 3467 | <= 4868 | yes |
| T13b importable <= projects | 4868 | <= 4868 | yes |
| T13c importable + suppressed = projects | 4868 | = 4868 | yes |
| T14 approved_for_publication <= eligible_unblocked | 0 | <= 3467 | yes |
| T15 approval lanes cover every project | 4868 | = 4868 | yes |
| T15b bulk + individual + family_sample = eligible_unblocked | 3467 | = 3467 | yes |
| T15c blocked lane = eligible - eligible_unblocked | 35 | = 35 | yes |
| T15d needs_review lane = needs_review category | 1353 | = 1353 | yes |
| T15e not_eligible lane = ineligible category | 13 | = 13 | yes |
| T15f eligible by evidence level = eligible | 3502 | = 3502 | yes |

All checks pass: **true**

## Definitions

| Figure | Unit | Meaning |
|---|---|---|
| raw source records | records | issues + pull requests + ALL comments, as retrieved (stored internally with provenance) |
| context-only comments | records | comments on issues other than the submission thread (#1); stored, never treated as submissions |
| normalised records | records | issues + pull requests + submission-thread comments; one per source record that the normaliser processed |
| submission-type records | records | normalised records whose intent is submission or submission_unclear (the 'relevant addition requests') |
| placed records | records | submission-type records with a usable identity (repository, package or endpoint); each is in exactly one project |
| unplaced records | records | submission-type records with no extractable identity; listed for manual review, not candidates |
| projects / canonical candidates | projects | groups of placed records sharing one canonical identity; the unit that is evaluated, reviewed and may be published |
| duplicate records | records | placed records that are not the first record of their project (= placed records - projects) |
| multi-record projects | projects | projects with more than one record; the R1 (GitHub identity) and R4 (endpoint/package identity) merge entries are one per such project |
| R2/R3/R5/R6 merge entries | records | one entry per record that was linked (R2 package, R3 endpoint, R5 package) or re-keyed by a rename (R6); NOT merge operations |
| rename mappings | repositories | repositories whose GitHub-resolved owner/name differs from the submitted one (197); NOT the number of merges |
| records re-keyed by rename | records | records whose repository key was replaced because of a rename (R6 entries) |
| projects joined by rename | projects | multi-record projects whose records carried different original repo keys that a rename made equal (the only places a rename caused a merge) |
| ambiguous projects | projects | distinct projects with a review-relevant ambiguity flag (monorepo_subpath_project excluded); a project can carry several flags |
| N6 reason entries vs projects | entries / projects | N6 is recorded once per ambiguity flag, so entries (246) exceed distinct projects (196) |
| eligible / needs_review / ineligible | projects | machine category; exactly one per project; a partition of all projects |
| importable | projects | candidate can be stored with provenance and is not on the suppression list |
| eligible_unblocked | projects | eligible and no security flag and no removal hold; may enter the approval queue (bulk-capable lane); NOT approved |
| approved_for_publication | projects | human decision recorded and all publication gates passed; the pipeline never sets this (always 0 here) |
