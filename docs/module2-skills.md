# Module 2: Turning RubricLoop's repeatable work into skills

Anurag, September 2026

## 1. Which work repeated

RubricLoop was built over about a dozen working sessions. Looking back at what got done more than once, with the same steps each time:

| Task | Times done | Well-defined? | Consistent process? | Decision |
|---|---|---|---|---|
| Add a sample project (task, labelled examples, seeded batch, docs entry, PRD row) | 4, then a 5th in this module | Yes, same shape every time | Yes, but the seeding rules lived only in my head | Skill: `add-sample-project` |
| Build a golden set and run the evaluation harness | 1, and one is needed per sample | Yes, fixed JSON schema | Yes, but retyping items into JSON is tedious and error-prone | Skill: `eval-golden-set` |
| Release: test, build, check copy, bump version, deploy, verify | 4 | Yes | Mostly; twice a step was skipped and the live site drifted from the repo | Skill: `release` |
| Apply the writing rules (no em dashes, no filler) to app copy and docs | 3 | Yes | Yes | Not a separate skill: the rules are one paragraph in `CLAUDE.md` and enforced by a check inside `release` |
| Regenerate the PRD | 5 | No, each pass had different goals | No | Not a skill: one-off document work |
| Edit the agent prompts | 3 | No, each edit was a judgement call | No | Not a skill: a prompt change is a design decision that should be measured with `eval-golden-set`, which is the reusable part |

The test I applied: would a new collaborator, or a fresh Claude session, produce the same quality output without me re-explaining? For the first three, the answer was no without the skill and yes with it. For the others, a skill would either duplicate a one-line rule or wrap a decision that should stay a decision.

## 2. The skills

All three live in `.claude/skills/` in the repo, so anyone who clones it gets them. Each has a `SKILL.md` with purpose, trigger, inputs, process, output, constraints and an example, plus a script for the deterministic part so the model is not asked to do checking a program does better.

### add-sample-project

Captures the recipe for a demo domain that actually exercises the agent: a task with explicit hard rules, four to six labelled examples with specific reasons, and a batch seeded with named failure modes, including one near miss and exactly one grader-directed instruction. The nuance that took four attempts to learn is written down: bad items must be the kind a tired human would let through, and the near-miss item is what demonstrates the refinement loop.

`scripts/validate_samples.mjs` checks structure, label balance, batch size, reasons, em dashes and that the injection regex fires on at least one item.

### eval-golden-set

Captures how to turn a sample into a regression test for the grader. `scripts/scaffold_set.mjs` pre-fills `golden.json` from a sample's batch so the human only types scores; `scripts/validate_set.mjs` checks weights, anchors, score ranges, flag vocabulary and that the injection regex agrees with `expect_flags`; `references/reading-results.md` says how to read the five summary lines of the harness report and what action each pattern calls for.

Two rules in this skill exist because of how easy it is to get them wrong: never let the agent fill in human scores itself, and never change a golden set and the grade prompt in the same commit.

### release

The only skill with side effects, so it carries `disable-model-invocation: true` and runs only when a person types `/release`. `scripts/preflight.mjs` runs tests, build, the sample validator, a copy scan, a secrets scan and a README consistency check, and stops at the first failure. The skill then bumps the version, commits, deploys and verifies the live URL, and says explicitly what to do if the key is missing on Vercel without ever handling the key itself.

## 3. Applying the skills

In this module I used all three to add a fifth sample project, "Metric definitions for a data catalog": given a SQL query, write the catalog definition an analyst or PM would read instead of the SQL.

**add-sample-project.** Following the numbered process took one pass. The task encodes three hard rules (must match the SQL, must state grain, must not invent context). The nine-item batch has: two contradictions of the SQL, a missing grain, a dropped date filter as the near miss, an invented owner and refresh schedule, one grader-directed line, and five clean items. The validator passed first time. Running it across the four older samples also produced a useful note: the original support sample's task is 45 words, shorter than the 60 the skill recommends. It grades fine, so the validator treats it as a note rather than a failure; that calibration came from applying the skill, not from writing it.

**eval-golden-set.** The scaffolder produced a nine-item `golden.json` in one command. Running the validator on the raw scaffold correctly refused it with four problems (stub key present, no criteria, weights zero, no scores). After filling the reference rubric (five criteria, weights 35/20/25/10/10) and scores, it passed. This environment has no API key, so the harness run itself is pending; the skill says to stop and say so rather than invent a report, which is what happened. One honesty note: I scored the items myself because I authored the seeded faults with intended scores. For a sample written by someone else, the skill requires their scores.

**release.** Pre-flight passed all six checks on the finished change (8 tests, 218 kB bundle, 5 samples valid, copy clean, no key strings in 29 files, README count matches). Version bumped 0.3.0 to 0.4.0 because the harness gained the `--set` option. The deploy step is left for the person to run, which is the point of the manual gate.

The PRD (v1.1) and `docs/niche-examples.md` were updated as the skill's steps 7 and 8 require.

## 4. What the skills changed

- **Faster.** Adding the fourth sample without a skill took roughly forty minutes including two rounds of "did I remember the injection item, did I update the docs, does the README count match". The fifth, with the skill, took about fifteen, and the checks were a single command.
- **More consistent.** Every sample now has the same anatomy, so a reviewer who has seen one knows where to look in the others, and every golden set has the same schema, so harness numbers are comparable across domains.
- **Fewer silent mistakes.** The pre-flight caught nothing this time, which is the desired outcome, but the categories it checks are exactly the three ways earlier releases went wrong: a skipped build, copy that violated the writing rules, and a README that lagged the code.
- **Safer.** The release skill cannot be triggered by the model, and the golden-set skill will not let the model score its own test. Both are one line of frontmatter or one sentence of instruction, and both would have been easy to omit.

## 5. Limits and next steps

The skills are tuned to this repo's file layout; moving `samples.js` would break the scripts, and the paths should become configurable if the project grows. The harness has not yet run on the new golden set, so the first real result from `eval-golden-set` on the metric domain is the next thing to do once a key is available. A fourth candidate skill, "propose a rubric edit from a set of overrides", is the agent's own refine step and is deliberately left inside the app rather than made a developer skill; if it turns out developers want to run it offline against golden sets, that is where the next skill would come from.
