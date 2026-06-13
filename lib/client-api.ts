// Small fetch helper for client components: unwraps JSON and turns the
// server's { error } payloads into thrown Errors.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error body; fall through to status-based error
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function isStale(iso: string | null, maxAgeHours = 24): boolean {
  if (!iso) return true;
  return Date.now() - Date.parse(iso) > maxAgeHours * 3600_000;
}

// Next Monday (or today if it is Monday) — default block start.
export function nextMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 1 ? 0 : (8 - day) % 7;
  d.setDate(d.getDate() + offset);
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}
