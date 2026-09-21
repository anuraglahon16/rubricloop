# RubricLoop

A rubric-building and grading agent for LLM outputs. Prototype for Module 1: Design and Prototype Your AI Agent.

The agent drafts a rubric from a task description and labelled examples, grades a batch of outputs against it, routes low-confidence or flagged items to a human review queue, and proposes rubric edits from the human's overrides. Approving edits creates a new rubric version and re-grades the disputed items.

See `docs/RubricLoop_PRD.pdf` for the full product and technical specification.

## Run locally

```
npm install
ANTHROPIC_API_KEY=sk-ant-... npx vercel dev
```

Or, without the Vercel CLI, run `npm run dev` and point the app at any endpoint that proxies to the Anthropic Messages API by setting `VITE_API_URL`.

## Deploy

Deployed on Vercel. Set `ANTHROPIC_API_KEY` in the project's environment variables. The browser never sees the key; `api/claude.js` forwards requests server-side.

## Sample projects

Five sample projects are built in, selectable on the Set up screen: customer support replies, SQL query explanations for analysts, blameless incident postmortem summaries, earnings press-release summaries, and metric definitions for a data catalog. Each batch is seeded with known failure modes. `docs/niche-examples.md` lists what to look for in each.

## Harness

Two layers of checks sit around the agent.

Unit tests cover the pure functions the app and the harness share (weight normalisation, weighted overall, the routing rule, grade post-processing, edit application, injection detection):

```
npm test
```

The evaluation harness grades a golden set of 12 outputs with the real grade prompt and reports agreement with human scores, mean absolute error per criterion, agreement by confidence bucket (calibration), how many items would be routed to review, and whether the expected risk flags were raised. It exits non-zero if agreement drops below a threshold, so it can run in CI on every prompt change:

```
ANTHROPIC_API_KEY=sk-ant-... npm run harness
ANTHROPIC_API_KEY=sk-ant-... node harness/run.mjs --threshold 0.7 --min-agreement 0.7
```

Each golden set lives in `harness/sets/<name>/` as `rubric.json` (the frozen reference rubric) and `golden.json` (items with human per-criterion scores). Pick one with `--set <name>`; the default is `support-replies`.

## Structure

- `src/App.jsx`: the prototype UI and agent loop (setup, rubric editor, grading, review queue, refinement, agent trace)
- `src/lib.js`: pure functions shared by the app and the harness (scoring, routing, edit application)
- `src/prompts.js`: the three agent prompts (draft, grade, refine)
- `src/samples.js`: the five sample projects (task, labelled examples, seeded batch)
- `api/claude.js`: serverless proxy to the Anthropic API
- `harness/`: golden set, reference rubric, evaluation script and unit tests
- `docs/`: PRD and system map
- `docs/`: PRD
