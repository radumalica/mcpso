# Publication Gate Checklist (Revision 5)

Three separate concepts, never used as synonyms:

| Concept | Meaning | Set by | Stored as |
|---|---|---|---|
| **Importable** | the source record can be stored with required provenance; the canonical key is not suppressed | importer | `candidate.importable`, `source_record` provenance columns |
| **Eligible for publication** | meets the inclusion criteria (rules E1-E4 / N / I with evidence) | machine evaluator | `eligibility_evaluation.category` (versioned, rule IDs) |
| **Approved for publication** | a human decision is recorded **and** gates P1-P8 pass | reviewer, only through `review_candidate` / `apply_bulk_approval` | `candidate.status = 'approved'` + `review_decision` + `audit_log` |

"Published" means a `listing` row exists; it can only follow "approved". Executable specification: `tools/upstream-import/lib/gates.mjs` (tested, 9 tests); database enforcement draft: `db/migrations/0002_publication_boundary.sql` with tests `db/tests/publication_boundary.test.sql` (**not executed**: no PostgreSQL available).

## 1. Per-candidate gates (all required for approval and re-checked at publication)

| Gate | Pass condition | Enforced by | Test |
|---|---|---|---|
| P1 | evaluation is `eligible`, **or** a written reviewer override reason exists | `publication_gate_failures` | gates.test "each mandatory gate" |
| P2 | no security flag, **or** the flag was cleared by an *individual* reviewer decision with a reason (`clear_security_flag`) | same; no bulk path can clear | gates.test "override never clears"; SQL test 4 |
| P3 | no removal hold, no open takedown/rights complaint, canonical key not on the suppression list, candidate importable | same; `import_upsert_candidate` | gates.test; SQL tests 4, 6 |
| P4 | no unresolved duplicate/ambiguity group | same | gates.test |
| P5 | minimum listing data: name, canonical source link, install route/endpoint or the literal "not documented", licence (SPDX or "unknown"), content type, last-checked date | same | gates.test |
| P6 | original summary approved (template built from facts, or reviewer-written); never copied third-party prose | same | gates.test; SQL test 4 |
| P7 | no rights restriction on any mapped source record; no third-party logo/screenshot; no personal data in public fields | same | gates.test; SQL test 4 |
| P8 | evidence level 0 ("declared only") needs an *individual* approval, never bulk | same; `apply_bulk_approval` rejects level < 2 | gates.test; SQL test 7 |

A written override (P1) can never clear P2, P3, P7 or P8. Nothing in the importer sets approval: `approved_for_publication` is always false in pipeline output (tested).

## 2. Evidence levels and public wording (resolution of D7)

Decision (proposed default, owner must confirm): **an external-registry or submitter declaration alone is not evidence of a working MCP server**, so such candidates are never bulk-approved and are not shown in the default catalogue view.

| Level | Basis | May be bulk-approved? | Default catalogue? | Public wording (required text) |
|---|---|---|---|---|
| 0 Declared only | no resolved repository (endpoint/package identity, unresolved repo) with a registry or submitter declaration | **No**; individual approval after an identity check | **No** (shown only with "include unreviewed declarations") | "Declared only: this entry comes from a publisher or registry declaration dated {date}. The registry has not checked the server or its repository." |
| 1 Repository facts | repository resolved and public; facts checked (licence, last activity, archived); evidence is a registry listing and/or a manifest file (`server.json`, `mcpName`), which are the publisher's own declarations | No (individual) | Yes, labelled | "Repository facts checked on {date} (exists, public, licence, last activity); any manifest or registry entry is the publisher's own declaration. The server has not been tested or security-reviewed." |
| 2 Static inspection | resolved repo plus an **SDK dependency with server wording** (code-level signal) | Yes, within lane rules (§3) | Yes | "Static inspection on {date}: the repository depends on an MCP SDK and describes itself as a server. The server has not been tested or security-reviewed." |
| 3 Tested | reserved for the future sandbox procedure | n/a | n/a | not available at launch |

Forbidden wording at launch: "verified", "safe", "secure", "trusted", "recommended", star ratings. Level 0 entries show only: display name from the repository or identifier (not the submitter's title), canonical link, source link, retrieval date, declared transport/package identifiers labelled as declared. **Why a manifest file does not reach level 2:** a `server.json` or `mcpName` field is self-published in the same way as a registry entry; counting it as inspection evidence would have made 888 more candidates (808 in the bulk lane, 80 in the family-sample lane) bulk-approvable on a declaration alone. Measured on the audit snapshot (eligible, n = 3,502): level 0 = 644, level 1 = 1,286, level 2 = 1,572 (`approval-lanes-summary.json`). Levels 0 and 1 together (1,930) are exactly the eligible candidates that rest on cheap evidence only (registry listing and/or manifest file).

## 3. Approval lanes and bulk-action guardrails

Lanes (measured, n = 4,868 candidates): **bulk 1,216**, **family_sample 302** (template/bulk-submitter families: bulk only after a 5% random sample of the family has zero rejects), **individual 1,949** (level 0/1 evidence, archived or stale), **blocked 35** (26 security-flagged + 9 removal-held), **needs_review 1,353**, **not_eligible 13**. Lanes describe how a human may approve; **0 candidates are approved**.

| Guardrail | Rule | Enforced / tested |
|---|---|---|
| Scope preview | exact filter, count and a random sample of 20 shown before confirmation | UI + `planBulkAction` |
| Count check | confirmed count must equal previewed count | `confirmBulk`; SQL `apply_bulk_approval` |
| Bounded | at most 500 candidates per action | both; tests incl. 501 |
| Eligible set only | approve: lane `bulk` (or sampled `family_sample`) only; reject: only I1/I2 | gates.test |
| Never bypassed | security flag, removal hold, suppression, rights restriction, level < 2, unresolved ambiguity are excluded and *cannot be cleared in bulk* | gates.test "bulk approve never includes ..."; SQL test 7 |
| Recorded | one `bulk_action` row (filter, count, reviewer) plus a `review_decision` per candidate | SQL |
| Recoverable | `undo_bulk_action` restores each candidate's previous status; refuses if a listing was published (unpublish first) | `bulkUndoRecord`; SQL test 7 |
| All-or-nothing | one failing candidate aborts the whole action | SQL test 7 |

## 4. Program-level launch gates (blocking public launch)

| Gate | Pass criterion (testable) |
|---|---|
| LG1 Security baseline | Phase A complete: no anonymous catalogue write (authorisation tests), RLS default-deny proven by the SQL suite, no critical/high production advisories, CI green |
| LG2 Publication boundary | gates unit tests and the SQL boundary suite green; a direct `UPDATE candidate SET status='published'` and a direct `INSERT INTO listing` are rejected; the public API/read model returns only `public_listing` columns |
| LG3 Takedown and correction | the workflow works end to end on staging (request → ownership check → hold → decision → suppression); re-import of a suppressed key stays non-importable and unpublished |
| LG4 Rights and privacy | questions Q1-Q7 (§5) decided by their owners, or the interim restrictions in force and documented; counsel sign-off recorded |
| LG5 Wording | listing templates reviewed: no "verified/safe/trusted"; non-affiliation statement present; evidence level and date on every listing |
| LG6 Data quality | first-wave stratum hand-checks recorded (k of n); any stratum with a clear false-positive eligible rate above 5% does not enter bulk approval |
| LG7 Operations | backup with a performed restore drill; monitoring and alert on errors/queue age; audit log retained |
| LG8 Accessibility basics | keyboard navigation, labels, contrast and zoom checks pass on catalogue, detail and review pages |
| LG9 Licence compliance | `LICENSE` kept, `NOTICE` and modification notices present, `templates/tailspark` licence verified or replaced, no upstream branding or tracking identifiers |
| LG10 Reconciliation | `reconcile.mjs` exits 0 for the dataset being published; published listings ≤ approved ≤ eligible_unblocked |

## 5. Data-rights workflow: fields and decisions

| Field class | Retain internally | May appear publicly | Decision needed |
|---|---|---|---|
| Source URL, number, date, state; canonical repository URL, owner/name; package identifiers; endpoint host | yes | yes (facts and links) | none |
| Licence SPDX, language, archived, last push, declared transports/hosting | yes (with retrieval date) | yes at level ≥ 1 | none |
| Submitter's GitHub login | yes (provenance, audit) | **no** by default | Q2 |
| Issue title, issue/comment bodies, submitter descriptions | yes, restricted, internal only (raw store) | **no**; listing uses an original summary and the repository name | Q1 (retention), Q7 (derivation) |
| Repository description and README-derived snippets (enrichment output) | yes, internal facts and short snippets only | no (facts such as "manifest present" only) | Q1 |
| Logos, screenshots, other media | not retained | **no** unless supplied by the verified owner with permission | Q3 |
| Contact details found in issues | not extracted by the importer; may exist in raw bodies | no | Q2 |
| Official-registry entries | facts used as evidence only | declared identifiers labelled "declared" | Q5 |
| Exported dataset / API | n/a | facts only | Q4 |

| Q | Unresolved question | Why it blocks | Who must resolve | Interim safe behaviour |
|---|---|---|---|---|
| Q1 | May third-party issue text and fetched repository snippets be stored, where, and for how long? | loading raw data into any production store | legal counsel with the product owner (policy); engineer implements the retention | keep raw data on the local/staging snapshot only; no production raw load until decided |
| Q2 | Is displaying submitter handles lawful; what is the basis and the opt-out? Handling of any personal data in bodies | any public attribution to a person | privacy advisor or counsel; product owner | no handles, titles or prose on public pages; link to the source issue only |
| Q3 | Reuse of logos/screenshots from issues or repositories | any media on listings | counsel | no media |
| Q4 | Licence and terms of an exported dataset/API | public export (post-launch) | product owner with counsel | no export at launch |
| Q5 | Obligations from the upstream repository's terms and from the official registry's terms | use of the official-registry reference, any statement of origin | counsel (reads the terms) | use the registry only as internal evidence; state sources as links |
| Q6 | Takedown/copyright contact designation and jurisdiction | launch (a working removal path is required) | counsel and the product owner | none: launch blocked until a contact and process exist |
| Q7 | Are template summaries built from facts, or LLM-drafted summaries, acceptable derivatives | summaries on listings | counsel; product owner | template-from-facts summaries only; no LLM text |

These are open questions, not conclusions. This repository's author is not a lawyer and cannot resolve Q1-Q7.
