import { useState, useRef, useEffect, Fragment } from "react";
import { uid, norm, overallOf, normalizeWeights, fmt, buildGrade, applyEditsToCriteria } from "./lib.js";
import { DRAFT_SYSTEM, GRADE_SYSTEM, REFINE_SYSTEM } from "./prompts.js";
import { SAMPLES } from "./samples.js";

// RubricLoop: rubric-building and grading agent for LLM outputs
// Prototype: full agent loop (draft -> grade -> route -> review -> refine)
// running live against Claude. State is in memory only.

const C = {
  paper: "#F5F6F4",
  panel: "#FFFFFF",
  ink: "#16181D",
  muted: "#5B6470",
  line: "#D9DEDC",
  teal: "#0E6E6D",
  tealSoft: "#E3F0EF",
  amber: "#B7791F",
  amberSoft: "#FBF1DF",
  red: "#B42318",
  redSoft: "#FBE9E7",
  slate: "#EEF1F0",
};
const FONT = "'Avenir Next', 'Segoe UI', system-ui, -apple-system, sans-serif";

// model calls
const API_URL = import.meta.env.VITE_API_URL || "/api/claude";
async function callClaude(system, user, retryNote) {
  const messages = [{ role: "user", content: user + (retryNote ? `\n\nYour previous response was not valid JSON (${retryNote}). Return only the JSON object.` : "") }];
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return text;
}
function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}
async function callJSON(system, user) {
  const t1 = await callClaude(system, user);
  try { return parseJSON(t1); } catch (e) {
    const t2 = await callClaude(system, user, String(e.message).slice(0, 80));
    return parseJSON(t2);
  }
}




// small UI atoms
const Btn = ({ children, onClick, kind = "primary", disabled, small }) => {
  const base = { fontFamily: FONT, borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontWeight: 600, border: "1px solid transparent" };
  const kinds = {
    primary: { background: C.teal, color: "#fff" },
    ghost: { background: "transparent", color: C.ink, borderColor: C.line },
    danger: { background: C.redSoft, color: C.red, borderColor: "#F0C9C4" },
    warm: { background: C.amberSoft, color: C.amber, borderColor: "#EBD5AE" },
  };
  return (
    <button onClick={onClick} disabled={disabled} className={small ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"} style={{ ...base, ...kinds[kind] }}>
      {children}
    </button>
  );
};
const Tag = ({ children, tone = "slate" }) => {
  const tones = { slate: [C.slate, C.muted], teal: [C.tealSoft, C.teal], amber: [C.amberSoft, C.amber], red: [C.redSoft, C.red] };
  const [bg, fg] = tones[tone];
  return <span className="px-2 py-0.5 text-xs rounded" style={{ background: bg, color: fg, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
};
const Field = ({ label, children }) => (
  <label className="block mb-3">
    <div className="text-xs mb-1" style={{ color: C.muted }}>{label}</div>
    {children}
  </label>
);
const inputStyle = { fontFamily: FONT, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px", width: "100%", fontSize: 14, color: C.ink, background: "#fff" };
const ConfBar = ({ v, threshold }) => {
  const pct = Math.round((v || 0) * 100);
  const color = v >= threshold ? C.teal : C.amber;
  return (
    <div className="flex items-center gap-2" title={`confidence ${pct}%`}>
      <div style={{ width: 64, height: 6, background: C.slate, borderRadius: 3, position: "relative" }}>
        <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 3 }} />
        <div style={{ position: "absolute", left: `${threshold * 100}%`, top: -3, width: 1, height: 12, background: C.ink, opacity: 0.5 }} />
      </div>
      <span className="text-xs" style={{ color, fontVariantNumeric: "tabular-nums", minWidth: 28 }}>{pct}%</span>
    </div>
  );
};
const Panel = ({ title, children, right }) => (
  <div className="rounded-lg mb-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
    {title && (
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="text-sm" style={{ fontWeight: 700 }}>{title}</div>
        {right}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

// main app
export default function RubricLoop() {
  const [stage, setStage] = useState("setup");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [task, setTask] = useState("");
  const [threshold, setThreshold] = useState(0.7);
  const [examples, setExamples] = useState([]);
  const [clarifications, setClarifications] = useState([]);
  const [draft, setDraft] = useState(null); // editable proposed rubric
  const [versions, setVersions] = useState([]); // approved rubric versions
  const [batchText, setBatchText] = useState("");
  const [items, setItems] = useState([]);
  const [grades, setGrades] = useState({}); // itemId -> grade
  const [labels, setLabels] = useState({}); // itemId -> label
  const [progress, setProgress] = useState(null); // {done, total}
  const [refine, setRefine] = useState(null); // {clusters, edits, expected_effect}
  const [editDecisions, setEditDecisions] = useState({});
  const [regrade, setRegrade] = useState(null); // {rows:[{itemId, before, after, human}], version}
  const [trace, setTrace] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [showTrace, setShowTrace] = useState(true);
  const traceRef = useRef(null);

  const currentVersion = versions[versions.length - 1] || null;
  const log = (stg, summary, decision) => setTrace((t) => [...t, { id: uid("t"), at: new Date(), stage: stg, summary, decision }]);
  useEffect(() => { if (traceRef.current) traceRef.current.scrollTop = traceRef.current.scrollHeight; }, [trace]);

  const queued = items.filter((it) => grades[it.id]?.queued && !labels[it.id]);
  const labelled = items.filter((it) => labels[it.id]);
  const overrides = labelled.filter((it) => labels[it.id].decision === "override");
  const agreeRate = labelled.length ? labelled.filter((it) => labels[it.id].decision === "agree").length / labelled.length : null;

  // ── stage 0: setup ──
  const loadSample = () => {
    const s = SAMPLES[sampleIdx];
    setTask(s.task);
    setExamples(s.examples.map((e) => ({ id: uid("ex"), ...e })));
    setBatchText(s.batch.join("\n---\n"));
    setDraft(null); setVersions([]); setClarifications([]); setItems([]); setGrades({}); setLabels({}); setRefine(null); setRegrade(null); setEditDecisions({});
    log("setup", `Loaded sample project: ${s.name}`, `${s.examples.length} labelled examples, ${s.batch.length}-item batch ready`);
  };
  const addExample = () => setExamples((x) => [...x, { id: uid("ex"), content: "", label: "", reason: "" }]);
  const updExample = (id, patch) => setExamples((x) => x.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // ── stage 1: draft ──
  const draftRubric = async () => {
    setBusy("draft"); setError(null);
    log("draft", `Received task (${task.length} chars), ${examples.filter((e) => e.content.trim()).length} examples, ${clarifications.length} clarifications`, "Deciding which criteria separate good from bad");
    try {
      const exText = examples.filter((e) => e.content.trim()).map((e, i) => `Example ${i + 1} [${e.label || "unlabelled"}]${e.reason ? ` (reason: ${e.reason})` : ""}:\n${e.content}`).join("\n\n");
      const clar = clarifications.length ? `\n\nHuman clarifications:\n${clarifications.map((c) => `Q: ${c.q}\nA: ${c.a}`).join("\n")}` : "";
      const user = `Task being evaluated:\n${task}${clar}\n\nScale: 1-5 per criterion.\n\nLabelled examples:\n${exText || "(none provided; rely on the task description and state more assumptions)"}`;
      const r = await callJSON(DRAFT_SYSTEM, user);
      const crit = normalizeWeights((r.criteria || []).map((c, i) => ({ ...c, id: c.id || `c${i + 1}`, anchors: c.anchors || {} })));
      setDraft({ criteria: crit, assumptions: r.assumptions || [], questions: (r.questions || []).map((q) => ({ q, a: "" })) });
      log("draft", `Produced ${crit.length} criteria, ${(r.assumptions || []).length} assumptions, ${(r.questions || []).length} questions`, "Waiting for human approval (gate 1)");
      setStage("rubric");
    } catch (e) { setError("Rubric draft failed: " + e.message); log("draft", "Model returned invalid rubric after retry", "Surfaced error; no version created"); }
    setBusy(null);
  };
  const updCriterion = (id, patch) => setDraft((d) => ({ ...d, criteria: d.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const updAnchor = (id, k, v) => setDraft((d) => ({ ...d, criteria: d.criteria.map((c) => (c.id === id ? { ...c, anchors: { ...c.anchors, [k]: v } } : c)) }));
  const weightSum = draft ? draft.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) : 0;
  const approveDraft = () => {
    const v = { version: versions.length + 1, criteria: draft.criteria.map((c) => ({ ...c, weight: Number(c.weight) })), assumptions: draft.assumptions, approvedAt: new Date(), parent: currentVersion?.version || null };
    const answered = draft.questions.filter((q) => q.a.trim());
    if (answered.length) setClarifications((c) => [...c, ...answered]);
    setVersions((vs) => [...vs, v]);
    log("approve", `Human approved rubric v${v.version} (${v.criteria.length} criteria)`, `Version frozen; ${answered.length} question(s) answered and stored as clarifications`);
    setStage("grade");
  };

  // ── stage 2: grade ──
  const gradeOne = async (item, version) => {
    const rubric = { criteria: version.criteria.map(({ id, name, description, weight, anchors, evidence_hint }) => ({ id, name, description, weight, anchors, evidence_hint })) };
    const clar = clarifications.length ? `\nClarifications from the rubric owner:\n${clarifications.map((c) => `- ${c.q} -> ${c.a}`).join("\n")}` : "";
    const user = `Task:\n${task}${clar}\n\nRubric (JSON):\n${JSON.stringify(rubric)}\n\n<output>\n${item.content}\n</output>`;
    const r = await callJSON(GRADE_SYSTEM, user);
    return buildGrade(r, item, version, threshold);
  };
  const runGrading = async () => {
    const parts = batchText.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 25);
    if (!parts.length || !currentVersion) return;
    const newItems = parts.map((content, i) => ({ id: `it_${i + 1}`, content }));
    setItems(newItems); setGrades({}); setLabels({}); setRefine(null); setRegrade(null); setEditDecisions({});
    setBusy("grade"); setError(null); setProgress({ done: 0, total: newItems.length });
    log("grade", `Received ${newItems.length} outputs; grading against v${currentVersion.version} with threshold ${threshold}`, "Running 4 concurrent graders");
    const results = {};
    let done = 0, failed = 0, q = 0;
    const pool = [...newItems];
    const worker = async () => {
      while (pool.length) {
        const it = pool.shift();
        try {
          results[it.id] = await gradeOne(it, currentVersion);
        } catch (e) {
          try { results[it.id] = await gradeOne(it, currentVersion); } catch (e2) { failed++; results[it.id] = { failed: true, error: e2.message }; }
        }
        if (results[it.id]?.queued) q++;
        done++;
        setProgress({ done, total: newItems.length });
        setGrades({ ...results });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    log("route", `Graded ${done - failed}/${newItems.length}; ${q} below threshold or flagged`, `${q} routed to review queue (gate 2); ${done - failed - q} accepted autonomously${failed ? `; ${failed} failed after retry` : ""}`);
    setBusy(null);
    setStage(q ? "review" : "grade");
  };

  // ── stage 3: review ──
  const label = (itemId, decision, override_overall, note) => {
    setLabels((l) => ({ ...l, [itemId]: { decision, override_overall, note, at: new Date() } }));
    log("ask", `Human ${decision === "agree" ? "agreed with" : "overrode"} grade on ${itemId}${decision === "override" ? ` (${fmt(grades[itemId].overall)} -> ${fmt(override_overall)})` : ""}`, note ? `Note: ${note}` : "No note");
  };

  // ── stage 4: refine ──
  const proposeEdits = async () => {
    if (!overrides.length) return;
    setBusy("refine"); setError(null);
    log("refine", `Received ${overrides.length} disagreements from ${labelled.length} labels`, "Clustering by cause and drafting rubric edits");
    try {
      const dis = overrides.map((it) => ({ id: it.id, output_excerpt: it.content.slice(0, 220), agent_scores: grades[it.id].scores, agent_overall: +grades[it.id].overall.toFixed(2), agent_uncertainty_reason: grades[it.id].uncertainty_reason, human_overall: labels[it.id].override_overall, human_note: labels[it.id].note }));
      const rubric = { criteria: currentVersion.criteria };
      const user = `Task:\n${task}\n\nRubric v${currentVersion.version} (JSON):\n${JSON.stringify(rubric)}\n\nDisagreements (JSON):\n${JSON.stringify(dis)}`;
      const r = await callJSON(REFINE_SYSTEM, user);
      const edits = (r.edits || []).filter((e) => Array.isArray(e.disagreement_ids) && e.disagreement_ids.length).map((e, i) => ({ ...e, id: e.id || `e${i + 1}` }));
      setRefine({ clusters: r.clusters || [], edits, expected_effect: r.expected_effect || "" });
      const dec = {}; edits.forEach((e) => (dec[e.id] = true)); setEditDecisions(dec);
      log("refine", `Proposed ${edits.length} edit(s) across ${(r.clusters || []).length} cluster(s)`, `Waiting for per-edit human approval (gate 3)${(r.edits || []).length !== edits.length ? "; dropped edits without cited disagreements" : ""}`);
      setStage("refine");
    } catch (e) { setError("Refinement failed: " + e.message); log("refine", "Model returned invalid edits after retry", "No changes proposed"); }
    setBusy(null);
  };
  const applyEdits = async () => {
    const approved = refine.edits.filter((e) => editDecisions[e.id]);
    if (!approved.length) return;
    const crit = applyEditsToCriteria(currentVersion.criteria, approved);
    const v = { version: versions.length + 1, criteria: crit, assumptions: currentVersion.assumptions, approvedAt: new Date(), parent: currentVersion.version, edits: approved };
    setVersions((vs) => [...vs, v]);
    log("approve", `Human approved ${approved.length}/${refine.edits.length} edit(s) -> rubric v${v.version}`, "Re-grading overridden items with the new version");
    setBusy("regrade");
    const rows = [];
    for (const it of overrides) {
      try {
        const g = await gradeOne(it, v);
        rows.push({ itemId: it.id, before: grades[it.id].overall, after: g.overall, human: labels[it.id].override_overall });
      } catch (e) { rows.push({ itemId: it.id, before: grades[it.id].overall, after: null, human: labels[it.id].override_overall }); }
      setRegrade({ version: v.version, rows: [...rows] });
    }
    const agreedBefore = rows.filter((r) => Math.abs(r.before - r.human) <= 0.5).length;
    const agreedAfter = rows.filter((r) => r.after != null && Math.abs(r.after - r.human) <= 0.5).length;
    log("regrade", `Re-graded ${rows.length} overridden item(s) with v${v.version}`, `Agreement within 0.5: ${agreedBefore}/${rows.length} -> ${agreedAfter}/${rows.length}`);
    setBusy(null);
  };

  // ── aggregates ──
  const gradedItems = items.filter((it) => grades[it.id] && !grades[it.id].failed);
  const counted = gradedItems.filter((it) => !grades[it.id].queued || labels[it.id]);
  const effOverall = (it) => (labels[it.id]?.decision === "override" ? labels[it.id].override_overall : grades[it.id].overall);
  const meanOverall = counted.length ? counted.reduce((a, it) => a + effOverall(it), 0) / counted.length : null;
  const critMeans = currentVersion ? currentVersion.criteria.map((c) => ({ c, m: counted.length ? counted.reduce((a, it) => a + (grades[it.id].scores[c.id] || 0), 0) / counted.length : null })) : [];

  // ─── render ───
  const stages = [
    ["setup", "Set up", "Task + examples"],
    ["rubric", "Draft rubric", draft ? `${draft.criteria.length} criteria` : "Agent proposes"],
    ["grade", "Grade batch", items.length ? `${gradedItems.length} graded` : "Agent scores"],
    ["review", "Review queue", queued.length ? `${queued.length} waiting` : "Human labels"],
    ["refine", "Refine", refine ? `${refine.edits.length} edits` : "Agent proposes"],
  ];

  return (
    <div style={{ fontFamily: FONT, background: C.paper, color: C.ink, minHeight: "100vh" }}>
      {/* header */}
      <div className="flex items-center justify-between px-5 py-3" style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-baseline gap-3">
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.3 }}>RubricLoop</div>
          <div className="text-xs" style={{ color: C.muted }}>rubric-building and grading agent, prototype</div>
        </div>
        <div className="flex items-center gap-2">
          {currentVersion && <Tag tone="teal">rubric v{currentVersion.version}</Tag>}
          {items.length > 0 && <Tag tone={queued.length ? "amber" : "slate"}>{queued.length} in queue</Tag>}
          {agreeRate != null && <Tag tone="slate">agreement {Math.round(agreeRate * 100)}%</Tag>}
          <Btn kind="ghost" small onClick={() => setShowTrace((s) => !s)}>{showTrace ? "Hide trace" : "Show trace"}</Btn>
        </div>
      </div>

      <div className="flex" style={{ minHeight: "calc(100vh - 53px)" }}>
        {/* left rail: the loop */}
        <div className="p-4" style={{ width: 200, borderRight: `1px solid ${C.line}`, flexShrink: 0 }}>
          <div className="text-xs mb-3" style={{ color: C.muted }}>The loop</div>
          {stages.map(([key, name, sub], i) => {
            const active = stage === key;
            return (
              <button key={key} onClick={() => setStage(key)} className="w-full text-left mb-1 px-3 py-2 rounded"
                style={{ fontFamily: FONT, background: active ? C.panel : "transparent", border: `1px solid ${active ? C.line : "transparent"}`, cursor: "pointer" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ width: 16, height: 16, borderRadius: 8, background: active ? C.teal : C.slate, color: active ? "#fff" : C.muted, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{i + 1}</span>
                  <span className="text-sm" style={{ fontWeight: active ? 700 : 500 }}>{name}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: C.muted, paddingLeft: 24 }}>{sub}</div>
              </button>
            );
          })}
          <div className="mt-6 text-xs" style={{ color: C.muted, lineHeight: 1.5 }}>
            Human gates: approve the rubric (1), label the queue (2), approve edits (3). The agent does everything else on its own.
          </div>
        </div>

        {/* main */}
        <div className="flex-1 p-5" style={{ minWidth: 0, maxWidth: 900 }}>
          {error && <div className="mb-4 p-3 rounded text-sm" style={{ background: C.redSoft, color: C.red }}>{error}</div>}

          {/* ── SETUP ── */}
          {stage === "setup" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg" style={{ fontWeight: 700 }}>Describe the task and give the agent examples</h2>
                <div className="flex items-center gap-2">
                  <select value={sampleIdx} onChange={(e) => setSampleIdx(Number(e.target.value))} style={{ ...inputStyle, width: 330, padding: "6px 8px", fontSize: 13 }}>
                    {SAMPLES.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                  </select>
                  <Btn kind="ghost" onClick={loadSample}>Load sample</Btn>
                </div>
              </div>
              <Panel>
                <Field label="What is the LLM feature producing? Include any policies or hard rules.">
                  <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={4} style={inputStyle} placeholder="e.g. Draft replies to customer support emails for..." />
                </Field>
                <Field label={`Confidence threshold. Grades below ${Math.round(threshold * 100)}% go to a human`}>
                  <input type="range" min={0.3} max={0.95} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 260 }} />
                </Field>
              </Panel>
              <Panel title={`Example outputs (${examples.length})`} right={<Btn kind="ghost" small onClick={addExample}>Add example</Btn>}>
                {examples.length === 0 && <div className="text-sm" style={{ color: C.muted }}>Add a few outputs and mark each good or bad. The agent infers criteria from what separates them. It can also work from the task description alone, with more assumptions.</div>}
                {examples.map((ex, i) => (
                  <div key={ex.id} className="mb-3 p-3 rounded" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs" style={{ color: C.muted }}>Example {i + 1}</span>
                      {["good", "bad"].map((l) => (
                        <button key={l} onClick={() => updExample(ex.id, { label: ex.label === l ? "" : l })} className="px-2 py-0.5 text-xs rounded"
                          style={{ fontFamily: FONT, cursor: "pointer", fontWeight: 600, border: `1px solid ${C.line}`, background: ex.label === l ? (l === "good" ? C.tealSoft : C.redSoft) : "#fff", color: ex.label === l ? (l === "good" ? C.teal : C.red) : C.muted }}>{l}</button>
                      ))}
                      <button onClick={() => setExamples((x) => x.filter((e) => e.id !== ex.id))} className="ml-auto text-xs" style={{ fontFamily: FONT, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>Remove</button>
                    </div>
                    <textarea value={ex.content} onChange={(e) => updExample(ex.id, { content: e.target.value })} rows={3} style={{ ...inputStyle, marginBottom: 6 }} placeholder="Paste the output" />
                    <input value={ex.reason} onChange={(e) => updExample(ex.id, { reason: e.target.value })} style={inputStyle} placeholder="Why is it good or bad? (one line, optional)" />
                  </div>
                ))}
              </Panel>
              <Btn onClick={draftRubric} disabled={!task.trim() || busy}>{busy === "draft" ? "Agent is drafting..." : draft ? "Re-draft rubric" : "Draft rubric"}</Btn>
            </>
          )}

          {/* ── RUBRIC ── */}
          {stage === "rubric" && (
            <>
              <h2 className="text-lg mb-1" style={{ fontWeight: 700 }}>Review the agent's proposed rubric</h2>
              <div className="text-sm mb-4" style={{ color: C.muted }}>Edit anything. Approving freezes it as a version; the agent can only grade against approved versions.</div>
              {!draft && <Panel><div className="text-sm" style={{ color: C.muted }}>No draft yet. Go to Set up and ask the agent to draft a rubric.</div></Panel>}
              {draft && (
                <>
                  {draft.criteria.map((c) => (
                    <Panel key={c.id} title={
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: C.muted }}>{c.id}</span>
                        <input value={c.name} onChange={(e) => updCriterion(c.id, { name: e.target.value })} style={{ ...inputStyle, width: 320, padding: "4px 8px", fontWeight: 700 }} />
                      </div>
                    } right={
                      <div className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
                        weight <input type="number" min={0} max={100} value={c.weight} onChange={(e) => updCriterion(c.id, { weight: e.target.value })} style={{ ...inputStyle, width: 64, padding: "4px 6px" }} />
                        <button onClick={() => setDraft((d) => ({ ...d, criteria: d.criteria.filter((x) => x.id !== c.id) }))} style={{ fontFamily: FONT, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>Remove</button>
                      </div>
                    }>
                      <textarea value={c.description} onChange={(e) => updCriterion(c.id, { description: e.target.value })} rows={2} style={{ ...inputStyle, marginBottom: 8 }} />
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        {["1", "3", "5"].map((k) => (
                          <div key={k}>
                            <div className="text-xs mb-1" style={{ color: C.muted }}>Score {k} looks like</div>
                            <textarea value={c.anchors?.[k] || ""} onChange={(e) => updAnchor(c.id, k, e.target.value)} rows={3} style={{ ...inputStyle, fontSize: 13 }} />
                          </div>
                        ))}
                      </div>
                      <div className="text-xs" style={{ color: C.muted }}>Evidence hint: <input value={c.evidence_hint || ""} onChange={(e) => updCriterion(c.id, { evidence_hint: e.target.value })} style={{ ...inputStyle, display: "inline-block", width: "70%", padding: "4px 8px", fontSize: 13 }} /></div>
                    </Panel>
                  ))}
                  <div className="grid grid-cols-2 gap-4">
                    <Panel title="Assumptions the agent made">
                      {draft.assumptions.length === 0 && <div className="text-sm" style={{ color: C.muted }}>None stated.</div>}
                      {draft.assumptions.map((a, i) => <div key={i} className="text-sm mb-1">- {a}</div>)}
                    </Panel>
                    <Panel title="Questions for you">
                      {draft.questions.length === 0 && <div className="text-sm" style={{ color: C.muted }}>None.</div>}
                      {draft.questions.map((q, i) => (
                        <div key={i} className="mb-2">
                          <div className="text-sm mb-1">{q.q}</div>
                          <input value={q.a} onChange={(e) => setDraft((d) => ({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) }))} style={{ ...inputStyle, fontSize: 13 }} placeholder="Your answer (stored and shown to the grader)" />
                        </div>
                      ))}
                    </Panel>
                  </div>
                  <div className="flex items-center gap-3">
                    <Btn onClick={approveDraft} disabled={weightSum !== 100 || draft.criteria.length === 0}>Approve as v{versions.length + 1}</Btn>
                    <Btn kind="ghost" onClick={draftRubric} disabled={busy}>{busy === "draft" ? "Re-drafting..." : "Ask the agent to re-draft"}</Btn>
                    <span className="text-sm" style={{ color: weightSum === 100 ? C.muted : C.red }}>Weights sum to {weightSum}{weightSum !== 100 ? ", must be 100" : ""}</span>
                  </div>
                </>
              )}
              {versions.length > 0 && (
                <div className="mt-4">
                  <Panel title="Approved versions">
                    {versions.map((v) => (
                      <div key={v.version} className="flex items-center gap-3 text-sm mb-1">
                        <Tag tone="teal">v{v.version}</Tag>
                        <span>{v.criteria.map((c) => `${c.name} (${c.weight})`).join(", ")}</span>
                        <span className="text-xs" style={{ color: C.muted }}>{v.edits ? `${v.edits.length} approved edit(s) from v${v.parent}` : "drafted"}</span>
                      </div>
                    ))}
                  </Panel>
                </div>
              )}
            </>
          )}

          {/* ── GRADE ── */}
          {stage === "grade" && (
            <>
              <h2 className="text-lg mb-1" style={{ fontWeight: 700 }}>Grade a batch of outputs</h2>
              <div className="text-sm mb-4" style={{ color: C.muted }}>Separate outputs with a line containing only <code>---</code>. The agent scores each criterion, cites evidence, estimates its confidence, and routes uncertain items to you.</div>
              {!currentVersion && <div className="mb-4 p-3 rounded text-sm" style={{ background: C.amberSoft, color: C.amber }}>Approve a rubric first. The agent will not grade against an unapproved draft.</div>}
              <Panel>
                <textarea value={batchText} onChange={(e) => setBatchText(e.target.value)} rows={6} style={inputStyle} placeholder={"Output one\n---\nOutput two"} />
                <div className="flex items-center gap-3 mt-3">
                  <Btn onClick={runGrading} disabled={!currentVersion || !batchText.trim() || busy}>{busy === "grade" ? `Grading ${progress?.done}/${progress?.total}...` : `Grade with v${currentVersion?.version || "-"}`}</Btn>
                  {!batchText && <Btn kind="ghost" onClick={() => setBatchText(SAMPLES[sampleIdx].batch.join("\n---\n"))}>Load sample batch</Btn>}
                  <span className="text-xs" style={{ color: C.muted }}>Up to 25 outputs in the prototype. Threshold {Math.round(threshold * 100)}%</span>
                </div>
                {progress && busy === "grade" && (
                  <div className="mt-3" style={{ height: 6, background: C.slate, borderRadius: 3 }}><div style={{ width: `${(progress.done / progress.total) * 100}%`, height: 6, background: C.teal, borderRadius: 3, transition: "width .3s" }} /></div>
                )}
              </Panel>

              {gradedItems.length > 0 && (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    {[
                      ["Mean overall", fmt(meanOverall), `${counted.length} counted`],
                      ["Accepted autonomously", gradedItems.filter((it) => !grades[it.id].queued).length, `of ${gradedItems.length}`],
                      ["In review queue", queued.length, `${labelled.length} labelled`],
                      ["Agent-human agreement", agreeRate == null ? "-" : `${Math.round(agreeRate * 100)}%`, `${overrides.length} overrides`],
                    ].map(([k, v, s]) => (
                      <div key={k} className="p-3 rounded" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                        <div className="text-xs" style={{ color: C.muted }}>{k}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                        <div className="text-xs" style={{ color: C.muted }}>{s}</div>
                      </div>
                    ))}
                  </div>
                  <Panel title="Per-criterion mean (counted items)">
                    <div className="flex gap-4 flex-wrap">
                      {critMeans.map(({ c, m }) => (
                        <div key={c.id} style={{ minWidth: 120 }}>
                          <div className="text-xs" style={{ color: C.muted }}>{c.name} (weight {c.weight})</div>
                          <div className="flex items-center gap-2"><div style={{ width: 80, height: 6, background: C.slate, borderRadius: 3 }}><div style={{ width: `${((m || 0) / 5) * 100}%`, height: 6, background: C.teal, borderRadius: 3 }} /></div><span className="text-sm" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(m)}</span></div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="Results">
                    <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                      <thead><tr style={{ color: C.muted }} className="text-xs"><th className="text-left py-1 pr-2">Item</th><th className="text-left py-1 pr-2">Output</th>{currentVersion.criteria.map((c) => <th key={c.id} className="py-1 px-1" title={c.name}>{c.id}</th>)}<th className="py-1 px-2">Overall</th><th className="text-left py-1 px-2">Confidence</th><th className="text-left py-1">Status</th></tr></thead>
                      <tbody>
                        {items.map((it) => {
                          const g = grades[it.id]; if (!g) return <tr key={it.id}><td className="py-2 pr-2" style={{ color: C.muted }}>{it.id}</td><td colSpan={99} className="text-xs" style={{ color: C.muted }}>grading...</td></tr>;
                          if (g.failed) return <tr key={it.id}><td className="py-2 pr-2">{it.id}</td><td colSpan={99} className="text-xs" style={{ color: C.red }}>failed after retry: {g.error}</td></tr>;
                          const lb = labels[it.id]; const open = expanded[it.id];
                          return (
                            <Fragment key={it.id}>
                              <tr onClick={() => setExpanded((x) => ({ ...x, [it.id]: !x[it.id] }))} style={{ borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
                                <td className="py-2 pr-2 text-xs" style={{ color: C.muted, whiteSpace: "nowrap" }}>{it.id}</td>
                                <td className="py-2 pr-2 text-xs" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.content}</td>
                                {currentVersion.criteria.map((c) => <td key={c.id} className="py-2 px-1 text-center" style={{ fontVariantNumeric: "tabular-nums" }}>{g.scores[c.id]}</td>)}
                                <td className="py-2 px-2 text-center" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{lb?.decision === "override" ? <span style={{ color: C.red }}>{fmt(lb.override_overall)}</span> : fmt(g.overall)}</td>
                                <td className="py-2 px-2"><ConfBar v={g.confidence} threshold={threshold} /></td>
                                <td className="py-2">{lb ? <Tag tone={lb.decision === "agree" ? "teal" : "red"}>human {lb.decision === "agree" ? "agreed" : "overrode"}</Tag> : g.queued ? <Tag tone="amber">in queue</Tag> : <Tag tone="teal">auto</Tag>}</td>
                              </tr>
                              {open && (
                                <tr><td colSpan={99} className="pb-3 px-2">
                                  <div className="p-3 rounded text-sm" style={{ background: C.paper }}>
                                    <div className="mb-2" style={{ whiteSpace: "pre-wrap" }}>{it.content}</div>
                                    <div className="text-xs mb-1"><span style={{ color: C.muted }}>Rationale: </span>{g.rationale}</div>
                                    <div className="text-xs mb-1"><span style={{ color: C.muted }}>Evidence: </span>"{g.evidence}"</div>
                                    <div className="flex gap-2 flex-wrap">{g.uncertainty_reason && <Tag tone="amber">{g.uncertainty_reason}</Tag>}{g.flags.map((f) => <Tag key={f} tone="red">{f}</Tag>)}{lb?.note && <span className="text-xs" style={{ color: C.muted }}>Human note: {lb.note}</span>}</div>
                                  </div>
                                </td></tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </Panel>
                </>
              )}
            </>
          )}

          {/* ── REVIEW ── */}
          {stage === "review" && (
            <>
              <h2 className="text-lg mb-1" style={{ fontWeight: 700 }}>Review the items the agent was unsure about</h2>
              <div className="text-sm mb-4" style={{ color: C.muted }}>Only items below the {Math.round(threshold * 100)}% confidence threshold or carrying a risk flag land here. Agree if the agent's score stands; override if it doesn't and say why. That note is what the agent uses to improve the rubric.</div>
              {items.length === 0 && <Panel><div className="text-sm" style={{ color: C.muted }}>Nothing graded yet.</div></Panel>}
              {items.length > 0 && queued.length === 0 && (
                <Panel><div className="text-sm">Queue is clear: {labelled.length} labelled, {overrides.length} override(s). {overrides.length > 0 ? <span>Ready to <button onClick={() => setStage("refine")} style={{ fontFamily: FONT, color: C.teal, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}>refine the rubric</button> from those disagreements.</span> : "No disagreements to learn from yet."}</div></Panel>
              )}
              {queued.map((it) => <ReviewCard key={it.id} item={it} grade={grades[it.id]} criteria={currentVersion.criteria} threshold={threshold} onLabel={label} />)}
              {labelled.length > 0 && (
                <Panel title={`Labelled (${labelled.length})`}>
                  {labelled.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 text-sm mb-1">
                      <span className="text-xs" style={{ color: C.muted, width: 40 }}>{it.id}</span>
                      <Tag tone={labels[it.id].decision === "agree" ? "teal" : "red"}>{labels[it.id].decision}</Tag>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(grades[it.id].overall)}{labels[it.id].decision === "override" ? ` -> ${fmt(labels[it.id].override_overall)}` : ""}</span>
                      <span className="text-xs" style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labels[it.id].note}</span>
                    </div>
                  ))}
                </Panel>
              )}
            </>
          )}

          {/* ── REFINE ── */}
          {stage === "refine" && (
            <>
              <h2 className="text-lg mb-1" style={{ fontWeight: 700 }}>Refine the rubric from disagreements</h2>
              <div className="text-sm mb-4" style={{ color: C.muted }}>The agent groups your overrides by cause and proposes edits. Each edit cites the disagreements that motivated it. Every edit starts as approved; click Reject on any you disagree with, then apply. Rejected edits are dropped.</div>
              {overrides.length === 0 && <Panel><div className="text-sm" style={{ color: C.muted }}>No overrides yet. Grade a batch and override at least one queued item to give the agent something to learn from.</div></Panel>}
              {overrides.length > 0 && !refine && (
                <Panel>
                  <div className="text-sm mb-3">{overrides.length} disagreement(s) on rubric v{currentVersion.version}.</div>
                  <Btn onClick={proposeEdits} disabled={busy}>{busy === "refine" ? "Agent is analysing disagreements..." : "Propose rubric edits"}</Btn>
                </Panel>
              )}
              {refine && (
                <>
                  <Panel title="Root causes the agent found">
                    {refine.clusters.length === 0 && <div className="text-sm" style={{ color: C.muted }}>No clusters returned.</div>}
                    {refine.clusters.map((cl, i) => <div key={i} className="text-sm mb-1">- {cl.cause} <span className="text-xs" style={{ color: C.muted }}>({(cl.disagreement_ids || []).join(", ")})</span></div>)}
                    {refine.expected_effect && <div className="text-xs mt-2" style={{ color: C.muted }}>Expected effect: {refine.expected_effect}</div>}
                  </Panel>
                  {refine.edits.map((e) => {
                    const target = currentVersion.criteria.find((c) => c.id === e.target_criterion_id);
                    const oldText = e.type === "reword" && target ? (e.field?.startsWith("anchor_") ? target.anchors?.[e.field.split("_")[1]] : target[e.field || "description"]) : null;
                    const on = !!editDecisions[e.id];
                    return (
                      <div key={e.id} style={{ opacity: on ? 1 : 0.55 }}>
                      <Panel title={<span><Tag tone="slate">{e.type}</Tag> <span className="ml-2">{target ? target.name : e.new_criterion?.name || "weights"}{e.field ? ` (${e.field})` : ""}</span> <span className="ml-2">{on ? <Tag tone="teal">will apply</Tag> : <Tag tone="red">rejected</Tag>}</span></span>}
                        right={<div className="flex gap-2"><Btn small kind={on ? "primary" : "ghost"} onClick={() => setEditDecisions((d) => ({ ...d, [e.id]: true }))}>Approve</Btn><Btn small kind={!on ? "danger" : "ghost"} onClick={() => setEditDecisions((d) => ({ ...d, [e.id]: false }))}>Reject</Btn></div>}>
                        {e.type === "reword" && (
                          <div className="grid grid-cols-2 gap-3 mb-2 text-sm">
                            <div className="p-2 rounded" style={{ background: C.redSoft }}><div className="text-xs mb-1" style={{ color: C.red }}>Before</div>{oldText || "(empty)"}</div>
                            <div className="p-2 rounded" style={{ background: C.tealSoft }}><div className="text-xs mb-1" style={{ color: C.teal }}>After</div>{e.new_text}</div>
                          </div>
                        )}
                        {e.type === "add_criterion" && e.new_criterion && (
                          <div className="p-2 rounded text-sm mb-2" style={{ background: C.tealSoft }}><b>{e.new_criterion.name}</b> (weight {e.new_criterion.weight}): {e.new_criterion.description}<div className="text-xs mt-1" style={{ color: C.muted }}>1: {e.new_criterion.anchors?.["1"]}. 3: {e.new_criterion.anchors?.["3"]}. 5: {e.new_criterion.anchors?.["5"]}</div></div>
                        )}
                        {e.type === "reweight" && e.new_weights && (
                          <div className="text-sm mb-2">{currentVersion.criteria.map((c) => <span key={c.id} className="mr-3">{c.name}: {c.weight} to <b>{e.new_weights[c.id] ?? c.weight}</b></span>)}</div>
                        )}
                        <div className="text-xs" style={{ color: C.muted }}>Why: {e.justification}. Cites {(e.disagreement_ids || []).join(", ")}</div>
                      </Panel>
                      </div>
                    );
                  })}
                  {!regrade && (
                    <div className="flex items-center gap-3">
                      <Btn onClick={applyEdits} disabled={busy || !refine.edits.some((e) => editDecisions[e.id])}>{busy === "regrade" ? "Creating version and re-grading..." : `Apply ${refine.edits.filter((e) => editDecisions[e.id]).length} of ${refine.edits.length} edit(s) as v${versions.length + 1}`}</Btn>
                      <Btn kind="ghost" onClick={() => { setRefine(null); setEditDecisions({}); }} disabled={busy}>Discard all</Btn>
                    </div>
                  )}
                </>
              )}
              {regrade && (
                <Panel title={`Re-graded the overridden items with v${regrade.version}`}>
                  <table className="w-full text-sm"><thead><tr className="text-xs" style={{ color: C.muted }}><th className="text-left py-1">Item</th><th className="py-1">Agent v{regrade.version - 1}</th><th className="py-1">Human</th><th className="py-1">Agent v{regrade.version}</th><th className="text-left py-1 pl-3">Agrees now?</th></tr></thead>
                    <tbody>{regrade.rows.map((r) => { const okB = Math.abs(r.before - r.human) <= 0.5; const okA = r.after != null && Math.abs(r.after - r.human) <= 0.5; return (
                      <tr key={r.itemId} style={{ borderTop: `1px solid ${C.line}` }}><td className="py-1 text-xs" style={{ color: C.muted }}>{r.itemId}</td><td className="py-1 text-center" style={{ fontVariantNumeric: "tabular-nums", color: okB ? C.ink : C.red }}>{fmt(r.before)}</td><td className="py-1 text-center" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(r.human)}</td><td className="py-1 text-center" style={{ fontVariantNumeric: "tabular-nums", color: okA ? C.teal : C.red, fontWeight: 600 }}>{r.after == null ? "..." : fmt(r.after)}</td><td className="py-1 pl-3">{r.after == null ? "" : okA ? <Tag tone="teal">within 0.5</Tag> : <Tag tone="red">still off</Tag>}</td></tr>); })}</tbody></table>
                  <div className="text-xs mt-3" style={{ color: C.muted }}>Agreement within 0.5: {regrade.rows.filter((r) => Math.abs(r.before - r.human) <= 0.5).length}/{regrade.rows.length} before -> {regrade.rows.filter((r) => r.after != null && Math.abs(r.after - r.human) <= 0.5).length}/{regrade.rows.length} after. Rubric v{regrade.version} is now the active version; grade a new batch to use it.</div>
                  <div className="mt-3"><Btn kind="ghost" onClick={() => { setRefine(null); setRegrade(null); setEditDecisions({}); setStage("grade"); }}>Grade another batch with v{regrade.version}</Btn></div>
                </Panel>
              )}
            </>
          )}
        </div>

        {/* trace */}
        {showTrace && (
          <div className="p-4" style={{ width: 300, borderLeft: `1px solid ${C.line}`, flexShrink: 0, background: C.panel }}>
            <div className="flex items-center justify-between mb-2"><div className="text-sm" style={{ fontWeight: 700 }}>Agent trace</div><span className="text-xs" style={{ color: C.muted }}>{trace.length} steps</span></div>
            <div className="text-xs mb-3" style={{ color: C.muted }}>Each receive, decide, act and produce step the agent takes, plus each human gate.</div>
            <div ref={traceRef} style={{ maxHeight: "calc(100vh - 150px)", overflowY: "auto" }}>
              {trace.length === 0 && <div className="text-xs" style={{ color: C.muted }}>Nothing yet. Load a sample project to start.</div>}
              {trace.map((t) => {
                const tone = { setup: "slate", draft: "teal", approve: "teal", grade: "teal", route: "amber", ask: "amber", refine: "teal", regrade: "teal" }[t.stage] || "slate";
                const human = t.stage === "approve" || t.stage === "ask";
                return (
                  <div key={t.id} className="mb-2 pb-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2 mb-1"><Tag tone={human ? "red" : tone}>{human ? "human: " : ""}{t.stage}</Tag><span className="text-xs" style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{t.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
                    <div className="text-xs" style={{ lineHeight: 1.4 }}>{t.summary}</div>
                    <div className="text-xs" style={{ color: C.muted, lineHeight: 1.4 }}>then: {t.decision}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// review card
function ReviewCard({ item, grade, criteria, threshold, onLabel }) {
  const [score, setScore] = useState(Math.round(grade.overall * 2) / 2);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState(null);
  const ev = grade.evidence && norm(item.content).includes(norm(grade.evidence));
  const parts = ev ? splitOnEvidence(item.content, grade.evidence) : [{ t: item.content }];
  const REASONS = { rubric_gap: "The rubric doesn't cover this case", borderline_score: "Sits between two anchors", conflicting_criteria: "Criteria pull in different directions", missing_context: "Would need the customer's original message", output_ambiguous: "The output itself is unclear" };
  return (
    <div className="rounded-lg mb-4" style={{ background: C.panel, border: `1px solid ${C.amber}55` }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-3"><span className="text-xs" style={{ color: C.muted }}>{item.id}</span><ConfBar v={grade.confidence} threshold={threshold} />{grade.flags.map((f) => <Tag key={f} tone="red">{f}</Tag>)}</div>
        <div className="text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>agent says <b>{fmt(grade.overall)}</b></div>
      </div>
      <div className="p-4">
        <div className="text-sm mb-3" style={{ lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{parts.map((p, i) => (p.hl ? <mark key={i} style={{ background: C.amberSoft, color: C.ink, padding: "0 2px" }}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</div>
        <div className="p-3 rounded mb-3" style={{ background: C.amberSoft }}>
          <div className="text-xs" style={{ color: C.amber, fontWeight: 700 }}>Why the agent is unsure</div>
          <div className="text-sm">{REASONS[grade.uncertainty_reason] || grade.uncertainty_reason || (grade.flags.length ? "Flagged for risk; a human should confirm." : "Below threshold.")}</div>
        </div>
        <div className="flex gap-3 flex-wrap mb-2 text-xs">{criteria.map((c) => <span key={c.id}><span style={{ color: C.muted }}>{c.name}</span> <b style={{ fontVariantNumeric: "tabular-nums" }}>{grade.scores[c.id]}</b></span>)}</div>
        <div className="text-xs mb-3" style={{ color: C.muted }}>{grade.rationale}</div>
        {mode !== "override" && (
          <div className="flex gap-2"><Btn onClick={() => onLabel(item.id, "agree", grade.overall, note)}>Agree with {fmt(grade.overall)}</Btn><Btn kind="warm" onClick={() => setMode("override")}>Override</Btn></div>
        )}
        {mode === "override" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm">Your score</span>
            <input type="number" min={1} max={5} step={0.5} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ ...inputStyle, width: 72 }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, width: 320 }} placeholder="Why? (this drives the rubric edit)" />
            <Btn kind="danger" onClick={() => onLabel(item.id, "override", score, note)} disabled={!note.trim()}>Save override</Btn>
            <Btn kind="ghost" onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
function splitOnEvidence(text, evidence) {
  const i = norm(text).indexOf(norm(evidence));
  if (i < 0) return [{ t: text }];
  // map normalized index back approximately by searching case-insensitively in the raw text
  const raw = text.toLowerCase();
  const evRaw = evidence.toLowerCase().trim();
  const j = raw.indexOf(evRaw);
  if (j < 0) return [{ t: text }];
  return [{ t: text.slice(0, j) }, { t: text.slice(j, j + evRaw.length), hl: true }, { t: text.slice(j + evRaw.length) }];
}
