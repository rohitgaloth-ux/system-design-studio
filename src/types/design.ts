/** Roles used in architecture diagrams (AI may emit others; we normalize). */
export type DiagramRole =
  | "client"
  | "balancer"
  | "queue"
  | "service"
  | "worker"
  | "database"
  | "cache"
  | "cloud";

export interface DiagramNode {
  id: string;
  label: string;
  description: string;
  role: DiagramRole;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface Architecture {
  summary: string;
  flow: string[];
  components: string[];
  decisions: string[];
  risks: string[];
  diagram: Diagram;
}

export interface TechStackItem {
  layer: string;
  name: string;
  reason: string;
}

export interface ApiSpec {
  name: string;
  method: string;
  path: string;
  purpose: string;
}

export interface NormalizedDesign {
  id: string;
  title: string;
  idea: string;
  functional: string[];
  nonFunctional: string[];
  architecture: Architecture;
  techStack: TechStackItem[];
  apis: ApiSpec[];
  generatedAt: string;
}

/** Loose input shape from the UI or Gemini JSON before normalization. */
export interface RawDesignInput {
  id?: string;
  title?: string;
  idea?: string;
  workingIdea?: string;
  functional?: string[];
  functionalRequirements?: string[];
  nonFunctional?: string[];
  nonFunctionalRequirements?: string[];
  techStack?: unknown[];
  stack?: unknown[];
  apis?: unknown[];
  architecture?: RawArchitectureInput;
  generatedAt?: string;
  howItWorks?: string[];
  coreComponents?: string[];
  simplify?: string[];
  risks?: string[];
  diagram?: RawDiagramInput;
}

export interface RawArchitectureInput {
  summary?: string;
  flow?: string[];
  components?: string[];
  decisions?: string[];
  risks?: string[];
  diagram?: RawDiagramInput;
}

export interface RawDiagramInput {
  nodes?: RawDiagramNode[];
  edges?: RawDiagramEdge[];
}

export interface RawDiagramNode {
  id?: string;
  label?: string;
  name?: string;
  description?: string;
  role?: string;
}

export interface RawDiagramEdge {
  from?: string;
  to?: string;
  label?: string;
}

export interface DesignConstraints {
  scale?: string;
  latency?: string;
  region?: string;
  budget?: string;
  security?: string;
  customRequirements?: string;
}
