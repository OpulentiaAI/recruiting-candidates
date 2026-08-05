# ATS & sourcing platform catalog

Detection order, extraction strategy, and the trap that bites first — per platform. Update this file when a wave fails identically across a platform; that is cheaper than re-deriving selectors every run.

## Detection priority

Run in this order and stop at the first hit. URL first (free), then DOM markers from `browser_get_content`.

1. **URL host match** — the host almost always names the ATS.
2. **`__NEXT_DATA__` present** → JSON payload lives in the page; prefer `next-data` over DOM scraping.
3. **Known DOM markers** — the table below.
4. **Login wall / MFA** → `strategy: "assisted"` regardless of platform.
5. **Nothing matched** → `strategy: "stagehand"`, extract with an explicit schema.

## Platforms

### Greenhouse
- **Detect**: `boards.greenhouse.io`, `grnh.se`, embedded `#grnhse_app` iframe.
- **Strategy**: `dom`. Postings are server-rendered; `browser_get_content` is enough.
- **Shape**: `.opening` rows → title anchor + `.location` span. Embedded boards put everything inside the iframe — navigate to the `boards.greenhouse.io` URL directly rather than fighting frame context.
- **Application form**: standard field names (`first_name`, `last_name`, `email`, `resume`). Custom questions render as `question_*` ids that differ per company — always `stagehand_observe` before filling.
- **Trap**: the resume field is a drag-drop zone with a hidden `input[type=file]`. `browser_upload_file` targets the input correctly; a click on the visible zone opens an OS dialog you cannot close.

### Lever
- **Detect**: `jobs.lever.co`, `.posting`, `.posting-categories`.
- **Strategy**: `dom`.
- **Shape**: `.posting` blocks with `.posting-title h5` and `.posting-categories .location`. No pagination — the whole board is one page.
- **Application form**: `/apply` appended to the posting URL. Fields carry `name="name"`, `name="email"`, `name="resume"`.
- **Trap**: some boards gate `/apply` behind a redirect to a company-hosted form. Re-run recon on the landing URL rather than assuming Lever selectors hold.

### Ashby
- **Detect**: `jobs.ashbyhq.com`, `__NEXT_DATA__` present.
- **Strategy**: `next-data` — parse the embedded JSON, do not scrape cards. Postings live under the page props; the shape is stable within a board.
- **Application form**: React-controlled inputs. `browser_fill_form` handles the change events; raw value assignment does not.
- **Trap**: file upload is a custom component. Observe first, then upload against the resolved `input[type=file]`.

### Workday
- **Detect**: `myworkdayjobs.com`, `data-automation-id` attributes.
- **Strategy**: `stagehand`. Selectors are generated and shift between tenants.
- **Shape**: everything is `data-automation-id="..."`. Those are more stable than class names — prefer them when `stagehand_observe` returns them.
- **Trap**: multi-page application wizard with per-step validation, and an account requirement on most tenants. Account creation is out of scope for this skill — if the flow demands one, stop and hand off to the user via `browser_get_live_view`.

### Workable / SmartRecruiters
- **Detect**: `apply.workable.com`, `jobs.smartrecruiters.com`.
- **Strategy**: `dom`, with `stagehand_extract` fallback on infinite-scroll boards.
- **Trap**: Workable paginates by "Show more" button, not page links. Batch `click` → `content` and stop when the record count stops growing.

### Professional networks & talent pools
- **Strategy**: `assisted` first run, `dom` thereafter.
- Auth-walled by design. Do the live-view handoff once; the thread's persistent browser context carries the session into later runs.
- **Rate discipline**: these platforms are the fastest way to get a session flagged. Keep concurrency at 1, keep the pace human, and stop on the first interstitial rather than retrying through it. Prefer an official export or API when the user has one — a CSV export beats any amount of scraping.
- **Trap**: results pages lazy-render on scroll. `browser_batch` with `scroll` → `content` repeated beats a single `content` call that captures ten rows.

### Custom / careers pages
- **Strategy**: `stagehand` with an explicit extraction schema.
- Most one-off career pages are static; `web_fetch` may be cheaper than a browser session. Escalate to a session only when the content is JS-rendered or interaction is required.

## The live-view handoff

When recon returns `auth_required: true`, do not attempt a login. Never type a credential.

```
browser_get_live_view { sessionId }
```

Give the user the returned URL with a one-line instruction: sign in (and clear MFA) in that window, then say "done". Keep the session open while they work. On "done", re-read the page to confirm the authenticated state, then continue the pipeline.

The login persists in the thread's browser context, so later runs against the same platform skip this step. If a run that used to work comes back `auth_required`, the context expired — hand off again rather than treating it as a scraping failure.

## Access discipline

- Use the official API or export whenever the user has access to one. This skill exists for the seams where no integration exists, not to replace integrations that do.
- Honor each platform's terms and rate expectations. Sourcing at a human pace from an authenticated session the user owns is the intended mode.
- Nothing in this skill bypasses a bot check. If a CAPTCHA or interstitial appears, that is a live-view handoff, not a puzzle to solve.
