// @ts-nocheck — runtime entry; full strict typing deferred (large HTTP surface + third-party types).
import crypto from "node:crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { createFallbackDesign, generateMarkdown, hasMeaningfulDesign, normalizeDesign } from "./src/lib/design";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const DIST = path.join(__dirname, "dist");
const STATIC_ROOT = fs.existsSync(DIST) ? DIST : __dirname;
const PORT = Number(process.env.PORT || 4173);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const IS_PROD    = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD
  ? (() => { throw new Error("JWT_SECRET must be set in production."); })()
  : "sd-dev-only-insecure-secret");

if (!IS_PROD && !process.env.JWT_SECRET) {
  console.warn("[WARN] JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env for real security.");
}

/* Trust X-Forwarded-For only when behind a known reverse proxy (otherwise it is spoofable). */
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

/* In production, AI generation and server-side export require a logged-in user (stops quota theft & DoS). */
const REQUIRE_AUTH_AI =
  IS_PROD || process.env.REQUIRE_AUTH_GENERATE === "1";

if (REQUIRE_AUTH_AI) {
  console.log("[security] /api/generate and /api/export require authentication.");
}
if (TRUST_PROXY) {
  console.log("[security] TRUST_PROXY=1 — client IP for rate limits taken from X-Forwarded-For.");
}

const MAX_PROMPT_CHARS = 12_000;

function slog(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** bcrypt cost: higher in production to slow offline attacks on stolen hashes. */
const BCRYPT_ROUNDS = IS_PROD ? 12 : 10;

/* ── Password reset: lockout + constant-time-ish response (6-digit codes) ─ */
const RESET_FAIL_WINDOW_MS = 10 * 60 * 1000;
const RESET_MAX_FAILS = 6;
const RESET_LOCKOUT_MS = 30 * 60 * 1000;
const RESET_MIN_RESPONSE_MS = 300;

const _resetFailTimes = new Map();
const _resetLockUntil = new Map();

function isResetPasswordLocked(ip) {
  return (_resetLockUntil.get(ip) || 0) > Date.now();
}

function noteResetPasswordFailure(ip) {
  const now = Date.now();
  const arr = (_resetFailTimes.get(ip) || []).filter((t) => now - t < RESET_FAIL_WINDOW_MS);
  arr.push(now);
  _resetFailTimes.set(ip, arr);
  if (arr.length >= RESET_MAX_FAILS) {
    _resetLockUntil.set(ip, now + RESET_LOCKOUT_MS);
    _resetFailTimes.delete(ip);
    const ipHash = crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 16);
    slog("warn", "password_reset_lockout", { ip_hash: ipHash, lockout_min: RESET_LOCKOUT_MS / 60000 });
  }
}

function clearResetPasswordFailures(ip) {
  _resetFailTimes.delete(ip);
  _resetLockUntil.delete(ip);
}

async function enforceResetMinDelay(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < RESET_MIN_RESPONSE_MS) await sleep(RESET_MIN_RESPONSE_MS - elapsed);
}

/** Timing-safe comparison of two 64-char hex SHA-256 digests. */
function hashesEqualHex(hexA, hexB) {
  try {
    const a = Buffer.from(String(hexA), "hex");
    const b = Buffer.from(String(hexB), "hex");
    if (a.length !== b.length || a.length !== 32) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ── In-memory rate limiter ──────────────────────────────────────────── */
const _rateLimits = new Map();
function isRateLimited(ip, max = 20, windowMs = 60_000, keySuffix = "") {
  const key = keySuffix ? `${ip}\0${keySuffix}` : ip;
  const now  = Date.now();
  const slot = _rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > slot.resetAt) { slot.count = 0; slot.resetAt = now + windowMs; }
  slot.count++;
  _rateLimits.set(key, slot);
  return slot.count > max;
}
/* Scrub stale entries every 5 minutes so the Map doesn't grow forever */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateLimits) if (now > v.resetAt) _rateLimits.delete(k);
  for (const [ip, until] of _resetLockUntil) if (now > until) _resetLockUntil.delete(ip);
  for (const [ip, times] of _resetFailTimes) {
    const fresh = times.filter((t) => now - t < RESET_FAIL_WINDOW_MS);
    if (fresh.length === 0) _resetFailTimes.delete(ip);
    else _resetFailTimes.set(ip, fresh);
  }
}, 300_000).unref();

function getClientIp(request) {
  if (TRUST_PROXY) {
    const xff = request.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

/* ── PostgreSQL ─────────────────────────────────────────────────────── */
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.error(
    "[fatal] DATABASE_URL is required (PostgreSQL). Example for local dev:\n" +
      "  postgresql://postgres:postgres@127.0.0.1:5432/system_design_studio\n" +
      "Create DB: createdb system_design_studio (or use Neon / Supabase free tier).",
  );
  process.exit(1);
}

const useSsl =
  process.env.DATABASE_SSL === "0" || /localhost|127\.0\.0\.1/i.test(DATABASE_URL) ? false : { rejectUnauthorized: false };

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ssl: useSsl,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT DEFAULT (FLOOR(EXTRACT(EPOCH FROM NOW())))::BIGINT
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idea TEXT NOT NULL,
      summary TEXT,
      domain TEXT,
      pattern TEXT,
      data TEXT NOT NULL,
      created_at BIGINT DEFAULT (FLOOR(EXTRACT(EPOCH FROM NOW())))::BIGINT
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS designs_user_idx ON designs (user_id, created_at DESC)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      job_url TEXT,
      status TEXT NOT NULL DEFAULT 'interested',
      applied_at BIGINT,
      notes TEXT,
      tailored_resume_snippet TEXT,
      automation_state TEXT NOT NULL DEFAULT 'none',
      created_at BIGINT DEFAULT (FLOOR(EXTRACT(EPOCH FROM NOW())))::BIGINT,
      updated_at BIGINT DEFAULT (FLOOR(EXTRACT(EPOCH FROM NOW())))::BIGINT
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS job_apps_user_idx ON job_applications (user_id, updated_at DESC)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_application_updates (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',
      created_at BIGINT DEFAULT (FLOOR(EXTRACT(EPOCH FROM NOW())))::BIGINT
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS job_updates_app_idx ON job_application_updates (application_id, created_at DESC)`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets (token_hash)`,
  );
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'token_version'
      ) THEN
        ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
      END IF;
    END $$`);
}

/* ── Auth helpers ────────────────────────────────────────────────────── */
async function getAuthUser(request) {
  const h = request.headers["authorization"] || "";
  if (!h.startsWith("Bearer ")) return null;
  let decoded;
  try {
    decoded = jwt.verify(h.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded.id !== "string") return null;
  const { rows } = await pool.query(
    "SELECT id, name, email, COALESCE(token_version, 0) AS token_version FROM users WHERE id = $1",
    [decoded.id],
  );
  const row = rows[0];
  if (!row) return null;
  const tvClaim = typeof decoded.tv === "number" ? decoded.tv : 0;
  if (tvClaim !== row.token_version) return null;
  return { id: row.id, name: row.name, email: row.email };
}

async function issueToken(user) {
  const { rows } = await pool.query("SELECT COALESCE(token_version, 0) AS tv FROM users WHERE id = $1", [user.id]);
  const tv = rows[0]?.tv ?? 0;
  return jwt.sign({ id: user.id, name: user.name, email: user.email, tv }, JWT_SECRET, { expiresIn: "30d" });
}

/* ── Auth route handlers ─────────────────────────────────────────────── */
async function handleSignup(request, response) {
  const body = await readJsonBody(request);
  const name  = String(body.name  || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!name || !email || !password) {
    sendJson(response, 400, { error: "Name, email and password are required." });
    return;
  }
  if (password.length < 6) {
    sendJson(response, 400, { error: "Password must be at least 6 characters." });
    return;
  }

  const { rows: existingRows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existingRows[0]) {
    sendJson(response, 409, { error: "An account with that email already exists." });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id   = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, name, email, password_hash, token_version) VALUES ($1, $2, $3, $4, 0)",
    [id, name, email, hash],
  );

  const user  = { id, name, email };
  const token = await issueToken(user);
  sendJson(response, 201, { token, user });
}

async function handleLogin(request, response) {
  const body = await readJsonBody(request);
  const email    = String(body.email    || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    sendJson(response, 400, { error: "Email and password are required." });
    return;
  }

  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const row = rows[0];
  if (!row) {
    sendJson(response, 401, { error: "No account found with that email." });
    return;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    sendJson(response, 401, { error: "Incorrect password." });
    return;
  }

  const user  = { id: row.id, name: row.name, email: row.email };
  const token = await issueToken(user);
  sendJson(response, 200, { token, user });
}

async function handleMe(request, response) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }
  sendJson(response, 200, { id: user.id, name: user.name, email: user.email });
}

const FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, you will receive a 6-digit reset code shortly.";

async function sendPasswordResetEmail(toEmail, rawCode) {
  const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim();
  const subject = `${rawCode} — your password reset code`;
  const base = APP_PUBLIC_URL.replace(/\/$/, "");
  const link = base ? `${base}/?code=${encodeURIComponent(rawCode)}` : "";
  const plain = `Your System Design Studio password reset code is: ${rawCode}\n\nIt expires in one hour. If you did not request this, you can ignore this email.`;
  const html = `<p>You requested a password reset for System Design Studio.</p>
<p style="font-size:28px;font-weight:700;letter-spacing:0.25em;font-family:ui-monospace,monospace;margin:16px 0">${rawCode}</p>
<p>Enter this <strong>6-digit code</strong> in the app within one hour. Do not share it with anyone.</p>
${link ? `<p><a href="${link}">Open the app to set a new password</a></p>` : "<p>Open the app, go to “Forgot password”, then enter the code above.</p>"}`;

  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (resendKey && from) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [toEmail], subject, html, text: plain }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`);
    }
    return true;
  }

  const smtpHost = (process.env.SMTP_HOST || "").trim();
  if (smtpHost && from) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "1",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
        : undefined,
    });
    await transporter.sendMail({ from, to: toEmail, subject, html, text: plain });
    return true;
  }

  return false;
}

async function handleForgotPassword(request, response) {
  const body = await readJsonBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const okPayload = { ok: true, message: FORGOT_PASSWORD_MESSAGE };

  if (!email) {
    sendJson(response, 200, okPayload);
    return;
  }

  /* Per-email hourly cap (same generic response whether the account exists). */
  const emailKey = crypto.createHash("sha256").update(email).digest("hex");
  if (isRateLimited(emailKey, 5, 60 * 60 * 1000, "forgot-email-hourly")) {
    sendJson(response, 200, okPayload);
    return;
  }

  const { rows: userRows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const row = userRows[0];
  if (!row) {
    sendJson(response, 200, okPayload);
    return;
  }

  await pool.query("DELETE FROM password_resets WHERE user_id = $1", [row.id]);
  const rawCode = String(crypto.randomInt(100_000, 1_000_000));
  const tokenHash = crypto.createHash("sha256").update(rawCode).digest("hex");
  const prId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await pool.query(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [prId, row.id, tokenHash, expiresAt],
  );

  if (IS_PROD) {
    try {
      const emailed = await sendPasswordResetEmail(email, rawCode);
      if (!emailed) {
        slog("warn", "password_reset_email_skipped", {
          hint: "Set RESEND_API_KEY+EMAIL_FROM+APP_PUBLIC_URL or SMTP_HOST+EMAIL_FROM",
        });
      }
    } catch (e) {
      slog("error", "password_reset_email_failed", { message: String(e?.message || e) });
    }
  } else {
    console.log(`[password-reset] email=${email} code=${rawCode} — use ?code=${rawCode} or enter code in reset form (dev only).`);
  }

  const payload = { ...okPayload };
  if (!IS_PROD) {
    payload.devResetCode = rawCode;
    payload.devResetHint =
      "Development only: use the 6-digit code below, or open the app with ?code=###### in the URL. Configure email in production.";
  }
  sendJson(response, 200, payload);
}

async function handleResetPassword(request, response, clientIp) {
  const startedAt = Date.now();
  const body = await readJsonBody(request);
  const password = String(body.password || "");
  const codeDigits = String(body.code ?? "").replace(/\D/g, "");
  const tokenLegacy = String(body.token ?? "").trim();

  if (isResetPasswordLocked(clientIp)) {
    await enforceResetMinDelay(startedAt);
    sendJson(response, 429, {
      error: "Too many incorrect codes. Try again in 30 minutes or request a new code.",
      code: "RESET_LOCKED",
    });
    return;
  }

  let secret = "";
  if (codeDigits.length >= 6) {
    secret = codeDigits.slice(0, 6);
  } else if (tokenLegacy) {
    secret = tokenLegacy;
  } else if (codeDigits.length > 0) {
    await enforceResetMinDelay(startedAt);
    sendJson(response, 400, { error: "The reset code must be 6 digits." });
    return;
  }

  if (!secret || password.length < 6) {
    await enforceResetMinDelay(startedAt);
    sendJson(response, 400, { error: "Reset code and a new password (at least 6 characters) are required." });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(secret).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const { rows: prRows } = await pool.query(
    "SELECT * FROM password_resets WHERE token_hash = $1 AND expires_at > $2",
    [tokenHash, now],
  );
  const pr = prRows[0];
  if (!pr || !hashesEqualHex(pr.token_hash, tokenHash)) {
    noteResetPasswordFailure(clientIp);
    await enforceResetMinDelay(startedAt);
    sendJson(response, 400, { error: "This reset code is wrong or has expired. Request a new code from the sign-in page." });
    return;
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query("UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2", [hash, pr.user_id]);
  await pool.query("DELETE FROM password_resets WHERE user_id = $1", [pr.user_id]);
  clearResetPasswordFailures(clientIp);

  await enforceResetMinDelay(startedAt);
  sendJson(response, 200, { ok: true, message: "Your password has been updated. You can sign in now." });
}

/* ── Design CRUD ─────────────────────────────────────────────────────── */
async function handleGetDesigns(request, response) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const { rows } = await pool.query(
    "SELECT id, idea, summary, domain, pattern, data, created_at FROM designs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
    [user.id],
  );

  sendJson(response, 200, rows.map((r) => ({
    id:        r.id,
    idea:      r.idea,
    summary:   r.summary,
    domain:    r.domain,
    pattern:   r.pattern,
    createdAt: Number(r.created_at) * 1000,
    design:    JSON.parse(r.data),
  })));
}

async function handleDeleteDesign(request, response, id) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const r = await pool.query("DELETE FROM designs WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (r.rowCount === 0) { sendJson(response, 404, { error: "Design not found." }); return; }
  sendJson(response, 200, { ok: true });
}

const JOB_STATUSES = new Set(["interested", "applied", "screening", "interview", "offer", "rejected", "withdrawn"]);
const JOB_UPDATE_KINDS = new Set(["note", "status_change", "system"]);

function rowToJobApplication(row, updates) {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    jobUrl: row.job_url || "",
    status: row.status,
    appliedAt: row.applied_at != null ? Number(row.applied_at) * 1000 : null,
    notes: row.notes || "",
    tailoredResumeSnippet: row.tailored_resume_snippet || "",
    automationState: row.automation_state || "none",
    createdAt: Number(row.created_at) * 1000,
    updatedAt: Number(row.updated_at) * 1000,
    updates: (updates || []).map((u) => ({
      id: u.id,
      body: u.body,
      kind: u.kind,
      createdAt: Number(u.created_at) * 1000,
    })),
  };
}

async function handleListJobApplications(request, response) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const { rows } = await pool.query(
    `SELECT * FROM job_applications WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [user.id],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    sendJson(response, 200, []);
    return;
  }
  const { rows: upRows } = await pool.query(
    `SELECT * FROM job_application_updates WHERE application_id = ANY($1::text[]) ORDER BY created_at ASC`,
    [ids],
  );
  const byApp = new Map();
  for (const u of upRows) {
    const list = byApp.get(u.application_id) || [];
    list.push(u);
    byApp.set(u.application_id, list);
  }
  sendJson(
    response,
    200,
    rows.map((r) => rowToJobApplication(r, byApp.get(r.id) || [])),
  );
}

async function handleCreateJobApplication(request, response) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const body = await readJsonBody(request);
  const company = String(body.company || "").trim();
  const title = String(body.title || "").trim();
  const jobUrl = String(body.jobUrl || body.job_url || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;
  let status = String(body.status || "interested").trim().toLowerCase();
  if (!JOB_STATUSES.has(status)) status = "interested";

  if (!company || !title) {
    sendJson(response, 400, { error: "Company and job title are required." });
    return;
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const appliedAt =
    status === "applied" ? now : null;

  await pool.query(
    `INSERT INTO job_applications (id, user_id, company, title, job_url, status, applied_at, notes, automation_state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'none', $9, $9)`,
    [id, user.id, company, title, jobUrl, status, appliedAt, notes, now],
  );

  if (status === "applied") {
    const uid = crypto.randomUUID();
    await pool.query(
      `INSERT INTO job_application_updates (id, application_id, user_id, body, kind, created_at) VALUES ($1, $2, $3, $4, 'status_change', $5)`,
      [uid, id, user.id, `Status: ${status}`, now],
    );
  }

  const { rows } = await pool.query("SELECT * FROM job_applications WHERE id = $1", [id]);
  sendJson(response, 201, rowToJobApplication(rows[0], []));
}

async function handlePatchJobApplication(request, response, id) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const body = await readJsonBody(request);
  const { rows: existingRows } = await pool.query(
    "SELECT * FROM job_applications WHERE id = $1 AND user_id = $2",
    [id, user.id],
  );
  const existing = existingRows[0];
  if (!existing) {
    sendJson(response, 404, { error: "Application not found." });
    return;
  }

  const company = body.company !== undefined ? String(body.company).trim() : existing.company;
  const title = body.title !== undefined ? String(body.title).trim() : existing.title;
  const jobUrl =
    body.jobUrl !== undefined || body.job_url !== undefined
      ? String(body.jobUrl ?? body.job_url ?? "").trim() || null
      : existing.job_url;
  const notes = body.notes !== undefined ? String(body.notes).trim() || null : existing.notes;
  let status = body.status !== undefined ? String(body.status).trim().toLowerCase() : existing.status;
  if (!JOB_STATUSES.has(status)) status = existing.status;

  const tailoredResumeSnippet =
    body.tailoredResumeSnippet !== undefined
      ? String(body.tailoredResumeSnippet).trim() || null
      : existing.tailored_resume_snippet;

  let automationState =
    body.automationState !== undefined
      ? String(body.automationState || "none").trim()
      : existing.automation_state;
  if (!["none", "pending", "running", "completed", "failed"].includes(automationState)) {
    automationState = existing.automation_state || "none";
  }

  let appliedAt = existing.applied_at != null ? Number(existing.applied_at) : null;
  const prevStatus = existing.status;
  if (status === "applied" && prevStatus !== "applied" && !appliedAt) {
    appliedAt = Math.floor(Date.now() / 1000);
  }

  const now = Math.floor(Date.now() / 1000);

  await pool.query(
    `UPDATE job_applications SET
      company = $1, title = $2, job_url = $3, status = $4, applied_at = $5, notes = $6,
      tailored_resume_snippet = $7, automation_state = $8, updated_at = $9
     WHERE id = $10 AND user_id = $11`,
    [company, title, jobUrl, status, appliedAt, notes, tailoredResumeSnippet, automationState, now, id, user.id],
  );

  if (prevStatus !== status) {
    const uid = crypto.randomUUID();
    await pool.query(
      `INSERT INTO job_application_updates (id, application_id, user_id, body, kind, created_at) VALUES ($1, $2, $3, $4, 'status_change', $5)`,
      [uid, id, user.id, `Status changed: ${prevStatus} → ${status}`, now],
    );
  }

  const { rows } = await pool.query("SELECT * FROM job_applications WHERE id = $1", [id]);
  const { rows: ups } = await pool.query(
    "SELECT * FROM job_application_updates WHERE application_id = $1 ORDER BY created_at ASC",
    [id],
  );
  sendJson(response, 200, rowToJobApplication(rows[0], ups));
}

async function handleDeleteJobApplication(request, response, id) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const r = await pool.query("DELETE FROM job_applications WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (r.rowCount === 0) { sendJson(response, 404, { error: "Application not found." }); return; }
  sendJson(response, 200, { ok: true });
}

async function handleAddJobUpdate(request, response, appId) {
  const user = await getAuthUser(request);
  if (!user) { sendJson(response, 401, { error: "Unauthorized." }); return; }

  const { rows: appRows } = await pool.query(
    "SELECT id FROM job_applications WHERE id = $1 AND user_id = $2",
    [appId, user.id],
  );
  if (!appRows[0]) {
    sendJson(response, 404, { error: "Application not found." });
    return;
  }

  const body = await readJsonBody(request);
  const text = String(body.body || "").trim();
  let kind = String(body.kind || "note").trim().toLowerCase();
  if (!JOB_UPDATE_KINDS.has(kind)) kind = "note";
  if (!text) {
    sendJson(response, 400, { error: "Update text is required." });
    return;
  }

  const uid = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO job_application_updates (id, application_id, user_id, body, kind, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [uid, appId, user.id, text, kind, now],
  );
  await pool.query("UPDATE job_applications SET updated_at = $1 WHERE id = $2", [now, appId]);

  const { rows } = await pool.query("SELECT * FROM job_application_updates WHERE id = $1", [uid]);
  const u = rows[0];
  sendJson(response, 201, {
    id: u.id,
    body: u.body,
    kind: u.kind,
    createdAt: Number(u.created_at) * 1000,
  });
}

const MAX_RESUME_CHARS = 24_000;
const MAX_JD_CHARS = 24_000;

async function callGeminiResumeTailor(masterResume, jobDescription) {
  if (!GEMINI_API_KEY) return null;

  const prompt = [
    "You tailor resumes for job applications. Given the candidate MASTER RESUME and the JOB DESCRIPTION,",
    "produce a tailored resume body in plain text (use clear section headers like EXPERIENCE, SKILLS).",
    "Rules:",
    "- Do not invent employers, dates, degrees, or skills the candidate did not list.",
    "- You may reorder and rephrase bullets to align with the job; keep facts truthful.",
    "- If the JD is empty, return a lightly polished version of the master resume.",
    "- Output ONLY the resume text, no preamble or markdown code fences.",
    "",
    "=== MASTER RESUME ===",
    masterResume.slice(0, MAX_RESUME_CHARS),
    "",
    "=== JOB DESCRIPTION ===",
    jobDescription.slice(0, MAX_JD_CHARS),
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body,
  });
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`Gemini error ${response.status}: ${t.slice(0, 200)}`);
  }
  const payload = await response.json();
  const rawText = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  return rawText || null;
}

async function handleTailorResume(request, response, clientIp) {
  const user = await getAuthUser(request);
  if (REQUIRE_AUTH_AI && !user) {
    sendJson(response, 401, { error: "Sign in to tailor your resume.", code: "AUTH_REQUIRED" });
    return;
  }
  if (!user) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }

  if (isRateLimited(clientIp, 30, 60 * 60 * 1000, "tailor-resume-hourly")) {
    sendJson(response, 429, { error: "Too many tailoring requests this hour. Try again later." });
    return;
  }

  const body = await readJsonBody(request);
  const masterResume = String(body.masterResume || body.master_resume || "").trim();
  const jobDescription = String(body.jobDescription || body.job_description || "").trim();

  if (!masterResume) {
    sendJson(response, 400, { error: "masterResume is required." });
    return;
  }

  if (!GEMINI_API_KEY) {
    sendJson(response, 503, { error: "Resume tailoring requires GEMINI_API_KEY on the server." });
    return;
  }

  try {
    const tailored = await callGeminiResumeTailor(masterResume, jobDescription);
    if (!tailored) {
      sendJson(response, 502, { error: "The model returned empty output. Try again." });
      return;
    }
    sendJson(response, 200, { tailoredResume: tailored });
  } catch (e) {
    slog("error", "tailor_resume_failed", { message: String(e?.message || e) });
    sendJson(response, 500, { error: e?.message || "Tailoring failed." });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendBuffer(response, statusCode, buffer, type, filename) {
  response.writeHead(statusCode, {
    "Content-Type": type,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });
  response.end(buffer);
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type =
    {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }

    response.writeHead(200, { "Content-Type": type });
    response.end(data);
  });
}

/**
 * Resolve a URL pathname to a file under STATIC_ROOT. Returns null if the path escapes the root (path traversal).
 */
function resolveStaticPath(urlPath) {
  const raw = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^[/\\]+/, "");
  if (!relative) return path.join(STATIC_ROOT, "index.html");

  const resolved = path.resolve(STATIC_ROOT, relative);
  const root = path.resolve(STATIC_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });

    request.on("error", reject);
  });
}

function sanitizePromptPayload(payload = {}) {
  const raw = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const prompt = raw.length > MAX_PROMPT_CHARS ? raw.slice(0, MAX_PROMPT_CHARS) : raw;
  return {
    prompt,
    constraints: {
      scale: typeof payload.constraints?.scale === "string" ? payload.constraints.scale.trim() : "",
      latency: typeof payload.constraints?.latency === "string" ? payload.constraints.latency.trim() : "",
      budget: typeof payload.constraints?.budget === "string" ? payload.constraints.budget.trim() : "",
      region: typeof payload.constraints?.region === "string" ? payload.constraints.region.trim() : "",
      security: typeof payload.constraints?.security === "string" ? payload.constraints.security.trim() : "",
      customRequirements:
        typeof payload.constraints?.customRequirements === "string" ? payload.constraints.customRequirements.trim() : ""
    }
  };
}

function buildPrompt(input, runNonce) {
  const domainHint   = input.constraints?.customRequirements || "";
  const domainLine   = domainHint ? `\nContext: ${domainHint}` : "";

  return [
    "You are a principal architect generating a production-grade system design.",
    domainLine,
    "Return only valid JSON that matches this exact schema:",
    JSON.stringify(
      {
        idea: "string",
        functional: ["string"],
        nonFunctional: ["string"],
        architecture: {
          summary: "string",
          flow: ["string"],
          components: ["string"],
          decisions: ["string"],
          risks: ["string"],
          diagram: {
            nodes: [{ id: "string", label: "string", description: "string", role: "client|balancer|queue|service|worker|database|cache|cloud" }],
            edges: [{ from: "string", to: "string", label: "string" }]
          }
        },
        techStack: [{ layer: "string", name: "string", reason: "string" }],
        apis: [{ name: "string", method: "string", path: "string", purpose: "string" }],
        deepAnalysis: {
          tradeoffs: ["string"],
          failureModes: ["string"],
          observability: ["string"],
          dataConsistency: ["string"]
        }
      },
      null,
      2
    ),
    "",
    "Important rules:",
    "- Make the output specific to the user idea, not a generic SaaS boilerplate.",
    "- architecture.diagram must be present.",
    "- Use 6 to 9 nodes only.",
    "- Roles must be chosen only from: client, balancer, queue, service, worker, database, cache, cloud.",
    "- Edges must connect real node ids.",
    "- Include the actual product modules from the idea inside the node labels and descriptions.",
    "- Prefer a readable request flow such as client -> gateway -> services -> queue/workers -> database/cache/cloud.",
    "- deepAnalysis: four arrays, each with at least 3 bullets grounded in THIS product (trade-offs you explicitly accept, realistic failure modes and mitigations, observability signals and SLO probes, consistency/replication boundaries and conflict handling).",
    "",
    `Run nonce (unique per request; vary your design details accordingly): ${runNonce}`,
    "",
    `Product idea: ${input.prompt}`,
    `Scale: ${input.constraints.scale || "Not specified"}`,
    `Latency: ${input.constraints.latency || "Not specified"}`,
    `Budget: ${input.constraints.budget || "Not specified"}`,
    `Region: ${input.constraints.region || "Not specified"}`,
    `Security: ${input.constraints.security || "Not specified"}`,
    `Additional constraints: ${input.constraints.customRequirements || "None"}`
  ].join("\n");
}

/** Validate that the AI response contains the minimum required structure. */
function isValidAiResponse(parsed) {
  return (
    parsed &&
    typeof parsed.idea === "string" &&
    Array.isArray(parsed.functional) &&
    Array.isArray(parsed.architecture?.diagram?.nodes) &&
    parsed.architecture.diagram.nodes.length >= 3
  );
}

/** Call Gemini with up to 3 retries and exponential back-off. */
async function callGemini(input, runNonce) {
  if (!GEMINI_API_KEY) return null;

  const temperature = 0.45 + Math.random() * 0.35;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: buildPrompt(input, runNonce) }] }],
    generationConfig: { temperature, responseMimeType: "application/json" },
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 429 || response.status >= 500) {
          /* Retryable: rate-limit or server error */
          if (attempt < 3) { await sleep(1000 * attempt); continue; }
        }
        throw new Error(`Gemini error ${response.status}: ${text.slice(0, 200)}`);
      }

      const payload = await response.json();
      const rawText = payload?.candidates?.[0]?.content?.parts?.map(p => p.text).join("").trim();
      if (!rawText) { if (attempt < 3) { await sleep(800 * attempt); continue; } return null; }

      let parsed;
      try { parsed = JSON.parse(rawText); } catch { if (attempt < 3) { await sleep(800 * attempt); continue; } return null; }

      if (!isValidAiResponse(parsed)) {
        if (attempt < 3) { await sleep(800 * attempt); continue; }
        return null;
      }

      return { parsed, temperature };
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
  return null;
}

function buildGenerationMeta({ source, model, temperature, runNonce, usedFallback, reason }) {
  const runShort = typeof runNonce === "string" ? runNonce.slice(0, 8) : "";
  const insights = [];
  if (!usedFallback) {
    insights.push("Each generate request hits the API fresh — there is no server-side cache of prior Gemini responses.");
    insights.push(
      `Model ${model} with temperature ${typeof temperature === "number" ? temperature.toFixed(2) : "?"} — outputs are stochastic; the same prompt can produce different architectures.`,
    );
  } else if (reason === "no_api_key") {
    insights.push("Gemini was not called — GEMINI_API_KEY is not set on the server.");
    insights.push("You are seeing the deterministic template design for your prompt until an API key is configured.");
  } else {
    insights.push("Gemini was called but did not return usable JSON after retries, or the response failed validation.");
    insights.push("This run uses the deterministic template design; fix API health or try again.");
  }
  insights.push(`Run nonce ${runShort}… is unique per click so the model treats each generate as a new pass.`);
  if (usedFallback && reason === "gemini_error") {
    insights.push("Check server logs and Gemini quotas if errors persist.");
  }
  if (usedFallback && reason === "no_api_key") {
    insights.push("Set GEMINI_API_KEY in the server environment to enable live generation.");
  }
  return {
    source,
    model: model || null,
    temperature: typeof temperature === "number" ? temperature : null,
    runNonceShort: runShort,
    insights,
  };
}

async function generateDesign(input) {
  const runNonce = crypto.randomUUID();
  const fallback = createFallbackDesign(input.prompt, input.constraints);

  try {
    const aiResult = await callGemini(input, runNonce);
    if (!aiResult) {
      const reason = !GEMINI_API_KEY ? "no_api_key" : "gemini_empty_or_invalid";
      return {
        design: fallback,
        usedFallback: true,
        reason,
        generationMeta: buildGenerationMeta({
          source: "fallback",
          model: GEMINI_MODEL,
          temperature: null,
          runNonce,
          usedFallback: true,
          reason,
        }),
      };
    }

    const { parsed, temperature } = aiResult;
    const design = normalizeDesign({
      ...parsed,
      title: "System Design Assistant",
      generatedAt: new Date().toISOString(),
    });
    return {
      design,
      usedFallback: false,
      reason: "",
      generationMeta: buildGenerationMeta({
        source: "gemini",
        model: GEMINI_MODEL,
        temperature,
        runNonce,
        usedFallback: false,
        reason: "",
      }),
    };
  } catch {
    return {
      design: fallback,
      usedFallback: true,
      reason: "gemini_error",
      generationMeta: buildGenerationMeta({
        source: "fallback",
        model: GEMINI_MODEL,
        temperature: null,
        runNonce,
        usedFallback: true,
        reason: "gemini_error",
      }),
    };
  }
}

function createRecord(design) {
  return {
    ...normalizeDesign(design),
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
  };
}

/* ── Diagram layout helpers (mirrors DiagramCanvas logic, PDF scale) ─── */

const ROLE_STYLE = {
  client:   { fill: "#eff6ff", stroke: "#2563eb", badge: "#2563eb" },
  balancer: { fill: "#f0fdf4", stroke: "#0f766e", badge: "#0f766e" },
  queue:    { fill: "#fffbeb", stroke: "#d97706", badge: "#d97706" },
  service:  { fill: "#f0f9ff", stroke: "#0284c7", badge: "#0284c7" },
  worker:   { fill: "#fff7ed", stroke: "#ea580c", badge: "#ea580c" },
  database: { fill: "#faf5ff", stroke: "#7c3aed", badge: "#7c3aed" },
  cache:    { fill: "#f0fdfa", stroke: "#0d9488", badge: "#0d9488" },
  cloud:    { fill: "#faf5ff", stroke: "#7c3aed", badge: "#7c3aed" },
};

const PDF_NODE = { w: 92, h: 46 };
const PDF_GAP  = 10;
const PDF_PAD  = 14;

function pdfDiagramLayout(nodes) {
  const W = 478;
  const { w, h } = PDF_NODE;

  function row(list, y, startX, regionW) {
    if (!list.length) return [];
    const total = list.length * w + (list.length - 1) * PDF_GAP;
    const sx = startX + Math.max(0, (regionW - total) / 2);
    return list.map((n, i) => ({ ...n, x: sx + i * (w + PDF_GAP), y }));
  }

  const entry   = nodes.filter((n) => n.role === "client"   || n.role === "balancer");
  const cloud   = nodes.filter((n) => n.role === "cloud");
  const queue   = nodes.filter((n) => n.role === "queue");
  const service = nodes.filter((n) => n.role === "service"  || n.role === "worker");
  const data    = nodes.filter((n) => n.role === "database" || n.role === "cache");

  return [
    ...row(entry,   20, PDF_PAD,                  W * 0.52),
    ...row(cloud,   20, PDF_PAD + W * 0.64,        W * 0.36),
    ...row(queue,   96, PDF_PAD + W * 0.20,        W * 0.60),
    ...row(service, 172, PDF_PAD,                  W - PDF_PAD * 2),
    ...row(data,    252, PDF_PAD,                  W - PDF_PAD * 2),
  ];
}

function drawArchitectureDiagram(doc, diagramData) {
  if (!diagramData?.nodes?.length) return;

  const { w, h } = PDF_NODE;
  const ml = doc.page.margins.left;

  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text("Architecture Diagram", ml, 48);
  doc.moveDown(0.8);

  const boardY = doc.y;
  const layout = pdfDiagramLayout(diagramData.nodes);
  const nodeMap = new Map(layout.map((n) => [n.id, n]));

  const maxY = layout.reduce((m, n) => Math.max(m, n.y), 0);
  const boardH = maxY + h + 28;

  /* Board background */
  doc.roundedRect(ml - 8, boardY - 8, 478 + 16, boardH + 16, 8).fill("#f8fafc");
  doc.roundedRect(ml - 8, boardY - 8, 478 + 16, boardH + 16, 8).lineWidth(0.8).stroke("#e2e8f0");

  /* Zone labels */
  const zoneRows = [
    { role: ["client", "balancer", "cloud"], label: "INPUT + EDGE" },
    { role: ["service", "worker"],           label: "APPLICATION SERVICES" },
    { role: ["database", "cache"],           label: "DATA + INFRA" },
  ];
  zoneRows.forEach(({ role, label }) => {
    const match = layout.find((n) => role.includes(n.role));
    if (match) {
      doc.font("Helvetica-Bold").fontSize(6).fillColor("#94a3b8")
        .text(label, ml, boardY + match.y - 14, { lineBreak: false });
    }
  });

  /* Edges */
  (diagramData.edges || []).forEach((edge) => {
    const src = nodeMap.get(edge.from);
    const tgt = nodeMap.get(edge.to);
    if (!src || !tgt) return;

    doc.save();
    doc.strokeColor("#cbd5e1").lineWidth(0.8);

    const sx = ml + src.x + w / 2;
    const sy = boardY + src.y + h;
    const tx = ml + tgt.x + w / 2;
    const ty = boardY + tgt.y;

    if (src.y < tgt.y - 10) {
      const my = sy + (ty - sy) * 0.5;
      doc.moveTo(sx, sy).lineTo(sx, my).lineTo(tx, my).lineTo(tx, ty).stroke();
    } else if (src.x + w < tgt.x) {
      const srcR  = ml + src.x + w;
      const tgtL  = ml + tgt.x;
      const midX  = srcR + (tgtL - srcR) * 0.5;
      const cy    = boardY + src.y + h / 2;
      const cyt   = boardY + tgt.y + h / 2;
      doc.moveTo(srcR, cy).lineTo(midX, cy).lineTo(midX, cyt).lineTo(tgtL, cyt).stroke();
    }

    /* Edge label */
    if (edge.label) {
      const lx = (sx + tx) / 2;
      const ly = (boardY + src.y + h + boardY + tgt.y) / 2 - 5;
      doc.roundedRect(lx - 20, ly - 4, 40, 11, 3).fill("#ffffff").stroke("#e2e8f0");
      doc.font("Helvetica").fontSize(5.5).fillColor("#64748b")
        .text(edge.label.slice(0, 12), lx - 18, ly, { lineBreak: false });
    }

    doc.restore();
  });

  /* Nodes */
  layout.forEach((node) => {
    const style = ROLE_STYLE[node.role] || ROLE_STYLE.service;
    const x = ml + node.x;
    const y = boardY + node.y;

    doc.roundedRect(x, y, w, h, 5).fill(style.fill);
    doc.roundedRect(x, y, w, h, 5).lineWidth(1).stroke(style.stroke);

    doc.font("Helvetica-Bold").fontSize(6).fillColor(style.badge)
      .text(node.role.toUpperCase(), x + 5, y + 5, { lineBreak: false });

    const lbl = node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#1e293b")
      .text(lbl, x + 5, y + 15, { width: w - 10, lineBreak: false });

    if (node.description) {
      const dsc = node.description.length > 28 ? node.description.slice(0, 26) + "…" : node.description;
      doc.font("Helvetica").fontSize(6.5).fillColor("#64748b")
        .text(dsc, x + 5, y + 29, { width: w - 10, lineBreak: false });
    }
  });

  /* Components legend below board */
  doc.y = boardY + boardH + 28;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text("Components");
  doc.moveDown(0.4);
  layout.forEach((node) => {
    const style = ROLE_STYLE[node.role] || ROLE_STYLE.service;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(style.stroke).text(`${node.label}  `, { continued: true });
    doc.font("Helvetica").fillColor("#6b7280").text(`(${node.role}) — ${node.description || ""}`);
  });
}

/* ── Word: build components table ──────────────────────────────────── */

function buildDocxComponentsTable(diagramData) {
  if (!diagramData?.nodes?.length) return [];

  const headerRow = new TableRow({
    tableHeader: true,
    children: ["Component", "Role", "Description"].map(
      (text) =>
        new TableCell({
          shading: { fill: "111827" },
          children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })] })],
        })
    ),
  });

  const dataRows = diagramData.nodes.map(
    (node) =>
      new TableRow({
        children: [node.label, node.role, node.description || ""].map(
          (text) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
            })
        ),
      })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const heading = new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: "Architecture Components", bold: true })],
  });

  const spacer = new Paragraph({ text: "" });

  const connectionsHeading = new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: "Component Connections", bold: true })],
    spacing: { before: 240 },
  });

  const connectionItems = (diagramData.edges || []).map((edge) => {
    const src = diagramData.nodes.find((n) => n.id === edge.from)?.label || edge.from;
    const tgt = diagramData.nodes.find((n) => n.id === edge.to)?.label || edge.to;
    return new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: `${src}`, bold: true }),
        new TextRun({ text: ` → ${tgt}` }),
        ...(edge.label ? [new TextRun({ text: ` (${edge.label})`, italics: true, color: "4B5563" })] : []),
      ],
    });
  });

  return [heading, spacer, table, connectionsHeading, ...connectionItems, spacer];
}

/* ── Markdown → DOCX ──────────────────────────────────────────────── */

function markdownToDocx(markdown, design) {
  const paragraphs = markdown.split("\n").reduce((acc, line) => {
    /* Skip the Mermaid block in docx — handled by the components table */
    if (line.trim() === "```mermaid" || line.trim() === "```") return acc;

    if (!line.trim()) { acc.push(new Paragraph({ text: "" })); return acc; }

    if (line.startsWith("# ")) {
      acc.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line.slice(2), bold: true })] }));
      return acc;
    }
    if (line.startsWith("## ")) {
      acc.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line.slice(3), bold: true })] }));
      return acc;
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      /* Strip markdown bold/italic markers */
      const text = line.slice(2).replace(/\*\*/g, "").replace(/`/g, "");
      acc.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text })] }));
      return acc;
    }

    const text = line.replace(/\*\*/g, "").replace(/`/g, "");
    acc.push(new Paragraph({ children: [new TextRun({ text })] }));
    return acc;
  }, []);

  /* Insert components table after the document heading */
  const componentBlocks = buildDocxComponentsTable(design?.architecture?.diagram);

  const doc = new Document({
    sections: [{ properties: {}, children: [...paragraphs, ...componentBlocks] }],
  });

  return Packer.toBuffer(doc);
}

/* ── Markdown → PDF ───────────────────────────────────────────────── */

function markdownToPdf(markdown, design) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let inMermaid = false;

    markdown.split("\n").forEach((line) => {
      /* Skip Mermaid code block — handled by the drawn diagram */
      if (line.trim() === "```mermaid") { inMermaid = true;  return; }
      if (line.trim() === "```")        { inMermaid = false; return; }
      if (inMermaid) return;

      if (!line.trim()) { doc.moveDown(0.5); return; }

      if (line.startsWith("# ")) {
        doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(line.slice(2));
        doc.moveDown(0.4);
        return;
      }
      if (line.startsWith("## ")) {
        doc.font("Helvetica-Bold").fontSize(13).fillColor("#1f2937").text(line.slice(3));
        doc.moveDown(0.2);
        return;
      }
      if (line.startsWith("- ") || line.startsWith("• ")) {
        const text = line.slice(2).replace(/\*\*/g, "").replace(/`/g, "");
        doc.font("Helvetica").fontSize(10.5).fillColor("#374151").text(`• ${text}`, { indent: 12 });
        return;
      }
      const text = line.replace(/\*\*/g, "").replace(/`/g, "");
      doc.font("Helvetica").fontSize(10.5).fillColor("#374151").text(text);
    });

    /* Draw the architecture diagram on a new page */
    drawArchitectureDiagram(doc, design?.architecture?.diagram);

    doc.end();
  });
}

async function handleGenerate(request, response, clientIp) {
  const payload = sanitizePromptPayload(await readJsonBody(request));
  if (!payload.prompt) {
    sendJson(response, 400, { error: "Prompt is required." });
    return;
  }

  const authUser = await getAuthUser(request);
  if (REQUIRE_AUTH_AI && !authUser) {
    sendJson(response, 401, { error: "Sign in to generate designs.", code: "AUTH_REQUIRED" });
    return;
  }

  if (isRateLimited(clientIp, 40, 60 * 60 * 1000, "generate-hourly")) {
    sendJson(response, 429, { error: "Too many generations this hour. Try again later." });
    return;
  }

  const { design: generated, usedFallback, reason, generationMeta } = await generateDesign(payload);
  const record = createRecord(generated);

  // If the user is authenticated, persist the design to the database.
  if (authUser) {
    const cReqs = payload.constraints?.customRequirements || "";
    const domainMatch  = cReqs.match(/Domain:\s*([^·]+)/);
    const patternMatch = cReqs.match(/Pattern:\s*([^·]+)/);
    await pool.query(
      `INSERT INTO designs (id, user_id, idea, summary, domain, pattern, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         idea = EXCLUDED.idea,
         summary = EXCLUDED.summary,
         domain = EXCLUDED.domain,
         pattern = EXCLUDED.pattern,
         data = EXCLUDED.data`,
      [
        record.id,
        authUser.id,
        record.idea,
        String(record.architecture?.summary || "").slice(0, 200),
        domainMatch  ? domainMatch[1].trim()  : null,
        patternMatch ? patternMatch[1].trim() : null,
        JSON.stringify(record),
      ],
    );
  }

  sendJson(response, 200, {
    recordId: record.id,
    data: record,
    usedFallback,
    generationMeta,
    ...(usedFallback && reason ? { fallbackReason: reason } : {}),
  });
}

async function handleExport(request, response) {
  const authUser = await getAuthUser(request);
  if (REQUIRE_AUTH_AI && !authUser) {
    sendJson(response, 401, { error: "Sign in to export PDF or Word.", code: "AUTH_REQUIRED" });
    return;
  }

  const payload = await readJsonBody(request);
  const format = typeof payload.format === "string" ? payload.format.toLowerCase() : "";
  const recordId = typeof payload.recordId === "string" ? payload.recordId.trim() : "";

  let rawData = payload.data;
  if (REQUIRE_AUTH_AI && authUser && recordId) {
    const { rows: exportRows } = await pool.query(
      "SELECT data FROM designs WHERE id = $1 AND user_id = $2",
      [recordId, authUser.id],
    );
    const row = exportRows[0];
    if (!row) {
      sendJson(response, 404, { error: "Design not found for export." });
      return;
    }
    try {
      rawData = JSON.parse(row.data);
    } catch {
      sendJson(response, 500, { error: "Stored design is invalid." });
      return;
    }
  }

  const design = normalizeDesign(rawData);

  if (!hasMeaningfulDesign(rawData)) {
    sendJson(response, 400, { error: "Export is blocked until a design is generated." });
    return;
  }

  const markdown = generateMarkdown(design);

  if (!markdown.trim()) {
    sendJson(response, 400, { error: "Export failed because the design is empty." });
    return;
  }

  if (format === "md") {
    sendBuffer(response, 200, Buffer.from(markdown, "utf8"), "text/markdown; charset=utf-8", "system-design.md");
    return;
  }

  if (format === "pdf") {
    const pdfBuffer = await markdownToPdf(markdown, design);
    sendBuffer(response, 200, pdfBuffer, "application/pdf", "system-design.pdf");
    return;
  }

  if (format === "docx") {
    const docxBuffer = await markdownToDocx(markdown, design);
    sendBuffer(
      response,
      200,
      docxBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "system-design.docx"
    );
    return;
  }

  sendJson(response, 400, { error: "Unsupported export format." });
}

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`;

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  /* Reflect the allowed origin; fall back to wildcard only in dev */
  response.setHeader("Access-Control-Allow-Origin", IS_PROD ? ALLOWED_ORIGIN : (origin || "*"));
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");

  /* Security headers */
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-XSS-Protection", "1; mode=block");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const clientIp = getClientIp(request);

  try {
    if (request.method === "GET" && request.url === "/api/health") {
      let dbOk = false;
      try {
        await pool.query("SELECT 1");
        dbOk = true;
      } catch {
        /* ignore */
      }
      sendJson(response, 200, {
        status: dbOk ? "ok" : "degraded",
        db: dbOk,
        geminiConfigured: Boolean(GEMINI_API_KEY),
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/public-config") {
      sendJson(response, 200, { requireAuthForAi: REQUIRE_AUTH_AI });
      return;
    }

    /* ── Auth (rate-limited: 10 req/min per IP) ── */
    if (request.method === "POST" && request.url === "/api/auth/signup") {
      if (isRateLimited(clientIp, 10)) { sendJson(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
      await handleSignup(request, response); return;
    }
    if (request.method === "POST" && request.url === "/api/auth/login") {
      if (isRateLimited(clientIp, 10)) { sendJson(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
      await handleLogin(request, response); return;
    }
    if (request.method === "GET" && request.url === "/api/auth/me") {
      await handleMe(request, response); return;
    }
    if (request.method === "POST" && request.url === "/api/auth/logout") {
      sendJson(response, 200, { ok: true }); return;
    }
    if (request.method === "POST" && request.url === "/api/auth/forgot-password") {
      if (isRateLimited(clientIp, 5)) { sendJson(response, 429, { error: "Too many reset requests. Try again in a minute." }); return; }
      await handleForgotPassword(request, response); return;
    }
    if (request.method === "POST" && request.url === "/api/auth/reset-password") {
      if (isRateLimited(clientIp, 10)) { sendJson(response, 429, { error: "Too many attempts. Try again in a minute." }); return; }
      if (isRateLimited(clientIp, 40, 60 * 60 * 1000, "reset-password-hourly")) {
        sendJson(response, 429, { error: "Too many reset attempts this hour. Try again later." });
        return;
      }
      await handleResetPassword(request, response, clientIp); return;
    }

    /* ── Designs CRUD ── */
    if (request.method === "GET" && request.url === "/api/designs") {
      await handleGetDesigns(request, response); return;
    }
    if (request.method === "DELETE" && request.url.startsWith("/api/designs/")) {
      const id = request.url.replace("/api/designs/", "").split("?")[0];
      await handleDeleteDesign(request, response, id); return;
    }

    /* ── Job applications (tracker + resume tailor) ── */
    if (request.method === "GET" && request.url.split("?")[0] === "/api/jobs/applications") {
      await handleListJobApplications(request, response); return;
    }
    if (request.method === "POST" && request.url.split("?")[0] === "/api/jobs/applications") {
      if (isRateLimited(clientIp, 60, 60_000, "jobs-post")) {
        sendJson(response, 429, { error: "Too many requests. Try again in a minute." }); return;
      }
      await handleCreateJobApplication(request, response); return;
    }
    if (request.method === "POST" && request.url.split("?")[0] === "/api/jobs/tailor-resume") {
      await handleTailorResume(request, response, clientIp); return;
    }
    {
      const patchPath = request.url.split("?")[0];
      const updatesMatch = /^\/api\/jobs\/applications\/([^/]+)\/updates$/.exec(patchPath);
      if (request.method === "POST" && updatesMatch) {
        if (isRateLimited(clientIp, 120, 60_000, "jobs-updates")) {
          sendJson(response, 429, { error: "Too many requests. Try again in a minute." }); return;
        }
        await handleAddJobUpdate(request, response, updatesMatch[1]); return;
      }
      const appMatch = /^\/api\/jobs\/applications\/([^/]+)$/.exec(patchPath);
      if (appMatch) {
        const jobId = appMatch[1];
        if (request.method === "PATCH") {
          await handlePatchJobApplication(request, response, jobId); return;
        }
        if (request.method === "DELETE") {
          await handleDeleteJobApplication(request, response, jobId); return;
        }
      }
    }

    /* ── AI + Export ── */
    if (request.method === "POST" && request.url === "/api/generate") {
      await handleGenerate(request, response, clientIp);
      return;
    }

    if (request.method === "POST" && request.url === "/api/export") {
      await handleExport(request, response);
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const filePath = resolveStaticPath(requestUrl.pathname);
    const indexPath = path.join(STATIC_ROOT, "index.html");

    if (!filePath) {
      sendJson(response, 403, { error: "Forbidden." });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(response, filePath);
      return;
    }

    sendFile(response, indexPath);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Internal server error." });
  }
});

async function start() {
  try {
    await initSchema();
  } catch (err) {
    console.error("[fatal] Database schema init failed:", err);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`System Design Assistant running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
