// Release pre-flight for RubricLoop. Run from the repo root:
//   node .claude/skills/release/scripts/preflight.mjs
// Exits non-zero on the first failing check.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let step = 0;
const head = (t) => console.log(`\n[${++step}] ${t}`);
const fail = (m) => { console.log(`    FAIL: ${m}`); process.exit(1); };
const ok = (m) => console.log(`    ok: ${m}`);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8" });

head("Unit tests");
try { const out = run("npm test --silent 2>&1"); const m = out.match(/# pass (\d+)[\s\S]*# fail (\d+)/); if (!m || m[2] !== "0") fail(out.split("\n").slice(-12).join("\n")); ok(`${m[1]} passed, 0 failed`); }
catch (e) { fail((e.stdout || e.message).toString().split("\n").slice(-15).join("\n")); }

head("Production build");
try { const out = run("npm run build --silent 2>&1"); const m = out.match(/dist\/assets\/index-\S+\.js\s+([\d.]+ kB)/); ok(`built${m ? `, bundle ${m[1]}` : ""}`); }
catch (e) { fail((e.stdout || e.message).toString().split("\n").slice(-15).join("\n")); }

head("Sample projects");
try { const out = run("node .claude/skills/add-sample-project/scripts/validate_samples.mjs 2>&1"); ok(out.trim().split("\n").filter((l) => /^(ok|FAIL)/.test(l)).length + " samples checked, all pass"); }
catch (e) { fail((e.stdout || e.message).toString()); }

head("Copy rules (no em dashes, middle dots, banned words in src/ and docs/)");
const banned = /\b(leverage|utilize|streamline|robust|cutting-edge|game.?changer|delve|seamless|empower|harness the|paramount|elevate|supercharge)\b/i;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs|md|json)$/.test(f)) files.push(p); } };
for (const d of ["src", "docs"]) if (existsSync(join(root, d))) walk(join(root, d));
const copyHits = [];
for (const p of files) {
  const lines = readFileSync(p, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/[—·]/.test(l)) copyHits.push(`${p.replace(root + "/", "")}:${i + 1} em dash or middle dot`);
    const m = l.match(banned); if (m && !/INJ|banned|regex/.test(l)) copyHits.push(`${p.replace(root + "/", "")}:${i + 1} "${m[0]}"`);
  });
}
if (copyHits.length) fail(copyHits.slice(0, 15).join("\n    ") + (copyHits.length > 15 ? `\n    ...and ${copyHits.length - 15} more` : ""));
ok(`${files.length} files clean`);

head("Secrets");
const tracked = [];
const walkAll = (d) => { for (const f of readdirSync(d)) { if (["node_modules", "dist", ".git"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walkAll(p); else if (statSync(p).size < 2_000_000 && !/\.(png|pdf|zip|jpg)$/.test(f)) tracked.push(p); } };
walkAll(root);
const leaks = tracked.filter((p) => /sk-ant-[A-Za-z0-9_-]{8,}/.test(readFileSync(p, "utf8")));
if (leaks.length) fail("possible API key in: " + leaks.map((p) => p.replace(root + "/", "")).join(", ") + ". Rotate the key before continuing.");
const gi = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
if (!/^\.env$/m.test(gi)) fail(".env is not in .gitignore");
ok(`no key strings in ${tracked.length} files; .env ignored`);

head("README consistency");
const samplesSrc = readFileSync(join(root, "src/samples.js"), "utf8");
const sampleCount = (samplesSrc.match(/^\s{2}\{\s*$/gm) || []).length;
const readme = readFileSync(join(root, "README.md"), "utf8");
const wordsToNum = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const m = readme.match(/\b(two|three|four|five|six|seven|eight|nine|ten|\d+) sample projects\b/i);
const stated = m ? (wordsToNum[m[1].toLowerCase()] ?? Number(m[1])) : null;
if (stated == null) fail("README does not state the sample project count");
if (stated !== sampleCount) fail(`README says ${stated} sample projects; src/samples.js has ${sampleCount}`);
ok(`${sampleCount} samples in code, README agrees`);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`\nPre-flight passed for rubricloop ${pkg.version}. Bump the version, commit, then deploy.`);
