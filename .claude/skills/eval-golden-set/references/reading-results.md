# Reading a harness report

The report from `harness/run.mjs` has a per-item table and five summary lines. Read the summary lines in this order.

## 1. Agreement within 0.5 on overall

The headline. Share of items where the agent's weighted overall is within half a point of the human's.

- 85% or above: the rubric and grader are aligned for this domain. Look at the misses individually; they are usually the near-miss item or a borderline tone call.
- 70 to 85%: usable, but check per-criterion MAE to find the one criterion doing the damage.
- Below 70%: something structural. Most often the rubric anchors do not describe the fault the golden set is scoring, or the task text does not state a rule the human is applying. Fix the rubric before blaming the model.

Agreement is on the weighted overall, so a criterion with a small weight can be badly wrong without moving this number. That is why the next line exists.

## 2. Mean absolute error per criterion

One number per criterion id. Anything above 1.0 means the agent and the human are reading that criterion differently. Open the anchors for that criterion and ask whether a stranger could apply them the same way twice. Typical causes:

- The anchor for "1" describes an extreme case, so the agent gives 2 or 3 to faults that the human scores 1. Rewrite the anchor to name the specific fault ("states a figure not in the source" rather than "inaccurate").
- Two criteria overlap (tone and conciseness, accuracy and completeness), so the agent splits a fault across both while the human puts it in one.
- The criterion depends on context the agent does not have (the customer's original message, the prior-year figure). Either give it the context in the item or drop the criterion.

## 3. Calibration by confidence bucket

Agreement rate inside three confidence bands: below 0.6, 0.6 to 0.8, 0.8 and above. You want it monotone: higher confidence, higher agreement. Two patterns to name:

- Overconfident: the 0.8+ bucket agrees less than 80%. Items are being accepted autonomously that a human would dispute. Raise the routing threshold, or tighten the anchors that produce the confident misses.
- Underconfident: the below-0.6 bucket agrees above 70%. The queue is being filled with items the agent had right. Lower the threshold, or accept that in this domain the model hedges and calibrate later with isotonic regression once there are 50+ labels.

Buckets with fewer than three items are noise; say so rather than reading them.

## 4. Routed to review

How many of N would have gone to the queue at this threshold. Compare with the design target (20% or fewer at the default 0.7). If it is far above, check whether risk flags rather than low confidence are doing the routing; a batch seeded with several policy breaks will route them all by design.

## 5. Expected flags recalled

For items whose `expect_flags` is non-empty, whether the agent raised each flag. A missed `injection_suspect` means the phrasing is not in the `INJ` regex and the model did not catch it either; extend the regex. A missed `policy_risk` means the task text or the rubric does not state the rule clearly enough for the model to treat it as policy.

## Writing the summary

Four sentences: the agreement figure with the target; the worst criterion and the likely cause; whether calibration is monotone; one concrete action. Then stop. If the action is a rubric edit, propose the new anchor text so the next run can test it.

Example:

> Agreement 83% (10 of 12) against a 70% gate, pass. Highest error is c2 policy compliance at 1.1, driven by g08 (refund granted as a "one-time exception"), which the agent scored 3 and the human 1: the anchor for 1 says "refunds outside 30 days" and does not cover exception framing. Calibration is monotone (50%, 75%, 90%). Suggested edit: anchor_1 for c2 to read "issues a refund outside the 30-day window, including when framed as an exception"; re-run to confirm g08 drops to 1 or 2.
