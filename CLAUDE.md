# RubricLoop

Rubric-building and grading agent for LLM outputs. React + Vite front end, one Vercel serverless proxy (`api/claude.js`) that holds the Anthropic key, no backend or persistence in the prototype.

## Commands
- `npm run dev` / `npm run build`
- `npm test` (unit tests, no key needed)
- `ANTHROPIC_API_KEY=... npm run harness -- --set <name>` (grades a golden set, needs key)

## Layout
- `src/App.jsx` UI and agent loop; `src/lib.js` pure scoring/routing shared with the harness; `src/prompts.js` the three agent prompts; `src/samples.js` demo projects
- `harness/sets/<name>/` frozen golden sets; `harness/run.mjs` the evaluator
- `docs/` PRD, system map, niche-examples guide

## Rules
- Plain writing everywhere, including UI copy and prompts: no em dashes, no filler, no marketing tone.
- The API key lives only in Vercel env vars and local `.env`. Never in code, docs or chat.
- Approved rubric versions are immutable; edits create a new version.
- Golden sets are frozen; a score change is its own commit with a reason.

## Skills (`.claude/skills/`)
- `add-sample-project`: add a demo domain with a seeded batch.
- `eval-golden-set`: scaffold, validate, run and read a golden set.
- `release`: pre-flight and deploy. User-invoked only (`/release`).
