// Validates every entry in src/samples.js against the add-sample-project rules.
//   node .claude/skills/add-sample-project/scripts/validate_samples.mjs [--name "substring"]
// Exit code 1 if any sample fails.
import { SAMPLES } from "../../../../src/samples.js";
import { INJ } from "../../../../src/lib.js";

const args = process.argv.slice(2);
const nameFilter = args.includes("--name") ? args[args.indexOf("--name") + 1] : null;
const words = (s) => s.trim().split(/\s+/).length;
let failures = 0;

for (const s of SAMPLES) {
  if (nameFilter && !s.name.toLowerCase().includes(nameFilter.toLowerCase())) continue;
  const problems = [];
  const warnings = [];

  if (!s.name || !/\(.+\)$/.test(s.name)) warnings.push('name should end with "(audience or context)"');
  const tw = words(s.task || "");
  if (tw < 35 || tw > 140) problems.push(`task is ${tw} words; needs to be 35 to 140`);
  else if (tw < 60) warnings.push(`task is ${tw} words; 60 to 120 gives the draft step more to work with`);
  if (!/\b(must|never|only|do not|no )\b/i.test(s.task)) warnings.push("task states no hard rules (no must / never / only / do not)");

  const ex = s.examples || [];
  const good = ex.filter((e) => e.label === "good").length;
  const bad = ex.filter((e) => e.label === "bad").length;
  if (ex.length < 4 || ex.length > 6) problems.push(`${ex.length} examples; need 4 to 6`);
  if (good < 2 || bad < 2) problems.push(`examples unbalanced: ${good} good, ${bad} bad; need at least 2 of each`);
  ex.forEach((e, i) => {
    if (!e.reason || words(e.reason) < 3) problems.push(`example ${i + 1} has no usable reason`);
    if (!e.content || words(e.content) < 8) problems.push(`example ${i + 1} content too short`);
    if (/—/.test(e.content + e.reason)) problems.push(`example ${i + 1} contains an em dash`);
  });

  const batch = s.batch || [];
  if (batch.length < 8 || batch.length > 12) problems.push(`batch has ${batch.length} items; need 8 to 12`);
  const injected = batch.filter((b) => INJ.test(b));
  if (injected.length === 0) problems.push("no batch item trips the injection regex (INJ in src/lib.js); add a grader-directed line or extend INJ");
  if (injected.length > 1) warnings.push(`${injected.length} batch items trip the injection regex; one is the convention`);
  batch.forEach((b, i) => {
    if (words(b) > 160) warnings.push(`batch item ${i + 1} is ${words(b)} words; long items hide the seeded fault`);
    if (/—/.test(b)) problems.push(`batch item ${i + 1} contains an em dash`);
  });
  const dupes = batch.filter((b, i) => batch.indexOf(b) !== i).length;
  if (dupes) problems.push(`${dupes} duplicate batch item(s)`);

  const status = problems.length ? "FAIL" : "ok";
  if (problems.length) failures++;
  console.log(`${status.padEnd(5)} ${s.name}  (examples ${good}g/${bad}b, batch ${batch.length}, injection items ${injected.length})`);
  problems.forEach((p) => console.log(`       problem: ${p}`));
  warnings.forEach((w) => console.log(`       note:    ${w}`));
}

if (failures) { console.log(`\n${failures} sample(s) need fixing.`); process.exit(1); }
console.log("\nAll samples pass.");
