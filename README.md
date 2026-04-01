# System Design Studio

**Turn a product idea into a structured system architecture** — requirements, components, APIs, tech-stack rationale, and an interactive diagram — in one flow.

Full-stack app: **React + TypeScript** frontend, **Node.js** HTTP API, **SQLite** persistence, optional **Google Gemini** generation, exports to **PDF**, **Word**, and **Markdown** (with Mermaid).

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [API overview](#api-overview)
- [Docker](#docker)
- [GitHub Pages (free static UI)](#github-pages-free-static-ui)
- [Deploy (Render)](#deploy-render)
- [Deploy (Fly.io)](#deploy-flyio)
- [Security](#security)
- [Project structure](#project-structure)
- [Licence](#licence)

---

## Features

| Area | What you get |
|------|----------------|
| **AI generation** | Prompt + constraints → structured JSON via Gemini (or a local fallback template if the API is unavailable). |
| **Diagram** | SVG canvas with role-based styling and readable routing. |
| **Presets** | Domain, pattern, and scale templates to seed constraints. |
| **Export** | PDF (with drawn diagram), Word (.docx) with component tables, Markdown + Mermaid. |
| **Accounts** | Sign up / sign in, JWT sessions, password reset via **6-digit email code** (with dev fallback). |
| **History** | Last 20 saved designs per user in SQLite. |
| **Production hardening** | Auth-gated AI/export when configured, rate limits, optional `TRUST_PROXY` for real client IPs. |

---

## Tech stack

| Layer | Choices |
|-------|---------|
| UI | React 19, Tailwind CSS v4, Vite 7 |
| API | Node.js 20, native `http`, TypeScript (`tsx`) |
| Data | `better-sqlite3`, file DB under `data/` |
| Auth | `bcryptjs`, `jsonwebtoken`, token versioning for revocation |
| AI | Gemini (`GEMINI_API_KEY`, header-based key usage) |
| Docs | `pdfkit`, `docx`, Mermaid in Markdown |

---

## Architecture

```
Browser (Vite-built SPA)
    │  REST + JSON
    ▼
server.ts
    ├── /api/auth/*        signup, login, me, forgot/reset password
    ├── /api/public-config  feature flags for the UI
    ├── /api/health         DB + Gemini configuration probe
    ├── /api/generate       AI → normalised design (+ optional DB save)
    ├── /api/designs        list / delete saved designs
    └── /api/export         PDF | DOCX | Markdown
            │
            ├── SQLite (data/designs.db)
            └── Gemini API (optional)
```

---

## Quick start

**Requirements:** Node.js **20+**, npm.

```bash
git clone https://github.com/rohitgaloth-ux/system-design-studio.git
cd system-design-studio

npm install
cp .env.example .env
# Edit .env: set GEMINI_API_KEY and JWT_SECRET (see below)

npm run build
npm start
```

Open **http://localhost:4173** (or the port set in `PORT`).

### Development (hot reload)

Terminal 1 — Vite (proxies `/api` to the backend):

```bash
npm run dev
```

Terminal 2 — API + static `dist`:

```bash
npm start
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server with `/api` proxy to `localhost:4173` |
| `npm run build` | Production frontend build → `dist/` |
| `npm start` | Run `server.ts` (serves `dist/` + API) |
| `npm run typecheck` | TypeScript check (app + server) |
| `npm test` | Unit tests (`tests/**/*.test.ts`) |
| `npm run preview` | Preview the built Vite app only (no API) |

---

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | When | Description |
|----------|------|-------------|
| `GEMINI_API_KEY` | Recommended | Live AI generation ([Google AI Studio](https://aistudio.google.com/app/apikey)). |
| `GEMINI_MODEL` | Optional | Default `gemini-2.5-flash`. |
| `JWT_SECRET` | **Required in production** | Long random secret. Example: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | Optional | Listen port (default `4173`). |
| `NODE_ENV` | Optional | `production` enables stricter defaults (e.g. bcrypt cost, JWT enforcement). |
| `REQUIRE_AUTH_GENERATE` | Optional | Set to `1` to require login for `/api/generate` and `/api/export` in dev (same as production behaviour). |
| `TRUST_PROXY` | Behind reverse proxy | Set to `1` so rate limits use `X-Forwarded-For` safely. |
| `ALLOWED_ORIGIN` | Production CORS | Exact origin, e.g. `https://your-domain.com`. On Render alone, `RENDER_EXTERNAL_URL` is used if this is unset. |
| `APP_PUBLIC_URL` | Password reset emails | Public site URL (no trailing slash). Falls back to `RENDER_EXTERNAL_URL` on Render. |
| `RENDER_EXTERNAL_URL` | Render only | Set by Render; do not put in `.env` locally. |
| `RESEND_API_KEY` + `EMAIL_FROM` | Prod email | Or configure **SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) + `EMAIL_FROM`. |

---

## API overview

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/api/auth/signup` | `{ name, email, password }` → `{ token, user }` |
| `POST` | `/api/auth/login` | `{ email, password }` → `{ token, user }` |
| `GET` | `/api/auth/me` | Bearer JWT → user profile |
| `POST` | `/api/auth/forgot-password` | `{ email }` → generic success; sends **6-digit code** when email is configured |
| `POST` | `/api/auth/reset-password` | `{ code, password }` or legacy `{ token, password }` |
| `GET` | `/api/public-config` | e.g. `{ requireAuthForAi }` |
| `GET` | `/api/health` | `{ status, db, geminiConfigured }` |
| `POST` | `/api/generate` | Prompt body → `{ recordId, data, usedFallback?, fallbackReason? }` |
| `GET` | `/api/designs` | Saved designs (auth) |
| `DELETE` | `/api/designs/:id` | Remove one design (auth) |
| `POST` | `/api/export` | `{ format, data, recordId? }` — PDF / DOCX / MD |

Auth routes are rate-limited per IP; reset flows add extra throttling and lockout behaviour (see [Security](#security)).

---

## Docker

```bash
docker build -t system-design-studio .

docker run -p 4173:4173 \
  -e PORT=4173 \
  -e JWT_SECRET=your-secret \
  -e GEMINI_API_KEY=your-key \
  -e NODE_ENV=production \
  -v "$(pwd)/data:/app/data" \
  system-design-studio
```

Mount **`/app/data`** for a persistent SQLite file in production.

---

## GitHub Pages (free static UI)

[GitHub Pages](https://pages.github.com/) only serves **static files** (HTML/JS/CSS). It **cannot** run this repo’s Node server, SQLite, or Gemini calls. Use Pages for the **React UI** and host the **API on another free/cheap service** (e.g. Fly.io’s allowance, Render free tier, a VPS).

### What this repo does for Pages

- **`VITE_API_BASE_URL`** — at build time, the UI calls your API at this full URL (e.g. `https://my-api.fly.dev`).
- **`VITE_BASE`** — GitHub Actions sets this to `/your-repo-name/` so assets load under a [project site](https://docs.github.com/en/pages/getting-started-with-github-pages/types-of-github-pages-sites) (`https://<user>.github.io/<repo>/`).
- Workflow: [`.github/workflows/deploy-github-pages.yml`](.github/workflows/deploy-github-pages.yml).

### One-time setup

1. Deploy the **backend** somewhere and note its public `https://…` origin (no path, no trailing slash).
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**  
   - Name: **`BACKEND_URL`**  
   - Value: `https://your-api-host.example` (same as you’ll use in `ALLOWED_ORIGIN`’s “browser origin” partner below).
3. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
4. On the **API server**, set **`ALLOWED_ORIGIN`** to your Pages site **origin** (not the API URL), e.g. `https://rohitgaloth-ux.github.io` — the browser sends `Origin: https://rohitgaloth-ux.github.io` for fetches from `https://rohitgaloth-ux.github.io/system-design-studio/`.
5. Push to **`main`**; the workflow builds and publishes **`dist/`**.

If **`BACKEND_URL`** is missing, the build still runs but the site will call `/api/...` on `github.io` and **nothing will work** until you add the secret and redeploy (or run the workflow again).

For a **free API** on [Render](https://render.com/), deploy the app there first, then set **`BACKEND_URL`** to your `https://…onrender.com` URL (see [Deploy (Render)](#deploy-render)).

---

## Deploy (Render)

[`render.yaml`](render.yaml) defines a **free** web service: builds the Vite app, runs `npm start` (`tsx server.ts`), and checks **`/api/health`**.

### Free tier caveats

- The filesystem is **ephemeral**: **`data/designs.db` is wiped** when the service restarts, redeploys, or the instance is recycled. Fine for demos; for durable data use a managed database later or a paid **Render Disk**.
- Free services **spin down** after idle time; the first request after sleep can take **~30–60s** (cold start).

### One-time setup

1. Push this repo to GitHub (already done if you use the same remote).
2. Sign up at [render.com](https://render.com/) and connect your GitHub account.
3. **New +** → **Blueprint** → select this repository → Render will read `render.yaml`.  
   *Or:* **New +** → **Web Service**, connect the repo, then **Build command** `npm ci && npm run build`, **Start command** `npm start`, **Instance type** Free.
4. In the service **Environment** tab, add **`GEMINI_API_KEY`** (your key — stored only on Render, not in git).  
   **`JWT_SECRET`** is auto-generated by the blueprint; you can rotate it in the dashboard if you like.
5. After the first deploy, copy the service URL (e.g. `https://system-design-studio.onrender.com`).

Render injects **`RENDER_EXTERNAL_URL`**. The server uses it for **CORS** (`ALLOWED_ORIGIN`) and **password-reset links** when `APP_PUBLIC_URL` is unset, so the SPA on the same Render URL usually works without extra env.

### GitHub Pages + Render API

If the UI is on **GitHub Pages** and the API on **Render**:

1. Set GitHub secret **`BACKEND_URL`** to your Render URL (no trailing slash), e.g. `https://system-design-studio.onrender.com`.
2. On Render, set **`ALLOWED_ORIGIN`** to your Pages **origin** (e.g. `https://your-user.github.io`), because the browser’s `Origin` header is the Pages site, not Render.

---

## Deploy (Fly.io)

### Hosting without putting API keys in Git

You do **not** need to clone the repo on a server with secrets in a file.

- **`.env` is git-ignored** and listed in **`.dockerignore`**, so it is **not** copied into the Docker image when you build.
- **`GEMINI_API_KEY` and `JWT_SECRET`** should be set only as **Fly secrets** (encrypted on Fly’s side), not in GitHub and not in the image.
- **`fly deploy`** runs from **your laptop**: it uploads the build context (code without `.env`) and runs the Dockerfile. Runtime reads **`process.env`** from Fly’s environment, which includes your secrets.

Example (run once per app; replace the URL with your real `https://<app>.fly.dev`):

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -hex 48)" \
  GEMINI_API_KEY="your-key-here" \
  ALLOWED_ORIGIN="https://your-app.fly.dev" \
  TRUST_PROXY=1 \
  APP_PUBLIC_URL="https://your-app.fly.dev"
```

Optional helper from the project root: `./scripts/deploy-fly.sh` (runs `fly deploy` after you have set secrets).

### Steps

1. [Install `flyctl`](https://fly.io/docs/hands-on/install-flyctl/) and `fly auth login`.
2. Set a unique `app` name in `fly.toml` (must be globally unique on Fly).
3. `fly volumes create sd_data --region iad --size 1` (match your `primary_region`).
4. `fly secrets set` as above (plus email vars for password reset if you use them).
5. From this directory: `fly deploy`.

Use **`TRUST_PROXY=1`** when the app sits behind Fly’s edge so client IP limits work correctly.

Other platforms: run the same image with a **persistent disk** on `/app/data` and inject secrets via **that platform’s secret manager**, not the repo.

---

## Security

- **Passwords:** bcrypt (higher cost in production).
- **JWTs:** signed with `JWT_SECRET`; include a **version** claim backed by the database so tokens invalidate on password change / reset.
- **Reset codes:** 6-digit codes stored as **SHA-256**; verification uses **timing-safe** comparison; wrong guesses tracked per IP with **lockout** after repeated failures; minimum response delay to reduce timing signals.
- **Forgot password:** per-email hourly cap; identical success messaging to avoid account enumeration.
- **HTTP:** security headers (e.g. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- **Production:** `JWT_SECRET` required; CORS locked to `ALLOWED_ORIGIN`; optional **require-auth** for AI and server-side export; Gemini key sent via header, not query string.

---

## Project structure

```
├── server.ts           # HTTP server + API + static hosting
├── index.html          # Vite entry
├── vite.config.ts
├── tsconfig*.json
├── .github/workflows/deploy-github-pages.yml
├── Dockerfile
├── render.yaml
├── fly.toml
├── scripts/deploy-fly.sh
├── .env.example
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── lib/design.ts
│   ├── types/design.ts
│   └── components/     # DiagramCanvas, RightPanel, Input, Skeleton, …
├── tests/
│   └── design.test.ts
├── data/               # SQLite (git-ignored)
└── dist/               # Production build output (git-ignored)
```

---

## Licence

MIT
