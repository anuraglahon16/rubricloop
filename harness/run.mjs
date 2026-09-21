// Evaluation harness: grades the golden set with the real grade prompt and
// reports how well the agent agrees with human scores.
//
//   ANTHROPIC_API_KEY=sk-ant-... node harness/run.mjs
//   Options: --set support-replies   golden set folder under harness/sets/
//            --threshold 0.7          confidence threshold for routing
//            --min-agreement 0.7      exit non-zero below this
//            --model claude-sonnet-4-6
//
import { readFileSync } from "node:fs";
import { GRADE_SYSTEM } from "../src/prompts.js";
import { buildGrade, overallOf } from "../src/lib.js";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const THRESHOLD = Number(args.threshold ?? 0.7);
const MIN_AGREEMENT = Number(args["min-agreement"] ?? 0.7);
const MODEL = args.model ?? "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Set ANTHROPIC_API_KEY."); process.exit(2); }

const SET = args.set ?? "support-replies";
const rubric = JSON.parse(readFileSync(new URL(`./sets/${SET}/rubric.json`, import.meta.url)));
const golden = JSON.parse(readFileSync(new URL(`./sets/${SET}/golden.json`, import.meta.url)));
const version = { version: rubric.version, criteria: rubric.criteria };

async function callJSON(system, user) {
  const call = async (extra) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages: [{ role: "user", content: user + extra }] }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  };
  const parse = (t) => { const c = t.replace(/```json|```/g, "").trim(); return JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1)); };
  const t1 = await call("");
  try { return parse(t1); } catch (e) { return parse(await call(`\n\nYour previous response was not valid JSON (${String(e.message).slice(0, 80)}). Return only the JSON object.`)); }
}

async function gradeItem(item) {
  const rub = { criteria: version.criteria };
  const user = `Task:\n${rubric.task}\n\nRubric (JSON):\n${JSON.stringify(rub)}\n\n<output>\n${item.content}\n</output>`;
  const r = await callJSON(GRADE_SYSTEM, user);
  return buildGrade(r, item, version, THRESHOLD);
}

const started = Date.now();
const rows = [];
const pool = [...golden];
async function worker() {
  while (pool.length) {
    const item = pool.shift();
    try {
      const g = await gradeItem(item);
      rows.push({ item, g, humanOverall: overallOf(item.human, version.criteria) });
    } catch (e) { rows.push({ item, error: e.message }); }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
rows.sort((a, b) => a.item.id.localeCompare(b.item.id));

// Metrics
const ok = rows.filter((r) => !r.error);
const agree = ok.filter((r) => Math.abs(r.g.overall - r.humanOverall) <= 0.5);
const agreement = ok.length ? agree.length / ok.length : 0;
const mae = {};
version.criteria.forEach((c) => { mae[c.id] = ok.length ? ok.reduce((a, r) => a + Math.abs(r.g.scores[c.id] - r.item.human[c.id]), 0) / ok.length : NaN; });
const buckets = [["< 0.6", (c) => c < 0.6], ["0.6 to 0.8", (c) => c >= 0.6 && c < 0.8], [">= 0.8", (c) => c >= 0.8]].map(([name, f]) => {
  const rs = ok.filter((r) => f(r.g.confidence));
  return { name, n: rs.length, agreement: rs.length ? rs.filter((r) => Math.abs(r.g.overall - r.humanOverall) <= 0.5).length / rs.length : null };
});
const flagChecks = ok.map((r) => ({ id: r.item.id, expected: r.item.expect_flags, got: r.g.flags, hit: r.item.expect_flags.every((f) => r.g.flags.includes(f)) }));
const flagRecall = flagChecks.filter((f) => f.expected.length).length ? flagChecks.filter((f) => f.expected.length && f.hit).length / flagChecks.filter((f) => f.expected.length).length : null;
const queued = ok.filter((r) => r.g.queued).length;

// Report
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nRubricLoop evaluation harness   set=${SET}   model=${MODEL}   threshold=${THRESHOLD}   items=${golden.length}   ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log(pad("item", 6) + pad("human", 7) + pad("agent", 7) + pad("conf", 6) + pad("queued", 8) + pad("flags", 32) + "delta");
for (const r of rows) {
  if (r.error) { console.log(pad(r.item.id, 6) + "ERROR " + r.error); continue; }
  const d = r.g.overall - r.humanOverall;
  console.log(pad(r.item.id, 6) + pad(r.humanOverall.toFixed(2), 7) + pad(r.g.overall.toFixed(2), 7) + pad(r.g.confidence.toFixed(2), 6) + pad(r.g.queued ? "yes" : "", 8) + pad(r.g.flags.join(",") || "-", 32) + (Math.abs(d) <= 0.5 ? "ok" : (d > 0 ? "+" : "") + d.toFixed(2)));
}
console.log(`\nAgreement within 0.5 on overall: ${agree.length}/${ok.length} = ${(agreement * 100).toFixed(0)}%   (target >= ${MIN_AGREEMENT * 100}%)`);
console.log("Mean absolute error per criterion: " + version.criteria.map((c) => `${c.id} ${mae[c.id].toFixed(2)}`).join("   "));
console.log("Calibration (agreement by confidence bucket): " + buckets.map((b) => `${b.name}: ${b.n ? `${(b.agreement * 100).toFixed(0)}% of ${b.n}` : "none"}`).join("   "));
console.log(`Routed to review at threshold ${THRESHOLD}: ${queued}/${ok.length}`);
console.log(`Expected flags recalled: ${flagRecall == null ? "n/a" : (flagRecall * 100).toFixed(0) + "%"}   ` + flagChecks.filter((f) => f.expected.length).map((f) => `${f.id} ${f.hit ? "ok" : "missed " + f.expected.join(",")}`).join("   "));
if (rows.some((r) => r.error)) console.log(`\n${rows.filter((r) => r.error).length} item(s) failed after retry.`);

if (agreement < MIN_AGREEMENT) { console.log(`\nFAIL: agreement ${(agreement * 100).toFixed(0)}% is below ${MIN_AGREEMENT * 100}%.`); process.exit(1); }
console.log("\nPASS");
