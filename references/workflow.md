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

**HARD CAP: 1 page read per candidate.** The only allowed call is one `browser_get_content` (or `web_fetch` when the profile URL is static). No follow-up searches, no secondary fetches. A thin profile scores `Unknown` and caps at 3 — that is the designed outcome, not a failure to route around.

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

Use the slug verbatim as the filename. Do not re-slugify — you will create duplicates.

SESSION RULES — CRITICAL:
1. Call browser_start ONCE at the beginning. Reuse that sessionId for every candidate.
2. Call browser_end_session at the END, including if you hit errors. A leaked session blocks the next batch.
3. Read pages with: browser_batch { sessionId, actions: [{ action: "navigate", url }, { action: "content" }] }
   That is ONE call covering navigate + read. Use it.
4. HARD CAP: one such call per candidate. If content comes back empty or auth-walled, write
   evidence: "Unknown — profile returned no readable content" and cap fit_score at 3. DO NOT retry.
5. ENFORCEMENT — prepend `# browser call N/{TOTAL}` to every call, N counting up.
6. BANNED: stagehand_agent, WebFetch, WebSearch, Write, Read, Glob, Grep. Bash + browser_* only.
7. Never use ~ or $HOME. Full literal paths only.
8. Never type a password or handle a credential. Auth-walled → score 3 and move on.

FAIR-SCREENING RULES — non-negotiable:
- Score ONLY on job-related evidence: skills, scope, years in a comparable role, shipped work, domain.
- NEVER let name, photo, age, gender, pronouns, nationality, marital/parental status, disability, or
  graduation year influence fit_score or fit_reasoning. Do not record them in the file at all.
- School and employer names are signals, not scores. Cite the work, not the logo.
- Every scored claim must quote or closely paraphrase a line from the page you read. No quote, no claim.
- NEVER infer seniority from page design, profile completeness, follower counts, or headshot quality.
- If you cannot tell what the person actually does, write "Unknown" — do not pattern-match them onto
  the role rubric because they share a job title.

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
- 1 × `web_search` — canonical profile
- 1 × `web_search` — shipped work (github / blog / talk)
- 1 × `browser_get_content` — the single best result, read properly
- 1 × `web_search` — public signal (deeper mode only)

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
1. web_search "{name} {company} linkedin"
2. web_search "{name} github OR blog OR conference talk"
3. browser_get_content on the single most substantive result from lanes 1-2
4. web_search "{name} {domain} podcast OR panel"   (deeper only)

RULES:
- HARD CAP {LANES} calls per candidate. Prepend `# call N/{TOTAL}` where TOTAL = {LANES} × batch size.
- One browser_start for the whole batch; browser_end_session before you return, always.
- Carry forward fit_score from the stub. Enrichment may adjust it by at most ±2, and only with a new
  quoted line of evidence. Record the delta and its reason in `score_adjustment`.
- The outreach_hook MUST quote a specific public artifact (repo, post title, talk, shipped feature).
  If no public signal exists, fall back to the role itself: "leads {scope} at {company}". Never invent
  a shared interest, a mutual connection, or a personal detail.
- Fair-screening rules from the Screening section apply unchanged.
- BANNED: stagehand_agent, Write tool, python3 -c. Bash + browser_* + web_search only.

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

**Runs only after the `ask_question` gate returns approve.** One subagent per concurrency slot, ~5 records each.

**HARD CAP: 3 browser calls per record** — observe, fill, verify-read. The screenshot rides inside the batch.

```
You are an ATS sync subagent. Push each record in your batch into {ATS_NAME} at {ATS_URL}.

RECORDS (one per line — `slug|ats_action|target_stage|note`):
{CHANGE_SET}

PROCEDURE per record:
1. stagehand_observe { instruction: "Locate the {ats_action} control for this candidate", returnAction: true }
2. browser_fill_form { fields: [...from the observed selectors...], maxRetries: 3 }
3. browser_batch { actions: [{ action: "content" }, { action: "screenshot" }] }  ← verify + proof in one
4. Confirm the re-read shows the new stage/field. A 200 is not proof. If unconfirmed, mark
   ats_synced: false with the reason — DO NOT retry blind, a partial write plus a retry is a duplicate.

RULES:
- One session for the batch. browser_end_session before returning, always.
- Never create a candidate record that already exists — check the re-read from the previous step first.
- Never type credentials. If the session is logged out, stop the batch and report `auth_required`.
- Write the screenshot to {OUTPUT_DIR}/proof/{slug}.png and set `proof: proof/{slug}.png` in the file.

Report back ONLY: "Synced {n}/{total}, {k} unconfirmed ({slugs}), session ended: yes".
```

---

## Application

**Runs only after the dry-run preview is approved.** This lane submits on the user's behalf with the user's own identity from `profiles/{req}.json` → `applicant`.

**HARD CAP per posting: 1 `browser_batch` + 1 upload + 1 screenshot.**

```
You are an application subagent. Apply to each posting in your batch as the applicant below.

APPLICANT (verbatim from the role profile — do not alter, do not synthesize):
{APPLICANT_BLOCK}
Resume: {RESUME_PATH}

POSTINGS (one per line — `job_slug|job_url|company`):
{POSTING_BATCH}

MODE: {dry_run | live}

PROCEDURE per posting:
1. browser_upload_file { sessionId, filePath: "{RESUME_PATH}" }
2. stagehand_observe { instruction: "Locate every required application field and the submit control",
                       returnAction: true }
3. browser_fill_form { sessionId, fields: [...], maxRetries: 3 }
   - dry_run: omit submitSelector entirely.
   - live: set submitSelector from the observed action, waitForContent: true.
4. browser_screenshot { fullPage: true } → {OUTPUT_DIR}/proof/{job_slug}_{mode}.png
5. live only: read the confirmation text off the page and record it. No confirmation text = no
   applied_at. Report it as unconfirmed rather than guessing.

RULES:
- NEVER generate a fake name, email, or identity. The applicant block is the only identity.
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

`browser_concurrency` comes from the profile and mirrors the Browserbase project limit. It is a ceiling on *simultaneous sessions*, not on subagents — a subagent waiting on a heredoc write is not holding a slot, but one mid-`browser_batch` is.

**Waves**: dispatch up to `browser_concurrency` subagents per message. Start the next wave only after the previous returns. Batch files (`_batch_*`) are deleted by the main agent after each step verifies coverage.

**Error handling**

- Subagent returns without "session ended: yes" → treat the batch as suspect, list sessions, end orphans before the next wave.
- Subagent busts its cap (visible in the `# call N/TOTAL` log) → discard that batch's files and re-run it. Over-budget data is usually retry-loop data.
- Coverage check fails (fewer files than batch lines) → re-run only the missing slugs, not the whole batch.
- Whole wave fails identically → the platform changed. Stop, re-run recon, update `references/ats-platforms.md` before spending more calls.
