#!/usr/bin/env node
/**
 * lint_candidates.mjs — check candidate files against the scoring contract.
 *
 *   node scripts/lint_candidates.mjs <DIR>
 *
 * The rules in references/scoring-rubric.md, made executable. A rule that is only
 * written down is a rule that gets skipped under time pressure; this is the same move
 * as linting copy against a banned-word list rather than asking people to remember it.
 *
 * Exits 1 on any violation, naming file and rule.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
if (!DIR) { console.error("usage: node scripts/lint_candidates.mjs <DIR>"); process.exit(2); }
const dir = existsSync(join(DIR, "candidates")) ? join(DIR, "candidates") : DIR;
if (!existsSync(dir)) { console.error(`No candidates directory at ${DIR}`); process.exit(2); }

/** Never recorded, so they can never reach a score. */
const PROTECTED = [
  "age", "date_of_birth", "dob", "graduation_year", "grad_year",
  "gender", "pronouns", "sex", "race", "ethnicity", "nationality",
  "marital_status", "children", "parental_status",
  "disability", "religion", "photo", "photo_url", "headshot", "veteran_status",
];

const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
if (!files.length) { console.error(`No candidate files in ${dir}`); process.exit(2); }

const violations = [];
const fail = (file, rule, detail) => violations.push({ file, rule, detail });

for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) { fail(file, "frontmatter", "no frontmatter block"); continue; }
  const kv = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (m) kv[m[1]] = m[2].trim();
  }

  for (const key of ["candidate_name", "fit_score", "fit_reasoning", "evidence", "rubric", "req"]) {
    if (!kv[key]) fail(file, "required-field", `${key} missing`);
  }

  const score = Number.parseInt(kv.fit_score, 10);
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    fail(file, "score-range", `fit_score is "${kv.fit_score}", expected an integer 1-10`);
  }

  const unknown = /^unknown/i.test(kv.evidence ?? "");
  const quoted = /^["“]/.test(kv.evidence ?? "");
  if (kv.evidence && !unknown && !quoted) {
    fail(file, "evidence-quoted", "evidence must quote the line it came from, or start with Unknown");
  }
  if (unknown && Number.isInteger(score) && score > 3) {
    fail(file, "unknown-caps-at-3", `evidence is Unknown but fit_score is ${score}`);
  }

  for (const key of Object.keys(kv)) {
    if (PROTECTED.includes(key.toLowerCase())) {
      fail(file, "protected-attribute", `${key} must never be recorded`);
    }
  }
  for (const term of PROTECTED) {
    if (new RegExp(`\\b${term}\\b`, "i").test(kv.fit_reasoning ?? "")) {
      fail(file, "protected-in-reasoning", `fit_reasoning references ${term}`);
    }
  }

  if (kv.triage_only === "false" && !kv.score_adjustment) {
    fail(file, "adjustment-recorded", "enriched file must state score_adjustment, even when none");
  }
  if (kv.score_adjustment && /^[+-]\d/.test(kv.score_adjustment)) {
    const delta = Math.abs(Number.parseInt(kv.score_adjustment, 10));
    if (delta > 2) fail(file, "adjustment-bound", `score moved by ${delta}, limit is 2`);
    if (!/—|--|\s-\s/.test(kv.score_adjustment)) {
      fail(file, "adjustment-reason", "score_adjustment must carry its reason");
    }
  }
}

for (const v of violations) console.error(`  ${v.file.padEnd(28)} ${v.rule.padEnd(22)} ${v.detail}`);
console.log(`${files.length} candidate file(s) · ${violations.length} violation(s)`);
if (violations.length) process.exit(1);
