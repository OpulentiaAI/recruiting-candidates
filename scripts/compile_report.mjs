#!/usr/bin/env node
/**
 * compile_report.mjs — turn candidate evidence files into a shortlist.
 *
 *   node compile_report.mjs <OUTPUT_DIR> [--open]
 *
 * Reads   {OUTPUT_DIR}/candidates/*.md   (frontmatter per references/example-research.md)
 * Writes  {OUTPUT_DIR}/index.html        ranked, filterable candidate cards
 *         {OUTPUT_DIR}/results.csv       ATS/CRM import
 *         {OUTPUT_DIR}/summary.json      counts for the chat summary
 *
 * No dependencies. Frontmatter values are single-line `key: value` pairs.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";

const OUTPUT_DIR = process.argv[2];
const OPEN = process.argv.includes("--open");
if (!OUTPUT_DIR) {
  console.error("usage: node compile_report.mjs <OUTPUT_DIR> [--open]");
  process.exit(1);
}

const CANDIDATE_DIR = join(OUTPUT_DIR, "candidates");
if (!existsSync(CANDIDATE_DIR)) {
  console.error(`No candidates/ directory under ${OUTPUT_DIR} — run screening first.`);
  process.exit(1);
}

/** Split `---\nkey: value\n---\nbody` into [frontmatter, body]. Tolerates a missing block. */
function parseFile(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return [{}, text.trim()];
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!kv) continue;
    fields[kv[1].trim()] = kv[2].trim();
  }
  return [fields, match[2].trim()];
}

/** Pull a `## Heading` section out of the body. */
function section(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "im");
  const m = body.match(re);
  return m ? m[1].trim() : "";
}

const list = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "none");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Quote every cell; neutralize spreadsheet formula injection from scraped text. */
function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const band = (score) => (score >= 8 ? "strong" : score >= 5 ? "partial" : "weak");

/** Label a link by host. Scraped URLs are often junk — never let one crash the report. */
function hostLabel(url) {
  const raw = String(url).trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(candidate).hostname.replace(/^www\./, "");
    return host || raw.slice(0, 32);
  } catch {
    return raw.slice(0, 32);
  }
}

const files = readdirSync(CANDIDATE_DIR).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error(`No .md files in ${CANDIDATE_DIR} — screening wrote nothing.`);
  process.exit(1);
}

const candidates = files.map((file) => {
  const [fm, body] = parseFile(readFileSync(join(CANDIDATE_DIR, file), "utf-8"));
  const rawScore = Number.parseInt(fm.fit_score, 10);
  const score = Number.isFinite(rawScore) ? Math.min(10, Math.max(0, rawScore)) : 0;
  return {
    slug: basename(file, ".md"),
    name: fm.candidate_name || basename(file, ".md"),
    title: fm.current_title || "",
    company: fm.current_company || "",
    location: fm.location || "",
    primary_url: fm.primary_url || "",
    profile_urls: list(fm.profile_urls),
    score,
    band: band(score),
    reasoning: fm.fit_reasoning || "",
    evidence: fm.evidence || "",
    met: list(fm.must_haves_met),
    gaps: list(fm.gaps),
    signals: list(fm.signals),
    hook: fm.outreach_hook || "",
    adjustment: fm.score_adjustment && fm.score_adjustment !== "none" ? fm.score_adjustment : "",
    enriched: String(fm.triage_only).toLowerCase() === "false",
    synced: String(fm.ats_synced).toLowerCase() === "true",
    rubric: fm.rubric || "v1",
    req: fm.req || "",
    why: section(body, "Why this person"),
    notes: section(body, "Screening notes"),
  };
});

candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

const req = candidates.find((c) => c.req)?.req || "Shortlist";
const counts = {
  total: candidates.length,
  strong: candidates.filter((c) => c.band === "strong").length,
  partial: candidates.filter((c) => c.band === "partial").length,
  weak: candidates.filter((c) => c.band === "weak").length,
  enriched: candidates.filter((c) => c.enriched).length,
  synced: candidates.filter((c) => c.synced).length,
};

// ---------- CSV ----------
const CSV_COLUMNS = [
  ["slug", (c) => c.slug],
  ["name", (c) => c.name],
  ["title", (c) => c.title],
  ["company", (c) => c.company],
  ["location", (c) => c.location],
  ["fit_score", (c) => c.score],
  ["band", (c) => c.band],
  ["fit_reasoning", (c) => c.reasoning],
  ["evidence", (c) => c.evidence],
  ["must_haves_met", (c) => c.met.join("; ")],
  ["gaps", (c) => c.gaps.join("; ")],
  ["signals", (c) => c.signals.join("; ")],
  ["outreach_hook", (c) => c.hook],
  ["primary_url", (c) => c.primary_url],
  ["profile_urls", (c) => c.profile_urls.join("; ")],
  ["enriched", (c) => c.enriched],
  ["ats_synced", (c) => c.synced],
  ["rubric", (c) => c.rubric],
];

writeFileSync(
  join(OUTPUT_DIR, "results.csv"),
  [
    CSV_COLUMNS.map(([header]) => csvCell(header)).join(","),
    ...candidates.map((c) => CSV_COLUMNS.map(([, get]) => csvCell(get(c))).join(",")),
  ].join("\n") + "\n",
);

// ---------- HTML ----------
const chip = (text, kind = "") =>
  `<span class="chip${kind ? ` ${kind}` : ""}">${esc(text)}</span>`;

const card = (c) => `
      <article class="card" data-band="${c.band}">
        <header>
          <div class="who">
            <h2>${c.primary_url ? `<a href="${esc(c.primary_url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h2>
            <p class="role">${esc([c.title, c.company].filter(Boolean).join(" · "))}${c.location ? ` <span class="loc">${esc(c.location)}</span>` : ""}</p>
          </div>
          <div class="score ${c.band}" title="Fit score, rubric ${esc(c.rubric)}">${c.score}<small>/10</small></div>
        </header>
        ${c.reasoning ? `<p class="reasoning">${esc(c.reasoning)}</p>` : ""}
        ${c.evidence ? `<blockquote>${esc(c.evidence)}</blockquote>` : ""}
        ${c.met.length ? `<div class="chips"><span class="label">Meets</span>${c.met.map((m) => chip(m, "met")).join("")}</div>` : ""}
        ${c.gaps.length ? `<div class="chips"><span class="label">Gaps</span>${c.gaps.map((g) => chip(g, "gap")).join("")}</div>` : ""}
        ${c.signals.length ? `<div class="chips"><span class="label">Signals</span>${c.signals.map((s) => chip(s)).join("")}</div>` : ""}
        ${c.hook ? `<p class="hook"><span class="label">Hook</span>${esc(c.hook)}</p>` : ""}
        ${c.why ? `<p class="why">${esc(c.why)}</p>` : ""}
        <footer>
          ${c.enriched ? chip("enriched") : chip("triage only", "gap")}
          ${c.synced ? chip("in ATS", "met") : ""}
          ${c.adjustment ? chip(`adj ${c.adjustment}`) : ""}
          ${c.profile_urls.map((u) => `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${esc(hostLabel(u))}</a>`).join("")}
        </footer>
      </article>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(req)} — shortlist</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --panel: #fff; --ink: #16161a; --muted: #6b6b76; --line: #e6e6e3;
    --strong: #1a7f5a; --partial: #9a6b12; --weak: #8a8a94; --quote: #f4f4f1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131315; --panel: #1a1a1d; --ink: #ececef; --muted: #9a9aa4; --line: #2a2a2f;
      --strong: #4ec99a; --partial: #d9a648; --weak: #7f7f89; --quote: #202024;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
         font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
  .filters button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--panel); color: var(--muted); cursor: pointer; }
  .filters button[aria-pressed="true"] { color: var(--ink); border-color: var(--ink); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
          padding: 18px 20px; margin-bottom: 14px; }
  .card header { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  .card h2 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .card h2 a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
  .role { margin: 0; color: var(--muted); font-size: 14px; }
  .loc::before { content: "· "; }
  .score { font-size: 26px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
  .score small { font-size: 12px; font-weight: 400; color: var(--muted); }
  .score.strong { color: var(--strong); } .score.partial { color: var(--partial); } .score.weak { color: var(--weak); }
  .reasoning { margin: 12px 0 0; }
  blockquote { margin: 12px 0 0; padding: 10px 14px; background: var(--quote);
               border-left: 2px solid var(--line); border-radius: 0 6px 6px 0;
               color: var(--muted); font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-right: 4px; }
  .chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .chip.met { color: var(--strong); border-color: color-mix(in srgb, var(--strong) 35%, var(--line)); }
  .chip.gap { color: var(--partial); border-color: color-mix(in srgb, var(--partial) 35%, var(--line)); }
  .hook { margin: 12px 0 0; font-size: 14px; }
  .why { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
  .card footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
                 margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .link { font-size: 12px; color: var(--muted); }
  .empty { color: var(--muted); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(req)}</h1>
    <p class="sub">${counts.total} candidates · ${counts.strong} strong · ${counts.partial} partial · ${counts.weak} weak · ${counts.enriched} enriched${counts.synced ? ` · ${counts.synced} in ATS` : ""}</p>
    <div class="filters">
      <button data-filter="all" aria-pressed="true">All ${counts.total}</button>
      <button data-filter="strong" aria-pressed="false">Strong ${counts.strong}</button>
      <button data-filter="partial" aria-pressed="false">Partial ${counts.partial}</button>
      <button data-filter="weak" aria-pressed="false">Weak ${counts.weak}</button>
    </div>
    <main id="cards">${candidates.map(card).join("")}
    </main>
    <p class="empty" id="empty" hidden>No candidates in this band.</p>
  </div>
<script>
  const buttons = [...document.querySelectorAll(".filters button")];
  const cards = [...document.querySelectorAll(".card")];
  const empty = document.getElementById("empty");
  buttons.forEach((btn) => btn.addEventListener("click", () => {
    const filter = btn.dataset.filter;
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    let shown = 0;
    cards.forEach((card) => {
      const match = filter === "all" || card.dataset.band === filter;
      card.hidden = !match;
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
  }));
</script>
</body>
</html>
`;

writeFileSync(join(OUTPUT_DIR, "index.html"), html);
writeFileSync(
  join(OUTPUT_DIR, "summary.json"),
  JSON.stringify(
    {
      req,
      rubric: candidates[0]?.rubric || "v1",
      counts,
      top: candidates.slice(0, 5).map((c) => ({
        name: c.name, title: c.title, company: c.company, score: c.score,
        reasoning: c.reasoning, evidence: c.evidence, hook: c.hook,
      })),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  [
    `candidates: ${counts.total}`,
    `strong:     ${counts.strong}`,
    `partial:    ${counts.partial}`,
    `weak:       ${counts.weak}`,
    `enriched:   ${counts.enriched}`,
    ``,
    `${join(OUTPUT_DIR, "index.html")}`,
    `${join(OUTPUT_DIR, "results.csv")}`,
    `${join(OUTPUT_DIR, "summary.json")}`,
  ].join("\n"),
);

if (OPEN) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [join(OUTPUT_DIR, "index.html")], () => {});
}
