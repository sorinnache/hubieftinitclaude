export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function detailToText(detail) {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = (d.loc || []).slice(1).join(".");
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  return JSON.stringify(detail);
}

export async function api(path, { method = "GET", body, form, signal } = {}) {
  const opts = { method, credentials: "include", signal, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (e) {
    throw new ApiError("Nu există conexiune la server. Verifică internetul.", 0);
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/public")) {
      window.dispatchEvent(new Event("hub:unauthorized"));
    }
    throw new ApiError(detailToText(data?.detail) || `Eroare ${res.status}`, res.status);
  }
  return data;
}

export const fileUrl = (id, download = false) => `/api/files/${id}${download ? "?download=1" : ""}`;
