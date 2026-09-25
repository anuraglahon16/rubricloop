# RubricLoop

Rubric-building and grading agent for LLM outputs. React + Vite front end, one Vercel serverless proxy (`api/claude.js`) that holds the Anthropic key, no backend or persistence in the prototype.

## Commands
- `npm run dev` / `npm run build`
- `npm test` (no key needed)
- `ANTHROPIC_API_KEY=... npm run harness -- --set <name>` (needs key)

## Layout
- `src/App.jsx` UI and agent loop; `src/lib.js` pure scoring/routing; `src/prompts.js` agent prompts; `src/samples.js` demo projects
- `harness/sets/<name>/` frozen golden sets; `harness/run.mjs` the evaluator
- `docs/` PRD, system map, guides

## Rules
- Plain writing everywhere, UI copy and prompts included: no em dashes, no filler, no marketing tone.
- The API key lives only in Vercel env vars and local `.env`. Never in code, docs or chat.
- Approved rubric versions are immutable; edits create a new version.
- Golden sets are frozen; a score change is its own commit with a reason.

## Skills and subagents (`.claude/`)
- `add-sample-project`: add a demo domain with a seeded batch.
- `eval-golden-set`: scaffold, validate, run and read a golden set.
- `release`: pre-flight and deploy. User-invoked only (`/release`).
- `harness-auditor` (subagent): judge a grader change against the golden sets. Verdict only.
