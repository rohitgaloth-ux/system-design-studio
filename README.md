# System Design Studio

> Turn a product idea into a complete system architecture in one prompt.

System Design Studio is a full-stack AI-powered tool that converts a plain-English product description into a structured, exportable system design — complete with requirements, component breakdown, tech-stack reasoning, API surface, and an interactive architecture diagram.

---

## Features

| Feature | Detail |
|---|---|
| **AI generation** | Gemini API converts a prompt + constraints into structured JSON architecture |
| **Architecture diagram** | Custom SVG layout engine with orthogonal edge routing and role-aware node styles |
| **Domain + scale presets** | 12 domain templates (e-commerce, FinTech, healthcare…) with pattern and scale selectors |
| **Multi-format export** | PDF with a rendered diagram, Word (.docx) with component tables, Markdown with Mermaid syntax |
| **Auth** | JWT-based sign-up / log-in, bcrypt password hashing, 30-day sessions |
| **Persistence** | SQLite via `better-sqlite3` — zero-config, file-based, production-portable |
| **History** | Last 20 designs per user, loaded from the database on sign-in |
| **Mobile responsive** | Tab-based workspace layout (Brief / Diagram / Insights) for small screens |

---

## Tech stack

```
Frontend     React 19, Tailwind CSS v4, Vite 7
Backend      Node.js 20 (raw HTTP, no framework)
Database     SQLite via better-sqlite3
Auth         bcryptjs + jsonwebtoken
AI           Google Gemini API (gemini-2.5-flash)
Export       pdfkit, docx, Mermaid
```

---

## Architecture overview

```
Browser
  └─► Vite / React SPA
         │  REST API (JSON)
         ▼
  Node.js HTTP server (`server.ts`)
    ├── /api/auth/*     — signup, login, me, logout
    ├── /api/generate   — AI prompt → normalised design JSON
    ├── /api/designs    — CRUD for saved designs
    └── /api/export     — PDF / DOCX / Markdown generation
         │
         ├── better-sqlite3  (data/designs.db)
         └── Gemini API      (optional, falls back to static demo)
```

---

## Getting started

### Prerequisites
- Node.js 20+
- A Gemini API key (free at https://aistudio.google.com/app/apikey)

### Local setup

```bash
# 1. Clone and install
git clone <your-repo-url>
cd system-design-studio
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — add your GEMINI_API_KEY and generate a JWT_SECRET

# 3. Build the frontend
npm run build

# 4. Start the server
npm start
# → http://localhost:4173
```

### Development (hot reload)

```bash
# Terminal 1 – Vite dev server
npm run dev

# Terminal 2 – API server (port 4173)
npm start
```

### Run tests

```bash
npm test
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | AI generation. Without it the app uses static fallback data. |
| `JWT_SECRET` | **Yes in prod** | Long random string. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | No | Server port (default `4173`) |
| `NODE_ENV` | No | Set to `production` to enable strict security checks |
| `ALLOWED_ORIGIN` | No | CORS allowed origin in production (e.g. `https://yourapp.com`) |
| `GEMINI_MODEL` | No | Gemini model name (default `gemini-2.5-flash`) |

---

## Docker

```bash
# Build
docker build -t system-design-studio .

# Run (mount a volume for the SQLite database)
docker run -p 4173:4173 \
  -e PORT=4173 \
  -e JWT_SECRET=your-secret \
  -e GEMINI_API_KEY=your-key \
  -e NODE_ENV=production \
  -v $(pwd)/data:/app/data \
  system-design-studio
```

---

## Deploy (Fly.io)

The repo includes a `fly.toml` that runs the Docker image with a **persistent volume** for SQLite (`/app/data`).

1. Install the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) and run `fly auth login`.
2. Edit `fly.toml` and set `app = "your-unique-app-name"`.
3. Create a volume in the same region as `primary_region` (default `iad`):

   ```bash
   fly volumes create sd_data --region iad --size 1
   ```

4. Set secrets (adjust URLs to your app hostname):

   ```bash
   fly secrets set NODE_ENV=production JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
     GEMINI_API_KEY=your-key \
     ALLOWED_ORIGIN=https://your-app.fly.dev \
     TRUST_PROXY=1 \
     APP_PUBLIC_URL=https://your-app.fly.dev
   ```

   Add `RESEND_API_KEY` and `EMAIL_FROM` (or SMTP variables) so password-reset emails send in production.

5. Deploy:

   ```bash
   fly deploy
   ```

6. Open `https://your-app.fly.dev`. Behind Fly’s proxy, **`TRUST_PROXY=1`** is required so rate limits use the real client IP.

Other hosts (Railway, Render, VPS) can run the same Docker image; mount a persistent disk at `/app/data` and set `PORT` to the platform’s expected port.

---

## API reference

### Auth

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/auth/signup` | `{ name, email, password }` | `{ token, user }` |
| `POST` | `/api/auth/login`  | `{ email, password }` | `{ token, user }` |
| `GET`  | `/api/auth/me`     | — | `{ id, name, email }` |
| `POST` | `/api/auth/logout` | — | `{ ok: true }` |

### Designs

| Method | Path | Auth | Response |
|---|---|---|---|
| `POST`   | `/api/generate`      | Optional | `{ recordId, data }` |
| `GET`    | `/api/designs`       | Required | Array of saved designs |
| `DELETE` | `/api/designs/:id`   | Required | `{ ok: true }` |
| `POST`   | `/api/export`        | Optional | Binary file (PDF/DOCX/MD) |

> Auth endpoints are rate-limited to 10 requests per minute per IP.

---

## Security notes

- Passwords hashed with **bcrypt** (10 rounds in development, **12 in production**)
- **6-digit password reset codes** are hashed (SHA-256) before storage; verification uses a **timing-safe** compare
- After **6 wrong reset codes** from one IP within 10 minutes, reset is **blocked for 30 minutes**; responses are padded to a **minimum delay** to reduce timing probes
- At most **5 “forgot password” requests per email address per hour** (generic success message either way)
- JWTs include a **token version**; password change invalidates old tokens
- JWTs expire after **30 days**
- Security headers set on every response: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`
- CORS origin is restricted in production (`ALLOWED_ORIGIN` env var)
- Auth routes are rate-limited per IP; reset endpoints have additional hourly caps
- `JWT_SECRET` must be explicitly set in production — the server throws on startup if it isn't

---

## Project structure

```
├── server.ts              # Node.js HTTP API server
├── src/
│   ├── App.tsx            # React root — routing, state, auth
│   ├── index.css          # Global styles + animation helpers
│   ├── lib/
│   │   └── design.ts      # Design normalisation + markdown export logic
│   └── components/
│       ├── DiagramCanvas.tsx  # SVG layout engine + architecture board
│       └── RightPanel.tsx     # Insights panel (tabs: Overview/Stack/APIs/Risks)
├── tests/
│   └── design.test.ts     # Unit tests (node:test)
├── data/                  # SQLite database file (git-ignored)
├── dist/                  # Built frontend (git-ignored)
├── Dockerfile
└── .env.example
```

---

## Licence

MIT
