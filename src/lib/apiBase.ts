export function apiUrl(path: string): string {
    const base = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    return base === "" ? p : `${base}${p}`;
}
