// Base URL for the PocketBase API.
// Production builds use "" (same-origin: PocketBase serves both the frontend
// and the API, so no CORS). The 127.0.0.1 fallback applies ONLY to `npm run
// dev` against a local PocketBase — production can no longer accidentally
// bake in localhost by forgetting VITE_API_BASE.
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8090" : "");
