// Pure functions shared by the app and the harness. No React, no network.
export const uid = (p) => p + Math.random().toString(36).slice(2, 7);
export const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'").trim();
export const overallOf = (scores, criteria) => {
  const tw = criteria.reduce((a, c) => a + (c.weight || 0), 0) || 1;
  return criteria.reduce((a, c) => a + (c.weight || 0) * (scores[c.id] || 0), 0) / tw;
};
export const normalizeWeights = (criteria) => {
  const tw = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 1;
  let acc = 0;
  return criteria.map((c, i) => {
    const w = i === criteria.length - 1 ? 100 - acc : Math.round(((Number(c.weight) || 0) / tw) * 100);
    acc += w;
    return { ...c, weight: w };
  });
};
export const fmt = (n) => (n == null || isNaN(n) ? "-" : n.toFixed(1));
export const INJ = /ignore (the )?(rubric|instructions)|note (to|for) (the )?grader|should receive 5|give (this|me) (a )?5|rate this (a )?5|(full|top) marks|merits (a )?5/i;


// Routing rule: this is code, not a prompt instruction.
export const shouldQueue = (confidence, flags, threshold) =>
  confidence < threshold || flags.includes("policy_risk") || flags.includes("injection_suspect");

// Post-process a raw grade response against a rubric version. Returns a grade record.
export function buildGrade(r, item, version, threshold) {
  const scores = {};
  version.criteria.forEach((c) => { const n = Number(r.scores?.[c.id]); scores[c.id] = Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 3; });
  let confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0.5));
  const flags = Array.isArray(r.flags) ? [...r.flags] : [];
  const evidence = String(r.evidence || "");
  if (evidence && !norm(item.content).includes(norm(evidence))) { confidence = Math.max(0, confidence - 0.2); flags.push("evidence_mismatch"); }
  if (INJ.test(item.content) && !flags.includes("injection_suspect")) flags.push("injection_suspect");
  const overall = overallOf(scores, version.criteria);
  return { scores, overall, rationale: r.rationale || "", evidence, confidence, uncertainty_reason: r.uncertainty_reason || (confidence < 0.8 ? "borderline_score" : null), flags, queued: shouldQueue(confidence, flags, threshold), version: version.version, source: "agent" };
}

// Apply approved rubric edits to a criteria list, returning a new list.
export function applyEditsToCriteria(criteria, approved) {
  let crit = criteria.map((c) => ({ ...c, anchors: { ...c.anchors } }));
  approved.forEach((e) => {
    if (e.type === "reword" && e.target_criterion_id) {
      crit = crit.map((c) => {
        if (c.id !== e.target_criterion_id) return c;
        if (e.field?.startsWith("anchor_")) return { ...c, anchors: { ...c.anchors, [e.field.split("_")[1]]: e.new_text } };
        return { ...c, [e.field || "description"]: e.new_text };
      });
    } else if (e.type === "add_criterion" && e.new_criterion) {
      const nc = { ...e.new_criterion, id: e.new_criterion.id || `c${crit.length + 1}`, anchors: e.new_criterion.anchors || {} };
      if (crit.some((c) => c.id === nc.id)) nc.id = `c${crit.length + 1}`;
      crit = normalizeWeights([...crit, nc]);
    } else if (e.type === "reweight" && e.new_weights) {
      crit = normalizeWeights(crit.map((c) => ({ ...c, weight: e.new_weights[c.id] ?? c.weight })));
    }
  });
  return crit;
}
