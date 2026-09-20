/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the backend, e.g. https://box.tailnet-name.ts.net
   *
   * Left unset (the default) the app calls same-origin `/api/...`, which is
   * what the Vite dev proxy and the single-process production build both want.
   * Set it only when the frontend is deployed apart from the API.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
