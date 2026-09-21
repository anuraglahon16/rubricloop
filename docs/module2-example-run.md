# Module 2: example run

Captured output from applying the three skills to add the metric-definitions sample (September 20, 2026).

## add-sample-project: validator
```
$ node .claude/skills/add-sample-project/scripts/validate_samples.mjs
ok    Customer support replies (furniture store)  (examples 3g/3b, batch 12, injection items 1)
       note:    task is 45 words; 60 to 120 gives the draft step more to work with
ok    SQL query explanations for analysts (data engineering)  (examples 2g/2b, batch 8, injection items 1)
ok    Blameless incident postmortem summaries (SRE)  (examples 2g/2b, batch 8, injection items 1)
ok    Earnings press-release summaries (finance newsletter)  (examples 2g/2b, batch 8, injection items 1)
ok    Metric definitions for a data catalog (analytics engineering)  (examples 2g/2b, batch 9, injection items 1)

All samples pass.
```

## eval-golden-set: scaffold, then validator on the raw scaffold (expected to fail), then after filling
```
$ node .claude/skills/eval-golden-set/scripts/scaffold_set.mjs --sample metric --out metric-definitions
Scaffolded harness/sets/metric-definitions/ from "Metric definitions for a data catalog (analytics engineering)"
  golden.json: 9 items, human scores blank
  rubric.json: stub with task text; paste the approved criteria

$ node .claude/skills/eval-golden-set/scripts/validate_set.mjs metric-definitions   (raw scaffold)
harness/sets/metric-definitions: 0 criteria (weights 0), 9 items, 0 scored, 0 expecting flags
  problem: rubric.json still has the _instructions stub key
  problem: 0 criteria; expected 3 to 7
  problem: weights sum to 0, not 100
  problem: no item has human scores yet; the set is a scaffold, not a golden set
4 problem(s). Fix before running the harness.

$ node .claude/skills/eval-golden-set/scripts/validate_set.mjs metric-definitions   (after filling)
harness/sets/metric-definitions: 5 criteria (weights 100), 9 items, 9 scored, 4 expecting flags

Valid. Run: ANTHROPIC_API_KEY=... node harness/run.mjs --set metric-definitions

$ node harness/run.mjs --set metric-definitions
Set ANTHROPIC_API_KEY.        (no key in the authoring environment; run pending)
```

## release: pre-flight
```
$ node .claude/skills/release/scripts/preflight.mjs

[1] Unit tests
    ok: 8 passed, 0 failed

[2] Production build
    ok: built, bundle 217.59 kB

[3] Sample projects
    ok: 5 samples checked, all pass

[4] Copy rules (no em dashes, middle dots, banned words in src/ and docs/)
    ok: 6 files clean

[5] Secrets
    ok: no key strings in 29 files; .env ignored

[6] README consistency
    ok: 5 samples in code, README agrees

Pre-flight passed for rubricloop 0.4.0. Bump the version, commit, then deploy.
```

## Files produced by the run
- `src/samples.js`: fifth entry, "Metric definitions for a data catalog (analytics engineering)", 4 examples, 9-item batch
- `docs/niche-examples.md`: section 5 describing what each item is designed to catch
- `harness/sets/metric-definitions/rubric.json` and `golden.json`: 5 criteria, 9 scored items, 4 with expected flags
- `docs/RubricLoop_PRD.pdf` v1.1: new row in the Section 8 sample table
- `package.json`: 0.3.0 to 0.4.0
