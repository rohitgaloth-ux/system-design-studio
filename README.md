# System Design Studio

Describe a product idea plus **constraints** (scale, latency, budget, region, security, custom notes). The app calls **`/api/generate`** to produce a **normalized design**: functional and non-functional requirements, architecture (summary, flow, components, decisions, risks), an **interactive diagram** (nodes and edges by role), **tech stack** with rationale, **API specs**, and **deep analysis** (trade-offs, failure modes, observability, data consistency).

Designs can be **saved** per user in **PostgreSQL**, **reopened**, and **exported** as **PDF**, **Word (.docx)**, or **Markdown** (with **Mermaid**). Optional **Google Gemini** powers generation; without it, the server returns a **structured fallback** template.

**Stack:** **React 19**, **TypeScript**, **Tailwind CSS v4**, **Vite 7** frontend; **Node** HTTP API; **PostgreSQL**; **JWT** auth, sign up / sign in, password reset (email when configured).

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

Copy **`.env.example`** → **`.env`**. Required for real use: **`DATABASE_URL`**, **`JWT_SECRET`** (production). Optional: **`GEMINI_API_KEY`**, email/SMTP for password reset, **`ALLOWED_ORIGIN`** / **`APP_PUBLIC_URL`** for production CORS and links.

## Deploy (short)

- **All-in-one:** [Render](https://render.com/) — see **`render.yaml`**; set `DATABASE_URL`, `GEMINI_API_KEY`, etc. in the dashboard.
- **Static UI on GitHub Pages + API elsewhere:** set Actions secret **`BACKEND_URL`** to your API origin; workflow **`.github/workflows/deploy-github-pages.yml`**. API must set **`ALLOWED_ORIGIN`** to your Pages site origin (e.g. `https://<user>.github.io`).
- **Docker:** `docker build -t system-design-studio .` — pass `DATABASE_URL`, `JWT_SECRET`, `PORT`, `GEMINI_API_KEY`, `NODE_ENV=production` (see **Dockerfile**).
- **Fly.io:** **`fly.toml`**, **`scripts/deploy-fly.sh`**; set secrets with `fly secrets set` (no API keys in git).

## Licence

MIT
