---
name: recruiting-candidates
description: Run a recruiting req end to end in a real browser — source candidates from job boards, ATS dashboards, and professional networks, screen them against a role profile, enrich the survivors, then sync to the ATS or submit applications behind an approval gate. Outputs a ranked candidate report, a CSV, and a per-candidate evidence file. Use when the user wants to source or screen candidates, build a shortlist for a req, move candidates through an ATS, or bulk-apply to job postings. Triggers "source candidates for", "screen these applicants", "build a shortlist", "fill this req", "sync candidates to Greenhouse/Lever/Ashby", "apply to these jobs".
license: MIT
---

# Recruiting candidates

Take a req → get a ranked shortlist with a "why this person" rationale per candidate, every claim backed by a line of evidence, and a one-approval path to the ATS.

Recruiting breaks at the seams between systems: the board, the sourcing tool, the ATS, the inbox. Each seam is a human copying fields. This skill closes the seams with real browser sessions — the same Chrome a recruiter uses, with login state that survives across runs — so the workflow runs unattended without an integration for every vendor.

**Required**: Browserbase-backed browser tools (`browser_*`, `stagehand_*`) and a role profile in `profiles/`. No API keys to manage in-skill — Opulent injects the thread's browser context automatically.

## Ownership

This skill owns the req pipeline: sourcing, screening, enrichment, and the handoff into the ATS or an application form. It does not own writing the job description, making the hire/no-hire call, or sending outreach copy the user has not read.

**Output directory**: everything lands in `/opulent/workspace/recruiting/{req_slug}_{YYYY-MM-DD-HHMM}/`. Final deliverables are `index.html` (ranked candidate cards), `results.csv` (ATS/CRM import), and `candidates/{slug}.md` (one evidence file per person). Pass the full literal path to every subagent — never `~` or `$HOME`.

---

## CRITICAL — Session discipline

Browser sessions are the scarce resource. A leaked session holds a concurrency slot until it times out, and the next subagent blocks behind it.

- **One `browser_start` per subagent, reused for every page.** Never start a session per URL.
- **Always `browser_end_session` in the same subagent that started it**, including on the failure path. A subagent that returns without ending its session has failed the run even if its data is good.
- **Never exceed `browser_concurrency` from the profile** (default `3`). That is the Browserbase project limit, not a suggestion — over-fanning produces queued sessions that look like hangs.
- **Batch with `browser_batch`.** Up to 20 ordered actions ride one CDP connection. Any step that does not need a model decision in between belongs in the batch. This is the single biggest latency lever in the pipeline.
- **Never handle credentials.** If a source requires login, do not type a password. Call `browser_get_live_view`, hand the URL to the user, and let them authenticate in the live session. The thread's browser context persists that login for subsequent runs — that is the whole point of persistent contexts.

## CRITICAL — Tool restrictions (main agent AND all subagents)

- Page reading: `browser_get_content` (returns title, cleaned text, links, headings, and form-field selector hints). Use it instead of screenshots when you need to *read* a page.
- Structured extraction on JS-heavy pages: `stagehand_extract` with an explicit `schema`. Do not regex the raw HTML.
- Selector discovery before acting: `stagehand_observe` with `returnAction: true`. Do not guess selectors from memory.
- Multi-field forms: `browser_fill_form` (one round-trip, `maxRetries` self-correction). Never a chain of `browser_type` calls — partial form state is the most common failure mode.
- Open discovery outside a board: `web_search`. Known page, no interaction needed: `web_fetch`. Do not spin up a browser session to read a static page.
- Evidence files: subagents write **one markdown file per candidate** to `{OUTPUT_DIR}/candidates/{slug}.md` via a single bash heredoc call. One Bash call = one permission prompt.
- `stagehand_agent` is the last resort, capped at `maxSteps: 12`. Reach for it only after `observe` → `act` has failed twice on the same page.
- **Subagents get Bash + browser tools only.**
- **HARD TOOL-CALL CAPS**: screening = 1 page read/candidate; enrichment = 4 calls/candidate; application = 1 `browser_batch` + 1 upload + 1 screenshot per job. See `references/workflow.md` for enforcement.

## CRITICAL — Fair-screening rules

Screening output is an employment record. Treat it like one.

- **Score only on job-related evidence**: skills, scope, years in a comparable role, shipped work, domain. Nothing else.
- **Never** let name, photo, age, gender, pronouns, nationality, marital or parental status, disability, or graduation year enter `fit_score` or `fit_reasoning`. Do not record them in the candidate file at all.
- School and employer names are **signals, not scores** — a brand name alone never moves a score. Cite the work, not the logo.
- Every scored claim must quote or closely paraphrase a line from a page read. No quote, no claim.
- If evidence is thin, write `Unknown — profile returned no readable content` and cap `fit_score` at 3. A capped score is a correct outcome, not a failure to retry around.
- Log the rubric version in every candidate file (`rubric: v1`) so a shortlist stays auditable after the rubric changes.

## CRITICAL — Approval gates

Sourcing and screening are read-only and run unattended. Everything that writes to the outside world stops for the user:

| Action | Gate |
|---|---|
| Source, screen, enrich | None — run silently |
| Write to ATS (stage move, field update, note) | `ask_question`, once, with the exact record count |
| Submit a job application | `ask_question` after a dry-run preview of application #1 |
| Send outreach | Out of scope — this skill drafts, the user sends |

Dry-run is the default for every write lane. `--live` on the invocation does not skip the gate; it only pre-selects the affirmative option.

---

## Pipeline Overview

Follow these 9 steps in order. Do not skip or reorder.

0. **Setup** — output dir + clean slate
1. **Load role profile** — `profiles/{req_slug}.json`
2. **Recon** — detect the platform behind each source URL
3. **Source** — extract people or postings → `raw/*.jsonl`
4. **Normalize** — dedupe across sources → `candidates.jsonl`
5. **Screen** — fast role-fit triage (1 call/candidate)
6. **Filter** — keep `fit_score >= --fit-threshold`
7. **Enrich** — deep evidence on the survivors (4 calls/candidate)
8. **Act** — Lane A (ATS sync) or Lane B (application submission), behind the gate
9. **Compile** — HTML report, CSV, artifact, chat summary

Invoke with `/recruiting-candidates <source-url> [--req <slug>] [--fit-threshold 6] [--depth deep] [--live]`. Defaults: `DEPTH=deep`, `FIT_THRESHOLD=6`, dry-run. Parse the source URL from the invocation — do not ask the user to confirm a URL they just typed.

---

## Step 0: Setup Output Directory

Derive everything from the invocation. Hardcode no req name.

```bash
REQ_SLUG=${REQ_SLUG:-$(node -e 'const h=new URL(process.argv[1]).hostname.replace(/^www\./,"");console.log(h.split(".")[0])' "$SOURCE_URL")}
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
OUTPUT_DIR=/opulent/workspace/recruiting/${REQ_SLUG}_${TIMESTAMP}
mkdir -p "$OUTPUT_DIR/raw" "$OUTPUT_DIR/candidates" "$OUTPUT_DIR/proof"
echo "$OUTPUT_DIR"
```

Pass `{OUTPUT_DIR}` as a full literal path into every subagent prompt.

## Step 1: Load Role Profile

The profile is the rubric. Screening scores against it, enrichment writes against it, and the report is titled by it. Load from `{SKILL_DIR}/profiles/{req_slug}.json`. `example.json` is a template — never score against it.

**Resolution order**:
1. `--req <slug>` on the invocation wins.
2. Else list `profiles/*.json` minus `example.json`. Exactly one → use it and say which. Several → ask the user which req this run is for.
3. Zero → **fail loudly**. Tell the user to copy `profiles/example.json` to `profiles/<req>.json` and fill it in. Do not invent a rubric.

```bash
PROFILES=$(ls {SKILL_DIR}/profiles/*.json 2>/dev/null | xargs -n1 basename | sed 's/\.json$//' | grep -v '^example$')
COUNT=$(echo "$PROFILES" | grep -c .)
test -f {SKILL_DIR}/profiles/${REQ_SLUG}.json || { echo "Profile not found: profiles/${REQ_SLUG}.json"; exit 1; }
cat {SKILL_DIR}/profiles/${REQ_SLUG}.json
```

The profile yields `role_title`, `must_haves`, `nice_to_haves`, `disqualifiers`, `seniority_band`, `locations`, `ats`, `browser_concurrency`, and (Lane B only) `applicant`. These get embedded **verbatim** in every subagent prompt — a paraphrased rubric scores a different req.

Never read profiles from another skill's directory. If the user wants one shared, they copy it.

## Step 2: Recon

Identify what is behind the source URL before you try to parse it. One browser session, one batch:

```
browser_start      { viewportPreset: "desktop", intent: "recon" }
browser_batch      { sessionId, actions: [
                       { action: "navigate", url: SOURCE_URL },
                       { action: "content" },
                       { action: "screenshot" }
                   ]}
browser_end_session { sessionId }
```

Classify from the returned content and write `{OUTPUT_DIR}/recon.json` with `platform`, `strategy`, `auth_required`, and `pagination`:

| Signal in content/URL | `platform` | `strategy` |
|---|---|---|
| `boards.greenhouse.io`, `grnh.se`, `#grnhse_app` | `greenhouse` | `dom` |
| `jobs.lever.co`, `.posting-` classes | `lever` | `dom` |
| `jobs.ashbyhq.com`, `__NEXT_DATA__` present | `ashby` | `next-data` |
| `myworkdayjobs.com`, `data-automation-id` | `workday` | `stagehand` |
| `apply.workable.com`, `smartrecruiters.com` | `workable`/`smartrecruiters` | `dom` |
| Login wall / MFA challenge | any | `assisted` |
| Anything else | `custom` | `stagehand` |

See `references/ats-platforms.md` for selector catalogs, pagination shapes, and the known traps per platform. If `auth_required` is true, stop and run the live-view handoff from that reference — do not attempt to log in.

## Step 3: Source

Two source shapes, same output contract.

**People sourcing** (a talent pool, a search result page, a conference speaker list, an ATS candidate table) — extract one record per person:

```
stagehand_extract { sessionId, instruction: "Extract every candidate row visible on this page",
  schema: { type: "object", properties: { candidates: { type: "array", items: { type: "object",
    properties: { name:{type:"string"}, title:{type:"string"}, company:{type:"string"},
                  location:{type:"string"}, profile_url:{type:"string"}, source_note:{type:"string"} },
    required: ["name","profile_url"] }}}}}
```

**Posting sourcing** (Lane B — the jobs the user will apply to) — extract one record per posting with `job_title`, `job_url`, `company`, `location`.

Paginate with `browser_batch` (`click` next → `content`, repeated), appending each page to `{OUTPUT_DIR}/raw/page_{N}.jsonl`. Stop at the profile's `max_sourced` or when a page yields zero new records.

Sanity-check before fanning out:

```bash
wc -l {OUTPUT_DIR}/raw/*.jsonl
head -3 {OUTPUT_DIR}/raw/page_1.jsonl
```

Fewer than ~10 records on a page that visibly had more means recon picked the wrong strategy. Re-run Step 2 against `references/ats-platforms.md` rather than hand-writing selectors.

## Step 4: Normalize

The same person shows up as three records across three sources. Collapse them before spending a screening call on each:

```bash
node {SKILL_DIR}/scripts/normalize_candidates.mjs {OUTPUT_DIR}
```

Merges on identity key (profile URL → email → name+company), unions the fields, and writes `{OUTPUT_DIR}/candidates.jsonl` plus `{OUTPUT_DIR}/seed_candidates.txt` (`slug|name|company|primary_url`, deduped and sorted). Expect a 10–30% collapse when sourcing from more than one place.

## Step 5: Screen

**Fast pass — one page read per candidate, no enrichment.** Score every candidate in `seed_candidates.txt` against the profile rubric and write a triage stub to `candidates/{slug}.md`.

Split into batches of ~10 and fan out one subagent per batch, **never more than `browser_concurrency` at a time**:

```bash
split -l 10 {OUTPUT_DIR}/seed_candidates.txt {OUTPUT_DIR}/_batch_screen_
ls {OUTPUT_DIR}/_batch_screen_* | wc -l
```

Each subagent runs the **Screening** prompt from `references/workflow.md` with `{SKILL_DIR}`, `{OUTPUT_DIR}`, `{ROLE_TITLE}`, `{MUST_HAVES}`, `{NICE_TO_HAVES}`, `{DISQUALIFIERS}`, `{CANDIDATE_LIST}`, and `{TOTAL}` substituted. Hard cap: **1 page read per candidate**, enforced by the `# browser call N/{TOTAL}` comment pattern.

Verify coverage before moving on:

```bash
ls {OUTPUT_DIR}/candidates/*.md | wc -l   # must equal wc -l seed_candidates.txt
rm {OUTPUT_DIR}/_batch_screen_*
```

## Step 6: Filter

```bash
THRESHOLD=6   # --fit-threshold
for f in {OUTPUT_DIR}/candidates/*.md; do
  score=$(awk '/^fit_score:/{print $2; exit}' "$f")
  [ -n "$score" ] && [ "$score" -ge "$THRESHOLD" ] && basename "$f" .md
done > {OUTPUT_DIR}/fits.txt
wc -l {OUTPUT_DIR}/fits.txt
```

Expect 15–35% survival. Below 10% means the rubric is narrower than the sourcing query — surface that to the user with both numbers before burning enrichment calls; the fix is usually the source, not the threshold.

## Step 7: Enrich

Deep evidence on survivors only. Hard cap: **4 calls per candidate**, four lanes:

1. `web_search "{name} {company} linkedin"` — canonical profile (always)
2. `web_search "{name} github OR blog OR talk 2026"` — shipped work (deep+)
3. `browser_get_content` on the single best result — the actual evidence (deep+)
4. `web_search "{name} {domain} conference OR podcast"` — public signal (deeper only)

Quick mode skips Step 7. Deep runs lanes 1–3. Deeper runs all four.

Batch ~5 candidates per subagent, one subagent per available concurrency slot, using the **Enrichment** prompt from `references/workflow.md`. Subagents **overwrite** the triage stub with the enriched version and flip `triage_only: false`.

```bash
grep -l "triage_only: false" {OUTPUT_DIR}/candidates/*.md | wc -l   # must equal wc -l fits.txt
```

## Step 8: Act

Pick the lane from the profile's `ats` block and the invocation. Both lanes stop at the gate.

### Lane A — ATS sync

Move the shortlist into the ATS the way a recruiter does: real session, real form, real audit trail.

1. Build the change set — one line per candidate: `slug|ats_action|target_stage|note`.
2. Preview it in chat as a table, then gate:

```
ask_question {
  question: "Push {N} candidates to {ATS} — {M} new records, {K} stage moves?",
  fields: [{ name: "approve", label: "Push to ATS", type: "confirm", required: true }],
  reason: "Writes to your ATS of record. Dry-run so far — nothing has left this workspace.",
  urgency: "blocking"
}
```

3. On approval, one subagent per concurrency slot, each with its own session:
   `browser_start` → `stagehand_observe` the target form → `browser_fill_form` → `browser_screenshot` into `{OUTPUT_DIR}/proof/{slug}.png` → `browser_end_session`.
4. Verify by re-reading the record — a `200` is not proof the field took. Log `ats_synced: true` in the candidate file only after the re-read confirms it.

### Lane B — Application submission

Applies **as the user**, using the `applicant` block from the profile — real name, real email, the resume at `applicant.resume_path`. Never synthesize identities to inflate volume; the only exception is a test board the user owns, declared as `applicant.mode: "loadtest"`.

Per posting, one batch:

```
browser_start        { viewportPreset: "desktop" }
browser_upload_file  { sessionId, filePath: "/opulent/workspace/uploads/{resume}.pdf" }
stagehand_observe    { sessionId, instruction: "Locate every required application field", returnAction: true }
browser_fill_form    { sessionId, fields: [...], maxRetries: 3 }        # no submitSelector on the dry run
browser_screenshot   { sessionId, fullPage: true }                      # → proof/{job_slug}_preview.png
browser_end_session  { sessionId }
```

Show the user the filled-but-unsubmitted screenshot for application #1, then gate on the whole run. On approval, re-run with `submitSelector` set, capture a post-submit screenshot as the receipt, and record `applied_at` + `confirmation_text` per posting.

Respect the concurrency limit here too — the semaphore is `browser_concurrency`, and applications are the longest-running sessions in the pipeline. Never retry a submit blind: re-read the page first, because a "failed" submit that actually landed becomes a duplicate application.

## Step 9: Compile

```bash
node {SKILL_DIR}/scripts/compile_report.mjs {OUTPUT_DIR}
```

Generates:
- `{OUTPUT_DIR}/index.html` — candidate cards ranked by fit, filterable by band
- `{OUTPUT_DIR}/results.csv` — ATS/CRM-ready import
- `{OUTPUT_DIR}/summary.json` — counts and score distribution for the chat summary

Then surface the table in the workbench with `create_spreadsheet_artifact` (headers from the CSV) and post the summary:

```
## Shortlist ready — {Role Title}

- **Sourced**: {count} ({collapsed} duplicates merged)
- **Screened**: {count} · **Fits (≥ {threshold})**: {count} · **Enriched**: {count}
- **Distribution**: strong 8-10: {n} · partial 5-7: {n} · weak 1-4: {n}
- **Lane**: {A: ATS sync — {n} synced | B: applications — {n} submitted | dry-run only}
- **Report**: {OUTPUT_DIR}/index.html
```

Show the **top 5 candidate cards** as a markdown table sorted by fit score, each with its one-line evidence quote. Then offer to: adjust `--fit-threshold` and re-run Steps 6–9, widen sourcing with another source URL, or draft outreach for the top N (drafts only — the user sends).

---

## Failure modes worth naming

| Symptom | Cause | Fix |
|---|---|---|
| Subagents hang at start | More sessions than `browser_concurrency` | Lower fan-out; check for un-ended sessions from the last run |
| Every candidate scores 3 | Source page needed auth; content came back empty | Live-view handoff in Step 2, then re-source |
| Form fills, submit does nothing | Selector matched a hidden duplicate node | `stagehand_observe` with `returnAction: true`, use the returned selector |
| Duplicate applications | Blind retry after an ambiguous submit | Re-read the page before any retry |
| Shortlist looks arbitrary | Rubric paraphrased into subagent prompts | Embed profile fields verbatim; re-run Step 5 |
