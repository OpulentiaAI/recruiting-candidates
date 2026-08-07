# File formats

Two artifacts have a fixed shape: the triage stub written in Step 5, and the enriched file that overwrites it in Step 7. `compile_report.mjs` parses the frontmatter, so keep every value on **one line** and keep the key names exactly as written.

---

## Triage stub — `candidates/{slug}.md` after Step 5

```markdown
---
candidate_name: Dana Okonkwo
current_title: Staff Software Engineer
current_company: Northwind Systems
location: Berlin, DE
primary_url: https://example-board.com/talent/dana-okonkwo
fit_score: 7
fit_reasoning: Owns the ingestion platform at a comparable scale, but the posting shows no evidence of the multi-tenant work the req centers on.
evidence: "Leads the team behind Northwind's event ingestion platform — 40B events/day across 200 tenants."
must_haves_met: distributed systems ownership, staff-level scope
gaps: multi-tenant isolation, on-call leadership
triage_only: true
rubric: v1
req: Staff Platform Engineer
---

## Screening notes

Profile states ownership of the ingestion platform at 40B events/day. Scope and band line up with the req. The page names no work on tenant isolation, which is must-have #3 — recorded as a gap rather than assumed either way.
```

Rules the stub must satisfy:
- `evidence` is a **quote** from the page that was read, in double quotes.
- `fit_reasoning` references that quote. It does not introduce new facts.
- `gaps` records what the page did not show. Absence is a gap, never a disqualifier.
- No protected attributes appear anywhere — including in the notes prose.

---

## Enriched file — same path after Step 7

```markdown
---
candidate_name: Dana Okonkwo
current_title: Staff Software Engineer
current_company: Northwind Systems
location: Berlin, DE
primary_url: https://example-board.com/talent/dana-okonkwo
profile_urls: https://linkedin.com/in/example, https://github.com/example
fit_score: 8
fit_reasoning: Ingestion platform ownership at req scale, plus a public talk on tenant isolation that closes the gap screening flagged.
evidence: "Leads the team behind Northwind's event ingestion platform — 40B events/day across 200 tenants."
must_haves_met: distributed systems ownership, staff-level scope, multi-tenant isolation
gaps: on-call leadership
signals: SREcon talk "Isolating noisy tenants without quotas" (2026), maintainer of example/ratelimiter
outreach_hook: Their SREcon talk on isolating noisy tenants without quotas is the exact problem this req opens with.
score_adjustment: +1 — talk abstract evidences multi-tenant isolation, previously a gap
triage_only: false
rubric: v1
req: Staff Platform Engineer
ats_synced: false
proof:
---

## Evidence

- "Leads the team behind Northwind's event ingestion platform — 40B events/day across 200 tenants." — https://example-board.com/talent/dana-okonkwo
- "Isolating noisy tenants without quotas" — SREcon 2026 talk abstract, https://example.org/srecon26/isolating-noisy-tenants
- Maintainer, `example/ratelimiter` — 1.2k stars, last commit within 30 days, https://github.com/example/ratelimiter

## Why this person

Runs an ingestion platform at the scale the req describes, with the staff-level ownership the band requires. The SREcon talk closes the multi-tenant isolation gap screening flagged from the profile alone — the abstract describes the same failure mode this team is hiring against. Remaining unknown is on-call leadership, which is a screen-call question, not a research question.
```

Rules the enriched file must satisfy:
- Every bullet under `## Evidence` carries a source URL.
- `signals` lists artifacts that can be opened and checked. No "active in the community".
- `outreach_hook` quotes a real artifact. Never a fabricated shared interest or mutual connection.
- `score_adjustment` states the delta **and** its reason, or `none`. Adjustments beyond ±2 are invalid.
- `## Why this person` is three sentences and introduces no fact absent from `## Evidence`.

---

## Sourced record — `raw/page_{N}.jsonl`, one JSON object per line

```json
{"name":"Dana Okonkwo","title":"Staff Software Engineer","company":"Northwind Systems","location":"Berlin, DE","profile_url":"https://example-board.com/talent/dana-okonkwo","source_note":"talent pool page 2"}
```

`normalize_candidates.mjs` merges these on identity key — `profile_url` → `email` → `name`+`company` — and emits `candidates.jsonl` plus `seed_candidates.txt` (`slug|name|company|primary_url`).

## Posting record — Lane B, `raw/jobs_{N}.jsonl`

```json
{"job_title":"Staff Platform Engineer","job_url":"https://boards.greenhouse.io/example/jobs/1234567","company":"Example Co","location":"Remote (EU)"}
```

## Layers on top of

`scoring-rubric.md` owns what a score means. This file owns only the shape a file takes, and `scripts/lint_candidates.mjs` checks that shape mechanically.
