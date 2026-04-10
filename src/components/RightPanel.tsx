import { memo, useState } from "react";
import type { GenerationRunMeta, NormalizedDesign } from "../types/design";
const TABS = ["Overview", "Stack", "APIs", "Deep dive", "Risks"] as const;
type TabId = (typeof TABS)[number];
const METHOD_STYLE: Record<string, {
    bg: string;
    text: string;
}> = {
    GET: { bg: "#dcfce7", text: "#15803d" },
    POST: { bg: "#dbeafe", text: "#1d4ed8" },
    PUT: { bg: "#fef9c3", text: "#a16207" },
    PATCH: { bg: "#ffedd5", text: "#c2410c" },
    DELETE: { bg: "#fee2e2", text: "#b91c1c" },
};
function TabBar({ active, onChange }: {
    active: TabId;
    onChange: (t: TabId) => void;
}) {
    return (<div className="flex border-b border-gray-100">
      {TABS.map((t) => (<button key={t} type="button" onClick={() => onChange(t)} className={`relative flex-1 py-2.5 text-[10px] font-bold tracking-wide transition-colors sm:text-xs ${active === t ? "text-blue-600" : "text-gray-400 hover:text-gray-600"}`}>
          {t}
          {active === t && <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-blue-600"/>}
        </button>))}
    </div>);
}
function RunInsightsSection({ meta }: {
    meta: GenerationRunMeta | null;
}) {
    return (<div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">This run</p>
      {meta ? (<>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
              {meta.source === "gemini" ? "Live model" : "Template fallback"}
            </span>
            {meta.model && (<span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">{meta.model}</span>)}
            {meta.temperature != null && (<span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                temp {meta.temperature.toFixed(2)}
              </span>)}
            {meta.runNonceShort && (<span className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] text-slate-600 ring-1 ring-slate-200">run {meta.runNonceShort}…</span>)}
          </div>
          <ul className="mt-3 space-y-2">
            {meta.insights.map((line, i) => (<li key={i} className="flex gap-2 text-xs leading-5 text-slate-700">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400"/>
                {line}
              </li>))}
          </ul>
        </>) : (<p className="mt-2 text-xs leading-5 text-slate-600">
          Generate from this workspace to see how each run uses the model (no response cache, stochastic temperature, unique run nonce). Opening
          history from the dashboard does not restore past run metadata.
        </p>)}
    </div>);
}
function OverviewTab({ design }: {
    design: NormalizedDesign;
}) {
    return (<div className="space-y-6">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Summary</p>
        <p className="text-sm leading-6 text-gray-600">{design.architecture.summary}</p>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Request flow</p>
        <ol className="space-y-2.5">
          {design.architecture.flow.map((step, i) => (<li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white">
                {i + 1}
              </span>
              <p className="text-sm leading-5 text-gray-600">{step}</p>
            </li>))}
        </ol>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Key components</p>
        <div className="flex flex-wrap gap-2">
          {design.architecture.components.map((c, i) => (<span key={i} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              {c}
            </span>))}
        </div>
      </div>
    </div>);
}
function StackTab({ design }: {
    design: NormalizedDesign;
}) {
    return (<div className="space-y-2">
      {design.techStack.map((item, i) => (<div key={i} className="group flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-blue-100 hover:shadow-sm">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[9px] font-black text-slate-600 transition-colors group-hover:bg-blue-50 group-hover:text-blue-700">
            {item.layer.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-gray-900">{item.name}</p>
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{item.layer}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500">{item.reason}</p>
          </div>
        </div>))}
    </div>);
}
function APIsTab({ design }: {
    design: NormalizedDesign;
}) {
    return (<div className="space-y-2">
      {design.apis.map((api, i) => {
            const ms = METHOD_STYLE[api.method] || { bg: "#f3f4f6", text: "#374151" };
            return (<div key={i} className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center gap-2.5">
              <span className="rounded-md px-2 py-1 text-[10px] font-black tracking-wide" style={{ background: ms.bg, color: ms.text }}>
                {api.method}
              </span>
              <code className="truncate text-xs font-mono font-semibold text-gray-700">{api.path}</code>
            </div>
            <p className="mt-2 text-sm font-semibold text-gray-800">{api.name}</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">{api.purpose}</p>
          </div>);
        })}
    </div>);
}
function DeepDiveTab({ design }: {
    design: NormalizedDesign;
}) {
    const sections: {
        title: string;
        items: string[];
        hint: string;
    }[] = [
        { title: "Trade-offs", items: design.deepAnalysis.tradeoffs, hint: "Accepted costs and competing goals for this product." },
        { title: "Failure modes", items: design.deepAnalysis.failureModes, hint: "What breaks first and how you detect or mitigate it." },
        { title: "Observability", items: design.deepAnalysis.observability, hint: "Signals, SLO probes, and debugging hooks." },
        { title: "Data consistency", items: design.deepAnalysis.dataConsistency, hint: "Replication, boundaries, and conflict handling." },
    ];
    return (<div className="space-y-6">
      <p className="text-xs leading-5 text-gray-500">
        Deeper pass from the model (beyond the diagram and stack). Empty sections mean the model omitted that block — try Regenerate.
      </p>
      {sections.map(({ title, items, hint }) => (<div key={title}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-500">{title}</p>
          <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
          {items.length ? (<ul className="mt-3 space-y-2.5">
              {items.map((line, i) => (<li key={i} className="flex gap-3 rounded-lg bg-violet-50/80 px-3 py-2.5 text-sm leading-5 text-gray-700">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400"/>
                  {line}
                </li>))}
            </ul>) : (<p className="mt-2 text-xs italic text-gray-400">Nothing returned for this section.</p>)}
        </div>))}
    </div>);
}
function RisksTab({ design }: {
    design: NormalizedDesign;
}) {
    return (<div className="space-y-5">
      <div>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Architectural decisions</p>
        <div className="space-y-2">
          {design.architecture.decisions.map((d, i) => (<div key={i} className="flex gap-3 rounded-xl bg-emerald-50 px-4 py-3.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500">
                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" clipRule="evenodd"/>
              </svg>
              <p className="text-sm leading-6 text-gray-700">{d}</p>
            </div>))}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Risks to monitor</p>
        <div className="space-y-2">
          {design.architecture.risks.map((r, i) => (<div key={i} className="flex gap-3 rounded-xl bg-amber-50 px-4 py-3.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500">
                <path fillRule="evenodd" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" clipRule="evenodd"/>
              </svg>
              <p className="text-sm leading-6 text-gray-700">{r}</p>
            </div>))}
        </div>
      </div>
    </div>);
}
function RightPanelComponent({ design, generationMeta, }: {
    design: NormalizedDesign;
    generationMeta: GenerationRunMeta | null;
}) {
    const [tab, setTab] = useState<TabId>("Overview");
    return (<div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-5 pt-4 pb-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Insights</p>
        <p className="mt-0.5 text-sm font-bold text-gray-900">Architecture analysis</p>
        <RunInsightsSection meta={generationMeta}/>
        <TabBar active={tab} onChange={setTab}/>
      </div>

      <div className="scroll-surface flex-1 overflow-y-auto px-5 py-5">
        {tab === "Overview" && <OverviewTab design={design}/>}
        {tab === "Stack" && <StackTab design={design}/>}
        {tab === "APIs" && <APIsTab design={design}/>}
        {tab === "Deep dive" && <DeepDiveTab design={design}/>}
        {tab === "Risks" && <RisksTab design={design}/>}
      </div>
    </div>);
}
export default memo(RightPanelComponent);
