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
git clone https://github.com/rohitghalot/system-design-studio.git
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
| `ALLOWED_ORIGIN` | Production CORS | Exact origin, e.g. `https://your-domain.com`. |
| `APP_PUBLIC_URL` | Password reset emails | Public site URL (no trailing slash); used in reset links. |
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

## Deploy (Fly.io)

`fly.toml` is included. Outline:

1. [Install `flyctl`](https://fly.io/docs/hands-on/install-flyctl/) and `fly auth login`.
2. Set a unique `app` name in `fly.toml`.
3. `fly volumes create sd_data --region iad --size 1` (match your `primary_region`).
4. `fly secrets set` for `JWT_SECRET`, `GEMINI_API_KEY`, `NODE_ENV=production`, `ALLOWED_ORIGIN`, `TRUST_PROXY=1`, `APP_PUBLIC_URL`, plus email vars for reset mail.
5. `fly deploy`.

Use **`TRUST_PROXY=1`** when the app sits behind Fly’s edge so client IP limits work correctly.

Other platforms: run the same image with a **persistent disk** on `/app/data` and set `PORT` as required.

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
├── Dockerfile
├── fly.toml
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
