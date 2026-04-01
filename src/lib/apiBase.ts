/**
 * API request URL. In dev / same-origin deploy, `VITE_API_BASE_URL` is unset → relative `/api/...`.
 * For GitHub Pages, set `VITE_API_BASE_URL` at build time to your Node backend (https://…, no trailing slash).
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base === "" ? p : `${base}${p}`;
}
