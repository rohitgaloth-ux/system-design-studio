import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Input } from "./components/Input";
import { Skeleton } from "./components/Skeleton";
import { apiUrl } from "./lib/apiBase";
import { createFallbackDesign, generateMarkdown, hasMeaningfulDesign } from "./lib/design";
import type { NormalizedDesign } from "./types/design";
import "./index.css";

const DiagramCanvas = lazy(() => import("./components/DiagramCanvas"));
const RightPanel = lazy(() => import("./components/RightPanel"));

type Screen =
  | "landing"
  | "auth"
  | "forgot-password"
  | "reset-password"
  | "onboarding"
  | "dashboard"
  | "newdesign"
  | "workspace";

type ConstraintKey = "scale" | "latency" | "budget" | "region" | "security" | "customRequirements";

interface FormState {
  prompt: string;
  constraints: Record<ConstraintKey, string>;
}

interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface DesignHistoryEntry {
  id: string;
  idea: string;
  summary?: string;
  domain?: string;
  createdAt: number;
  design: NormalizedDesign;
}

type ToastState = { message: string; type: "success" | "error" | "info" } | null;

const INITIAL_FORM: FormState = {
  prompt: "",
  constraints: {
    scale: "100k monthly users",
    latency: "sub-second interactions",
    budget: "Balanced",
    region: "US-East primary with global edge delivery",
    security: "SSO, RBAC, audit logs",
    customRequirements: "",
  },
};
const SIGNUP_DEFAULT = { name: "", email: "", password: "" };

/* ── Token helpers (single source of truth — DB is authoritative) ─────── */
const TOKEN_KEY = "sd-token";
const loadToken  = ()  => localStorage.getItem(TOKEN_KEY) || null;
const saveToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = ()  => {
  localStorage.removeItem(TOKEN_KEY);
  /* purge any stale legacy keys from before the DB migration */
  ["sd-user","sd-history","system-design-studio-access"].forEach(k => localStorage.removeItem(k));
};

/* Auth header builder */
function authHeader(): Record<string, string> {
  const t = loadToken();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

/* Fetch designs from API */
async function fetchDesigns(): Promise<DesignHistoryEntry[]> {
  const t = loadToken();
  if (!t) return [];
  try {
    const r = await fetch(apiUrl("/api/designs"), { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60)    return "Just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f7", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <p style={{ fontSize: 32 }}>⚠️</p>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111", marginTop: 12 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 24, border: "1px solid #111", background: "transparent", padding: "10px 28px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/* ── Skeletons & Toast ────────────────────────────────────────────────── */
function DiagramSkeleton() {
  return (
    <div className="h-full rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-8 w-48 rounded-full" />
        <div className="flex gap-2"><Skeleton className="h-9 w-24 rounded-xl" /><Skeleton className="h-9 w-24 rounded-xl" /></div>
      </div>
      <Skeleton className="h-[680px] w-full rounded-xl" />
    </div>
  );
}
function InsightSkeleton() {
  return <div className="space-y-3"><Skeleton className="h-28 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>;
}
function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  const t: Record<string, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };
  return <div className={`fixed right-6 top-6 z-[80] rounded-2xl border px-4 py-3 text-sm shadow-lg ${t[toast.type] || t.info}`}>{toast.message}</div>;
}

/* ── Wordmark ─────────────────────────────────────────────────────────── */
function Wordmark({ inverted = false, onClick }: { inverted?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 ${onClick ? "cursor-pointer rounded-xl p-1 transition-opacity hover:opacity-75" : ""}`}
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${inverted ? "bg-white text-slate-950" : "bg-gray-950 text-white"}`}>SD</div>
      <div>
        <p className={`text-sm font-bold ${inverted ? "text-white" : "text-gray-950"}`}>System Design Studio</p>
        <p className={`text-[10px] uppercase tracking-[0.2em] ${inverted ? "text-slate-500" : "text-gray-400"}`}>Turn ideas into architecture</p>
      </div>
    </Tag>
  );
}

/* ── Constraint field helper ──────────────────────────────────────────── */
function ConstraintField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      <Input value={value} onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)} placeholder={placeholder} className="text-sm" />
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  LANDING PAGE                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/* ── Single colour system ─────────────────────────────────────────── */
const BG    = "#f7f7f7";   /* one background for the whole page */
const DARK  = "#111111";   /* headings + body text */
const MUTED = "#6b7280";   /* secondary text */
const BORD  = "#e0e0e0";   /* dividers / borders */
const LIME  = "#84cc16";   /* single accent for labels only */

/* keep aliases so auth / dashboard / workspace code still compiles */
const GRAY   = BG;
const BORD_D = "#d0d0d0";
const P = { text: DARK, muted: MUTED, bl: BORD, bd: BORD_D, white: BG, dark: DARK, paper: BG, inv: BG, accent: LIME, dark2: "#222", mutedI: MUTED };
const OUTPUT_SAMPLES = [
  { label: "FUNCTIONAL REQ", text: "Real-time message delivery under 100ms p95" },
  { label: "COMPONENT",      text: "WebSocket gateway — connection lifecycle and fan-out" },
  { label: "TECH STACK",     text: "Redis Streams — low-latency pub/sub with replay" },
  { label: "API",            text: "POST /messages  ·  GET /channels/:id/history" },
  { label: "RISK",           text: "Connection state must survive pod restarts" },
];

/* ══════════════════════════════════════════════════════════════════════ */
/*  NEW DESIGN — domain / pattern / scale config                         */
/* ══════════════════════════════════════════════════════════════════════ */

const DOMAINS = [
  { id: "ecommerce",   label: "E-Commerce",        desc: "Marketplace, checkout, inventory, payments" },
  { id: "social",      label: "Social Platform",    desc: "Feeds, messaging, communities, content" },
  { id: "fintech",     label: "FinTech",            desc: "Payments, wallets, trading, banking" },
  { id: "healthcare",  label: "Healthcare",         desc: "Patient data, HIPAA, appointments, EHR" },
  { id: "gaming",      label: "Gaming",             desc: "Multiplayer, leaderboards, matchmaking" },
  { id: "saas",        label: "SaaS / Productivity", desc: "Multi-tenant, subscriptions, collaboration" },
  { id: "devtools",    label: "Developer Tools",    desc: "APIs, SDKs, CI/CD, observability" },
  { id: "analytics",   label: "Data & Analytics",   desc: "Pipelines, warehouses, dashboards, ML" },
  { id: "media",       label: "Media & Streaming",  desc: "Video, audio, CDN, live streaming" },
  { id: "logistics",   label: "Logistics & Ops",    desc: "Routing, tracking, fleet, warehouses" },
  { id: "iot",         label: "IoT & Embedded",     desc: "Devices, telemetry, edge compute" },
  { id: "custom",      label: "Custom / Other",     desc: "Start fresh, no domain preset" },
];

const PATTERNS = [
  { id: "microservices",  label: "Microservices",      desc: "Independently deployable services, API contracts" },
  { id: "monolith",       label: "Modular Monolith",   desc: "Single deployment, clean module boundaries" },
  { id: "serverless",     label: "Serverless",         desc: "Functions + managed cloud services, no infra" },
  { id: "event-driven",   label: "Event-Driven",       desc: "Async messaging, queues, CQRS / event sourcing" },
];

const SCALES = [
  { id: "startup",    label: "Prototype",   sub: "< 10k users" },
  { id: "growth",     label: "Growth",      sub: "10k – 500k users" },
  { id: "scale",      label: "Scale",       sub: "500k – 10M users" },
  { id: "enterprise", label: "Enterprise",  sub: "10M+ users" },
];

const DOMAIN_PRESETS = {
  ecommerce:  { scale: "100k monthly users, 10× spike on sales events",  latency: "< 200ms product pages, < 500ms checkout",       security: "PCI DSS, HTTPS, fraud detection, RBAC" },
  social:     { scale: "1M DAU, high read-heavy workload",                latency: "< 100ms feed reads, < 300ms write operations",  security: "GDPR, rate limiting, content moderation" },
  fintech:    { scale: "50k active users, 1k TPS peak payments",          latency: "< 100ms payment API, < 50ms ledger reads",      security: "PCI DSS Level 1, SOC 2, encryption at rest and in transit" },
  healthcare: { scale: "20k patients, 500 concurrent practitioners",      latency: "< 300ms clinical queries, near-real-time alerts",security: "HIPAA, RBAC, audit logging, data encryption" },
  gaming:     { scale: "500k concurrent players, 200k TPS game events",   latency: "< 50ms game state sync, < 20ms matchmaking",    security: "DDoS protection, anti-cheat, session tokens" },
  saas:       { scale: "10k tenants, 200k active seats",                  latency: "< 200ms UI, < 500ms heavy reports",             security: "SOC 2, tenant isolation, SSO, RBAC, audit logs" },
  devtools:   { scale: "100k developers, 10M API calls/day",              latency: "< 100ms API responses, < 5s build triggers",    security: "API key management, OAuth, rate limiting" },
  analytics:  { scale: "50TB data warehouse, 10k queries/day",            latency: "< 5s interactive queries, near-real-time ingest",security: "Column-level encryption, RBAC, data lineage" },
  media:      { scale: "500k concurrent viewers, 1PB storage",            latency: "< 2s stream start, < 100ms CDN edge",           security: "DRM, content authentication, geo-restrictions" },
  logistics:  { scale: "100k shipments/day, 50k tracked assets",          latency: "< 200ms tracking updates, real-time routing",   security: "Driver auth, vehicle telemetry encryption" },
  iot:        { scale: "1M connected devices, 100k messages/sec",         latency: "< 10ms edge processing, < 100ms cloud sync",    security: "Device certificates, TLS, OTA update signing" },
  custom:     { scale: "100k monthly users",                              latency: "sub-second interactions",                       security: "SSO, RBAC, audit logs" },
};

const PATTERN_NOTES = {
  microservices: "Design as independent microservices with clear API boundaries, service discovery, and a gateway. Each service owns its data store.",
  monolith:      "Design as a modular monolith with clear domain modules. Use a single deployable unit with internal module contracts.",
  serverless:    "Design using serverless functions (AWS Lambda / Cloud Functions) with managed services. No long-running servers where possible.",
  "event-driven":"Design around asynchronous events and message queues. Apply CQRS where read/write patterns diverge. Use event sourcing for audit trails.",
};

type DomainDef = (typeof DOMAINS)[number];
type PatternDef = (typeof PATTERNS)[number];
type ScaleDef = (typeof SCALES)[number];

/* ── NewDesignScreen ────────────────────────────────────────────────── */
function NewDesignScreen({
  onStart,
  onBack,
}: {
  onStart: (payload: {
    prompt: string;
    constraints: Record<string, string>;
    meta: { domain?: string; pattern?: string; scale?: string };
  }) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState(1);
  const [domain, setDomain] = useState<DomainDef | null>(null);
  const [pattern, setPattern] = useState<PatternDef | null>(null);
  const [scale, setScale] = useState<ScaleDef | null>(null);
  const [prompt, setPrompt] = useState("");

  function goStep2(d: DomainDef) {
    setDomain(d);
    setStep(2);
  }
  function goStep3() {
    if (!pattern || !scale) return;
    setStep(3);
  }
  function handleStart() {
    if (!prompt.trim()) return;
    const preset = DOMAIN_PRESETS[domain?.id as keyof typeof DOMAIN_PRESETS] || DOMAIN_PRESETS.custom;
    const patternNote = pattern ? PATTERN_NOTES[pattern.id as keyof typeof PATTERN_NOTES] || "" : "";
    const enrichedPrompt = [
      prompt.trim(),
      patternNote ? `\n\nArchitecture style: ${patternNote}` : "",
    ].join("");
    onStart({
      prompt: enrichedPrompt,
      constraints: {
        ...preset,
        latency: SCALES.find((s) => s.id === scale?.id) && scale ? `${scale.sub} — ${preset.latency}` : preset.latency,
        customRequirements: [
          domain?.id !== "custom" ? `Domain: ${domain?.label}` : "",
          pattern ? `Pattern: ${pattern.label}` : "",
          scale ? `Scale tier: ${scale.label} (${scale.sub})` : "",
        ].filter(Boolean).join(" · "),
      },
      meta: { domain: domain?.id, pattern: pattern?.id, scale: scale?.id },
    });
  }

  const step2Done = !!pattern && !!scale;

  const inp: CSSProperties = {
    border: `1px solid ${BORD}`,
    background: BG,
    color: DARK,
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
    resize: "none",
    width: "100%",
  };

  return (
    <div style={{ background: BG, minHeight: "100vh", color: DARK }}>
      {/* Header */}
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5" style={{ borderBottom: `1px solid ${BORD}` }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm transition-opacity hover:opacity-60" style={{ color: MUTED }}>← Back</button>
          <div style={{ width: 1, height: 16, background: BORD }} />
          <span className="text-sm font-semibold" style={{ color: DARK }}>New Design</span>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex h-6 w-6 items-center justify-center text-xs font-bold transition-colors"
                style={{ background: step >= n ? DARK : "transparent", color: step >= n ? BG : MUTED, border: `1px solid ${step >= n ? DARK : BORD}` }}>
                {step > n ? "✓" : n}
              </div>
              {n < 3 && <div style={{ width: 16, height: 1, background: step > n ? DARK : BORD }} />}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">

        {/* ── Step 1: Domain ── */}
        {step === 1 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>Step 1 of 3</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight" style={{ color: DARK }}>What are you building?</h2>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>Pick the domain that best matches your product. This shapes the default constraints and stack choices.</p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DOMAINS.map(d => (
                <button key={d.id} type="button" onClick={() => goStep2(d)}
                  className="card-hover group border p-5 text-left transition-all"
                  style={{
                    borderColor: domain?.id === d.id ? DARK : BORD,
                    background: domain?.id === d.id ? DARK : BG,
                  }}>
                  <p className="font-bold text-sm" style={{ color: domain?.id === d.id ? BG : DARK }}>{d.label}</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: domain?.id === d.id ? "#aaa" : MUTED }}>{d.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Pattern + Scale ── */}
        {step === 2 && (
          <div>
            <button type="button" onClick={() => setStep(1)} className="mb-6 text-sm transition-opacity hover:opacity-60" style={{ color: MUTED }}>← Domain: {domain?.label}</button>
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>Step 2 of 3</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight" style={{ color: DARK }}>Architecture style & scale</h2>

            <div className="mt-6 sm:mt-8">
              <p className="mb-3 text-sm font-semibold" style={{ color: DARK }}>Architecture pattern</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {PATTERNS.map(p => (
                  <button key={p.id} type="button" onClick={() => setPattern(p)}
                    className="card-hover border p-5 text-left transition-all"
                    style={{ borderColor: pattern?.id === p.id ? DARK : BORD, background: pattern?.id === p.id ? DARK : BG }}>
                    <p className="font-bold text-sm" style={{ color: pattern?.id === p.id ? BG : DARK }}>{p.label}</p>
                    <p className="mt-1 text-xs leading-5" style={{ color: pattern?.id === p.id ? "#aaa" : MUTED }}>{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 sm:mt-8">
              <p className="mb-3 text-sm font-semibold" style={{ color: DARK }}>Expected scale</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SCALES.map(s => (
                  <button key={s.id} type="button" onClick={() => setScale(s)}
                    className="card-hover border px-4 py-4 text-left transition-all"
                    style={{ borderColor: scale?.id === s.id ? DARK : BORD, background: scale?.id === s.id ? DARK : BG }}>
                    <p className="font-bold text-sm" style={{ color: scale?.id === s.id ? BG : DARK }}>{s.label}</p>
                    <p className="mt-0.5 text-xs" style={{ color: scale?.id === s.id ? "#aaa" : MUTED }}>{s.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            <button type="button" onClick={goStep3} disabled={!step2Done}
              className="btn-outline mt-10 border px-8 py-3.5 text-sm font-semibold disabled:opacity-30"
              style={{ borderColor: DARK, color: DARK }}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 3: Prompt ── */}
        {step === 3 && (
          <div>
            <button type="button" onClick={() => setStep(2)} className="mb-6 text-sm transition-opacity hover:opacity-60" style={{ color: MUTED }}>
              ← {pattern?.label} · {scale?.label}
            </button>
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>Step 3 of 3</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight" style={{ color: DARK }}>Describe your product</h2>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>
              The more specific you are about users, flows, and must-have features, the sharper the architecture output.
            </p>

            {/* Context summary */}
            <div className="mt-6 flex flex-wrap gap-2">
              {[domain?.label, pattern?.label, scale?.sub].filter(Boolean).map(t => (
                <span key={t} className="border px-3 py-1 text-xs font-semibold"
                  style={{ borderColor: DARK, color: DARK }}>{t}</span>
              ))}
            </div>

            <textarea value={prompt} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              rows={8} style={{ ...inp, marginTop: 20, minHeight: 180 }}
              placeholder={`Describe your ${domain?.label || "product"} idea. Include the key user journeys, must-have features, and anything that makes your use case specific...`} />

            {/* Quick starters */}
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Quick starters</p>
              <div className="flex flex-wrap gap-2">
                {[
                  `Build a ${domain?.label?.toLowerCase() || "product"} where users can sign up, manage their profile, and get personalised recommendations.`,
                  `Design a real-time ${domain?.label?.toLowerCase() || "platform"} with live notifications and collaborative features.`,
                  `Create a ${domain?.label?.toLowerCase() || "system"} that supports third-party integrations and an open API.`,
                ].map((s, i) => (
                  <button key={i} type="button" onClick={() => setPrompt(s)}
                    className="border px-3 py-1.5 text-xs transition-colors hover:border-black"
                    style={{ borderColor: BORD, color: MUTED }}>
                    {s.slice(0, 60)}…
                  </button>
                ))}
              </div>
            </div>

            <button type="button" onClick={handleStart} disabled={!prompt.trim()}
              className="btn-outline mt-8 border px-8 py-3.5 text-sm font-semibold disabled:opacity-30"
              style={{ borderColor: DARK, color: DARK }}>
              Generate architecture →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HeroDiagram() {
  return (
    <svg viewBox="0 0 780 440" className="h-full w-full" role="img" aria-label="Architecture preview">
      <defs>
        <marker id="hd-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="#94a3b8" />
        </marker>
        <pattern id="hd-dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#e2e8f0" />
        </pattern>
      </defs>
      <rect x="16" y="16" width="748" height="408" rx="20" fill="url(#hd-dots)" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="192" y="152" width="336" height="96" rx="14" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="1.2" strokeDasharray="5 4" />

      <text x="36" y="46" fontSize="9" fontWeight="700" fill="#94a3b8" letterSpacing="0.1em">EDGE</text>
      <text x="36" y="180" fontSize="9" fontWeight="700" fill="#94a3b8" letterSpacing="0.1em">SERVICES</text>
      <text x="36" y="330" fontSize="9" fontWeight="700" fill="#94a3b8" letterSpacing="0.1em">DATA</text>

      {/* User node */}
      <circle cx="64" cy="100" r="24" fill="white" stroke="#1e293b" strokeWidth="1.8" />
      <text x="64" y="105" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1e293b">User</text>
      <rect x="104" y="86" width="78" height="30" rx="9" fill="white" stroke="#3b82f6" strokeWidth="1.8" />
      <text x="143" y="105" textAnchor="middle" fontSize="10" fontWeight="700" fill="#3b82f6">Request</text>

      {/* Gateway */}
      <rect x="220" y="60" width="130" height="50" rx="12" fill="white" stroke="#1e293b" strokeWidth="1.6" />
      <text x="230" y="78" fontSize="8" fontWeight="700" fill="#0f766e" letterSpacing="0.1em">ENTRY</text>
      <text x="230" y="95" fontSize="12" fontWeight="700" fill="#1e293b">API Gateway</text>

      {/* Queue */}
      <rect x="410" y="66" width="130" height="50" rx="12" fill="#fff7ed" stroke="#1e293b" strokeWidth="1.6" />
      <text x="420" y="84" fontSize="8" fontWeight="700" fill="#f59e0b" letterSpacing="0.1em">QUEUE</text>
      <text x="420" y="101" fontSize="12" fontWeight="700" fill="#1e293b">Worker Queue</text>

      {/* Cloud */}
      <path d="M598 78 c0-16 12-28 28-28 6-14 22-20 36-12 10-8 26-5 32 8 18 2 30 14 30 28 0 18-15 30-34 30H630 c-20 0-32-10-32-26z" fill="white" stroke="#1e293b" strokeWidth="1.5" />
      <text x="646" y="94" textAnchor="middle" fontSize="10" fontWeight="700" fill="#8b5cf6">Cloud AI</text>

      {/* Services */}
      <rect x="204" y="188" width="130" height="48" rx="11" fill="#ecfeff" stroke="#1e293b" strokeWidth="1.6" />
      <text x="214" y="205" fontSize="8" fontWeight="700" fill="#0891b2" letterSpacing="0.1em">SERVICE</text>
      <text x="214" y="222" fontSize="11" fontWeight="700" fill="#1e293b">React Workspace</text>

      <rect x="376" y="184" width="130" height="56" rx="11" fill="#ecfeff" stroke="#1e293b" strokeWidth="1.6" />
      <text x="386" y="202" fontSize="8" fontWeight="700" fill="#0891b2" letterSpacing="0.1em">SERVICE</text>
      <text x="386" y="219" fontSize="11" fontWeight="700" fill="#1e293b">Export Service</text>
      <text x="386" y="233" fontSize="10" fill="#64748b">PDF · Word · MD</text>

      {/* Data */}
      <ellipse cx="200" cy="360" rx="70" ry="30" fill="white" stroke="#1e293b" strokeWidth="1.6" />
      <text x="200" y="355" textAnchor="middle" fontSize="9" fontWeight="700" fill="#6366f1">DATA</text>
      <text x="200" y="370" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e293b">PostgreSQL</text>
      <rect x="330" y="340" width="110" height="52" rx="11" fill="white" stroke="#1e293b" strokeWidth="1.6" />
      <text x="340" y="358" fontSize="9" fontWeight="700" fill="#14b8a6">CACHE</text>
      <text x="340" y="375" fontSize="11" fontWeight="700" fill="#1e293b">Redis Cache</text>
      <text x="340" y="389" fontSize="10" fill="#64748b">Sessions + Jobs</text>

      {/* Edges */}
      <path d="M88 100 H104" stroke="#3b82f6" strokeWidth="1.8" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M285 110 L285 138" stroke="#475569" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M350 85 L410 91" stroke="#475569" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M540 91 L598 91" stroke="#475569" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M270 188 L270 212" stroke="#3b82f6" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M475 116 L441 184" stroke="#f97316" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M270 236 L214 330" stroke="#6366f1" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
      <path d="M441 240 L385 340" stroke="#14b8a6" strokeWidth="1.6" fill="none" markerEnd="url(#hd-arrow)" />
    </svg>
  );
}

/* ── Personalized dashboard (logged-in users) ────────────────────────── */
function HistoryCard({ entry, onOpen }: { entry: DesignHistoryEntry; onOpen: (e: DesignHistoryEntry) => void }) {
  return (
    <button type="button" onClick={() => onOpen(entry)}
      className="group w-full border-b p-5 text-left transition-colors hover:bg-[#f9f9f9]"
      style={{ borderColor: BORD }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: DARK }}>{entry.idea}</p>
          {entry.summary && <p className="mt-0.5 line-clamp-1 text-xs" style={{ color: MUTED }}>{entry.summary}</p>}
        </div>
        <span className="shrink-0 text-xs font-semibold transition-colors group-hover:text-black" style={{ color: MUTED }}>Open →</span>
      </div>
      <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
        {entry.domain && <span className="mr-2">{entry.domain}</span>}
        {timeAgo(entry.createdAt)}
      </p>
    </button>
  );
}

function DashboardScreen({
  user,
  history,
  onNewDesign,
  onOpenHistory,
  onLogout,
  onDeleteDesign: _onDeleteDesign,
}: {
  user: SessionUser;
  history: DesignHistoryEntry[];
  onNewDesign: (preset?: string) => void;
  onOpenHistory: (e: DesignHistoryEntry) => void;
  onLogout: () => void;
  onDeleteDesign: (id: string) => void;
}) {
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = user.name.split(" ")[0];

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <nav className="flex items-center justify-between px-8 py-4" style={{ borderBottom: `1px solid ${BORD}` }}>
        <Wordmark />
        <div className="flex items-center gap-6">
          <span className="hidden text-sm sm:block" style={{ color: MUTED }}>{user.name}</span>
          <button type="button" onClick={onLogout} className="text-sm transition-colors hover:text-black" style={{ color: MUTED }}>Sign out</button>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-8 py-16">
        <p className="text-sm" style={{ color: MUTED }}>{greeting}, {first}.</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight" style={{ color: DARK }}>
          {history.length > 0 ? "Continue where you left off." : "Start your first design."}
        </h1>
        <p className="mt-3 text-base" style={{ color: MUTED }}>
          {history.length > 0 ? "Open a recent design or start fresh." : "Describe a product and get a complete system architecture."}
        </p>
        <button type="button" onClick={() => onNewDesign()}
          className="btn-outline mt-6 inline-flex items-center gap-2 border px-6 py-3 text-sm font-semibold"
          style={{ borderColor: DARK, color: DARK }}>
          + New design
        </button>

        {history.length > 0 && (
          <div className="mt-12">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Recent</p>
            <div style={{ border: `1px solid ${BORD}` }}>
              {history.map(e => <HistoryCard key={e.id} entry={e} onOpen={onOpenHistory} />)}
            </div>
          </div>
        )}

        <div className="mt-12" style={{ borderTop: `1px solid ${BORD}`, paddingTop: 40 }}>
          <p className="mb-5 text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Try one of these</p>
          <div style={{ border: `1px solid ${BORD}` }}>
            {[
              "Build a real-time collaborative code editor with presence indicators",
              "Design a food delivery platform with live order tracking",
              "Create a customer support tool with AI-powered ticket routing",
              "Build a multi-tenant SaaS analytics dashboard",
            ].map((idea, i) => (
              <button key={i} type="button" onClick={() => onNewDesign(idea)}
                className="flex w-full items-center justify-between border-b px-5 py-4 text-left text-sm transition-colors hover:bg-[#f9f9f9] last:border-0"
                style={{ borderColor: BORD, color: DARK }}>
                <span>{idea}</span>
                <span style={{ color: MUTED }}>→</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Login / Sign-up screen ──────────────────────────────────────────── */
function AuthScreen({
  onAuth,
  onBack,
  onForgotPassword,
  initialMode = "signup",
}: {
  onAuth: (mode: "signup" | "login", fields: { name?: string; email: string; password: string }) => Promise<boolean>;
  onBack: () => void;
  onForgotPassword?: () => void;
  initialMode?: "signup" | "login";
}) {
  const [mode, setMode] = useState<"signup" | "login">(initialMode);
  const [fields, setFields] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  async function handleSubmit() {
    if (!fields.email.trim() || !fields.password.trim()) { setError("Email and password are required."); return; }
    if (mode === "signup" && !fields.name.trim())        { setError("Your name is required."); return; }
    if (fields.password.length < 6)                      { setError("Password must be at least 6 characters."); return; }
    setBusy(true); setError("");
    const ok = await onAuth(mode, fields);
    if (!ok) setBusy(false);
  }

  function set(k: keyof typeof fields, v: string) {
    setError("");
    setFields((f) => ({ ...f, [k]: v }));
  }

  const inp: CSSProperties = { border: `1px solid ${BORD}`, background: BG, color: DARK, width: "100%", padding: "12px 14px", fontSize: 14, outline: "none", borderRadius: 0 };

  return (
    <div style={{ background: GRAY, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <button type="button" onClick={onBack} className="mb-6 text-sm transition-colors hover:text-black" style={{ color: MUTED }}>← Back</button>
        <div style={{ background: BG, border: `1px solid ${BORD}`, padding: 36 }}>
          <Wordmark />
          <h2 className="mt-7 text-xl font-bold" style={{ color: DARK }}>{mode === "signup" ? "Create account" : "Welcome back"}</h2>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>{mode === "signup" ? "Free. No card required." : "Sign in to continue."}</p>

          {error && <p className="mt-4 border-l-4 pl-3 text-sm" style={{ color: "#dc2626", borderColor: "#dc2626" }}>{error}</p>}

          <div className="mt-6 space-y-4">
            {mode === "signup" && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Name</span>
                <input value={fields.name} onChange={(e: ChangeEvent<HTMLInputElement>) => set("name", e.target.value)} placeholder="Your name" style={inp} />
              </label>
            )}
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Email</span>
              <input type="email" value={fields.email} onChange={(e: ChangeEvent<HTMLInputElement>) => set("email", e.target.value)} placeholder="you@example.com" style={inp} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Password</span>
              <input
                type="password"
                value={fields.password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => set("password", e.target.value)}
                placeholder="Min 6 characters"
                onKeyDown={(e) => e.key === "Enter" && void handleSubmit()}
                style={inp}
              />
            </label>
            {mode === "login" && onForgotPassword && (
              <div className="text-right">
                <button type="button" onClick={onForgotPassword} className="text-link text-xs font-semibold" style={{ color: MUTED }}>
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          <button type="button" onClick={handleSubmit} disabled={busy}
            className="mt-6 w-full py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60 hover:opacity-80"
            style={{ background: DARK }}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account →" : "Sign in →"}
          </button>

          <p className="mt-5 text-center text-sm" style={{ color: MUTED }}>
            {mode === "signup" ? "Have an account? " : "No account? "}
            <button type="button" onClick={() => { setMode(m => m === "signup" ? "login" : "signup"); setError(""); }}
              className="font-semibold underline" style={{ color: DARK }}>
              {mode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function ForgotPasswordScreen({
  onBack,
  onContinueWithCode,
}: {
  onBack: () => void;
  onContinueWithCode: (code: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { message?: string; devResetCode?: string; devResetHint?: string; error?: string };
      if (!res.ok) {
        setMessage(data.error || "Request failed.");
        setDone(true);
        return;
      }
      setMessage(data.message || "If an account exists, you will receive a 6-digit code.");
      if (data.devResetCode) setDevCode(data.devResetCode);
      setDone(true);
    } catch {
      setMessage("Network error. Try again.");
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const inp: CSSProperties = { border: `1px solid ${BORD}`, background: BG, color: DARK, width: "100%", padding: "12px 14px", fontSize: 14, outline: "none", borderRadius: 0 };

  return (
    <div style={{ background: GRAY, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <button type="button" onClick={onBack} className="mb-6 text-sm transition-colors hover:text-black" style={{ color: MUTED }}>
          ← Back to sign in
        </button>
        <div style={{ background: BG, border: `1px solid ${BORD}`, padding: 36 }}>
          <Wordmark />
          <h2 className="mt-7 text-xl font-bold" style={{ color: DARK }}>Reset your password</h2>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: MUTED }}>
            Enter the email you used to register. We will email you a 6-digit code (valid for one hour). In local development, the code may appear below instead.
          </p>

          {!done ? (
            <>
              <label className="mt-6 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={inp}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !email.trim()}
                className="mt-6 w-full py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40 hover:opacity-80"
                style={{ background: DARK }}
              >
                {busy ? "Please wait…" : "Send reset code →"}
              </button>
            </>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed" style={{ color: DARK }}>{message}</p>
              {devCode && (
                <div className="space-y-2 rounded border p-3" style={{ borderColor: BORD, background: "#fafafa" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Development code</p>
                  <p className="text-xs" style={{ color: MUTED }}>Enter this code on the next screen with your new password. It expires in one hour.</p>
                  <p
                    className="w-full py-3 text-center font-mono text-2xl font-bold tracking-[0.35em]"
                    style={{ ...inp, letterSpacing: "0.35em" }}
                  >
                    {devCode}
                  </p>
                  <button
                    type="button"
                    onClick={() => onContinueWithCode(devCode)}
                    className="btn-outline w-full border py-2.5 text-sm font-semibold"
                    style={{ borderColor: DARK, color: DARK }}
                  >
                    Enter code and new password →
                  </button>
                </div>
              )}
              {!devCode && (
                <button
                  type="button"
                  onClick={() => onContinueWithCode("")}
                  className="btn-outline w-full border py-2.5 text-sm font-semibold"
                  style={{ borderColor: DARK, color: DARK }}
                >
                  I have my code →
                </button>
              )}
              <button type="button" onClick={onBack} className="block text-sm font-semibold underline-offset-2 hover:underline" style={{ color: DARK }}>
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Normalises reset input: 6-digit codes, or legacy 64-char hex tokens from old links. */
function normalizePasswordResetInput(raw: string) {
  const v = raw.replace(/\s/g, "");
  if (/^\d+$/.test(v)) return v.slice(0, 6);
  if (/^[a-f0-9]{64}$/i.test(v)) return v.toLowerCase();
  if (/^[a-f0-9]+$/i.test(v) && v.length > 6) return v.toLowerCase().slice(0, 64);
  return v.replace(/\D/g, "").slice(0, 6);
}

function ResetPasswordScreen({
  code,
  onCodeChange,
  onBack,
  onDone,
}: {
  code: string;
  onCodeChange: (c: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const raw = code.trim().replace(/\s/g, "");
    if (!raw) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    const legacyHex = /^[a-f0-9]{64}$/i.test(raw);
    const digitsOnly = raw.replace(/\D/g, "");
    if (!legacyHex && digitsOnly.length !== 6) {
      setError("The code must be exactly 6 digits.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const body = legacyHex
      ? { token: raw.toLowerCase(), password }
      : { code: digitsOnly.slice(0, 6), password };
    try {
      const res = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; message?: string; code?: string };
      if (!res.ok) {
        if (res.status === 429 && data.code === "RESET_LOCKED") {
          setError(data.error || "Too many attempts. Wait before trying again.");
        } else {
          setError(data.error || "Reset failed.");
        }
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const inp: CSSProperties = { border: `1px solid ${BORD}`, background: BG, color: DARK, width: "100%", padding: "12px 14px", fontSize: 14, outline: "none", borderRadius: 0 };

  return (
    <div style={{ background: GRAY, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <button type="button" onClick={onBack} className="mb-6 text-sm transition-colors hover:text-black" style={{ color: MUTED }}>
          ← Back to sign in
        </button>
        <div style={{ background: BG, border: `1px solid ${BORD}`, padding: 36 }}>
          <Wordmark />
          <h2 className="mt-7 text-xl font-bold" style={{ color: DARK }}>Choose a new password</h2>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>Codes expire after one hour.</p>

          {error && <p className="mt-4 border-l-4 pl-3 text-sm" style={{ color: "#dc2626", borderColor: "#dc2626" }}>{error}</p>}

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Code from email</span>
              <input
                type="text"
                inputMode={/^[a-f0-9]+$/i.test(code) && !/^\d+$/.test(code) ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={64}
                value={code}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onCodeChange(normalizePasswordResetInput(e.target.value))}
                placeholder="000000"
                className={`font-mono ${code.length > 6 ? "text-sm tracking-normal" : "text-center text-lg tracking-[0.4em]"}`}
                style={{ ...inp, letterSpacing: code.length > 6 ? "normal" : "0.4em" }}
              />
              <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                Enter the 6-digit code from your email, or follow the link in the message to fill this in automatically.
              </p>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                style={inp}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                style={inp}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="mt-6 w-full py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60 hover:opacity-80"
            style={{ background: DARK }}
          >
            {busy ? "Please wait…" : "Update password →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LandingScreen({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  const S = { background: BG };   /* every section uses this */
  return (
    <div style={{ ...S, color: DARK }}>

      {/* Nav */}
      <nav style={{ ...S, borderBottom: `1px solid ${BORD}`, position: "sticky", top: 0, zIndex: 50 }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Wordmark />
          <div className="flex items-center gap-6">
            <a href="#features" className="nav-link hidden text-sm sm:block" style={{ color: DARK }}>Features</a>
            <a href="#process"  className="nav-link hidden text-sm sm:block" style={{ color: DARK }}>Process</a>
            <button type="button" onClick={onSignIn} className="nav-link text-sm" style={{ color: DARK }}>Sign in</button>
            <button type="button" onClick={onGetStarted}
              className="btn-outline border px-5 py-2 text-sm font-semibold"
              style={{ borderColor: DARK, color: DARK }}>
              Get started
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={S} className="px-4 py-12 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>System Design Studio</p>
              <h1 className="mt-4 text-3xl font-black leading-[1.06] tracking-tight sm:text-4xl lg:text-[4.2rem]" style={{ color: DARK }}>
                Turn a product idea into a real system design.
              </h1>
              <p className="mt-5 text-base leading-7 sm:text-lg" style={{ color: MUTED }}>
                Describe what you want to build. Get back requirements, components,
                data flows, stack choices, APIs, and a visual architecture diagram.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={onGetStarted}
                  className="btn-outline border px-6 py-3 text-sm font-semibold sm:px-7 sm:py-3.5"
                  style={{ borderColor: DARK, color: DARK }}>
                  Try it free →
                </button>
                <a href="#features" className="nav-link px-6 py-3 text-sm font-semibold sm:px-7 sm:py-3.5"
                  style={{ color: MUTED }}>
                  See how it works ↓
                </a>
              </div>
              <div className="mt-8 grid grid-cols-3 border-t pt-6" style={{ borderColor: BORD }}>
                {[["8+","Sections"],["< 10s","Per design"],["3","Export formats"]].map(([v, l], i) => (
                  <div key={l} style={{ paddingRight: i < 2 ? 16 : 0, paddingLeft: i > 0 ? 16 : 0, borderRight: i < 2 ? `1px solid ${BORD}` : "none" }}>
                    <p className="text-2xl font-black sm:text-3xl" style={{ color: DARK }}>{v}</p>
                    <p className="mt-1 text-xs" style={{ color: MUTED }}>{l}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagram preview — hidden on very small, shown from sm */}
            <div className="card-hover hidden sm:block" style={{ border: `1px solid ${BORD}` }}>
              <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: BORD }}>
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center border text-[8px] font-black" style={{ borderColor: DARK, color: DARK }}>SD</div>
                  <span className="text-xs font-medium" style={{ color: MUTED }}>Architecture Board</span>
                </div>
                <span className="border px-2.5 py-1 text-[10px] font-semibold" style={{ borderColor: DARK, color: DARK }}>Regenerate</span>
              </div>
              <HeroDiagram />
            </div>
          </div>
        </div>
      </section>

      {/* ── What's included ── */}
      <section id="features" style={S} className="px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl border-t pt-10 sm:pt-16" style={{ borderColor: BORD }}>
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>What's included</p>
              <h2 className="mt-4 text-2xl font-black leading-tight sm:text-3xl lg:text-4xl" style={{ color: DARK }}>
                Not a summary. A complete architecture.
              </h2>
              <p className="mt-4 text-base leading-7" style={{ color: MUTED }}>
                Structured output that matches how engineers actually document systems — section by section.
              </p>
              <button type="button" onClick={onGetStarted}
                className="btn-outline mt-6 border px-6 py-3 text-sm font-semibold sm:mt-8 sm:px-7 sm:py-3.5"
                style={{ borderColor: DARK, color: DARK }}>
                Start for free →
              </button>
            </div>

            {/* Output sample list */}
            <div className="card-hover mt-4 lg:mt-0" style={{ border: `1px solid ${BORD}` }}>
              <div className="border-b px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ borderColor: BORD, color: MUTED }}>
                Sample output
              </div>
              {OUTPUT_SAMPLES.map(({ label, text }) => (
                <div key={label} className="sample-row border-b px-5 py-3.5 last:border-0 sm:py-4" style={{ borderColor: BORD }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: LIME }}>{label}</p>
                  <p className="mt-1 text-sm" style={{ color: DARK }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Diagram ── */}
      <section style={S} className="px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl border-t pt-10 sm:pt-16" style={{ borderColor: BORD }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>Architecture board</p>
          <h2 className="mt-3 mb-6 text-2xl font-black tracking-tight sm:text-3xl sm:mb-8" style={{ color: DARK }}>The diagram it generates</h2>
          <div className="card-hover overflow-x-auto" style={{ border: `1px solid ${BORD}` }}>
            <div className="flex min-w-[340px] items-center justify-between border-b px-5 py-3" style={{ borderColor: BORD }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Architecture Board</p>
              <div className="flex gap-2">
                <span className="border px-3 py-1 text-[11px]" style={{ borderColor: BORD, color: MUTED }}>Zoom</span>
                <span className="border px-3 py-1 text-[11px] font-semibold" style={{ borderColor: DARK, color: DARK }}>Regenerate</span>
              </div>
            </div>
            <div className="min-w-[340px]"><HeroDiagram /></div>
          </div>
        </div>
      </section>

      {/* ── Process ── */}
      <section id="process" style={S} className="px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-3xl border-t pt-10 sm:pt-16" style={{ borderColor: BORD }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: MUTED }}>How it works</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl" style={{ color: DARK }}>Three steps</h2>
          <div className="mt-8 sm:mt-12">
            {[
              ["01", "Describe the product", "Write what you want to build — users, flows, and constraints like scale, latency, region, and budget."],
              ["02", "Architecture generates", "Requirements, components, tech stack, data flows, API definitions, and a diagram — in seconds."],
              ["03", "Review and export", "Inspect every section, adjust the prompt, regenerate parts, and export as PDF, Word, or Markdown."],
            ].map(([n, t, b]) => (
              <div key={n} className="step-row flex gap-5 border-b py-6 sm:gap-6 sm:py-8" style={{ borderColor: BORD }}>
                <span className="w-8 shrink-0 text-sm font-semibold" style={{ color: MUTED }}>{n}</span>
                <div>
                  <p className="font-semibold" style={{ color: DARK }}>{t}</p>
                  <p className="mt-1.5 text-sm leading-6" style={{ color: MUTED }}>{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={S} className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-3xl border-t pt-12 sm:pt-16" style={{ borderColor: BORD }}>
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl" style={{ color: DARK }}>Start designing.</h2>
          <p className="mt-4 text-base sm:text-lg" style={{ color: MUTED }}>Describe a product. Get the complete system design.</p>
          <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
            <button type="button" onClick={onGetStarted}
              className="btn-outline border px-8 py-3.5 text-sm font-semibold"
              style={{ borderColor: DARK, color: DARK }}>
              Get started free →
            </button>
            <button type="button" onClick={onSignIn}
              className="text-link text-sm"
              style={{ color: MUTED }}>
              Already have an account? Sign in
            </button>
          </div>
        </div>
      </section>

      <footer style={S} className="px-6 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between border-t pt-6" style={{ borderColor: BORD }}>
          <Wordmark />
          <p className="text-xs" style={{ color: MUTED }}>Architecture planning, simplified.</p>
        </div>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  ONBOARDING SCREEN                                                     */
/* ══════════════════════════════════════════════════════════════════════ */
function OnboardingScreen({
  form,
  signup,
  onPromptChange,
  onConstraintChange,
  onSignupChange,
  onSubmit,
  onBack,
}: {
  form: FormState;
  signup: typeof SIGNUP_DEFAULT;
  onPromptChange: (v: string) => void;
  onConstraintChange: (k: ConstraintKey, v: string) => void;
  onSignupChange: (k: keyof typeof SIGNUP_DEFAULT, v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen px-4 py-8 md:px-6" style={{ background: P.paper, color: P.text }}>
      <div className="mx-auto max-w-[1100px]">
        <button type="button" onClick={onBack} className="mb-8 flex items-center gap-2 text-sm font-medium transition-colors hover:text-[#c8452d]" style={{ color: P.muted }}>
          ← Back to overview
        </button>
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* Left */}
          <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="mb-7 border-b border-gray-100 pb-6">
              <Wordmark />
              <h1 className="mt-6 text-3xl font-black tracking-tight text-gray-950">Describe what you want to build.</h1>
              <p className="mt-3 text-sm leading-7 text-gray-500">The more specific you are about users, flows, and constraints, the sharper the architecture output.</p>
            </div>
            <div className="space-y-5">
              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Product idea</span>
                <Input as="textarea" rows={6} value={form.prompt} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(e.target.value)}
                  placeholder="e.g. Build a SaaS tool for engineering teams to track on-call incidents, assign alerts, and generate post-mortems automatically."
                  className="min-h-[160px] resize-none bg-gray-50 text-sm" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <ConstraintField label="Scale" value={form.constraints.scale} onChange={(v) => onConstraintChange("scale", v)} placeholder="100k monthly users" />
                <ConstraintField label="Latency" value={form.constraints.latency} onChange={(v) => onConstraintChange("latency", v)} placeholder="sub-second" />
                <ConstraintField label="Budget" value={form.constraints.budget} onChange={(v) => onConstraintChange("budget", v)} placeholder="balanced" />
                <ConstraintField label="Region" value={form.constraints.region} onChange={(v) => onConstraintChange("region", v)} placeholder="US + global edge" />
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Need inspiration?</p>
                <button type="button" onClick={() => {
                  onPromptChange("Build a learning platform where students can watch live classes, message mentors, and get AI-generated study plans.");
                  onConstraintChange("scale", "250k active learners");
                  onConstraintChange("latency", "real-time chat and live class interactions");
                  onConstraintChange("budget", "balanced with room for managed services");
                  onConstraintChange("region", "global edge delivery with India and US focus");
                }} className="mt-2 text-sm font-medium text-blue-700 underline-offset-2 hover:underline">
                  Load: learning platform with live classes and AI study plans →
                </button>
              </div>
            </div>
          </div>
          {/* Right */}
          <div className="space-y-5">
            <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">Access</p>
              <h2 className="mt-2 text-xl font-black tracking-tight text-gray-950">Create your free workspace</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">Takes 10 seconds. No card required.</p>
              <div className="mt-6 grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Full name</span>
                  <Input value={signup.name} onChange={(e: ChangeEvent<HTMLInputElement>) => onSignupChange("name", e.target.value)} placeholder="Your name" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Email</span>
                  <Input type="email" value={signup.email} onChange={(e: ChangeEvent<HTMLInputElement>) => onSignupChange("email", e.target.value)} placeholder="you@example.com" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Password</span>
                  <Input type="password" value={signup.password} onChange={(e: ChangeEvent<HTMLInputElement>) => onSignupChange("password", e.target.value)} placeholder="Create a password" />
                </label>
              </div>
              <button type="button" onClick={onSubmit}
                className="mt-6 w-full rounded-xl bg-gray-950 py-3.5 text-sm font-black text-white shadow-[0_6px_20px_rgba(15,23,42,0.16)] transition-all duration-200 hover:bg-blue-600">
                Open workspace →
              </button>
            </div>
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">You'll get</p>
              <ul className="mt-4 space-y-3">
                {["Architecture diagram with components and flows", "Functional + non-functional requirements", "Tech stack with reasoning for each choice", "API definitions and data schema", "Export to PDF, Word, or Markdown"].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-700">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500">
                      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  WORKSPACE SCREEN                                                      */
/* ══════════════════════════════════════════════════════════════════════ */
type ExportFormat = "md" | "pdf" | "docx";

function WorkspaceScreen({
  form,
  design,
  loading,
  exporting,
  hasDesign,
  showInsights,
  showExportMenu,
  metrics,
  user,
  designMeta,
  requireAuthForAi,
  onRequestSignIn,
  onPromptChange,
  onConstraintChange,
  onGenerate,
  onReset,
  onExport,
  onToggleInsights,
  onToggleExportMenu,
  onCloseMenus: _onCloseMenus,
  onGoHome,
  onNewDesign,
}: {
  form: FormState;
  design: NormalizedDesign;
  loading: boolean;
  exporting: string;
  hasDesign: boolean;
  showInsights: boolean;
  showExportMenu: boolean;
  metrics: { label: string; value: number }[];
  user: SessionUser | null;
  designMeta: { domain?: string; pattern?: string; scale?: string } | null;
  requireAuthForAi: boolean;
  onRequestSignIn: () => void;
  onPromptChange: (v: string) => void;
  onConstraintChange: (k: ConstraintKey, v: string) => void;
  onGenerate: () => void;
  onReset: () => void;
  onExport: (fmt: ExportFormat) => void;
  onToggleInsights: () => void;
  onToggleExportMenu: () => void;
  onCloseMenus: () => void;
  onGoHome: () => void;
  onNewDesign: () => void;
}) {
  const domainLabel  = designMeta?.domain  ? DOMAINS.find(d => d.id === designMeta.domain)?.label  : null;
  const patternLabel = designMeta?.pattern ? PATTERNS.find(p => p.id === designMeta.pattern)?.label : null;
  const [mobileTab, setMobileTab] = useState("diagram");
  const [mobileMenu, setMobileMenu] = useState(false);

  return (
    <div className="workspace-root flex flex-col" style={{ background: GRAY }}>

      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3" style={{ borderColor: BORD }}>
        {/* Left: logo + meta */}
        <div className="flex min-w-0 items-center gap-3">
          <Wordmark onClick={onGoHome} />
          {(domainLabel || patternLabel) && (
            <div className="hidden items-center gap-1.5 md:flex">
              {domainLabel  && <span className="border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: BORD, color: MUTED }}>{domainLabel}</span>}
              {patternLabel && <span className="border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: BORD, color: MUTED }}>{patternLabel}</span>}
            </div>
          )}
        </div>

        {/* Right: desktop actions + mobile hamburger */}
        <div className="flex shrink-0 items-center gap-1.5">

          {/* Desktop-only buttons */}
          <button type="button" onClick={onNewDesign}
            className="btn-outline hidden border px-3 py-2 text-xs font-semibold sm:block"
            style={{ borderColor: BORD, color: DARK }}>
            + New design
          </button>

          <div className="relative hidden sm:block">
            <button type="button" disabled={!hasDesign || Boolean(exporting)} onClick={onToggleExportMenu}
              className="btn-outline border px-3 py-2 text-xs font-semibold disabled:opacity-40"
              style={{ borderColor: BORD, color: DARK }}>
              {exporting ? "…" : "Export"}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-9 z-30 w-40 overflow-hidden border bg-white shadow-xl" style={{ borderColor: BORD }}>
                {[["md","Markdown (.md)"],["pdf","PDF (.pdf)"],["docx","Word (.docx)"]].map(([fmt, label]) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => onExport(fmt as ExportFormat)}
                    className="flex w-full px-4 py-2.5 text-sm transition-colors hover:bg-gray-50"
                    style={{ color: DARK }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Generate — always visible */}
          <button type="button" onClick={onGenerate} disabled={loading}
            className="btn-outline border px-4 py-2 text-xs font-bold disabled:opacity-50"
            style={{ borderColor: DARK, color: DARK }}>
            {loading ? "…" : "Generate"}
          </button>

          <button type="button" onClick={onToggleInsights}
            className="btn-outline hidden border px-3 py-2 text-xs font-semibold sm:block"
            style={{ borderColor: showInsights ? DARK : BORD, background: showInsights ? DARK : BG }}>
            <span style={{ color: showInsights ? BG : DARK }}>Insights</span>
          </button>

          <div className="mx-0.5 hidden h-4 w-px sm:block" style={{ background: BORD }} />

          <button type="button" onClick={onReset}
            className="hidden text-xs font-semibold transition-opacity hover:opacity-60 sm:block"
            style={{ color: MUTED }}>
            Reset
          </button>

          {/* Mobile hamburger — shows extra actions */}
          <div className="relative sm:hidden">
            <button type="button" onClick={() => setMobileMenu(v => !v)}
              className="btn-outline border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: BORD, color: DARK }}>
              ⋯
            </button>
            {mobileMenu && (
              <div className="absolute right-0 top-10 z-40 w-48 overflow-hidden border bg-white shadow-xl" style={{ borderColor: BORD }}
                onClick={() => setMobileMenu(false)}>
                <button type="button" onClick={onNewDesign} className="flex w-full px-4 py-3 text-sm font-medium" style={{ color: DARK }}>+ New design</button>
                <button type="button" disabled={!hasDesign} onClick={() => onExport("pdf" as ExportFormat)} className="flex w-full px-4 py-3 text-sm disabled:opacity-40" style={{ color: DARK }}>Export as PDF</button>
                <button type="button" disabled={!hasDesign} onClick={() => onExport("md" as ExportFormat)} className="flex w-full px-4 py-3 text-sm disabled:opacity-40" style={{ color: DARK }}>Export as Markdown</button>
                <div style={{ height: 1, background: BORD }} />
                <button type="button" onClick={onToggleInsights} className="flex w-full px-4 py-3 text-sm" style={{ color: DARK }}>
                  {showInsights ? "Hide insights" : "Show insights"}
                </button>
                <button type="button" onClick={onReset} className="flex w-full px-4 py-3 text-sm" style={{ color: MUTED }}>Reset workspace</button>
              </div>
            )}
          </div>

          {user && (
            <div className="ml-1 flex h-7 w-7 items-center justify-center border text-[11px] font-black" style={{ borderColor: DARK, color: DARK }} title={user.name}>
              {user.name?.[0]?.toUpperCase() || "U"}
            </div>
          )}
        </div>
      </header>

      {requireAuthForAi && !user && (
        <div
          className="shrink-0 border-b px-4 py-2.5 text-center text-xs sm:text-[13px]"
          style={{ borderColor: BORD, background: "#fffbeb", color: "#78350f" }}
        >
          Sign in to generate designs and export PDF or Word on this server.{" "}
          <button type="button" className="font-bold underline decoration-amber-800/50" onClick={onRequestSignIn}>
            Sign in
          </button>
        </div>
      )}

      {/* ── Mobile tab bar ── */}
      <div className="flex shrink-0 border-b xl:hidden" style={{ borderColor: BORD, background: BG }}>
        {[["brief","Brief"],["diagram","Diagram"],["insights","Insights"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMobileTab(id)}
            className="flex-1 py-2.5 text-xs font-semibold transition-colors"
            style={{
              color: mobileTab === id ? DARK : MUTED,
              borderBottom: mobileTab === id ? `2px solid ${DARK}` : "2px solid transparent",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Body: flex-col on mobile, grid on xl ── */}
      <div className={`flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 xl:grid xl:gap-3 xl:p-3 ${showInsights ? "xl:grid-cols-[300px_minmax(0,1fr)_320px]" : "xl:grid-cols-[300px_minmax(0,1fr)]"}`}>

        {/* ── Brief panel ── */}
        <aside className={`min-h-0 rounded-xl border border-gray-200 bg-white
          ${mobileTab === "brief"
            ? "flex flex-1 flex-col"
            : "hidden xl:flex xl:flex-col"}`}>
          {/* Fixed header */}
          <div className="shrink-0 border-b border-gray-100 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Design Brief</p>
          </div>
          {/* Scrollable content */}
          <div className="scroll-surface flex-1 overflow-y-auto">
            <div className="space-y-5 px-4 py-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Product idea</span>
                <Input as="textarea" rows={6} value={form.prompt}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(e.target.value)}
                  className="resize-none bg-gray-50 text-sm"
                  placeholder="Describe the product, users, and critical flows." />
              </label>
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Constraints</p>
                {(
                  [
                    ["scale", "Scale"],
                    ["latency", "Latency"],
                    ["budget", "Budget"],
                    ["region", "Region"],
                    ["security", "Security"],
                  ] as const
                ).map(([k, l]) => (
                  <ConstraintField key={k} label={l} value={form.constraints[k]} onChange={(v) => onConstraintChange(k, v)} />
                ))}
              </div>
              <div>
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Snapshot</p>
                <div className="grid grid-cols-2 gap-2">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{m.label}</p>
                      <p className="mt-0.5 text-lg font-black text-gray-900">{m.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" onClick={onGenerate} disabled={loading}
                className="btn-outline w-full border py-3 text-sm font-bold disabled:opacity-50 xl:hidden"
                style={{ borderColor: DARK, color: DARK }}>
                {loading ? "Generating…" : "Generate architecture →"}
              </button>
            </div>
          </div>
        </aside>

        {/* ── Diagram ── */}
        <section className={`min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white
          ${mobileTab === "diagram"
            ? "flex flex-1 flex-col"
            : "hidden xl:flex xl:flex-col"}`}>
          <Suspense fallback={<DiagramSkeleton />}>
            <DiagramCanvas design={design} loading={loading} onGenerate={onGenerate} />
          </Suspense>
        </section>

        {/* ── Insights ── */}
        {showInsights && (
          <aside className={`min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white
            ${mobileTab === "insights"
              ? "flex flex-1 flex-col"
              : "hidden xl:flex xl:flex-col"}`}>
            <Suspense fallback={<InsightSkeleton />}>
              <RightPanel design={design} />
            </Suspense>
          </aside>
        )}

        {/* Insights empty state on mobile */}
        {!showInsights && mobileTab === "insights" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 xl:hidden">
            <p className="text-sm font-semibold" style={{ color: DARK }}>Insights panel is off</p>
            <p className="text-xs" style={{ color: MUTED }}>Generate a design first, then enable insights.</p>
            <button type="button" onClick={onToggleInsights}
              className="btn-outline mt-2 border px-6 py-2.5 text-sm font-semibold"
              style={{ borderColor: DARK, color: DARK }}>
              Enable insights
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  APP ROOT                                                              */
/* ══════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [design, setDesign] = useState<NormalizedDesign>(() =>
    createFallbackDesign("Build a learning platform where students can watch live classes, message mentors, and get AI-generated study plans.", INITIAL_FORM.constraints),
  );
  const [recordId, setRecordId] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [signup, setSignup] = useState(SIGNUP_DEFAULT);
  const [showInsights, setShowInsights] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [screen, setScreen] = useState<Screen>("landing");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [history, setHistory] = useState<DesignHistoryEntry[]>([]);
  const [designMeta, setDesignMeta] = useState<{ domain?: string; pattern?: string; scale?: string } | null>(null);
  const [resetPasswordCode, setResetPasswordCode] = useState("");
  const [publicConfig, setPublicConfig] = useState({ requireAuthForAi: false });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/public-config"))
      .then((r) => r.json())
      .then((c: { requireAuthForAi?: boolean }) => setPublicConfig({ requireAuthForAi: Boolean(c.requireAuthForAi) }))
      .catch(() => {});
  }, []);

  /* Password reset deep link (?reset=TOKEN) or restore session from JWT */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code");
    if (codeParam) {
      params.delete("code");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      const digits = codeParam.replace(/\D/g, "").slice(0, 6);
      if (digits.length === 6) {
        setResetPasswordCode(digits);
        setScreen("reset-password");
        return;
      }
    }

    const reset = params.get("reset");
    if (reset) {
      setResetPasswordCode(reset.trim().replace(/\s/g, "").toLowerCase().slice(0, 64));
      setScreen("reset-password");
      params.delete("reset");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      return;
    }

    const token = loadToken();
    if (!token) return;
    (async () => {
      try {
        const me = await fetch(apiUrl("/api/auth/me"), { headers: { Authorization: `Bearer ${token}` } });
        if (!me.ok) {
          clearToken();
          return;
        }
        const u = await me.json();
        setUser(u);
        const designs = await fetchDesigns();
        setHistory(designs);
        setScreen(designs.length > 0 ? "dashboard" : "workspace");
      } catch {
        clearToken();
      }
    })();
  }, []);

  const hasDesign = useMemo(() => hasMeaningfulDesign(design), [design]);
  const metrics   = useMemo(() => [
    { label: "Functional",    value: design.functional.length },
    { label: "Quality gates", value: design.nonFunctional.length },
    { label: "Stack choices", value: design.techStack.length },
    { label: "APIs",          value: design.apis.length },
  ], [design]);

  const toast$ = useCallback((msg: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message: msg, type });
    const prev = toastTimerRef.current;
    if (prev) clearTimeout(prev);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  /* Real API auth — used by both AuthScreen and OnboardingScreen */
  const handleAuth = useCallback(async (mode: "signup" | "login", fields: { name?: string; email: string; password: string }) => {
    try {
      const res = await fetch(apiUrl(`/api/auth/${mode}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { toast$(data.error || "Authentication failed.", "error"); return false; }
      saveToken(data.token);
      setUser(data.user);
      const designs = await fetchDesigns();
      setHistory(designs);
      setScreen(designs.length > 0 ? "dashboard" : "workspace");
      toast$(`Welcome${data.user.name ? ", " + data.user.name.split(" ")[0] : ""}!`, "success");
      return true;
    } catch {
      toast$("Network error. Please try again.", "error");
      return false;
    }
  }, [toast$]);

  const handleLogout = useCallback(async () => {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", headers: authHeader() }).catch(() => {});
    clearToken();
    setUser(null);
    setHistory([]);
    setScreen("landing");
  }, []);

  const handleSignupSubmit = useCallback(async () => {
    if (!signup.name.trim() || !signup.email.trim() || !signup.password.trim()) {
      toast$("Fill in all fields to continue.", "error"); return;
    }
    await handleAuth("signup", { name: signup.name.trim(), email: signup.email.trim(), password: signup.password });
  }, [signup, handleAuth, toast$]);

  const handleReset = useCallback(() => {
    setForm(INITIAL_FORM);
    setRecordId("");
    setDesign(createFallbackDesign("Architecture workspace for a new product idea.", INITIAL_FORM.constraints));
    setScreen(user ? "dashboard" : "landing");
  }, [user]);

  const handleDeleteDesign = useCallback(async (id: string) => {
    try {
      await fetch(apiUrl(`/api/designs/${id}`), { method: "DELETE", headers: authHeader() });
      setHistory((h) => h.filter((e) => e.id !== id));
    } catch {
      /* silent */
    }
  }, []);

  const handleNewDesign = useCallback((presetIdea = "") => {
    if (presetIdea) {
      setForm({ ...INITIAL_FORM, prompt: presetIdea });
      setScreen("workspace");
    } else {
      setScreen("newdesign");
    }
  }, []);

  const handleNewDesignStart = useCallback(
    ({ prompt, constraints, meta }: { prompt: string; constraints: Record<string, string>; meta?: { domain?: string; pattern?: string; scale?: string } }) => {
    setForm({ prompt, constraints: { ...INITIAL_FORM.constraints, ...constraints } });
    setDesignMeta(meta || null);
    setScreen("workspace");
  },
  [],
);

  const handleOpenHistory = useCallback((entry: DesignHistoryEntry) => {
    setDesign(entry.design);
    setForm(f => ({ ...f, prompt: entry.idea }));
    setScreen("workspace");
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!form.prompt.trim()) { toast$("Add a product idea first.", "error"); return; }
    setLoading(true); setShowExportMenu(false);
    try {
      const res = await fetch(apiUrl("/api/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(form),
      });
      const payload = (await res.json()) as {
        error?: string;
        code?: string;
        data?: NormalizedDesign;
        recordId?: string;
        usedFallback?: boolean;
        fallbackReason?: string;
      };
      if (res.status === 401 && payload.code === "AUTH_REQUIRED") {
        toast$("Sign in to generate designs.", "info");
        setScreen("auth");
        return;
      }
      if (res.status === 429) {
        throw new Error(payload.error || "Too many requests.");
      }
      if (!res.ok) throw new Error(payload.error || "Generation failed.");
      setDesign(payload.data!);
      setRecordId(payload.recordId || "");
      if (payload.usedFallback) {
        toast$(
          "We could not use the AI for this run (check your API key or try again). A template design was returned instead.",
          "info",
        );
      } else {
        toast$("Architecture generated.", "success");
      }
      /* Refresh history from DB if authenticated, else skip */
      if (loadToken()) {
        const designs = await fetchDesigns();
        setHistory(designs);
      }
    } catch (e) {
      toast$(e instanceof Error ? e.message : "Generation failed.", "error");
    }
    finally { setLoading(false); }
  }, [form, toast$]);

  const exportFile = useCallback(async (format: ExportFormat) => {
    if (!hasDesign) { toast$("Generate a design first.", "error"); return; }
    setExporting(format); setShowExportMenu(false);
    if (format === "md") {
      try { downloadBlob(new Blob([generateMarkdown(design)], { type: "text/markdown;charset=utf-8" }), "system-design.md"); toast$("Markdown exported.", "success"); }
      finally { setExporting(""); }
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ format, data: design, recordId }),
      });
      if (!res.ok) {
        const p = (await res.json()) as { error?: string; code?: string };
        if (res.status === 401 && p.code === "AUTH_REQUIRED") {
          toast$("Sign in to export PDF or Word.", "info");
          setScreen("auth");
          return;
        }
        throw new Error(p.error || "Export failed.");
      }
      downloadBlob(await res.blob(), format === "pdf" ? "system-design.pdf" : "system-design.docx");
      toast$(`${format.toUpperCase()} exported.`, "success");
    } catch (e) {
      toast$(e instanceof Error ? e.message : "Export failed.", "error");
    }
    finally { setExporting(""); }
  }, [design, hasDesign, recordId, toast$]);

  return (
    <ErrorBoundary>
      <Toast toast={toast} />
      {screen === "workspace" ? (
        <WorkspaceScreen
          form={form} design={design} loading={loading} exporting={exporting}
          hasDesign={hasDesign} showInsights={showInsights} showExportMenu={showExportMenu} metrics={metrics} user={user} designMeta={designMeta}
          requireAuthForAi={publicConfig.requireAuthForAi}
          onPromptChange={(v) => setForm((c) => ({ ...c, prompt: v }))}
          onConstraintChange={(k, v) => setForm((c) => ({ ...c, constraints: { ...c.constraints, [k]: v } }))}
          onGenerate={handleGenerate} onReset={handleReset} onExport={exportFile}
          onToggleInsights={() => setShowInsights((v) => !v)}
          onToggleExportMenu={() => setShowExportMenu((v) => !v)}
          onCloseMenus={() => { setShowInsights(false); setShowExportMenu(false); }}
          onGoHome={() => setScreen(user ? "dashboard" : "landing")}
          onNewDesign={() => setScreen("newdesign")}
          onRequestSignIn={() => setScreen("auth")}
        />
      ) : screen === "newdesign" ? (
        <NewDesignScreen
          onStart={handleNewDesignStart}
          onBack={() => setScreen(user ? "dashboard" : "landing")}
        />
      ) : screen === "dashboard" ? (
        user ? (
          <DashboardScreen
            user={user}
            history={history}
            onNewDesign={handleNewDesign}
            onOpenHistory={handleOpenHistory}
            onLogout={handleLogout}
            onDeleteDesign={handleDeleteDesign}
          />
        ) : null
      ) : screen === "auth" ? (
        <AuthScreen
          onAuth={handleAuth}
          onBack={() => setScreen("landing")}
          initialMode="login"
          onForgotPassword={() => setScreen("forgot-password")}
        />
      ) : screen === "forgot-password" ? (
        <ForgotPasswordScreen
          onBack={() => setScreen("auth")}
          onContinueWithCode={(c) => {
            setResetPasswordCode(c);
            setScreen("reset-password");
          }}
        />
      ) : screen === "reset-password" ? (
        <ResetPasswordScreen
          code={resetPasswordCode}
          onCodeChange={setResetPasswordCode}
          onBack={() => {
            setResetPasswordCode("");
            setScreen("auth");
          }}
          onDone={() => {
            clearToken();
            setUser(null);
            setHistory([]);
            setResetPasswordCode("");
            setScreen("auth");
            toast$("Password updated. Sign in with your new password.", "success");
          }}
        />
      ) : screen === "onboarding" ? (
        <OnboardingScreen
          form={form} signup={signup}
          onPromptChange={(v) => setForm((c) => ({ ...c, prompt: v }))}
          onConstraintChange={(k, v) => setForm((c) => ({ ...c, constraints: { ...c.constraints, [k]: v } }))}
          onSignupChange={(k, v) => setSignup((c) => ({ ...c, [k]: v }))}
          onSubmit={handleSignupSubmit}
          onBack={() => setScreen("landing")}
        />
      ) : (
        <LandingScreen
          onGetStarted={() => setScreen("onboarding")}
          onSignIn={() => setScreen("auth")}
        />
      )}
    </ErrorBoundary>
  );
}
