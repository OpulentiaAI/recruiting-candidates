# Sample inputs — Head of AI Partnerships

A ready-to-run req you can point the skill at, plus an offline fixture that exercises both scripts without opening a browser.

## What's real and what isn't

**Real**: the role profile (`head-of-ai-partnerships.json`) is a rubric you could actually hire against, and the source URLs below are live ATS boards, verified 2026-08-05.

**Synthetic**: every candidate record under `fixture/` is invented — fictional people at fictional companies (`example-talent.dev` is not a real host). They exist to exercise the parsers, not to represent anyone. Nothing in this repo contains data about a real candidate.

---

## 1. Install the profile

```bash
cp samples/head-of-ai-partnerships.json profiles/head-of-ai-partnerships.json
```

It ships filled in except the `applicant` block — that's the user's own identity for Lane B application submission and should stay empty unless you're testing that lane. Check `browser_concurrency: 3` against your Browserbase project limit before a real run.

## 2. Pick a live source

All three resolve as of 2026-08-05 and each exercises a different recon strategy:

| Source | Platform | Strategy | Why this one |
|---|---|---|---|
| `https://jobs.ashbyhq.com/openai` | Ashby | `app-data` | ~690 postings in one `window.__appData` payload, a dozen with "Partnership" in the title. Best first test — one fetch, no pagination, guaranteed non-empty. |
| `https://job-boards.greenhouse.io/databricks` | Greenhouse | `dom` | Server-rendered `.opening` rows. Tests the plain DOM path. |
| `https://jobs.lever.co/palantir` | Lever | `dom` | Whole board on one page, no pagination. Tests the Lever selector set. |

Then invoke:

```
/recruiting-candidates https://jobs.ashbyhq.com/openai --req head-of-ai-partnerships --fit-threshold 6 --depth deep
```

Sourcing and screening run unattended. Nothing is written anywhere outside the workspace unless you approve Lane A or Lane B at the gate.

**What to expect**: recon classifies Ashby and pulls the `jobPostings` array in one call; sourcing writes `raw/page_1.jsonl`; screening spends one page read per posting; the report ranks what survives the threshold. On a posting board (rather than a people board) the "candidates" are roles — useful for checking the plumbing end to end, and the exact input Lane B wants.

## 3. Offline test — no browser, no API keys

Copy the fixture somewhere writable and run both scripts:

```bash
cp -R samples/fixture /tmp/rc-demo && node scripts/normalize_candidates.mjs /tmp/rc-demo && node scripts/compile_report.mjs /tmp/rc-demo --open
```

Expected output:

```
files:       2      lines: 12    records: 12
unique:      9      merged: 2    malformed: 1    no-identity: 1

candidates: 8   strong: 2   partial: 3   weak: 3   enriched: 2
```

What each number proves:

- **merged: 2** — Rosalind Achebe appears twice with `?utm_source=…&ref=list#profile` on one copy, Tomas Lindqvist twice with a trailing slash and different field aliases (`full_name`/`headline`/`employer` vs `name`/`title`/`company`). Both collapse to one record, and the cleaner URL wins.
- **malformed: 1** — a deliberately broken JSON line in `page_2.jsonl` is counted, not fatal.
- **no-identity: 1** — a record with no name and no URL is dropped rather than slugged into `candidate-1`.
- **Protected attributes** — `page_1.jsonl` carries `photo_url`, `gender`, and `graduation_year` on one record. Grep the output: they are gone. `grep -c gender /tmp/rc-demo/candidates.jsonl` → `0`.
- **9 sourced but 8 screened** — deliberate. Kwame Boateng has no evidence file, which is exactly what the Step 5 coverage check catches (`ls candidates/*.md | wc -l` must equal `wc -l seed_candidates.txt`). Re-run only the missing slug, not the batch.
- **The band spread** exercises every rubric path: a `+1` enrichment adjustment with its reason, a title-match-but-wrong-domain at 4, a hard disqualifier at 2 recorded with its evidence line, and an auth-walled profile capped at 3 rather than guessed.

Open `/tmp/rc-demo/index.html` for the ranked cards and `results.csv` for the 18-column import.
