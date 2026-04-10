import type { ApiSpec, Architecture, DesignConstraints, Diagram, DiagramEdge, DiagramNode, DeepAnalysis, DiagramRole, NormalizedDesign, RawArchitectureInput, RawDesignInput, RawDiagramEdge, RawDiagramNode, TechStackItem, } from "../types/design";
const DEFAULT_IDEA = "No idea generated yet.";
const DIAGRAM_ROLES = new Set<DiagramRole>([
    "client",
    "balancer",
    "queue",
    "service",
    "worker",
    "database",
    "cache",
    "cloud",
]);
function normalizeText(value: unknown, fallback = ""): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
    return Array.isArray(value)
        ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
        : fallback;
}
function normalizeObjectList<T>(value: unknown, mapper: (item: unknown, index: number) => T | null): T[] {
    return Array.isArray(value) ? value.map(mapper).filter((x): x is T => Boolean(x)) : [];
}
function inferRole(...parts: (string | undefined)[]): DiagramRole {
    const value = parts.filter(Boolean).join(" ").toLowerCase();
    if (/\b(client|web|mobile|frontend|ui|dashboard|portal|browser)\b/.test(value))
        return "client";
    if (/\b(load balancer|balancer|gateway|api gateway|ingress|edge|proxy)\b/.test(value))
        return "balancer";
    if (/\b(queue|kafka|rabbitmq|pubsub|stream|event bus|broker)\b/.test(value))
        return "queue";
    if (/\b(worker|consumer|processor|runner|job)\b/.test(value))
        return "worker";
    if (/\b(database|postgres|mysql|cockroach|mongo|dynamo|storage|warehouse)\b/.test(value))
        return "database";
    if (/\b(cache|redis|memcached)\b/.test(value))
        return "cache";
    if (/\b(cloud|cdn|ai|llm|provider|s3|object storage|blob)\b/.test(value))
        return "cloud";
    return "service";
}
function normalizeDiagramNode(item: RawDiagramNode | undefined, index: number): DiagramNode {
    const label = normalizeText(item?.label || item?.name, `Component ${index + 1}`);
    const description = normalizeText(item?.description, "Architecture component");
    const inferredRole = inferRole(item?.role, label, description);
    const rawRole = item?.role;
    const role: DiagramRole = typeof rawRole === "string" && DIAGRAM_ROLES.has(rawRole as DiagramRole)
        ? (rawRole as DiagramRole)
        : inferredRole;
    return {
        id: normalizeText(item?.id, `node-${index + 1}`),
        label,
        description,
        role,
    };
}
function normalizeDiagramEdge(item: RawDiagramEdge | undefined): DiagramEdge | null {
    const from = normalizeText(item?.from);
    const to = normalizeText(item?.to);
    const label = normalizeText(item?.label, "flow");
    if (!from || !to)
        return null;
    return { from, to, label };
}
function synthesizeDiagram(summary: string, components: string[] = []): Diagram {
    const normalizedComponents = normalizeStringList(components);
    const baseNodes: DiagramNode[] = normalizedComponents.slice(0, 8).map((component, index) => ({
        id: `component-${index + 1}`,
        label: component,
        description: component,
        role: inferRole(component, summary),
    }));
    const nodes: DiagramNode[] = baseNodes.length
        ? baseNodes
        : [
            { id: "client", label: "Client App", description: "Idea intake and result review", role: "client" },
            { id: "gateway", label: "API Gateway", description: "Request validation and routing", role: "balancer" },
            { id: "planner", label: "Planner Service", description: summary, role: "service" },
            { id: "jobs", label: "Worker Queue", description: "Background generation and export work", role: "queue" },
            { id: "worker", label: "AI Worker", description: "Turns prompts into structured output", role: "worker" },
            { id: "store", label: "Design Store", description: "Persists generated architecture records", role: "database" },
        ];
    const hasClient = nodes.some((node) => node.role === "client");
    const hasBalancer = nodes.some((node) => node.role === "balancer");
    const hasDatabase = nodes.some((node) => node.role === "database");
    const hasQueue = nodes.some((node) => node.role === "queue");
    if (!hasClient) {
        nodes.unshift({ id: "client", label: "Client App", description: "User-facing experience", role: "client" });
    }
    if (!hasBalancer) {
        nodes.splice(1, 0, {
            id: "gateway",
            label: "API Gateway",
            description: "Request validation and routing",
            role: "balancer",
        });
    }
    if (!hasQueue) {
        nodes.push({
            id: "jobs",
            label: "Worker Queue",
            description: "Async processing and task orchestration",
            role: "queue",
        });
    }
    if (!hasDatabase) {
        nodes.push({
            id: "store",
            label: "Primary Database",
            description: "Persistent system record storage",
            role: "database",
        });
    }
    const edges: DiagramEdge[] = [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
        edges.push({
            from: nodes[index].id,
            to: nodes[index + 1].id,
            label: index === 0 ? "request" : "flow",
        });
    }
    return { nodes, edges };
}
function normalizeDiagram(rawDiagram: RawDesignInput["diagram"] | undefined, summary: string, components: string[]): Diagram {
    const nodes = normalizeObjectList(rawDiagram?.nodes, (item, index) => normalizeDiagramNode(item as RawDiagramNode | undefined, index));
    const edges = normalizeObjectList(rawDiagram?.edges, (item) => normalizeDiagramEdge(item as RawDiagramEdge | undefined));
    if (!nodes.length) {
        return synthesizeDiagram(summary, components);
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    const filteredEdges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    return {
        nodes,
        edges: filteredEdges.length
            ? filteredEdges
            : nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id, label: "flow" })),
    };
}
function normalizeTechStackEntry(item: unknown): TechStackItem | null {
    const o = item as {
        layer?: string;
        name?: string;
        reason?: string;
    };
    const layer = normalizeText(o?.layer, "Application");
    const name = normalizeText(o?.name);
    const reason = normalizeText(o?.reason, "Supports the target architecture.");
    if (!name)
        return null;
    return { layer, name, reason };
}
const EMPTY_DEEP_ANALYSIS: DeepAnalysis = {
    tradeoffs: [],
    failureModes: [],
    observability: [],
    dataConsistency: [],
};
function normalizeDeepAnalysis(raw: unknown): DeepAnalysis {
    const o = raw as DeepAnalysis | undefined;
    if (!o || typeof o !== "object")
        return { ...EMPTY_DEEP_ANALYSIS };
    return {
        tradeoffs: normalizeStringList(o.tradeoffs),
        failureModes: normalizeStringList(o.failureModes),
        observability: normalizeStringList(o.observability),
        dataConsistency: normalizeStringList(o.dataConsistency),
    };
}
function normalizeApiEntry(item: unknown): ApiSpec | null {
    if (typeof item === "string" && item.trim()) {
        return {
            name: item.trim(),
            method: "GET",
            path: "/",
            purpose: "API endpoint included in the generated design.",
        };
    }
    const o = item as {
        name?: string;
        method?: string;
        path?: string;
        purpose?: string;
    };
    const name = normalizeText(o?.name);
    const method = normalizeText(o?.method, "GET").toUpperCase();
    const path = normalizeText(o?.path, "/");
    const purpose = normalizeText(o?.purpose, "API endpoint included in the generated design.");
    if (!name)
        return null;
    return { name, method, path, purpose };
}
function normalizeArchitecture(rawArchitecture: RawArchitectureInput | undefined, raw: RawDesignInput): Architecture {
    const summary = normalizeText(rawArchitecture?.summary, normalizeText(raw.workingIdea, normalizeText(raw.idea, DEFAULT_IDEA)));
    const flow = normalizeStringList(rawArchitecture?.flow, normalizeStringList(raw.howItWorks));
    const components = normalizeStringList(rawArchitecture?.components, normalizeStringList(raw.coreComponents));
    const decisions = normalizeStringList(rawArchitecture?.decisions, normalizeStringList(raw.simplify));
    const risks = normalizeStringList(rawArchitecture?.risks, normalizeStringList(raw.risks));
    const fallbackDiagram = normalizeDiagram(rawArchitecture?.diagram || raw.diagram, summary, components);
    return {
        summary,
        flow: flow.length ? flow : ["Capture requirements and model the first release around a clean API boundary."],
        components: components.length ? components : ["API layer", "Application services", "Persistence layer", "External integrations"],
        decisions: decisions.length ? decisions : ["Start with a modular deployment and scale hotspots after measuring usage."],
        risks: risks.length ? risks : ["Low-quality prompts can produce over-engineered architecture decisions."],
        diagram: fallbackDiagram,
    };
}
export function createFallbackDesign(prompt = "", constraints: DesignConstraints = {}): NormalizedDesign {
    const idea = normalizeText(prompt, "Architecture workspace for a SaaS platform.");
    const scale = normalizeText(constraints.scale, "100k monthly users");
    const latency = normalizeText(constraints.latency, "sub-second interactions");
    const region = normalizeText(constraints.region, "one primary region with global CDN");
    const budget = normalizeText(constraints.budget, "balanced operating cost");
    const security = normalizeText(constraints.security, "RBAC, audit logs, and secure APIs");
    const custom = normalizeText(constraints.customRequirements);
    return normalizeDesign({
        idea,
        functional: [
            "Capture product intent and platform constraints from one structured input flow.",
            "Generate an architecture outline, component map, and implementation-ready APIs.",
            "Support export to markdown, PDF, and Word after a design is available.",
        ],
        nonFunctional: [
            `Design for ${scale}.`,
            `Optimize for ${latency}.`,
            `Plan for ${region}.`,
            `Respect ${budget}.`,
            security,
        ],
        architecture: {
            summary: `A production-oriented SaaS planning workspace for ${idea}.`,
            flow: [
                "The web client submits the prompt and constraints to a generation API.",
                "The API validates the payload and calls the AI orchestration layer for structured output.",
                "The service persists the generated record and returns normalized data to the UI.",
                "The UI renders architecture, stack, APIs, and insights without additional transformation.",
            ],
            components: [
                "Responsive React workspace with fixed input and insights panels.",
                "Generation API that validates, orchestrates AI calls, and normalizes the response.",
                "Storage layer for saved designs and export metadata.",
                "Export service that converts structured architecture into markdown, PDF, and Word files.",
            ],
            decisions: [
                "Keep the API contract narrow and deterministic so the frontend can render immediately.",
                "Persist the normalized design shape so exports and future edits reuse the same object.",
                "Separate diagram rendering from insight rendering to improve perceived load time.",
                custom || "Prioritize a premium engineering-product UX over adding extra workflow noise.",
            ],
            risks: [
                "Unstructured prompts can still produce vague architecture tradeoffs.",
                "Export jobs can be slow if document generation runs on large payloads without limits.",
                "Diagram density needs lane-based layout rules to prevent node overlap.",
            ],
        },
        techStack: [
            { layer: "Frontend", name: "React + Tailwind", reason: "Fast, interactive UI with reusable design system primitives." },
            { layer: "Backend", name: "Node.js API", reason: "Simple orchestration for AI generation and export services." },
            { layer: "Storage", name: "In-memory Store", reason: "Keeps generated records accessible during local development." },
            { layer: "AI", name: "Gemini", reason: "Returns structured JSON architecture output from one prompt." },
        ],
        apis: [
            {
                name: "Generate Design",
                method: "POST",
                path: "/api/generate",
                purpose: "Accept prompt and constraints, then return normalized architecture data.",
            },
            {
                name: "Export Design",
                method: "POST",
                path: "/api/export",
                purpose: "Convert structured design data into markdown, PDF, or DOCX downloads.",
            },
        ],
        deepAnalysis: {
            tradeoffs: [
                "Template mode trades rich scenario modeling for a predictable local preview when the AI is offline.",
                "Generic stack hints may not match your real compliance or cloud mandate until Gemini is enabled.",
                "Diagram roles are synthesized from labels — verify them before sharing externally.",
            ],
            failureModes: [
                "Missing GEMINI_API_KEY or quota exhaustion keeps you on this template until the server is configured.",
                "Invalid JSON from the model triggers the same fallback — check API health and prompts.",
                "Very long prompts are truncated server-side — extreme edge cases may lose constraint detail.",
            ],
            observability: [
                "Use GET /api/health to confirm database connectivity and whether an API key is configured.",
                "Server logs include structured events for password-reset lockouts and export failures.",
                "Client toasts indicate fallback vs live generation after each /api/generate call.",
            ],
            dataConsistency: [
                "Saved designs live in PostgreSQL per authenticated user; anonymous sessions only hold UI state.",
                "Exports use the in-memory payload you send — re-fetch from history if the record changed.",
                "JWT token versioning invalidates older sessions after password reset for safer consistency.",
            ],
        },
    });
}
export function normalizeDesign(raw: RawDesignInput = {}): NormalizedDesign {
    const idea = normalizeText(raw.idea, normalizeText(raw.workingIdea, DEFAULT_IDEA));
    const functional = normalizeStringList(raw.functional, normalizeStringList(raw.functionalRequirements));
    const nonFunctional = normalizeStringList(raw.nonFunctional, normalizeStringList(raw.nonFunctionalRequirements));
    const techStack = normalizeObjectList(raw.techStack || raw.stack, normalizeTechStackEntry);
    const apis = normalizeObjectList(raw.apis, normalizeApiEntry);
    const architecture = normalizeArchitecture(raw.architecture, raw);
    const deepAnalysis = normalizeDeepAnalysis(raw.deepAnalysis);
    return {
        id: normalizeText(raw.id),
        title: normalizeText(raw.title, "System Design Assistant"),
        idea,
        functional: functional.length ? functional : ["Define the first release scope and the core user journeys."],
        nonFunctional: nonFunctional.length ? nonFunctional : ["Maintain a predictable response time under expected load."],
        architecture,
        techStack: techStack.length
            ? techStack
            : [
                { layer: "Frontend", name: "React + Tailwind", reason: "Ships a polished SaaS workspace quickly." },
                { layer: "Backend", name: "Node.js API", reason: "Coordinates generation, storage, and export operations." },
            ],
        apis: apis.length
            ? apis
            : [{ name: "Generate Design", method: "POST", path: "/api/generate", purpose: "Create a structured system design." }],
        deepAnalysis,
        generatedAt: normalizeText(raw.generatedAt, new Date().toISOString()),
    };
}
export function hasMeaningfulDesign(raw: unknown): boolean {
    if (!raw || typeof raw !== "object")
        return false;
    const r = raw as RawDesignInput;
    return Boolean(normalizeText(r.idea) ||
        normalizeText(r.workingIdea) ||
        normalizeStringList(r.functional).length ||
        normalizeStringList(r.functionalRequirements).length ||
        normalizeStringList(r.nonFunctional).length ||
        normalizeStringList(r.nonFunctionalRequirements).length ||
        normalizeStringList(r.architecture?.flow).length ||
        normalizeStringList(r.howItWorks).length ||
        normalizeObjectList(r.techStack || r.stack, normalizeTechStackEntry).length ||
        normalizeObjectList(r.apis, normalizeApiEntry).length);
}
function formatBullets(items: string[], emptyCopy: string): string[] {
    return items.length ? items.map((item) => `- ${item}`) : [`- ${emptyCopy}`];
}
function buildMermaidDiagram(diagram: Diagram | undefined): string | null {
    if (!diagram?.nodes?.length)
        return null;
    const lines = ["```mermaid", "flowchart TD"];
    diagram.nodes.forEach((node) => {
        const label = (node.label || node.id).replace(/"/g, "'");
        const shape = node.role === "database"
            ? `[("${label}")]`
            : node.role === "cloud"
                ? `(["${label}"])`
                : node.role === "client"
                    ? `(["${label}"])`
                    : node.role === "queue"
                        ? `{{"${label}"}}`
                        : `["${label}"]`;
        lines.push(`  ${node.id}${shape}`);
    });
    (diagram.edges || []).forEach((edge) => {
        const label = edge.label ? ` -->|${edge.label}|` : ` -->`;
        lines.push(`  ${edge.from}${label} ${edge.to}`);
    });
    lines.push("```");
    return lines.join("\n");
}
export function generateMarkdown(raw: RawDesignInput = {}): string {
    const design = normalizeDesign(raw);
    const diagram = design.architecture.diagram;
    const mermaid = buildMermaidDiagram(diagram);
    const lines = [
        `# ${design.title}`,
        "",
        "## Idea",
        design.idea || DEFAULT_IDEA,
        "",
        "## Functional Requirements",
        ...formatBullets(design.functional, "No functional requirements available."),
        "",
        "## Non-Functional Requirements",
        ...formatBullets(design.nonFunctional, "No non-functional requirements available."),
        "",
        "## Architecture Summary",
        design.architecture.summary || "No architecture summary available.",
        "",
        "## Architecture Flow",
        ...formatBullets(design.architecture.flow, "No architecture flow available."),
        "",
        "## Architecture Components",
        ...(diagram?.nodes?.length
            ? diagram.nodes.map((n) => `- **${n.label}** *(${n.role})*: ${n.description}`)
            : ["- No components available."]),
        "",
        "## Component Connections",
        ...(diagram?.edges?.length
            ? diagram.edges.map((e) => {
                const src = diagram.nodes.find((n) => n.id === e.from)?.label || e.from;
                const tgt = diagram.nodes.find((n) => n.id === e.to)?.label || e.to;
                return `- ${src} → ${tgt}${e.label ? ` *(${e.label})*` : ""}`;
            })
            : ["- No connections available."]),
        "",
        ...(mermaid ? ["## Architecture Diagram", "", mermaid, ""] : []),
        "## Architecture Decisions",
        ...formatBullets(design.architecture.decisions, "No architecture decisions available."),
        "",
        "## Risks",
        ...formatBullets(design.architecture.risks, "No architecture risks available."),
        "",
        "## Deep analysis — trade-offs",
        ...formatBullets(design.deepAnalysis.tradeoffs, "No trade-off analysis available."),
        "",
        "## Deep analysis — failure modes",
        ...formatBullets(design.deepAnalysis.failureModes, "No failure-mode analysis available."),
        "",
        "## Deep analysis — observability",
        ...formatBullets(design.deepAnalysis.observability, "No observability notes available."),
        "",
        "## Deep analysis — data consistency",
        ...formatBullets(design.deepAnalysis.dataConsistency, "No consistency analysis available."),
        "",
        "## Tech Stack",
        ...(design.techStack.length
            ? design.techStack.map((item) => `- **${item.layer}**: ${item.name} — ${item.reason}`)
            : ["- No tech stack available."]),
        "",
        "## APIs",
        ...(design.apis.length
            ? design.apis.map((item) => `- \`${item.method} ${item.path}\` — **${item.name}**: ${item.purpose}`)
            : ["- No APIs available."]),
        "",
        `*Generated at: ${design.generatedAt}*`,
    ];
    const markdown = lines.join("\n").trim();
    return markdown || "# System Design Assistant\n\nNo content available.";
}
