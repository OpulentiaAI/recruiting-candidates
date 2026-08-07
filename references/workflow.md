# Budgets and waves

Call budgets, batch sizes, and how a fan-out is sized and checked. Open this when planning a wave or diagnosing one that went wrong.

## Hard caps

| Stage | Calls per item | What the call is |
| --- | --- | --- |
| Screening | 1 per candidate | One page read |
| Enrichment | 4 per candidate | Canonical profile, shipped work, one substantive read, public signal |
| ATS sync | 3 per record | Resolve the control, fill in one round-trip, re-read to verify |
| Application | 1 batch + 1 upload + 1 proof capture per posting | |

A stage that exceeds its cap has failed regardless of what it returned. Over-budget data is usually retry-loop data, so discard the batch and re-run it rather than keeping the extra.

Make the cap visible in the tool log by prefixing each call with a running counter, `# call N/TOTAL`. A wave whose counter passes TOTAL is caught while it is running rather than in review.

## Batch and concurrency

| Stage | Batch size | Concurrency |
| --- | --- | --- |
| Screening | 10 | `browser_concurrency` |
| Enrichment | 5 | `browser_concurrency` |
| ATS sync | 5 | `browser_concurrency` |
| Application | 3 | `browser_concurrency`, hard |

`browser_concurrency` comes from the profile and mirrors the provider's session limit. It caps *simultaneous sessions*, not subagents. A subagent writing a file holds no slot; one mid-round-trip does.

Applications are the longest-running sessions in the pipeline, so over-fanning there produces queued sessions that read as a hang.

## Waves

Dispatch up to `browser_concurrency` subagents per message. Start the next wave when the previous returns.

Each subagent opens one session, reuses it across its batch, and releases it before returning, including on the error path. A subagent that returns without releasing has failed the run even when its data is good.

Every subagent's whole surface is the shell and the browser, and the shell writes every file. Batch all writes for a batch into a single call, since one call is one permission prompt.

## Checks after each wave

- **Coverage.** Output files must equal batch lines. Re-run only the missing ids, not the whole batch.
- **Sessions.** Every subagent reported releasing its session. If one did not, list sessions and close orphans before the next wave.
- **Budget.** No counter exceeded its TOTAL.
- **Contract.** `npm run lint` passes on the files the wave produced.

## When a wave fails

| Signal | Meaning | Response |
| --- | --- | --- |
| One item failed | Transient | Re-run that id alone |
| Whole wave failed identically | The platform changed | Stop, re-run recon, update `ats-platforms.md` before spending more |
| Subagents hang at start | More sessions than the limit | Lower fan-out, close orphaned sessions |
| Counter exceeded TOTAL | A retry loop | Discard and re-run the batch |

## Cost shape

A screening pass is one call per candidate, so it scales linearly and cheaply. Enrichment is four calls but runs only on candidates that cleared the threshold, which is why the filter sits between them. Moving the threshold changes the enrichment bill directly, and that is the number to state before a large run.

## Layers on top of

`scoring-rubric.md` owns the bands, the evidence bar, and the protected-attribute exclusions, and `scripts/lint_candidates.mjs` enforces the checkable half. `SKILL.md` owns session discipline and the approval gates. This file adds only the budgets and the wave mechanics.
