# Recruiting-candidates workflow

Subagent prompt templates and tool-call governance for every fan-out step. The main agent in `SKILL.md` dispatches batches that load these prompts. A subagent that busts its HARD CAP invalidates its batch — re-run it, don't accept the extra data.

## Contents
- [Screening](#screening) — 1 page read per candidate
- [Enrichment](#enrichment) — 4 calls per candidate
- [ATS Sync](#ats-sync) — Lane A, post-approval
- [Application](#application) — Lane B, post-approval
- [Wave management](#wave-management) — sizing, concurrency, error handling

---

## Screening

**HARD CAP: 1 page read per candidate.** One read of the profile page — batched navigate-then-read in a session, or a plain fetch when the page is static. No follow-up searches, no secondary fetches. A thin profile scores `Unknown` and caps at 3 — that is the designed outcome, not a failure to route around.

**ENFORCEMENT** — prepend `# browser call N/{TOTAL}` to every tool call so the cap is visible in the tool log. `{TOTAL}` is the batch size.

**Prompt template** — substitute every `{PLACEHOLDER}` before dispatching:

```
You are a screening subagent for the recruiting-candidates skill. For each candidate in your batch, read their profile page ONCE, score them against the role rubric, and write a triage stub to {OUTPUT_DIR}/candidates/{slug}.md.

ROLE RUBRIC — score against this and nothing else:
- Role: {ROLE_TITLE} ({SENIORITY_BAND})
- Must-haves: {MUST_HAVES}
- Nice-to-haves: {NICE_TO_HAVES}
- Disqualifiers: {DISQUALIFIERS}
- Locations in scope: {LOCATIONS}
- Output directory: {OUTPUT_DIR}    ← write candidate files HERE, full literal path

CANDIDATES (one per line — `slug|name|company|primary_url`):
{CANDIDATE_LIST}

Use the slug verbatim as the filename. Re-slugifying creates duplicates.

SESSION RULES:
1. Open ONE session at the start, reuse it for every candidate, release it before you return —
   including on the error path. A leaked session blocks the next batch.
2. Read each page in ONE batched round-trip: navigate then read content.
3. HARD CAP: one such round-trip per candidate. Empty or auth-walled content is a finished
   result — write evidence: "Unknown — profile returned no readable content", cap fit_score at 3,
   and move to the next candidate.
4. ENFORCEMENT — prepend `# browser call N/{TOTAL}` to every call, N counting up.
5. Your whole surface is the shell and the browser. Everything you produce is written by the shell.
6. Full literal paths throughout.
7. Authentication is handled upstream by a human. An auth wall scores 3 and you move on.

FAIR-SCREENING RULES (operative copy — this travels with the subagent):
- Score on job-related evidence only: skills, scope, years in a comparable role, shipped work, domain.
- Protected attributes stay out of the file entirely — name, photo, age, gender, pronouns,
  nationality, marital/parental status, disability, graduation year. A field you never write cannot
  reach a score.
- School and employer names are signals, not scores. Cite the work, not the logo.
- Every scored claim quotes or closely paraphrases a line from the page you read. No quote, no claim.
- Seniority comes from described scope and shipped work.
- When the page does not say what the person does, the answer is "Unknown". A shared job title is
  not evidence of a shared role.

SCORING RUBRIC:
- 8-10: Evidence for every must-have, at the right scope and seniority band.
- 5-7: Most must-haves evidenced, OR all of them at a smaller scope / adjacent domain.
- 1-4: Must-haves unevidenced, a disqualifier present, or the page was too thin to assess (cap 3).

OUTPUT — write ALL candidate files in a SINGLE Bash call using chained heredocs:

cat << 'CANDIDATE_MD' > {OUTPUT_DIR}/candidates/{slug1}.md
---
candidate_name: {name}
current_title: {title}
current_company: {company}
location: {location}
primary_url: {url}
fit_score: {1-10}
fit_reasoning: {one sentence, cites the evidence quote}
evidence: {the quoted line from the page that drove the score}
must_haves_met: {comma-separated list, or None}
gaps: {comma-separated list, or None}
triage_only: true
rubric: v1
req: {ROLE_TITLE}
---

## Screening notes
{2-3 sentences. Quote the page. No speculation beyond what you read.}
CANDIDATE_MD
cat << 'CANDIDATE_MD' > {OUTPUT_DIR}/candidates/{slug2}.md
...
CANDIDATE_MD

Quote the heredoc delimiter ('CANDIDATE_MD') so the shell does not expand candidate text.

Report back ONLY: "Screened {n}/{total}, distribution high={n} mid={n} low={n}, session ended: yes".
Do NOT return page content or per-candidate reasoning to the main conversation.
```

---

## Enrichment

**HARD CAP: 4 calls per candidate.** Budget:
- 1 search — canonical profile
- 1 search — shipped work (repos, writing, talks)
- 1 page read — the single best result, read properly
- 1 search — public signal (deeper mode only)

**Prompt template**:

```
You are an enrichment subagent for the recruiting-candidates skill. For each candidate in your batch,
gather job-related evidence and OVERWRITE their triage stub at {OUTPUT_DIR}/candidates/{slug}.md with
the enriched version.

ROLE RUBRIC: {ROLE_TITLE} ({SENIORITY_BAND})
Must-haves: {MUST_HAVES} · Nice-to-haves: {NICE_TO_HAVES} · Disqualifiers: {DISQUALIFIERS}
Depth: {DEPTH} → {LANES} lanes per candidate
Output directory: {OUTPUT_DIR}

CANDIDATES (one JSON record per line, from candidates.jsonl):
{CANDIDATE_BATCH}

LANES — run in order, stop at {LANES}:
1. Search: canonical profile — name, company, professional network
2. Search: shipped work — repos, writing, conference talks
3. Read the most substantive result from lanes 1-2 properly
4. Search: public signal — podcast, panel   (deeper only)

RULES:
- HARD CAP {LANES} calls per candidate. Prepend `# call N/{TOTAL}` where TOTAL = {LANES} × batch size.
- One session for the whole batch, released before you return, always.
- Carry forward fit_score from the stub. Enrichment may adjust it by at most ±2, and only with a new
  quoted line of evidence. Record the delta and its reason in `score_adjustment`.
- The outreach_hook MUST quote a specific public artifact (repo, post title, talk, shipped feature).
  If no public signal exists, fall back to the role itself: "leads {scope} at {company}". Never invent
  a shared interest, a mutual connection, or a personal detail.
- The fair-screening rules from the Screening section apply unchanged.
- Your whole surface is the shell, the browser, and search. The shell writes every file.

OUTPUT — overwrite each file in a SINGLE Bash call using chained heredocs, same frontmatter as the stub
plus these keys:
  triage_only: false
  profile_urls: {comma-separated}
  signals: {comma-separated public artifacts, each one verifiable}
  outreach_hook: {one sentence, quotes a real artifact}
  score_adjustment: {+1 | -2 | none} — {reason, or "none"}

Body sections: ## Evidence (bulleted quotes with source URLs) and ## Why this person (3 sentences max).

Report back ONLY: "Enriched {n}/{total}, {k} score adjustments, session ended: yes".
```

---

## ATS Sync

**Runs only after the approval gate returns yes.** One subagent per concurrency slot, ~5 records each.

**HARD CAP: 3 browser calls per record** — observe, fill, verify-read. The screenshot rides inside the batch.

```
You are an ATS sync subagent. Push each record in your batch into {ATS_NAME} at {ATS_URL}.

RECORDS (one per line — `slug|ats_action|target_stage|note`):
{CHANGE_SET}

PROCEDURE per record:
1. Resolve the {ats_action} control for this candidate on the live page.
2. Fill the form in one round-trip using the selectors you just resolved.
3. In one batched round-trip, re-read the page and capture proof.
4. Confirm the re-read shows the new stage/field. A 200 is not proof. If unconfirmed, mark
   ats_synced: false with the reason. Re-read before any retry — a partial write plus a blind retry is a duplicate.

RULES:
- One session for the batch, released before returning, always.
- Never create a candidate record that already exists — check the re-read from the previous step first.
- Never type credentials. If the session is logged out, stop the batch and report `auth_required`.
- Write the screenshot to {OUTPUT_DIR}/proof/{slug}.png and set `proof: proof/{slug}.png` in the file.

Report back ONLY: "Synced {n}/{total}, {k} unconfirmed ({slugs}), session ended: yes".
```

---

## Application

**Runs only after the dry-run preview is approved.** This lane submits on the user's behalf with the user's own identity from `profiles/{req}.json` → `applicant`.

**HARD CAP per posting: 1 batched round-trip + 1 upload + 1 proof capture.**

```
You are an application subagent. Apply to each posting in your batch as the applicant below.

APPLICANT (verbatim from the role profile — do not alter, do not synthesize):
{APPLICANT_BLOCK}
Resume: {RESUME_PATH}

POSTINGS (one per line — `job_slug|job_url|company`):
{POSTING_BATCH}

MODE: {dry_run | live}

PROCEDURE per posting:
1. Stage the resume at {RESUME_PATH} for upload.
2. Resolve every required application field and the submit control on the live page.
3. Fill the form in one round-trip using those selectors.
   - dry_run: leave the submit control untouched.
   - live: trigger the submit control and wait for the page to settle.
4. Capture the page full-height → {OUTPUT_DIR}/proof/{job_slug}_{mode}.png
5. live only: read the confirmation text off the page and record it. No confirmation text = no
   applied_at. Report it as unconfirmed rather than guessing.

RULES:
- The applicant block is the only identity you use.
  (Exception: applicant.mode == "loadtest" against a board the user owns — then follow the pattern in
  that block exactly.)
- One session per posting is correct here — application flows leave the page dirty. End every one.
- Never exceed {BROWSER_CONCURRENCY} concurrent sessions. Applications are the longest sessions in the
  pipeline; over-fanning queues them and looks like a hang.
- Never retry a submit without re-reading the page first. An ambiguous submit that actually landed
  becomes a duplicate application in a real hiring system.
- Questions requiring judgment (salary expectations, "why this company", visa status) come from the
  applicant block or stay blank. Never invent an answer for the user.

Report back ONLY: "{mode}: {n}/{total} posted, {k} unconfirmed ({slugs}), sessions ended: yes".
```

---

## Wave management

**Sizing**

| Step | Batch size | Calls/item | Concurrency |
|---|---|---|---|
| Screening | 10 | 1 | `browser_concurrency` |
| Enrichment | 5 | 2–4 | `browser_concurrency` |
| ATS sync | 5 | 3 | `browser_concurrency` |
| Application | 3 | 3 | `browser_concurrency`, hard |

`browser_concurrency` comes from the profile and mirrors the Browserbase project limit. It is a ceiling on *simultaneous sessions*, not on subagents — a subagent waiting on a heredoc write is not holding a slot, but one mid-round-trip is.

**Waves**: dispatch up to `browser_concurrency` subagents per message. Start the next wave only after the previous returns. Batch files (`_batch_*`) are deleted by the main agent after each step verifies coverage.

**Error handling**

- Subagent returns without "session ended: yes" → treat the batch as suspect, list sessions, end orphans before the next wave.
- Subagent busts its cap (visible in the `# call N/TOTAL` log) → discard that batch's files and re-run it. Over-budget data is usually retry-loop data.
- Coverage check fails (fewer files than batch lines) → re-run only the missing slugs, not the whole batch.
- Whole wave fails identically → the platform changed. Stop, re-run recon, update `references/ats-platforms.md` before spending more calls.

## Layers on top of

`scoring-rubric.md` owns the bands and the evidence bar. The copy inside each prompt below is operative rather than duplicated: a subagent receives the prompt without the repository, so the rules have to travel with it. When the two disagree, `scoring-rubric.md` wins and this file is stale.
