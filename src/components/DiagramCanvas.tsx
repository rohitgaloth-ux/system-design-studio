import { memo, useDeferredValue, useMemo, useState } from "react";
import type { DiagramEdge, DiagramNode, DiagramRole, NormalizedDesign } from "../types/design";
const VB = { w: 1520, h: 980 };
const NODE = { w: 196, h: 130 };
const PAD = 80;
const GAP = 38;
const BOARD_W = VB.w - PAD * 2;
const ROW = { edge: 96, queue: 316, services: 516, data: 770 };
const ENTRY_W = Math.floor(BOARD_W * 0.54);
const CLOUD_X = PAD + Math.floor(BOARD_W * 0.68);
const CLOUD_W = Math.floor(BOARD_W * 0.32);
type RoleStyle = {
    badge: string;
    accent: string;
    bg: string;
    border: string;
    icon: string;
};
const ROLE: Record<DiagramRole, RoleStyle> = {
    client: { badge: "CLIENT", accent: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "user" },
    balancer: { badge: "ENTRY", accent: "#0f766e", bg: "#f0fdf4", border: "#86efac", icon: "gateway" },
    queue: { badge: "QUEUE", accent: "#b45309", bg: "#fefce8", border: "#fde68a", icon: "queue" },
    service: { badge: "SERVICE", accent: "#0369a1", bg: "#f0f9ff", border: "#bae6fd", icon: "service" },
    worker: { badge: "WORKER", accent: "#c2410c", bg: "#fff7ed", border: "#fed7aa", icon: "worker" },
    database: { badge: "DATA", accent: "#6d28d9", bg: "#faf5ff", border: "#ddd6fe", icon: "db" },
    cache: { badge: "CACHE", accent: "#0f766e", bg: "#f0fdfa", border: "#99f6e4", icon: "cache" },
    cloud: { badge: "CLOUD", accent: "#7c3aed", bg: "#fdf4ff", border: "#e9d5ff", icon: "cloud" },
};
type LayoutNode = DiagramNode & {
    x: number;
    y: number;
};
function distributeRow(nodes: DiagramNode[], regionLeft: number, regionWidth: number, y: number): LayoutNode[] {
    if (!nodes.length)
        return [];
    const total = nodes.length * NODE.w + (nodes.length - 1) * GAP;
    const startX = Math.round(regionLeft + Math.max(0, (regionWidth - total) / 2));
    return nodes.map((n, i) => ({ ...n, x: startX + i * (NODE.w + GAP), y }));
}
function buildLayout(nodes: DiagramNode[]): LayoutNode[] {
    const seen = new Map<string, DiagramNode>();
    nodes.forEach((n, i) => seen.set(n.id || `n${i}`, { ...n, id: n.id || `n${i}` }));
    const list = [...seen.values()].slice(0, 10);
    const entry = list.filter((n) => n.role === "client" || n.role === "balancer");
    const queue = list.filter((n) => n.role === "queue");
    const service = list.filter((n) => n.role === "service" || n.role === "worker");
    const data = list.filter((n) => n.role === "database" || n.role === "cache");
    const cloud = list.filter((n) => n.role === "cloud");
    const rest = list.filter((n) => ![...entry, ...queue, ...service, ...data, ...cloud].includes(n));
    return [
        ...distributeRow(entry.slice(0, 3), PAD, ENTRY_W, ROW.edge),
        ...distributeRow(cloud.slice(0, 2), CLOUD_X, CLOUD_W, ROW.edge),
        ...distributeRow(queue.slice(0, 2), PAD + Math.floor(BOARD_W * 0.22), Math.floor(BOARD_W * 0.56), ROW.queue),
        ...distributeRow(service.concat(rest).slice(0, 4), PAD, BOARD_W, ROW.services),
        ...distributeRow(data.slice(0, 3), PAD, BOARD_W, ROW.data),
    ];
}
function wrap(text: string | undefined, maxCh: number, maxLines: number): string[] {
    const words = String(text || "")
        .split(/\s+/)
        .filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > maxCh) {
            if (cur)
                lines.push(cur);
            cur = w;
        }
        else
            cur = next;
    }
    if (cur)
        lines.push(cur);
    return lines.slice(0, maxLines);
}
function anchor(n: LayoutNode, side: "top" | "bottom" | "left" | "right") {
    const cx = n.x + NODE.w / 2, cy = n.y + NODE.h / 2;
    if (side === "top")
        return { x: cx, y: n.y };
    if (side === "bottom")
        return { x: cx, y: n.y + NODE.h };
    if (side === "left")
        return { x: n.x, y: cy };
    return { x: n.x + NODE.w, y: cy };
}
function bestAnchors(src: LayoutNode, tgt: LayoutNode) {
    if (src.y < tgt.y - 24)
        return [anchor(src, "bottom"), anchor(tgt, "top")] as const;
    if (src.x < tgt.x)
        return [anchor(src, "right"), anchor(tgt, "left")] as const;
    return [anchor(src, "left"), anchor(tgt, "right")] as const;
}
function makePath(src: LayoutNode, tgt: LayoutNode) {
    const [s, e] = bestAnchors(src, tgt);
    const dx = e.x - s.x, dy = e.y - s.y;
    if (Math.abs(dy) > Math.abs(dx) * 0.36) {
        const my = s.y + dy * 0.5;
        return `M${s.x} ${s.y} L${s.x} ${my} L${e.x} ${my} L${e.x} ${e.y}`;
    }
    const mx = s.x + dx * 0.5;
    return `M${s.x} ${s.y} L${mx} ${s.y} L${mx} ${e.y} L${e.x} ${e.y}`;
}
function RoleIcon({ role, x, y }: {
    role: DiagramRole | string;
    x: number;
    y: number;
}) {
    const r = ROLE[role as DiagramRole] ?? ROLE.service;
    const c = r.accent;
    const s = 14;
    if (role === "database") {
        const cx = x + s / 2, ry = 3;
        return (<g>
        <ellipse cx={cx} cy={y + ry} rx={s / 2} ry={ry} fill="none" stroke={c} strokeWidth="1.4"/>
        <line x1={x} y1={y + ry} x2={x} y2={y + s - ry} stroke={c} strokeWidth="1.4"/>
        <line x1={x + s} y1={y + ry} x2={x + s} y2={y + s - ry} stroke={c} strokeWidth="1.4"/>
        <ellipse cx={cx} cy={y + s - ry} rx={s / 2} ry={ry} fill="none" stroke={c} strokeWidth="1.4"/>
      </g>);
    }
    if (role === "cloud") {
        return (<path d={`M ${x + 2} ${y + s - 3} c0-4 2-7 6-7 1-3 4-5 7-4 2-2 6-1 7 2 4 0 7 3 7 7 0 4-3 5-7 5 h-13 c-4 0-7-1-7-3 z`} fill="none" stroke={c} strokeWidth="1.4"/>);
    }
    if (role === "queue") {
        return (<g>
        {[0, 4, 8].map((oy) => (<line key={oy} x1={x} y1={y + 2 + oy} x2={x + s} y2={y + 2 + oy} stroke={c} strokeWidth="1.4" strokeLinecap="round"/>))}
      </g>);
    }
    if (role === "balancer" || role === "gateway") {
        return <path d={`M${x + s / 2} ${y} L${x + s} ${y + s / 2} L${x + s / 2} ${y + s} L${x} ${y + s / 2} Z`} fill="none" stroke={c} strokeWidth="1.4"/>;
    }
    if (role === "client") {
        const cx = x + s / 2;
        return (<g>
        <circle cx={cx} cy={y + 4} r="3.5" fill="none" stroke={c} strokeWidth="1.4"/>
        <path d={`M${x} ${y + s} c0-4 ${s}-4 ${s} 0`} fill="none" stroke={c} strokeWidth="1.4"/>
      </g>);
    }
    return <rect x={x + 1} y={y + 1} width={s - 2} height={s - 2} rx="3" fill="none" stroke={c} strokeWidth="1.4"/>;
}
const DiagramNode = memo(function DiagramNodeInner({ node }: {
    node: LayoutNode;
}) {
    const r = ROLE[node.role] || ROLE.service;
    const { w, h } = NODE;
    const { x, y } = node;
    const titleLines = wrap(node.label, 15, 2);
    const descLines = wrap(node.description, 26, 2);
    const clipId = `cl-${node.id}`;
    const TX = x + 14;
    return (<g style={{ cursor: "default" }} onMouseEnter={(e) => {
            e.currentTarget.querySelector("rect.shell")?.setAttribute("filter", "url(#node-shadow)");
        }} onMouseLeave={(e) => {
            e.currentTarget.querySelector("rect.shell")?.removeAttribute("filter");
        }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w} height={h}/>
        </clipPath>
      </defs>

      <rect className="shell" x={x} y={y} width={w} height={h} rx="14" fill={r.bg} stroke={r.border} strokeWidth="1.6"/>

      <rect x={x} y={y + 12} width="3.5" height={h - 24} rx="2" fill={r.accent} opacity="0.7"/>

      <RoleIcon role={node.role} x={x + w - 26} y={y + 13}/>

      <g clipPath={`url(#${clipId})`}>
        <text x={TX} y={y + 22} fontSize="8" fontWeight="800" letterSpacing="0.14em" fill={r.accent}>
          {r.badge}
        </text>

        {titleLines.map((ln, i) => (<text key={i} x={TX} y={y + 38 + i * 16} fontSize="12.5" fontWeight="700" fill="#0f172a">
            {ln}
          </text>))}

        {descLines.map((ln, i) => (<text key={i} x={TX} y={y + 38 + titleLines.length * 16 + 10 + i * 13} fontSize="10" fill="#64748b">
            {ln}
          </text>))}
      </g>
    </g>);
});
type RoutedEdge = DiagramEdge & {
    source: LayoutNode;
    target: LayoutNode;
};
const DiagramEdgeC = memo(function DiagramEdgeInner({ edge, source, target, index, }: {
    edge: RoutedEdge;
    source: LayoutNode;
    target: LayoutNode;
    index: number;
}) {
    const path = makePath(source, target);
    const mx = (source.x + target.x + NODE.w) / 2;
    const my = (source.y + target.y + NODE.h) / 2;
    const lx = mx + ((index % 5) - 2) * 8;
    const ly = my + (index % 2 === 0 ? -14 : 18);
    const color = /queue|async|event/i.test(edge.label) ? "#f97316" : /cache|read/i.test(edge.label) ? "#3b82f6" : "#94a3b8";
    const lbl = edge.label?.length > 10 ? edge.label.slice(0, 9) + "…" : edge.label;
    return (<g className="pointer-events-none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#arr)"/>
      {lbl && (<>
          <rect x={lx - 30} y={ly - 9} width="60" height="18" rx="9" fill="white" stroke="#e2e8f0" strokeWidth="0.8"/>
          <text x={lx} y={ly + 4.5} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#64748b">
            {lbl}
          </text>
        </>)}
    </g>);
});
type Props = {
    design: NormalizedDesign;
    loading: boolean;
    onGenerate: () => void;
};
function DiagramCanvasComponent({ design, loading, onGenerate }: Props) {
    const [zoom, setZoom] = useState(0.78);
    const diagram = useDeferredValue(design.architecture.diagram);
    const layout = useMemo(() => buildLayout(diagram?.nodes || []), [diagram]);
    const nodeMap = useMemo(() => new Map(layout.map((n) => [n.id, n])), [layout]);
    const edges = useMemo(() => {
        return (diagram?.edges || [])
            .map((e) => ({ ...e, source: nodeMap.get(e.from), target: nodeMap.get(e.to) }))
            .filter((e): e is RoutedEdge => Boolean(e.source && e.target));
    }, [diagram, nodeMap]);
    return (<div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Architecture Board</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-gray-800">{design.idea}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => setZoom((v) => Math.max(0.5, +(v - 0.08).toFixed(2)))} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100">
            − Zoom
          </button>
          <span className="text-xs font-medium text-gray-400">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((v) => Math.min(1.2, +(v + 0.08).toFixed(2)))} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-100">
            + Zoom
          </button>
          <div className="mx-1 h-4 w-px bg-gray-200"/>
          <button type="button" onClick={onGenerate} disabled={loading} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
            {loading ? "Generating…" : "Regenerate"}
          </button>
        </div>
      </div>

      <div className="scroll-surface flex-1 overflow-auto p-4" style={{ background: "#f8fafc" }}>
        <div style={{ display: "inline-block", borderRadius: 20, border: "1px solid #e2e8f0", background: "white", padding: 16, boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}>
          <svg viewBox={`0 0 ${VB.w} ${VB.h}`} width={Math.round(VB.w * zoom)} height={Math.round(VB.h * zoom)} style={{ display: "block" }}>
            <defs>
              <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 1.5L7 4L0 6.5z" fill="#94a3b8"/>
              </marker>
              <filter id="node-shadow" x="-8%" y="-8%" width="116%" height="116%">
                <feDropShadow dx="0" dy="4" stdDeviation="8" floodOpacity="0.1"/>
              </filter>
              <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.1" fill="#e2e8f0"/>
              </pattern>
            </defs>

            <rect x="44" y="36" width={VB.w - 88} height={VB.h - 72} rx="24" fill="url(#dots)" stroke="#e9eef6" strokeWidth="1"/>

            <rect x="64" y={ROW.services - 24} width={VB.w - 128} height={NODE.h + 48} rx="16" fill="#eff6ff" stroke="#dbeafe" strokeWidth="1" strokeDasharray="5 4"/>

            {([
            [96, ROW.edge - 18, "INPUT + EDGE"],
            [96, ROW.services - 40, "APPLICATION SERVICES"],
            [96, ROW.data - 22, "DATA + INFRA"],
        ] as const).map(([lx, ly, label]) => (<text key={label} x={lx} y={ly} fontSize="9.5" fontWeight="700" fill="#94a3b8" letterSpacing="0.16em">
                {label}
              </text>))}

            {edges.map((e, i) => (<DiagramEdgeC key={`${e.from}-${e.to}-${i}`} edge={e} source={e.source} target={e.target} index={i}/>))}

            {layout.map((n) => (<DiagramNode key={n.id} node={n}/>))}
          </svg>
        </div>
      </div>
    </div>);
}
export default memo(DiagramCanvasComponent);
