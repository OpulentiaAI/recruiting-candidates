# ATS & sourcing platform catalog

Detection order, extraction strategy, and the trap that bites first — per platform. Update this file when a wave fails identically across a platform; that is cheaper than re-deriving selectors every run.

## Detection priority

Run in this order and stop at the first hit. URL first (free), then DOM markers from a page read.

1. **URL host match** — the host almost always names the ATS.
2. **`__NEXT_DATA__` present** → JSON payload lives in the page; prefer `next-data` over DOM scraping.
3. **Known DOM markers** — the table below.
4. **Login wall / MFA** → `strategy: "assisted"` regardless of platform.
5. **Nothing matched** → `strategy: "schema"`, extract against an explicit schema.

## Platforms

### Greenhouse
- **Detect**: `boards.greenhouse.io`, `grnh.se`, embedded `#grnhse_app` iframe.
- **Strategy**: `dom`. Postings are server-rendered; a page read is enough.
- **Shape**: `.opening` rows → title anchor + `.location` span. Embedded boards put everything inside the iframe — navigate to the `boards.greenhouse.io` URL directly rather than fighting frame context.
- **Application form**: standard field names (`first_name`, `last_name`, `email`, `resume`). Custom questions render as `question_*` ids that differ per company — always resolve the control on the live page before filling.
- **Trap**: the resume field is a drag-drop zone with a hidden `input[type=file]`. Target that input directly; clicking the visible zone opens an OS dialog you cannot close.

### Lever
- **Detect**: `jobs.lever.co`, `.posting`, `.posting-categories`.
- **Strategy**: `dom`.
- **Shape**: `.posting` blocks with `.posting-title h5` and `.posting-categories .location`. No pagination — the whole board is one page.
- **Application form**: `/apply` appended to the posting URL. Fields carry `name="name"`, `name="email"`, `name="resume"`.
- **Trap**: some boards gate `/apply` behind a redirect to a company-hosted form. Re-run recon on the landing URL rather than assuming Lever selectors hold.

### Ashby
- **Detect**: `jobs.ashbyhq.com`, `window.__appData` present in the HTML.
- **Strategy**: `app-data` — parse the embedded JSON, do not scrape cards. Verified against `jobs.ashbyhq.com/openai` (2026-08): the served HTML carries `window.__appData` with a `jobPostings` array of ~690 records, each `{ id, title, teamId, locationId, locationName, workplaceType, employmentType, secondaryLocations }`, plus a sibling `teams` array to resolve `teamId`. One fetch gets the whole board — no pagination, no scrolling.
- Posting URLs are `https://jobs.ashbyhq.com/{board}/{id}` using the record's UUID.
- **Not `__NEXT_DATA__`.** Older Ashby boards used it; current ones do not. Detect on `window.__appData`, and fall back to schema extraction when neither is present.
- **Application form**: React-controlled inputs. A proper form fill emits the change events these need; assigning values directly does not.
- **Trap**: file upload is a custom component. Observe first, then upload against the resolved `input[type=file]`.

### Workday
- **Detect**: `myworkdayjobs.com`, `data-automation-id` attributes.
- **Strategy**: `schema`. Selectors are generated and shift between tenants.
- **Shape**: everything is `data-automation-id="..."`. Those are more stable than class names — prefer them whenever a live-page lookup returns them.
- **Trap**: multi-page application wizard with per-step validation, and an account requirement on most tenants. Account creation is out of scope for this skill — if the flow demands one, stop and hand off to the user via a live view of the session.

### Workable / SmartRecruiters
- **Detect**: `apply.workable.com`, `jobs.smartrecruiters.com`.
- **Strategy**: `dom`, falling back to schema-based extraction on infinite-scroll boards.
- **Trap**: Workable paginates by a "Show more" button, not page links. Batch click-then-read and stop when the record count stops growing.

### Professional networks & talent pools
- **Strategy**: `assisted` first run, `dom` thereafter.
- Auth-walled by design. Do the live-view handoff once; the thread's persistent browser context carries the session into later runs.
- **Rate discipline**: these platforms are the fastest way to get a session flagged. Keep concurrency at 1, keep the pace human, and stop on the first interstitial rather than retrying through it. Prefer an official export or API when the user has one — a CSV export beats any amount of scraping.
- **Trap**: results pages lazy-render on scroll. Batch scroll-then-read repeatedly; a single read captures ten rows and stops.

### Custom / careers pages
- **Strategy**: `schema` extraction.
- Most one-off career pages are static, so a plain fetch is cheaper. Escalate to a session when the content is JS-rendered or interaction is required.

## The live-view handoff

When recon returns `auth_required: true`, authentication belongs to the user.

Open a live view of the session and give the user that URL with a one-line instruction: sign in (and clear MFA) in that window, then say "done". Keep the session open while they work. On "done", re-read the page to confirm the authenticated state, then continue the pipeline.

The login persists in the thread's browser context, so later runs against the same platform skip this step. If a run that used to work comes back `auth_required`, the context expired — hand off again rather than treating it as a scraping failure.

## Access discipline

- Use the official API or export whenever the user has access to one. This skill exists for the seams where no integration exists, not to replace integrations that do.
- Honor each platform's terms and rate expectations. Sourcing at a human pace from an authenticated session the user owns is the intended mode.
- A CAPTCHA or interstitial is a live-view handoff, not a puzzle to solve.

## Layers on top of

`SKILL.md` owns session discipline and the caps. This file adds only what differs per platform: detection, selectors, pagination shape, and the trap that bites first.
