# Scoring rubric — v1

**Single source for scoring.** Bands, the evidence bar, and the protected-attribute exclusions live here and nowhere else. `SKILL.md` points at this file; `workflow.md` carries an operative copy because a subagent prompt travels without the repository. `scripts/lint_candidates.mjs` enforces the checkable half.

The rubric is the contract between the role profile and the shortlist. Change it and you have a different shortlist, so every candidate file records `rubric: v1`. Bump the version when the bands or the evidence standard change; leave old files pointing at the old version.

## Bands

| Score | Meaning | Evidence bar |
|---|---|---|
| 9-10 | Hire-loop ready | Every must-have evidenced, at or above the target scope, in the target band |
| 8 | Strong | Every must-have evidenced; one at slightly smaller scope |
| 6-7 | Partial | Most must-haves evidenced, OR all of them in an adjacent domain / smaller scope |
| 5 | Speculative | One must-have evidenced; the rest inferred from title alone |
| 3-4 | Weak | Must-haves unevidenced, or a disqualifier present |
| 1-2 | Out | Explicit disqualifier, or clearly a different function |
| cap 3 | Unknown | Page returned no readable content — score is capped regardless of what the title suggests |

Screening assigns the band from one page read. Enrichment may move it **±2 at most**, and only on a new quoted line of evidence. A swing larger than 2 means screening read the wrong person — check identity before trusting either score.

## What counts as evidence

**Counts**: a quoted line from a profile, posting, repo, changelog, talk abstract, or published post that names what the person did and at what scope.

**What does not count**:
- A job title on its own. Titles are not scoped and do not deflate across companies.
- Tenure length. Four years is not seniority.
- Company or school brand. A signal for context, never a term in the score.
- Follower counts, endorsements, profile completeness, headshot quality, page design.
- Anything the model "knows" about the person that is not on a page it read this run.

**The one-quote rule**: every scored claim carries the line that supports it. If the file says "led platform migrations", the `evidence` field holds the sentence that says so. No quote, no claim, and the claim comes out of the file.

## Protected attributes — never in scope

Name, photo, age or graduation year, gender, pronouns, race, nationality, immigration status, marital or parental status, disability, religion, health, or any proxy for these.

These never enter `fit_score`, never enter `fit_reasoning`, and are **not recorded in the candidate file at all** — a field that does not exist cannot leak into a downstream sort. If a source page volunteers one of them, drop it on the way in.

Location is in scope only against `locations` in the role profile, and only as a work-authorization / time-zone constraint the req actually states.

A screening record is an employment record. It should read as something you would be comfortable showing the candidate, the hiring manager, and an auditor — because in several jurisdictions you may have to.

## Disqualifiers

Only what the profile's `disqualifiers` array states — hard, checkable, job-related facts (e.g. "no US work authorization and req cannot sponsor", "requires on-site, candidate is remote-only"). A disqualifier caps the score at 2 and must cite its evidence line like any other claim.

A disqualifier is a stated fact. An absence is `Unknown`, which caps at 3 and stays recoverable. Missing evidence is `Unknown`, which caps at 3 — that is a different, recoverable state.

## Calibration

Before a large run, screen five candidates the hiring manager has already judged and compare. If the skill's bands sit consistently high or low, fix the **profile** — sharpen `must_haves`, make `seniority_band` concrete — rather than nudging the threshold. A threshold change hides miscalibration; a profile change fixes it.

Expected shape of a healthy run: 15-35% of sourced candidates clear a threshold of 6. Above 50%, the sourcing query is doing no filtering. Below 10%, the source is wrong for the req — widening the source beats lowering the bar.
