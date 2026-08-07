---
name: recruiting-candidates
description: Source candidates from job boards, ATS dashboards and talent pools, screen them against a role profile, enrich the survivors, then sync to the ATS or submit applications behind an approval gate. Outputs a ranked report, a CSV, and one evidence file per candidate. Use for sourcing, screening, building a shortlist, moving candidates through an ATS, or bulk-applying to postings.
license: MIT
---

# Recruiting candidates

A req in, a ranked shortlist out, every claim carrying the line that supports it.

**Offline demo, no browser or keys:**

```bash
npm run demo && npm run open
```

`demo` normalizes, reports, then lints the candidate files against the scoring contract.

**Live run:** stages 1 to 9 below.

## Invariants

- One session per subagent, released by that subagent, including on the failure path.
- Concurrency never exceeds the profile's `browser_concurrency`.
- Protected attributes never enter a candidate file. A field that does not exist cannot reach a score.
- Scoring rules live in `references/scoring-rubric.md`. `npm run lint` enforces the checkable half and exits 1 on a violation.
- Writes stop for a human: ATS sync and application submit each need one blocking approval.
- Authentication is the user's. Hand them a live view; never type a credential.

## Stages

### 1 · Setup
Create `/opulent/workspace/recruiting/{req_slug}_{timestamp}/` with `raw/`, `candidates/`, `proof/`. Pass the full literal path to every subagent.

*Done: path exists and is echoed.*

### 2 · Load the profile
`profiles/{req_slug}.json`. `--req` wins; otherwise one non-example profile is used and named; several means ask; zero means fail and say so. The rubric is an input.

*Done: profile loaded, `must_haves` and `disqualifiers` in hand.*

### 3 · Recon
One session, one batch: navigate, read content, capture proof, release. Classify the platform and write `recon.json` with `platform`, `strategy`, `auth_required`, `pagination`.

Open `references/ats-platforms.md` for the detection table and per-platform traps. `auth_required: true` means live-view handoff, not a login attempt.

*Done: `recon.json` written with a strategy.*

### 4 · Source
Extract against an explicit schema. People need `name` and `profile_url`; postings need `job_title` and `job_url`. Paginate by batching click-next then read-content until `max_sourced` or a page yields nothing new. Append to `raw/page_{N}.jsonl`.

*Done: `raw/*.jsonl` populated, row count sane against what the page showed.*

### 5 · Normalize
```bash
node scripts/normalize_candidates.mjs {OUTPUT_DIR}
```
Merges on URL, then email, then name+company for a person or title+company for a posting. A record registers every key it has, so the same subject sourced two ways collapses. Drops protected attributes on the way in. Writes `candidates.jsonl` and `seed_candidates.txt`.

*Done: unique count reported, merge count reported.*

### 6 · Screen
One page read per candidate. Batches of 10, subagents capped at `browser_concurrency`. Budgets in `references/workflow.md`.

*Done: `candidates/*.md` count equals `seed_candidates.txt` line count.*

### 7 · Filter
Keep `fit_score >= --fit-threshold` (default 6) into `fits.txt`. Expect 15 to 35 percent. Below 10 percent, surface both numbers before spending enrichment calls.

*Done: `fits.txt` written, survival rate stated.*

### 8 · Enrich
Four calls per candidate, survivors only: canonical profile, shipped work, one substantive read, public signal. Enrichment may move a score by at most 2, and only with a new quoted line.

*Done: every fit file carries `triage_only: false`.*

### 9 · Act, then compile
Lane A syncs to the ATS, lane B submits applications. Both are dry-run first and both stop at one blocking approval carrying exact counts. Verify by re-reading the record; a 200 is not proof.

```bash
node scripts/compile_report.mjs {OUTPUT_DIR}
```

```bash
npm run lint    # or: node scripts/lint_candidates.mjs {OUTPUT_DIR}
```

*Done: report written, linter exits 0, top five reported.*

## References

Open on trigger.

| Trigger | File |
| --- | --- |
| Sizing a wave or a budget | `references/workflow.md` |
| A platform behaves oddly | `references/ats-platforms.md` |
| A score is disputed | `references/scoring-rubric.md` |
| A file's frontmatter is unclear | `references/example-research.md` |

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Subagents hang at start | More sessions than `browser_concurrency` | Lower fan-out, end orphaned sessions |
| Every candidate scores 3 | Source needed auth, content came back empty | Live-view handoff, then re-source |
| Form fills, submit does nothing | Selector matched a hidden duplicate | Re-resolve on the live page |
| Duplicate applications | Blind retry after an ambiguous submit | Re-read before any retry |
| Shortlist looks arbitrary | Rubric paraphrased into prompts | Embed profile fields verbatim, re-screen |
