import { useCallback, useEffect, useMemo, useState, type ChangeEvent, } from "react";
import { apiUrl } from "../lib/apiBase";
import { JobAutomationControlCenter } from "./JobAutomationControlCenter";
const BG = "#f7f7f7";
const DARK = "#111111";
const MUTED = "#6b7280";
const BORD = "#e0e0e0";
const STATUS_LABEL: Record<string, string> = {
    interested: "Interested",
    applied: "Applied",
    screening: "Screening",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
};
const AUTOMATION_LABEL: Record<string, string> = {
    none: "None",
    pending: "Automation pending",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
};
export interface JobApplicationRow {
    id: string;
    company: string;
    title: string;
    jobUrl: string;
    status: string;
    appliedAt: number | null;
    notes: string;
    tailoredResumeSnippet: string;
    automationState: string;
    createdAt: number;
    updatedAt: number;
    updates: {
        id: string;
        body: string;
        kind: string;
        createdAt: number;
    }[];
}
function authHeader(): Record<string, string> {
    const t = localStorage.getItem("sd-token");
    const h: Record<string, string> = {};
    if (t)
        h.Authorization = `Bearer ${t}`;
    return h;
}
function timeAgo(ts: number) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60)
        return "Just now";
    if (s < 3600)
        return `${Math.floor(s / 60)}m ago`;
    if (s < 86400)
        return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
}
function Wordmark({ onClick }: {
    onClick?: () => void;
}) {
    const Tag = onClick ? "button" : "div";
    return (<Tag type={onClick ? "button" : undefined} onClick={onClick} className={`flex items-center gap-3 ${onClick ? "cursor-pointer rounded-xl p-1 transition-opacity hover:opacity-75" : ""}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-950 text-sm font-bold text-white">SD</div>
      <div>
        <p className="text-sm font-bold text-gray-950">System Design Studio</p>
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">Job copilot</p>
      </div>
    </Tag>);
}
export function JobTrackerScreen({ userName, onBack, onToast, }: {
    userName: string;
    onBack: () => void;
    onToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
    const [rows, setRows] = useState<JobApplicationRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [filter, setFilter] = useState<string>("");
    const [view, setView] = useState<"pipeline" | "applications">("pipeline");
    const [addOpen, setAddOpen] = useState(false);
    const [addCompany, setAddCompany] = useState("");
    const [addTitle, setAddTitle] = useState("");
    const [addUrl, setAddUrl] = useState("");
    const [addNotes, setAddNotes] = useState("");
    const [addBusy, setAddBusy] = useState(false);
    const [updateLine, setUpdateLine] = useState("");
    const [copilotOpen, setCopilotOpen] = useState(false);
    const [masterResume, setMasterResume] = useState("");
    const [jobDescription, setJobDescription] = useState("");
    const [tailoredOut, setTailoredOut] = useState("");
    const [tailorBusy, setTailorBusy] = useState(false);
    const [matchBusy, setMatchBusy] = useState(false);
    const [matchResult, setMatchResult] = useState<{
        score: number;
        summary: string;
        strengths: string[];
        gaps: string[];
    } | null>(null);
    const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(apiUrl("/api/jobs/applications"), { headers: authHeader() });
            if (!r.ok)
                throw new Error("Failed to load applications.");
            const data = (await r.json()) as JobApplicationRow[];
            setRows(data);
            setSelectedId((prev) => {
                if (!data.length)
                    return null;
                if (prev && data.some((d) => d.id === prev))
                    return prev;
                return data[0].id;
            });
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Load failed.", "error");
        }
        finally {
            setLoading(false);
        }
    }, [onToast]);
    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        try {
            const s = localStorage.getItem("job-master-resume");
            if (s)
                setMasterResume(s);
        }
        catch {
        }
    }, []);
    useEffect(() => {
        try {
            localStorage.setItem("job-master-resume", masterResume);
        }
        catch {
        }
    }, [masterResume]);
    const filtered = useMemo(() => {
        if (!filter.trim())
            return rows;
        const q = filter.toLowerCase();
        return rows.filter((r) => r.company.toLowerCase().includes(q) ||
            r.title.toLowerCase().includes(q) ||
            r.status.toLowerCase().includes(q));
    }, [rows, filter]);
    async function patchStatus(id: string, status: string) {
        try {
            const r = await fetch(apiUrl(`/api/jobs/applications/${id}`), {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({ status }),
            });
            const data = (await r.json()) as JobApplicationRow | {
                error?: string;
            };
            if (!r.ok)
                throw new Error((data as {
                    error?: string;
                }).error || "Update failed.");
            setRows((list) => list.map((x) => (x.id === id ? (data as JobApplicationRow) : x)));
            onToast("Status updated.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Update failed.", "error");
        }
    }
    async function patchAutomation(id: string, automationState: string) {
        try {
            const r = await fetch(apiUrl(`/api/jobs/applications/${id}`), {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({ automationState }),
            });
            const data = (await r.json()) as JobApplicationRow | {
                error?: string;
            };
            if (!r.ok)
                throw new Error((data as {
                    error?: string;
                }).error || "Update failed.");
            setRows((list) => list.map((x) => (x.id === id ? (data as JobApplicationRow) : x)));
            onToast("Automation state saved.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Update failed.", "error");
        }
    }
    async function saveTailoredToApplication() {
        if (!selected || !tailoredOut.trim()) {
            onToast("Tailor a resume first.", "info");
            return;
        }
        try {
            const r = await fetch(apiUrl(`/api/jobs/applications/${selected.id}`), {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({ tailoredResumeSnippet: tailoredOut }),
            });
            const data = (await r.json()) as JobApplicationRow | {
                error?: string;
            };
            if (!r.ok)
                throw new Error((data as {
                    error?: string;
                }).error || "Save failed.");
            setRows((list) => list.map((x) => (x.id === selected.id ? (data as JobApplicationRow) : x)));
            onToast("Saved tailored resume to this application.", "success");
            setCopilotOpen(false);
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Save failed.", "error");
        }
    }
    async function addApplication() {
        if (!addCompany.trim() || !addTitle.trim()) {
            onToast("Company and title are required.", "error");
            return;
        }
        setAddBusy(true);
        try {
            const r = await fetch(apiUrl("/api/jobs/applications"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({
                    company: addCompany.trim(),
                    title: addTitle.trim(),
                    jobUrl: addUrl.trim(),
                    notes: addNotes.trim(),
                }),
            });
            const data = (await r.json()) as JobApplicationRow | {
                error?: string;
            };
            if (!r.ok)
                throw new Error((data as {
                    error?: string;
                }).error || "Could not add.");
            setRows((list) => [data as JobApplicationRow, ...list]);
            setSelectedId((data as JobApplicationRow).id);
            setAddCompany("");
            setAddTitle("");
            setAddUrl("");
            setAddNotes("");
            setAddOpen(false);
            onToast("Application added.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Could not add.", "error");
        }
        finally {
            setAddBusy(false);
        }
    }
    async function addTimelineNote() {
        if (!selected || !updateLine.trim())
            return;
        try {
            const r = await fetch(apiUrl(`/api/jobs/applications/${selected.id}/updates`), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({ body: updateLine.trim(), kind: "note" }),
            });
            if (!r.ok) {
                const err = (await r.json()) as {
                    error?: string;
                };
                throw new Error(err.error || "Could not add update.");
            }
            setUpdateLine("");
            await load();
            onToast("Update added.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Failed.", "error");
        }
    }
    async function runMatchScore() {
        if (!masterResume.trim()) {
            onToast("Paste your master resume first.", "error");
            return;
        }
        if (!jobDescription.trim()) {
            onToast("Paste the job description to get a match score.", "error");
            return;
        }
        setMatchBusy(true);
        setMatchResult(null);
        try {
            const r = await fetch(apiUrl("/api/jobs/match-score"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({
                    masterResume: masterResume.trim(),
                    jobDescription: jobDescription.trim(),
                }),
            });
            const data = (await r.json()) as {
                match?: {
                    score: number;
                    summary: string;
                    strengths: string[];
                    gaps: string[];
                };
                error?: string;
                code?: string;
            };
            if (r.status === 401 && data.code === "AUTH_REQUIRED") {
                onToast("Sign in to run match scoring.", "info");
                return;
            }
            if (!r.ok)
                throw new Error(data.error || "Match scoring failed.");
            if (data.match)
                setMatchResult(data.match);
            onToast("Match score ready.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Match scoring failed.", "error");
        }
        finally {
            setMatchBusy(false);
        }
    }
    async function runTailor() {
        if (!masterResume.trim()) {
            onToast("Paste your master resume first.", "error");
            return;
        }
        setTailorBusy(true);
        setTailoredOut("");
        try {
            const r = await fetch(apiUrl("/api/jobs/tailor-resume"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader() },
                body: JSON.stringify({
                    masterResume: masterResume.trim(),
                    jobDescription: jobDescription.trim() || (selected ? `${selected.title} at ${selected.company}` : ""),
                }),
            });
            const data = (await r.json()) as {
                tailoredResume?: string;
                error?: string;
                code?: string;
            };
            if (r.status === 401 && data.code === "AUTH_REQUIRED") {
                onToast("Sign in to tailor your resume.", "info");
                return;
            }
            if (!r.ok)
                throw new Error(data.error || "Tailoring failed.");
            setTailoredOut(data.tailoredResume || "");
            onToast("Resume tailored. Review before using.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Tailoring failed.", "error");
        }
        finally {
            setTailorBusy(false);
        }
    }
    async function removeApplication(id: string) {
        if (!window.confirm("Remove this application and its timeline?"))
            return;
        try {
            const r = await fetch(apiUrl(`/api/jobs/applications/${id}`), { method: "DELETE", headers: authHeader() });
            if (!r.ok)
                throw new Error("Delete failed.");
            setRows((list) => list.filter((x) => x.id !== id));
            if (selectedId === id)
                setSelectedId(null);
            onToast("Removed.", "success");
        }
        catch (e) {
            onToast(e instanceof Error ? e.message : "Delete failed.", "error");
        }
    }
    const firstName = userName.split(" ")[0] || userName;
    return (<div style={{ background: BG, minHeight: "100vh", color: DARK }}>
      <nav className="flex flex-wrap items-center justify-between gap-4 px-6 py-4" style={{ borderBottom: `1px solid ${BORD}` }}>
        <Wordmark onClick={onBack}/>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setAddOpen(true)} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
            + Add position
          </button>
          <button type="button" onClick={() => {
            setCopilotOpen(true);
            setMatchResult(null);
            setTailoredOut("");
            if (selected)
                setJobDescription(`${selected.title} at ${selected.company}\n${selected.jobUrl ? selected.jobUrl : ""}`);
        }} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
            Copilot (match + tailor)
          </button>
          <button type="button" onClick={onBack} className="text-sm" style={{ color: MUTED }}>
            ← Designs
          </button>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm" style={{ color: MUTED }}>{firstName}, track applications like a lightweight JobRight-style copilot.</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">Applications</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: MUTED }}>
          <strong className="text-gray-900">Match score</strong> and <strong className="text-gray-900">tailored resume</strong> use your Gemini key on the server.
          You still submit on the employer or LinkedIn site yourself—this app does not autofill third-party forms.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <input value={filter} onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)} placeholder="Filter company, title, status…" className="min-w-[200px] flex-1 border px-3 py-2 text-sm" style={{ borderColor: BORD, background: BG, color: DARK }}/>
          <button type="button" onClick={() => void load()} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: BORD, color: DARK }}>
            Refresh
          </button>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {[
            { id: "pipeline", label: "Pipeline monitor" },
            { id: "applications", label: "Applications" },
        ].map((tab) => (<button key={tab.id} type="button" onClick={() => setView(tab.id as "pipeline" | "applications")} className="border px-4 py-2 text-sm font-semibold" style={{
                borderColor: view === tab.id ? DARK : BORD,
                background: view === tab.id ? DARK : "transparent",
                color: view === tab.id ? BG : DARK,
            }}>
              {tab.label}
            </button>))}
        </div>

        {view === "pipeline" ? (<div className="mt-8">
            <JobAutomationControlCenter rows={rows} onToast={onToast}/>
          </div>) : (<div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="border" style={{ borderColor: BORD }}>
              {loading ? (<p className="p-6 text-sm" style={{ color: MUTED }}>Loading…</p>) : filtered.length === 0 ? (<p className="p-6 text-sm" style={{ color: MUTED }}>No applications yet. Add a position or widen your filter.</p>) : (<ul>
                  {filtered.map((r) => (<li key={r.id} style={{ borderBottom: `1px solid ${BORD}` }}>
                      <button type="button" onClick={() => setSelectedId(r.id)} className="w-full px-4 py-4 text-left transition-colors hover:bg-white" style={{ background: selectedId === r.id ? "#fff" : "transparent" }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{r.title}</p>
                            <p className="truncate text-sm" style={{ color: MUTED }}>{r.company}</p>
                          </div>
                          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                            {STATUS_LABEL[r.status] || r.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                          Updated {timeAgo(r.updatedAt)}
                          {r.automationState !== "none" ? ` · ${AUTOMATION_LABEL[r.automationState] || r.automationState}` : ""}
                        </p>
                      </button>
                    </li>))}
                </ul>)}
            </div>

            <aside className="border p-5" style={{ borderColor: BORD }}>
              {!selected ? (<p className="text-sm" style={{ color: MUTED }}>Select an application to see details and timeline.</p>) : (<div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold">{selected.title}</h2>
                    <p className="text-sm" style={{ color: MUTED }}>{selected.company}</p>
                    {selected.jobUrl && (<a href={selected.jobUrl} target="_blank" rel="noreferrer" className="mt-0.5 block text-sm font-semibold underline" style={{ color: DARK }}>
                        Open posting →
                      </a>)}
                  </div>

                  <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Status</label>
                  <select value={selected.status} onChange={(e) => void patchStatus(selected.id, e.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD, background: BG, color: DARK }}>
                    {Object.entries(STATUS_LABEL).map(([k, lab]) => (<option key={k} value={k}>{lab}</option>))}
                  </select>

                  <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Automation flag</label>
                  <select value={selected.automationState} onChange={(e) => void patchAutomation(selected.id, e.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD, background: BG, color: DARK }}>
                    {Object.entries(AUTOMATION_LABEL).map(([k, lab]) => (<option key={k} value={k}>{lab}</option>))}
                  </select>

                  {selected.appliedAt && (<p className="text-xs" style={{ color: MUTED }}>Marked applied {new Date(selected.appliedAt).toLocaleString()}</p>)}

                  {selected.notes && (<div>
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Notes</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{selected.notes}</p>
                    </div>)}

                  {selected.tailoredResumeSnippet && (<div>
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Tailored resume (saved)</p>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs" style={{ borderColor: BORD, background: "#fff" }}>
                        {selected.tailoredResumeSnippet.slice(0, 4000)}
                        {selected.tailoredResumeSnippet.length > 4000 ? "…" : ""}
                      </pre>
                    </div>)}

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Timeline</p>
                    <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                      {selected.updates.length === 0 ? (<li className="text-sm" style={{ color: MUTED }}>No updates yet.</li>) : (selected.updates.map((u) => (<li key={u.id} className="border-l-2 pl-3 text-sm" style={{ borderColor: BORD }}>
                            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
                              {u.kind} · {new Date(u.createdAt).toLocaleString()}
                            </span>
                            <p className="whitespace-pre-wrap">{u.body}</p>
                          </li>)))}
                    </ul>
                  </div>

                  <div className="flex gap-2">
                    <input value={updateLine} onChange={(e) => setUpdateLine(e.target.value)} placeholder="Add note (recruiter reply, next step…)" className="min-w-0 flex-1 border px-3 py-2 text-sm" style={{ borderColor: BORD, background: BG, color: DARK }} onKeyDown={(e) => e.key === "Enter" && void addTimelineNote()}/>
                    <button type="button" onClick={() => void addTimelineNote()} className="border px-3 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
                      Add
                    </button>
                  </div>

                  <button type="button" onClick={() => void removeApplication(selected.id)} className="text-sm font-semibold underline" style={{ color: "#b91c1c" }}>
                    Remove application
                  </button>
                </div>)}
            </aside>
          </div>)}
      </div>

      {addOpen && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-lg border bg-white p-6 shadow-xl" style={{ borderColor: BORD }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Add position</h3>
            <div className="mt-4 space-y-3">
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Company</label>
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD }}/>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Job title</label>
              <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD }}/>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Posting URL (optional)</label>
              <input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD }} placeholder="https://…"/>
              <label className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Notes (optional)</label>
              <textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} rows={3} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD }}/>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm" style={{ color: MUTED }}>Cancel</button>
              <button type="button" disabled={addBusy} onClick={() => void addApplication()} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
                {addBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>)}

      {copilotOpen && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCopilotOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto border bg-white p-6 shadow-xl" style={{ borderColor: BORD }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Job copilot</h3>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>
              Match score + tailored resume (Gemini on your server). Paste a posting from any site, then apply there yourself—no autofill on LinkedIn or employer forms from this app.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Master resume</label>
                <textarea value={masterResume} onChange={(e) => setMasterResume(e.target.value)} rows={12} className="mt-1 w-full border px-3 py-2 font-mono text-xs" style={{ borderColor: BORD }} placeholder="Paste your full resume text…"/>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Job description</label>
                <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} rows={12} className="mt-1 w-full border px-3 py-2 font-mono text-xs" style={{ borderColor: BORD }} placeholder="Paste the full JD for match score. For tailor-only, a short summary is ok."/>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={matchBusy} onClick={() => void runMatchScore()} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
                {matchBusy ? "Scoring…" : "Get match score"}
              </button>
              <button type="button" disabled={tailorBusy} onClick={() => void runTailor()} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: BORD, color: DARK }}>
                {tailorBusy ? "Tailoring…" : "Generate tailored resume"}
              </button>
            </div>

            {matchResult && (<div className="mt-4 grid gap-4 border p-4 md:grid-cols-[140px_minmax(0,1fr)]" style={{ borderColor: BORD, background: "#fafafa" }}>
                <div className="flex flex-col items-center justify-center">
                  <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full border-4 text-3xl font-black" style={{
                    borderColor: matchResult.score >= 70 ? "#16a34a" : matchResult.score >= 45 ? "#ca8a04" : "#dc2626",
                    color: DARK,
                }}>
                    {matchResult.score}
                  </div>
                  <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Fit score</p>
                </div>
                <div className="min-w-0 space-y-3 text-sm">
                  <p style={{ color: DARK }}>{matchResult.summary}</p>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#15803d" }}>Strengths</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5" style={{ color: MUTED }}>
                      {matchResult.strengths.map((s, i) => (<li key={i}>{s}</li>))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#b91c1c" }}>Gaps</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5" style={{ color: MUTED }}>
                      {matchResult.gaps.map((s, i) => (<li key={i}>{s}</li>))}
                    </ul>
                  </div>
                </div>
              </div>)}

            {tailoredOut && (<div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(tailoredOut);
                    onToast("Copied to clipboard.", "success");
                }} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: BORD, color: DARK }}>
                    Copy tailored resume
                  </button>
                  {selected && (<button type="button" onClick={() => void saveTailoredToApplication()} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
                      Save to selected application
                    </button>)}
                </div>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap border p-3 text-xs" style={{ borderColor: BORD, background: "#fff" }}>
                  {tailoredOut}
                </pre>
              </div>)}
            <button type="button" className="mt-4 text-sm font-semibold underline" style={{ color: MUTED }} onClick={() => setCopilotOpen(false)}>
              Close
            </button>
          </div>
        </div>)}
    </div>);
}
