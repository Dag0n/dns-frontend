// src/api.js
import { API_BASE } from "./config";

// Called when an AUTHENTICATED request comes back 401 (expired/revoked
// token) so the app can drop the stale session instead of showing raw
// errors on every page. Registered once by App; login's own 401s (wrong
// password) don't trigger it because no token is sent.
let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

export async function apiRequest(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = token; // PocketBase expects the raw token

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && token && unauthorizedHandler) {
      unauthorizedHandler();
    }
    const message = data.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}
