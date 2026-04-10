# System Design Studio

Full-stack workspace for **two** connected experiences, both backed by the same **Node** API, **PostgreSQL**, and optional **Google Gemini**:

### 1. Architecture generator (main product)

You describe a product idea plus **constraints** (scale, latency, budget, region, security, custom notes). The app calls **`/api/generate`** to produce a **normalized design** document:

- **Requirements** — functional and non-functional lists  
- **Architecture** — summary, end-to-end flow, core components, key decisions, risks  
- **Diagram** — interactive canvas: nodes (client, services, DB, cache, queues, etc.) and labeled edges  
- **Tech stack** — per-layer choices with **why** each fits  
- **API surface** — named endpoints with method, path, and purpose  
- **Deep analysis** — trade-offs, failure modes, observability, data-consistency notes  

Designs can be **saved** (per-user history in Postgres), **reopened**, and **exported** server-side as **PDF** (diagram included), **Word (.docx)**, or **Markdown** (with **Mermaid** for the diagram). Without Gemini, the server can still return a **structured fallback** template.

### 2. Job search copilot (same app, signed-in users)

A **job application tracker**: pipeline statuses (e.g. interested → applied → interview → offer/rejected), notes, optional job URLs, and timeline-style **updates**. The API also exposes **AI-assisted** flows when **`GEMINI_API_KEY`** is set: **resume tailoring** against a job description and a **resume–job match score** (rate-limited). Automation-related state is stored per application for workflow tooling (see UI: **Job tracker** / automation views).

**Frontend:** **React 19**, **TypeScript**, **Tailwind CSS v4**, **Vite 7**. **Auth:** sign up / sign in, JWT sessions, password reset (email code when mail is configured).

## Quick start

**Node 20+** and npm.

```bash
git clone https://github.com/rohitgaloth-ux/system-design-studio.git
cd system-design-studio
npm install
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, and optionally GEMINI_API_KEY — see .env.example
npm run build && npm start
```

App: **http://localhost:4173** (or `PORT`).

**Hot reload:** terminal 1 — `npm run dev`; terminal 2 — `npm start` (API + `dist`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server (proxies `/api` to backend) |
| `npm run build` | Production build → `dist/` |
| `npm start` | API + static `dist` |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests |

## Environment

Copy **`.env.example`** → **`.env`**. Required for real use: **`DATABASE_URL`**, **`JWT_SECRET`** (production). Optional: **`GEMINI_API_KEY`**, email/SMTP for password reset, **`ALLOWED_ORIGIN`** / **`APP_PUBLIC_URL`** for production CORS and links. Full table and behaviour are documented in `.env.example` comments where applicable.

## Deploy (short)

- **All-in-one:** [Render](https://render.com/) — see **`render.yaml`**; set `DATABASE_URL`, `GEMINI_API_KEY`, etc. in the dashboard.
- **Static UI on GitHub Pages + API elsewhere:** set Actions secret **`BACKEND_URL`** to your API origin; workflow **`.github/workflows/deploy-github-pages.yml`**. API must set **`ALLOWED_ORIGIN`** to your Pages site origin (e.g. `https://<user>.github.io`).
- **Docker:** `docker build -t system-design-studio .` — pass `DATABASE_URL`, `JWT_SECRET`, `PORT`, `GEMINI_API_KEY`, `NODE_ENV=production` (see **Dockerfile**).
- **Fly.io:** **`fly.toml`**, **`scripts/deploy-fly.sh`**; set secrets with `fly secrets set` (no API keys in git).

## Licence

MIT
