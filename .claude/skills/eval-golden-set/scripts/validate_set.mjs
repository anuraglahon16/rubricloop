// Validates a golden set folder before the harness runs on it.
//   node .claude/skills/eval-golden-set/scripts/validate_set.mjs <set-name>
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { INJ } from "../../../../src/lib.js";

const set = process.argv[2];
if (!set) { console.error("Usage: validate_set.mjs <set-name>"); process.exit(2); }
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dir = join(root, "harness", "sets", set);
for (const f of ["rubric.json", "golden.json"]) if (!existsSync(join(dir, f))) { console.error(`Missing ${f} in harness/sets/${set}/`); process.exit(1); }

const rubric = JSON.parse(readFileSync(join(dir, "rubric.json")));
const golden = JSON.parse(readFileSync(join(dir, "golden.json")));
const problems = [], notes = [];
const FLAGS = new Set(["policy_risk", "injection_suspect"]);

// rubric
if (rubric._instructions) problems.push("rubric.json still has the _instructions stub key");
const crit = rubric.criteria || [];
if (crit.length < 3 || crit.length > 7) problems.push(`${crit.length} criteria; expected 3 to 7`);
const ids = crit.map((c) => c.id);
if (new Set(ids).size !== ids.length) problems.push("duplicate criterion ids");
const wsum = crit.reduce((a, c) => a + (Number(c.weight) || 0), 0);
if (wsum !== 100) problems.push(`weights sum to ${wsum}, not 100`);
crit.forEach((c) => {
  for (const k of ["1", "3", "5"]) if (!c.anchors?.[k]) problems.push(`criterion ${c.id} missing anchor "${k}"`);
  if (!c.description) problems.push(`criterion ${c.id} missing description`);
  if (!c.evidence_hint) notes.push(`criterion ${c.id} has no evidence_hint`);
});
if (!rubric.task) problems.push("rubric.json has no task text");

// golden
if (golden.length < 8 || golden.length > 20) notes.push(`${golden.length} items; 8 to 20 keeps runs fast and cheap`);
const gids = golden.map((g) => g.id);
if (new Set(gids).size !== gids.length) problems.push("duplicate item ids in golden.json");
let blank = 0;
golden.forEach((g) => {
  if (!g.content || g.content.trim().length < 20) problems.push(`${g.id}: content missing or too short`);
  const h = g.human || {};
  if (Object.keys(h).length === 0) { blank++; return; }
  ids.forEach((id) => {
    const v = h[id];
    if (!Number.isInteger(v) || v < 1 || v > 5) problems.push(`${g.id}: human score for ${id} is ${JSON.stringify(v)}; need integer 1 to 5`);
  });
  Object.keys(h).forEach((k) => { if (!ids.includes(k)) problems.push(`${g.id}: human score for unknown criterion ${k}`); });
  const ef = g.expect_flags || [];
  ef.forEach((f) => { if (!FLAGS.has(f)) problems.push(`${g.id}: unknown flag ${f}`); });
  const trips = INJ.test(g.content);
  if (trips && !ef.includes("injection_suspect")) problems.push(`${g.id}: content trips the injection regex but expect_flags lacks injection_suspect`);
  if (!trips && ef.includes("injection_suspect")) notes.push(`${g.id}: expects injection_suspect but INJ does not match; the model may still flag it, but the code path will not`);
});
if (blank === golden.length) problems.push("no item has human scores yet; the set is a scaffold, not a golden set");
else if (blank) problems.push(`${blank} item(s) have no human scores`);

const withFlags = golden.filter((g) => (g.expect_flags || []).length).length;
if (withFlags === 0) notes.push("no item expects a risk flag; flag recall will be n/a");

console.log(`harness/sets/${set}: ${crit.length} criteria (weights ${wsum}), ${golden.length} items, ${golden.length - blank} scored, ${withFlags} expecting flags`);
problems.forEach((p) => console.log(`  problem: ${p}`));
notes.forEach((n) => console.log(`  note:    ${n}`));
if (problems.length) { console.log(`\n${problems.length} problem(s). Fix before running the harness.`); process.exit(1); }
console.log("\nValid. Run: ANTHROPIC_API_KEY=... node harness/run.mjs --set " + set);
