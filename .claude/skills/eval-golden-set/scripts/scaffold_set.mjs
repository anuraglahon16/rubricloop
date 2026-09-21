// Scaffolds a golden set folder from a sample project's batch.
//   node .claude/skills/eval-golden-set/scripts/scaffold_set.mjs --sample "earnings" --out earnings-summaries
// Creates harness/sets/<out>/golden.json (items pre-filled, scores blank) and rubric.json (stub).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SAMPLES } from "../../../../src/samples.js";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const sampleQ = opt("--sample");
const out = opt("--out");
if (!sampleQ || !out) { console.error('Usage: --sample "<name substring>" --out <set-name>'); process.exit(2); }
if (!/^[a-z0-9-]+$/.test(out)) { console.error("--out must be lowercase letters, digits and hyphens"); process.exit(2); }

const sample = SAMPLES.find((s) => s.name.toLowerCase().includes(sampleQ.toLowerCase()));
if (!sample) { console.error(`No sample matches "${sampleQ}". Available:\n  ` + SAMPLES.map((s) => s.name).join("\n  ")); process.exit(2); }

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dir = join(root, "harness", "sets", out);
if (existsSync(dir)) { console.error(`${dir} already exists. Golden sets are frozen; pick a new name or edit the files directly.`); process.exit(1); }
mkdirSync(dir, { recursive: true });

const golden = sample.batch.map((content, i) => ({
  id: `g${String(i + 1).padStart(2, "0")}`,
  content,
  human: {},
  expect_flags: [],
}));
writeFileSync(join(dir, "golden.json"), JSON.stringify(golden, null, 2) + "\n");

const rubric = {
  version: 1,
  source_sample: sample.name,
  task: sample.task,
  criteria: [],
  _instructions: "Fill criteria with the approved v1 rubric from the app: [{id, name, weight, description, anchors:{'1','3','5'}, evidence_hint}]. Weights sum to 100. Delete this key when done.",
};
writeFileSync(join(dir, "rubric.json"), JSON.stringify(rubric, null, 2) + "\n");

console.log(`Scaffolded harness/sets/${out}/ from "${sample.name}"`);
console.log(`  golden.json: ${golden.length} items, human scores blank`);
console.log(`  rubric.json: stub with task text; paste the approved criteria`);
console.log(`Next: fill both files, then node .claude/skills/eval-golden-set/scripts/validate_set.mjs ${out}`);
