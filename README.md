# recruiting-candidates

A recruiting skill for Opulent, built on the Browserbase recruiting patterns: source → screen → enrich → act, all through real browser sessions with persistent login state.

## What it does

This skill runs a hiring req end to end in a real browser instead of across four tabs and a spreadsheet. You point it at a source — a job board, an ATS candidate list, a talent pool, a conference speaker page — and it pulls out the people, collapses the duplicates that show up when the same person appears in three places, and scores each one against the rubric you wrote for that specific req. Screening is deliberately cheap: one page read per person, and anyone whose page is too thin to judge gets capped at 3 rather than guessed about. Only the candidates who clear your threshold get the expensive treatment — four more lookups for public evidence of what they've actually shipped, which can move their score by at most two points and only if there's a new quote to back it. What comes out is a ranked shortlist where every claim carries the line of text that supports it, plus a spreadsheet you can hand to a hiring manager. From there the skill can push the shortlist into your ATS or fill out job applications on your behalf, but both of those stop and ask before anything leaves the workspace — sourcing and screening run unattended, writes never do. Throughout, it scores only on job-related evidence and never records protected attributes at all, so the output reads like something you'd be comfortable showing the candidate.

## Required inputs

| Input | Where | Required | Notes |
|---|---|---|---|
| Source URL | Invocation — `/recruiting-candidates <url>` | **Yes** | Job board, ATS list, talent pool, or speaker page. Determines the recon strategy. |
| Role profile | `profiles/{req-slug}.json` | **Yes** | The rubric. Copy `example.json` and fill it in — the run fails loudly rather than inventing one. |
| → `role_title`, `seniority_band` | profile | **Yes** | Concrete band, not a title. "Owns a platform surface" beats "Staff". |
| → `must_haves` | profile | **Yes** | What the score is actually measured against. Vague must-haves, vague shortlist. |
| → `disqualifiers` | profile | No | Hard, checkable, job-related facts only. Caps a score at 2. |
| → `locations`, `max_sourced` | profile | No | Work-authorization / time-zone scope; sourcing ceiling. |
| → `browser_concurrency` | profile | **Yes** | Your Browserbase project session limit. Exceeding it queues sessions and looks like a hang. |
| → `ats` block | profile | Lane A only | ATS name, URL, default stage, note template. |
| → `applicant` block + resume | profile + `/opulent/workspace/uploads/` | Lane B only | The user's real identity and resume path. No synthesized identities. |
| Browser automation | Opulent runtime | **Yes** | Must hold an authenticated session. Browser context is injected automatically — no API key handling in-skill. |
| A human, once | Live view | If auth-walled | Sign-in and MFA happen in the live session; the skill never types a credential. Login then persists across runs. |
| A human, once | Approval gate | Lane A/B only | One blocking question before any ATS write or application submit. |

## Expected outputs

Everything lands in `/opulent/workspace/recruiting/{req_slug}_{YYYY-MM-DD-HHMM}/`.

| Output | What it is |
|---|---|
| `index.html` | The deliverable. Candidate cards ranked by fit, filterable by band, each with its score, reasoning, evidence quote, met/gap chips, public signals, and an outreach hook. Renders light and dark, no external assets. |
| `results.csv` | 18 columns, one row per candidate, ready for an ATS or CRM import. Formula injection from scraped text is neutralized. |
| `candidates/{slug}.md` | One evidence file per person — frontmatter plus an `## Evidence` section where every bullet carries a source URL. This is the audit trail; it outlives the report. |
| `summary.json` | Counts, score distribution, and the top 5 — what the chat summary is built from. |
| `candidates.jsonl` | Normalized, deduped candidate records with merge provenance (`sources`, `source_note`). |
| `seed_candidates.txt` | `slug\|name\|company\|url`, the batching input for screening. |
| `raw/*.jsonl` | Untouched sourced records, one file per page — keep them to re-run screening without re-sourcing. |
| `recon.json` | Detected platform, strategy, auth and pagination shape. First thing to read when a run comes back empty. |
| `proof/*.png` | Screenshots of every ATS write and application submit. Dry-run previews land here too. |
| Workbench artifact | The same table, rendered interactively. |
| Chat summary | Counts, distribution, lane result, and the top 5 as a markdown table. |

A healthy run puts 15–35% of sourced candidates over a threshold of 6. Above 50% the sourcing query isn't filtering; below 10% the source is wrong for the req, and widening the source beats lowering the bar.

## Status

**Isolated by design.** This package sits outside `.agents/skills/` in the Opulent monorepo — not in the skill catalog, not in the template SSOT, not in the preloaded seed — so nothing here can affect the snapshot-skill contract tests. It is self-contained: read it, run the scripts from it, promote it when you want it live.

## Layout

```
recruiting-candidates/
├── SKILL.md                        the pipeline — 9 steps, session discipline, approval gates
├── profiles/
│   └── example.json                role profile: rubric + ATS target + applicant identity
├── references/
│   ├── workflow.md                 subagent prompt templates, hard call caps, wave sizing
│   └── (each reference declares what it layers on rather than restating it)
│   ├── ats-platforms.md            Greenhouse/Lever/Ashby/Workday/Workable detection + traps
│   ├── scoring-rubric.md           bands, evidence bar, protected-attribute exclusions
│   └── example-research.md         exact frontmatter for triage / enriched / sourced records
└── scripts/
    ├── lint_candidates.mjs          the scoring contract, made executable
    ├── normalize_candidates.mjs    dedupe across sources on URL → email → name+company
    └── compile_report.mjs          candidates/*.md → index.html + results.csv + summary.json
```

## Try it

A ready-to-run **Head of AI Partnerships** req, live ATS source URLs, and an offline fixture live in [`samples/`](samples/README.md). Fastest path — both scripts end to end, no browser, no keys:

```bash
cp -R samples/fixture /tmp/rc-demo && node scripts/normalize_candidates.mjs /tmp/rc-demo && node scripts/compile_report.mjs /tmp/rc-demo --open
```

## Try the scripts without a browser

Both scripts are dependency-free Node 18+ and run standalone:

```bash
node scripts/normalize_candidates.mjs /path/to/run_dir     # reads run_dir/raw/*.jsonl
```

```bash
node scripts/compile_report.mjs /path/to/run_dir --open    # reads run_dir/candidates/*.md
```

`normalize_candidates.mjs` drops protected attributes on the way in and merges duplicate records; `compile_report.mjs` escapes all scraped text into HTML and neutralizes spreadsheet formula injection in the CSV. Both were verified against fixtures covering malformed JSONL, wrapped `{candidates:[...]}` payloads, tracking-param URL variants, junk links, and a `=CMD|...` name.

## Setup before a real run

1. Copy `profiles/example.json` to `profiles/<req-slug>.json` and fill in `must_haves`, `disqualifiers`, `seniority_band`, and `locations`. The profile *is* the rubric — vague must-haves produce a vague shortlist.
2. Set `browser_concurrency` to your Browserbase project's session limit.
3. Lane B only: put the resume at `applicant.resume_path` (default `/opulent/workspace/uploads/resume.pdf`) and fill the `applicant` block with the user's real details.

## Promoting it into the catalog

If this graduates out of the lab, follow the sync chain in order — skipping a step breaks a contract test:

1. Move the folder to `frontend/templates/convex-nextjs/.agents/skills/recruiting-candidates/` (the SSOT).
2. `node scripts/generate-template-workspace-index.mjs` — regenerates the workspace index and fingerprints.
3. Add the seed entry in `frontend/convex/lib/preloadedOpulentiaSkillFiles.ts` if it should be an entry skill.
4. Register the slug in `OPULENTIA_SKILL_SEED_SLUGS` and the router rows in `workspaceSkillPaths.ts`.

The slug already follows catalog convention (unprefixed, gerund form), and the frontmatter is `name` + `description` + `license` only.

## Provenance

Modeled on [browserbase/skills](https://github.com/browserbase/skills) — the pipeline shape, hard tool-call caps, anti-hallucination rules, and heredoc-batched subagent writes come from `event-prospecting` and `company-research`. The Lane B application flow follows the [job-application template](https://www.browserbase.com/templates/job-application); the sourcing/ATS/application/outreach decomposition follows [recruiting automation](https://www.browserbase.com/use-case/recruiting-automation). Tool calls are rewritten against Opulent's own `browser_*` / `stagehand_*` surface.
