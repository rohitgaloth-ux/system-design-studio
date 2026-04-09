# System Design Studio

Turn a product idea into structured system architecture — requirements, components, APIs, stack rationale, and an interactive diagram. **React + TypeScript** (Vite), **Node** API, **PostgreSQL**, optional **Gemini**; exports **PDF**, **Word**, and **Markdown** (with Mermaid).

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
