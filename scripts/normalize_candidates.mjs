#!/usr/bin/env node
/**
 * normalize_candidates.mjs — collapse sourced records into one row per person.
 *
 *   node normalize_candidates.mjs <OUTPUT_DIR>
 *
 * Reads   {OUTPUT_DIR}/raw/*.jsonl   (one JSON record per line, any source)
 * Writes  {OUTPUT_DIR}/candidates.jsonl
 *         {OUTPUT_DIR}/seed_candidates.txt   slug|name|company|primary_url
 *
 * Merge key, in order: normalized profile URL → email → name+company.
 * Protected attributes are dropped on the way in — see references/scoring-rubric.md.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = process.argv[2];
if (!OUTPUT_DIR) {
  console.error("usage: node normalize_candidates.mjs <OUTPUT_DIR>");
  process.exit(1);
}

const RAW_DIR = join(OUTPUT_DIR, "raw");
if (!existsSync(RAW_DIR)) {
  console.error(`No raw/ directory under ${OUTPUT_DIR} — nothing to normalize.`);
  process.exit(1);
}

/** Fields that must never reach a screening record. Dropped, not blanked. */
const PROTECTED = new Set([
  "photo", "photo_url", "image", "avatar", "headshot",
  "age", "dob", "date_of_birth", "birth_year", "graduation_year", "grad_year",
  "gender", "pronouns", "sex", "race", "ethnicity", "nationality",
  "marital_status", "children", "parental_status",
  "disability", "religion", "veteran_status", "citizenship",
]);

/** Accepted aliases → canonical field name. */
const ALIASES = {
  name: "name", candidate_name: "name", full_name: "name",
  title: "title", current_title: "title", headline: "title", job_title: "title",
  company: "company", current_company: "company", employer: "company", organization: "company",
  location: "location", city: "location", region: "location",
  profile_url: "primary_url", primary_url: "primary_url", url: "primary_url", link: "primary_url",
  email: "email", email_address: "email",
  source_note: "source_note", source: "source_note", note: "source_note",
};

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Strip query, hash, trailing slash, www, and case so the same profile matches itself. */
function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

function canonicalize(record) {
  const out = {};
  const extras = {};
  for (const [rawKey, value] of Object.entries(record)) {
    const key = String(rawKey).trim().toLowerCase();
    if (PROTECTED.has(key)) continue;
    if (value === null || value === undefined) continue;
    const str = typeof value === "string" ? value.trim() : value;
    if (str === "") continue;
    const canonical = ALIASES[key];
    if (canonical) {
      if (!out[canonical] || String(out[canonical]).length < String(str).length) {
        out[canonical] = str;
      }
    } else {
      extras[key] = str;
    }
  }
  if (Object.keys(extras).length) out.extra = extras;
  return out;
}

function identityKey(rec) {
  const url = normalizeUrl(rec.primary_url);
  if (url) return `url:${url}`;
  if (rec.email) return `email:${String(rec.email).toLowerCase()}`;
  const name = slugify(rec.name);
  if (!name) return "";
  return `nc:${name}:${slugify(rec.company)}`;
}

/** A tracking-free URL beats a longer one carrying ?ref= / #anchor junk. */
function preferCleanerUrl(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  const dirty = (u) => (/[?#]/.test(String(u)) ? 1 : 0);
  if (dirty(current) !== dirty(incoming)) return dirty(current) ? incoming : current;
  return String(incoming).length < String(current).length ? incoming : current;
}

/** Prefer the longer, more specific value; union the multi-valued fields. */
function merge(target, incoming) {
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "extra") {
      target.extra = { ...(target.extra || {}), ...value };
      continue;
    }
    if (key === "source_note" || key === "sources") {
      const seen = new Set(String(target[key] || "").split(" | ").filter(Boolean));
      seen.add(String(value));
      target[key] = [...seen].join(" | ");
      continue;
    }
    if (key === "primary_url") {
      target.primary_url = preferCleanerUrl(target.primary_url, value);
      continue;
    }
    if (!target[key] || String(target[key]).length < String(value).length) {
      target[key] = value;
    }
  }
  return target;
}

const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".jsonl")).sort();
if (files.length === 0) {
  console.error(`No .jsonl files in ${RAW_DIR} — did sourcing write anything?`);
  process.exit(1);
}

let lines = 0;
let records = 0;
let malformed = 0;
let skippedNoIdentity = 0;
const byIdentity = new Map();

for (const file of files) {
  for (const line of readFileSync(join(RAW_DIR, file), "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }
    // A record may arrive as {candidates:[...]} from a schema extraction.
    const unwrapped = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : [parsed];
    for (const record of unwrapped) {
      if (!record || typeof record !== "object") { malformed += 1; continue; }
      records += 1;
      const canonical = canonicalize(record);
      const key = identityKey(canonical);
      if (!key) { skippedNoIdentity += 1; continue; }
      canonical.sources = file;
      if (byIdentity.has(key)) merge(byIdentity.get(key), canonical);
      else byIdentity.set(key, canonical);
    }
  }
}

// Stable order: company, then name — keeps diffs between runs readable.
const candidates = [...byIdentity.values()].sort((a, b) =>
  `${a.company || ""}${a.name || ""}`.localeCompare(`${b.company || ""}${b.name || ""}`),
);

const usedSlugs = new Map();
for (const candidate of candidates) {
  const base = slugify(candidate.name) || slugify(candidate.primary_url) || "candidate";
  const count = (usedSlugs.get(base) || 0) + 1;
  usedSlugs.set(base, count);
  candidate.slug = count === 1 ? base : `${base}-${count}`;
}

writeFileSync(
  join(OUTPUT_DIR, "candidates.jsonl"),
  candidates.map((c) => JSON.stringify(c)).join("\n") + (candidates.length ? "\n" : ""),
);
writeFileSync(
  join(OUTPUT_DIR, "seed_candidates.txt"),
  candidates
    .map((c) => [c.slug, c.name || "", c.company || "", c.primary_url || ""].join("|"))
    .join("\n") + (candidates.length ? "\n" : ""),
);

const collapsed = records - skippedNoIdentity - candidates.length;
console.log(
  [
    `files:       ${files.length}`,
    `lines:       ${lines}`,
    `records:     ${records}`,
    `unique:      ${candidates.length}`,
    `merged:      ${collapsed > 0 ? collapsed : 0}`,
    `malformed:   ${malformed}`,
    `no-identity: ${skippedNoIdentity}`,
  ].join("\n"),
);
if (candidates.length === 0) {
  console.error("\nZero candidates after normalization — re-check recon strategy before fanning out.");
  process.exit(2);
}
