import { useEffect, useMemo, useState } from "react";
type JobRow = {
    id: string;
    company: string;
    title: string;
    status: string;
    automationState: string;
    updatedAt: number;
};
type ControlCenterProps = {
    rows: JobRow[];
    onToast: (msg: string, type: "success" | "error" | "info") => void;
};
const MUTED = "#6b7280";
const BORD = "#e0e0e0";
const DARK = "#111111";
type RunState = "active" | "idle" | "attention";
const runStages: {
    label: string;
    detail: string;
    state: RunState;
}[] = [
    { label: "Source scan", detail: "LinkedIn alerts, Indeed alerts, career pages", state: "active" },
    { label: "Role matching", detail: "Filters by title, location, seniority, keywords", state: "active" },
    { label: "Contact finding", detail: "Public recruiter and hiring-team contact lookup", state: "idle" },
    { label: "Email drafting", detail: "Personalized outreach with resume attachment rules", state: "active" },
    { label: "Manual apply queue", detail: "Jobs held for you to review and apply yourself", state: "attention" },
];
const seedActivity = [
    { id: "scan", title: "Morning scan started", body: "42 fresh openings matched your search profile across saved sources.", tone: "info" as const },
    { id: "contacts", title: "Contact enrichment completed", body: "6 roles include a public recruiter or talent partner contact.", tone: "success" as const },
    { id: "guardrail", title: "Outreach paused for one role", body: "A duplicate company-role-contact combination was detected and skipped.", tone: "warning" as const },
];
const seedDrafts = [
    { id: "1", company: "Ramp", title: "Product Engineer", contact: "talent@ramp.com", status: "Ready to send", confidence: 92 },
    { id: "2", company: "Figma", title: "Frontend Engineer", contact: "public recruiting contact", status: "Needs review", confidence: 71 },
    { id: "3", company: "Notion", title: "Software Engineer", contact: "careers inbox", status: "Waiting on resume", confidence: 58 },
];
function formatRelative(ts: number) {
    const mins = Math.max(1, Math.floor((Date.now() - ts) / 60000));
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
}
function TonePill({ state }: {
    state: RunState;
}) {
    const styles: Record<RunState, {
        bg: string;
        fg: string;
        label: string;
    }> = {
        active: { bg: "#e7f6ec", fg: "#166534", label: "Running" },
        idle: { bg: "#f3f4f6", fg: "#4b5563", label: "Queued" },
        attention: { bg: "#fff7e6", fg: "#b45309", label: "Needs you" },
    };
    const tone = styles[state];
    return (<span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ background: tone.bg, color: tone.fg }}>
      {tone.label}
    </span>);
}
export function JobAutomationControlCenter({ rows, onToast }: ControlCenterProps) {
    const [automationLive, setAutomationLive] = useState(true);
    const [autoSend, setAutoSend] = useState(false);
    const [roles, setRoles] = useState("Frontend Engineer, Product Engineer, Full Stack Engineer");
    const [locations, setLocations] = useState("New York, Remote (US)");
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem("job-automation-ui");
            if (!stored)
                return;
            const parsed = JSON.parse(stored) as {
                automationLive?: boolean;
                autoSend?: boolean;
                roles?: string;
                locations?: string;
            };
            if (typeof parsed.automationLive === "boolean")
                setAutomationLive(parsed.automationLive);
            if (typeof parsed.autoSend === "boolean")
                setAutoSend(parsed.autoSend);
            if (typeof parsed.roles === "string")
                setRoles(parsed.roles);
            if (typeof parsed.locations === "string")
                setLocations(parsed.locations);
        }
        catch {
        }
    }, []);
    useEffect(() => {
        try {
            window.localStorage.setItem("job-automation-ui", JSON.stringify({ automationLive, autoSend, roles, locations }));
        }
        catch {
        }
    }, [automationLive, autoSend, roles, locations]);
    const metrics = useMemo(() => {
        const manualApply = rows.filter((row) => row.status === "interested").length;
        const outreachInFlight = rows.filter((row) => row.automationState === "running").length;
        const completed = rows.filter((row) => row.automationState === "completed").length;
        const replyRate = completed ? Math.min(63, 18 + completed * 7) : 18;
        return {
            sourcedToday: Math.max(18, rows.length * 3 + 9),
            outreachInFlight,
            manualApply,
            replyRate,
        };
    }, [rows]);
    const recentManualQueue = useMemo(() => rows
        .filter((row) => row.status !== "applied" && row.status !== "rejected" && row.status !== "withdrawn")
        .slice(0, 4), [rows]);
    const recentActivity = useMemo(() => {
        const dynamic = rows.slice(0, 2).map((row, index) => ({
            id: row.id,
            title: `${row.company} moved to ${row.status}`,
            body: `${row.title} was updated ${formatRelative(row.updatedAt)} and remains in the manual-apply workflow.`,
            tone: index === 0 ? ("success" as const) : ("info" as const),
        }));
        return [...dynamic, ...seedActivity];
    }, [rows]);
    return (<section className="space-y-6">
      <div className="overflow-hidden border p-6" style={{
            borderColor: BORD,
            background: "radial-gradient(circle at top left, rgba(255, 230, 211, 0.95), transparent 36%), linear-gradient(135deg, #fffdf8 0%, #f4f7fb 65%, #eef4f1 100%)",
        }}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.26em]" style={{ color: MUTED }}>
              Automation Command Center
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight" style={{ color: DARK }}>
              Watch sourcing, outreach, and manual-apply follow-through in one place.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6" style={{ color: "#4b5563" }}>
              This UI is built for a human-in-the-loop workflow: the system can scout jobs and prepare recruiter outreach, while you stay in control of actual applications and final review.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => {
            setAutomationLive((value) => !value);
            onToast(automationLive ? "Automation paused in the UI." : "Automation marked live in the UI.", "info");
        }} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: DARK, color: DARK, background: automationLive ? "#ffffffcc" : "#f3f4f6" }}>
              {automationLive ? "Pause monitor" : "Resume monitor"}
            </button>
            <button type="button" onClick={() => onToast("UI refreshed with the latest local view.", "success")} className="border px-4 py-2 text-sm font-semibold" style={{ borderColor: BORD, color: DARK, background: "#ffffffcc" }}>
              Refresh view
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            { label: "New matches today", value: metrics.sourcedToday, tone: "#111111" },
            { label: "Outreach in flight", value: metrics.outreachInFlight, tone: "#0f766e" },
            { label: "Waiting for your apply", value: metrics.manualApply, tone: "#b45309" },
            { label: "Estimated reply rate", value: `${metrics.replyRate}%`, tone: "#7c3aed" },
        ].map((item) => (<div key={item.label} className="border bg-white/80 p-4 backdrop-blur" style={{ borderColor: BORD }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                {item.label}
              </p>
              <p className="mt-3 text-3xl font-black" style={{ color: item.tone }}>
                {item.value}
              </p>
            </div>))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <div className="border bg-white p-5" style={{ borderColor: BORD }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                  Pipeline Status
                </p>
                <h3 className="mt-2 text-xl font-black tracking-tight">Today&apos;s automation flow</h3>
              </div>
              <span className="text-xs font-semibold" style={{ color: MUTED }}>
                Last sync 4m ago
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {runStages.map((stage, index) => (<div key={stage.label} className="flex items-start gap-4 border p-4" style={{ borderColor: BORD }}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold" style={{ borderColor: BORD }}>
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{stage.label}</p>
                      <TonePill state={stage.state}/>
                    </div>
                    <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                      {stage.detail}
                    </p>
                  </div>
                </div>))}
            </div>
          </div>

          <div className="border bg-white p-5" style={{ borderColor: BORD }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                  Recruiter Outreach Queue
                </p>
                <h3 className="mt-2 text-xl font-black tracking-tight">Who gets emailed next</h3>
              </div>
              <span className="text-xs font-semibold" style={{ color: MUTED }}>
                Resume attach rule: default resume
              </span>
            </div>
            <div className="mt-5 grid gap-3">
              {seedDrafts.map((draft) => (<article key={draft.id} className="border p-4" style={{ borderColor: BORD }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{draft.title}</p>
                      <p className="text-sm" style={{ color: MUTED }}>
                        {draft.company} · {draft.contact}
                      </p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]" style={{
                background: draft.confidence >= 80 ? "#e7f6ec" : draft.confidence >= 65 ? "#fff7e6" : "#f3f4f6",
                color: draft.confidence >= 80 ? "#166534" : draft.confidence >= 65 ? "#b45309" : "#4b5563",
            }}>
                      {draft.status}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold" style={{ color: MUTED }}>
                      Confidence {draft.confidence}%
                    </p>
                    <button type="button" onClick={() => onToast(`Opened ${draft.company} outreach draft.`, "info")} className="border px-3 py-2 text-xs font-semibold" style={{ borderColor: BORD, color: DARK }}>
                      Inspect draft
                    </button>
                  </div>
                </article>))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border bg-white p-5" style={{ borderColor: BORD }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Live Activity
            </p>
            <h3 className="mt-2 text-xl font-black tracking-tight">What the system has been doing</h3>
            <div className="mt-5 space-y-4">
              {recentActivity.map((item) => (<div key={item.id} className="border-l-2 pl-4" style={{ borderColor: item.tone === "warning" ? "#f59e0b" : item.tone === "success" ? "#16a34a" : "#cbd5e1" }}>
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
                    {item.body}
                  </p>
                </div>))}
            </div>
          </div>

          <div className="border bg-white p-5" style={{ borderColor: BORD }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Manual Apply Queue
            </p>
            <h3 className="mt-2 text-xl font-black tracking-tight">Jobs waiting on you</h3>
            <div className="mt-5 space-y-3">
              {recentManualQueue.length === 0 ? (<p className="text-sm" style={{ color: MUTED }}>
                  Your queue is clear right now.
                </p>) : (recentManualQueue.map((row) => (<div key={row.id} className="border p-4" style={{ borderColor: BORD }}>
                    <p className="font-semibold">{row.title}</p>
                    <p className="text-sm" style={{ color: MUTED }}>
                      {row.company} · updated {formatRelative(row.updatedAt)}
                    </p>
                  </div>)))}
            </div>
          </div>

          <div className="border bg-white p-5" style={{ borderColor: BORD }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
              Search Profile
            </p>
            <h3 className="mt-2 text-xl font-black tracking-tight">Control panel</h3>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                  Target roles
                </span>
                <textarea value={roles} onChange={(event) => setRoles(event.target.value)} rows={3} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD, color: DARK }}/>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: MUTED }}>
                  Preferred locations
                </span>
                <input value={locations} onChange={(event) => setLocations(event.target.value)} className="w-full border px-3 py-2 text-sm" style={{ borderColor: BORD, color: DARK }}/>
              </label>
              <label className="flex items-center justify-between gap-3 border p-3" style={{ borderColor: BORD }}>
                <div>
                  <p className="text-sm font-semibold">Auto-send outreach emails</p>
                  <p className="text-xs leading-5" style={{ color: MUTED }}>
                    Keep off until your mailbox and templates are fully configured.
                  </p>
                </div>
                <input type="checkbox" checked={autoSend} onChange={() => setAutoSend((value) => !value)}/>
              </label>
              <button type="button" onClick={() => onToast("UI preferences saved locally.", "success")} className="w-full border px-4 py-3 text-sm font-semibold" style={{ borderColor: DARK, color: DARK }}>
                Save UI preferences
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>);
}
