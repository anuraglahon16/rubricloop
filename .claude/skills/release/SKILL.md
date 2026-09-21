---
name: release
description: Pre-flight and ship a RubricLoop release to Vercel. Runs tests, build, sample and copy checks, bumps the version, then deploys and verifies the live URL. Invoke with /release when a change is ready to go live; not for local experiments.
disable-model-invocation: true
---

# Release RubricLoop

Releasing is the one workflow here with consequences outside the repo: a broken build takes the demo link down, and a leaked key or a stray em dash in the UI is visible to every reviewer. So this skill is invoked by a person, not triggered automatically, and it refuses to deploy when any check fails.

The order matters. Checks that are cheap and local run first; the deploy is last and only if everything before it is green.

## Inputs you need

- Confirmation of what is in this release (one line is enough; it becomes the commit message and the version bump note).
- Whether the target is `production` (the public demo link) or `preview` (a shareable test URL). Default to preview when the change touches prompts or grading logic and nobody has run the harness on it yet.

## Process

1. Run the pre-flight script from the repo root: `node .claude/skills/release/scripts/preflight.mjs`. It runs, in order:
   - `npm test` (unit tests for the shared scoring and routing code).
   - `npm run build` (Vite production build).
   - The sample validator (`add-sample-project` skill), so a half-finished sample cannot ship.
   - A copy scan over `src/` and `docs/` for em dashes, middle-dot separators and the banned filler words, since the project's writing rules apply to UI text and prompts.
   - A secrets scan: no `sk-ant-` strings anywhere in tracked files, and `.env` is gitignored.
   - A consistency check: the sample count in `src/samples.js` matches the count stated in `README.md`.
   Stop on the first failure and fix it. Do not skip a check to get a deploy out; that is how the reviewer sees a broken page.

2. If the change touched `src/prompts.js` or any rubric anchor logic, run the harness on at least one golden set (`eval-golden-set` skill) and confirm agreement did not drop below the previous run. Record the numbers in the release note.

3. Bump `version` in `package.json` (patch for copy and sample changes, minor for new capability, major never during the prototype). Commit with a one-line message describing the change.

4. Deploy. Two routes, in order of preference:
   - Git-linked project: push to `main`; Vercel builds automatically. Watch the deployment reach Ready.
   - Direct: use the Vercel deploy tool with the repo's source files (not `dist/`, not `node_modules/`) and the target from the inputs. The project name is `rubricloop`.

5. Verify the live site. Open the production URL (`https://rubricloop.vercel.app`), load a sample, and draft a rubric. A rubric appearing within about 15 seconds is the pass condition. If the page loads but drafting fails with a key error, the `ANTHROPIC_API_KEY` environment variable is missing on the Vercel project; it is set in the project's Environment Variables and needs a redeploy to take effect. Never paste the key into code or chat to work around this.

6. Report: version, target, URL, what changed, harness numbers if step 2 ran, and anything deferred.

## Output

- A green pre-flight log.
- A version bump commit.
- A Ready deployment and a one-paragraph release note.

## Constraints and nuances

- Never deploy with failing tests or a failing build, even for a "small copy fix". The copy fix is not what breaks; the thing you did not run is.
- The API key lives only in Vercel's environment variables and the local `.env`. If pre-flight finds `sk-ant-` in any tracked file, treat the key as compromised: rotate it in the Anthropic console before doing anything else.
- Preview deploys are cheap. When in doubt about a grading change, ship to preview, run the sample by hand, then promote.
- Keep the release note plain. It is read by the person grading the assignment as much as by anyone.
- If the environment cannot reach Vercel (no tool, no network), stop after step 3 and hand the person the exact `git push` or `vercel --prod` command to run. Do not describe a deploy that did not happen as done.

## Example

Request: "/release, adding the metric-definitions sample, production."

Pre-flight passes (8 tests, build 190 kB, 5 samples valid, no copy or secret findings, README says five samples). No prompt change, so the harness step is skipped and noted. Version 0.3.0 to 0.3.1. Push to main, deployment Ready in 50 seconds, production URL loads and drafts a rubric for the new sample. Release note: "0.3.1: adds the metric-definitions sample project (data catalog domain, five seeded faults, one near miss on grain). No prompt or grading changes; harness not re-run."
