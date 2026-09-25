---
name: eval-golden-set
description: Build, validate and run a golden set for RubricLoop's evaluation harness (harness/sets/<name>/rubric.json and golden.json), then read the results. Use whenever someone wants to test how well the grader agrees with humans, add human scores for a sample project, check calibration or flag recall, run or interpret the harness, or gate a prompt change. Also use when the grade prompt or a rubric anchor is being edited, since any such change should be measured against a golden set before it ships.
---

# Build and run a golden set

RubricLoop is a grader, so the question that matters is whether the grader is right. The harness in `harness/run.mjs` answers it by grading a frozen set of outputs whose human scores are known and reporting agreement, per-criterion error, calibration by confidence bucket, and whether the expected risk flags fired. A golden set is that frozen input: a reference rubric plus items with human scores.

Building one by hand means retyping every batch item into JSON and remembering the schema. The scaffolder here does the retyping; the human's job is reduced to the part only a human can do, which is deciding the scores.

## Inputs you need

- Which sample project (from `src/samples.js`) or which external batch the set is for.
- A reference rubric: usually the v1 rubric the agent drafted and a human approved in the app. Copy it from the app's "Approved versions" panel, or write one by hand in the same shape. Weights must sum to 100 and anchors for 1, 3 and 5 must be present.
- Human per-criterion scores for every item, and the risk flags each item should raise. If the requester has not scored the items, the scaffold produces a file with blanks for them to fill in; do not invent scores.

## Process

1. Scaffold: `node .claude/skills/eval-golden-set/scripts/scaffold_set.mjs --sample "<name substring>" --out <set-name>`. This creates `harness/sets/<set-name>/` with `golden.json` pre-filled from the sample's batch (ids g01..gNN, content, empty `human` and `expect_flags`) and a `rubric.json` stub containing the task text and an empty criteria array. It refuses to overwrite an existing set.

2. Fill `rubric.json` criteria. Each criterion: `id`, `name`, `weight`, `description`, `anchors` with keys "1", "3", "5", and `evidence_hint`. Use the same ids the app uses (c1, c2, ...) so results line up with the results table.

3. Fill `golden.json`. For each item set `human` to an integer 1 to 5 per criterion id, and `expect_flags` to the subset of `policy_risk`, `injection_suspect` the item should raise (usually empty). Score against the anchors, not against a general feeling; the point of the set is to be the standard the agent is measured against. Read `docs/niche-examples.md` for what each seeded item was designed to test; the human score should reflect that fault.

4. Validate: `node .claude/skills/eval-golden-set/scripts/validate_set.mjs <set-name>`. It checks weights, anchors, ids, that every item scores every criterion in range, that flags are from the known vocabulary, and that the injection regex agrees with `expect_flags`. Fix anything it reports before running the harness, because a malformed set produces a misleading agreement number rather than an error.

5. Run: `ANTHROPIC_API_KEY=... node harness/run.mjs --set <set-name>`. Optional `--threshold` (routing threshold, default 0.7) and `--min-agreement` (exit non-zero below it, default 0.7). Each run costs about one cent per item.

6. Read the report using `references/reading-results.md`. Summarise for the requester: agreement, the criterion with the highest error, whether calibration is monotone, and any expected flag that was missed.

7. Commit the set. Golden sets are frozen: if a score turns out to be wrong, change it in a separate commit with the reason in the message, so agreement numbers across runs stay comparable.

## Output

- `harness/sets/<set-name>/rubric.json` and `golden.json`, passing the validator.
- A harness report (paste the summary lines, not the full table, unless asked).
- Three or four sentences of interpretation, including one recommended action (a rubric anchor to tighten, a threshold to move, or nothing to change).

## Constraints and nuances

- When the run is judging a change to the grade prompt, to scoring in `src/lib.js` or to a
  rubric anchor, hand the run and the reading to the `harness-auditor` subagent
  (`.claude/agents/harness-auditor.md`) rather than doing it here. The session that made
  the change should not be the one that judges whether it helped. Use this skill for
  building and validating the set; use the auditor for the verdict.
- Never fill in human scores yourself when the requester has not provided them. An agent scoring its own golden set defeats the purpose. Leave blanks and say so.
- Keep sets small and deliberate: 8 to 20 items. A golden set is a regression test, not a benchmark; it should run in under a minute and cost cents.
- Do not edit a golden set and the grade prompt in the same change. Change one, run, then change the other, or you cannot tell which moved the number.
- The near-miss item (see `add-sample-project`) is the most informative one. If the agent passes it with high confidence, the rubric anchors are too loose on that criterion; that is a finding, not a failure of the set.
- Agreement is measured on the weighted overall within 0.5. Per-criterion MAE tells you where the disagreement lives; look there before touching anything.
- The harness needs an API key and network. If neither is available, stop after validation and say the run is pending; do not fabricate a report.

## Example

Request: "Build a golden set for the earnings sample and tell me if the grader catches the wrong revenue figure."

Scaffold with `--sample earnings --out earnings-summaries`, paste the v1 rubric from the app, ask the requester for scores (or use theirs), validate, run. In the report, look at item g06 (revenue stated as $3.2B against a source of $3.02B): if its accuracy score is 4 or 5 with confidence above 0.8, report that the faithfulness anchor needs to say figures must match the source exactly, and suggest that as the rubric edit to test next.
