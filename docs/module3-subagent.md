# Module 3: the harness-auditor subagent

Definition: [`.claude/agents/harness-auditor.md`](../.claude/agents/harness-auditor.md)

## What it does

RubricLoop is a grader. The only question that matters about it is whether the grader
agrees with a human, and the only thing that answers that question is
`harness/run.mjs` run against a frozen golden set. The auditor owns that judgement
end to end: it validates each set, runs both of them, reads the reports against the
documented thresholds, and returns a single `ship` / `hold` / `pending` verdict with
one recommended action.

It does not build golden sets and it does not fix what it finds. Those are the
`eval-golden-set` skill and the caller's job respectively.

## Why a subagent and not a skill

The repo already has an `eval-golden-set` skill that can run the harness and read the
report, so the honest question is what the subagent adds. Three things, in order of
how much they matter here.

**Independence.** The session that edited `src/prompts.js` is the worst possible judge
of whether that edit helped. It knows what the change was meant to do, so it reads an
ambiguous number charitably. A subagent starts with no memory of the edit or the
reasoning behind it: it sees the prompt text and the numbers, nothing else. This is the
same principle the product itself runs on. RubricLoop routes low-confidence grades to a
human because the grader should not be the final judge of its own output; the auditor
is that gate applied one level up, to the grader's own changes. A skill cannot provide
this, because a skill executes inside the context that made the change.

**Output volume.** A full audit is two harness runs: 21 items, each printing a row of
seven columns, plus five summary lines and any retry noise per set. All of it is
intermediate work. The main session needs six lines. Running this inline means ~50 rows
of table live in the context permanently, for a verdict that fits in a tweet.

**Read set.** To judge a prompt change properly the auditor reads `src/prompts.js`,
`buildGrade` in `src/lib.js`, both `rubric.json` anchor sets, both `golden.json` files
and `references/reading-results.md`. That is a large, single-purpose read set that has
no value in the main session once the verdict is in.

Bounded tools are a fourth, smaller reason: `Bash, Read, Grep, Glob` and deliberately
no `Write` or `Edit`. An auditor that can edit the thing it is judging will be tempted
to fix and re-judge, which is how you launder a regression into a pass. It also cannot
touch the golden sets, which CLAUDE.md freezes.

## When it is called

- After any edit to `src/prompts.js`.
- After any edit to scoring or routing in `src/lib.js`.
- After any edit to an anchor in `harness/sets/*/rubric.json`.
- Before shipping any of the above. The `release` pre-flight covers tests, build and
  copy rules; it deliberately does not run the harness, because the harness costs money
  and needs a key. The auditor is the gate that pre-flight does not include.

Not called for: building a set (that is `eval-golden-set`), grading a batch in the app,
or a change that cannot move a grade, such as UI copy or the Vercel config.

## What context it receives

Subagents start fresh, so the spawning prompt must carry everything. Concretely:

1. The working directory.
2. Which files changed, with a one-line summary of each change. The summary, not the diff,
   and never the reason the change was made.
3. Baseline numbers from the last accepted run if any exist: agreement per set, and flag
   recall. Without them the auditor reports absolute numbers against the gates and says
   the baseline was missing.
4. Which golden sets to run, by folder name under `harness/sets/`.

Everything else it fetches itself rather than being handed: both sets' `rubric.json` and
`golden.json`, `src/prompts.js`, `buildGrade` in `src/lib.js`, and
`.claude/skills/eval-golden-set/references/reading-results.md`, which its process names as
the authority on interpretation. Passing those in the prompt would defeat the purpose,
since keeping that read set out of the calling session is half the reason the subagent
exists.

What it does not receive:

- The intent behind the change. It is told what changed, never why. That asymmetry is the
  point.
- Write or Edit tools. It cannot alter a prompt, an anchor or a human score, so it cannot
  fix and re-judge, and it cannot quietly edit a frozen golden set.
- A baseline of its own choosing. Baselines come from the caller, so it cannot pick a
  flattering comparison.

One thing it does inherit: `ANTHROPIC_API_KEY` from the environment, because
`harness/run.mjs` needs it to grade and exits 2 without it. The auditor never reads,
prints or copies the key and nothing instructs it to, but it is not isolated from the
environment. A caller who has not exported the key gets a `pending` verdict, not a run.

## Gates

Hold if any of: a set exits 1 or agreement is below 70%; agreement fell more than 5
points against baseline on any set; an `expect_flags` entry recalled at baseline is now
missed; the 0.8-and-above confidence bucket agrees under 80% with three or more items in
it. Otherwise ship. Buckets under three items are noise.

## Output

```
VERDICT: ship | hold | pending
<set>: agreement N% (target M%), <delta vs baseline or "no baseline">
Worst criterion: <id> MAE <n> on <set>, cause in <anchor>
Calibration: monotone | overconfident | underconfident (<bucket figures>)
Flags: recall N%, missed <ids or none>
Action: <exactly one, or "none">
Caveat: <what limits this verdict, or omit the line>
```

Under 200 words, no per-item table, at most two item ids as evidence, cause clause under
25 words. When the verdict is `pending` it may add at most two one-line blockers.

## How it was tested

Two tests, both run against the definition file as written. Neither could call the agent
by its name, because `.claude/agents/` is read at session start and the definition was
created mid-session; both loaded the same file as the agent's instructions into a fresh
agent context instead. Calling it as `harness-auditor` works from the next session on.

**Test 1, refusal to fabricate.** This machine has no `ANTHROPIC_API_KEY` (the key lives
only in Vercel, per CLAUDE.md), so `harness/run.mjs` exits 2. This is the auditor's most
dangerous failure mode: a made-up evaluation is worse for this project than no
evaluation. Result: `pending`, both sets validated but not run, the exit-2 mechanism
named at `harness/run.mjs:19`, and an explicit closing line that it ran nothing and
estimated nothing. Pass.

**Test 2, interpretation and gates.** A hand-written report fixture with a planted
regression: agreement down 8 points on one set, flag recall lost on two items, and the
0.8-and-above bucket at 57% of 7. Result: `hold`, all three gates tripped and named, the
one-item `<0.6` bucket correctly dismissed as noise, the worst criterion traced to the
literal `anchor_1` text in `rubric.json`, and exactly one action. Pass.

**What the tests changed.** Both runs independently ran `git diff`, noticed the working
tree did not contain the prompt change described in the brief, and said so. That is the
right instinct, but the output block had no slot for it, so both had to break format to
report it. Two for two is a pattern, not an accident, so the definition gained a
`Caveat:` line and a realistic 200-word cap. A format that forces a choice between
honesty and compliance is a broken format.

Known gap: no live end-to-end run against the real API has been done, because the key is
not available locally and pulling it out of Vercel would break the rule that it never
appears outside Vercel env vars and a local `.env`. Both tests therefore exercise the
interpretation and refusal paths, not the grading path. To close the gap, on a machine
with the key:

```
export ANTHROPIC_API_KEY=...
# then: use the harness-auditor subagent to audit the current change
```

Roughly 21 cents a full audit at one cent an item.
