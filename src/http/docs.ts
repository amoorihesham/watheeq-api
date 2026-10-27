import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import { noStore } from "@/middleware/no-store.js";

const SCRIPT_PATH = "/docs/scalar.js";

// The package's subpaths are not exported, so the standalone bundle is found next to its main entry.
const scriptDir = join(
  dirname(createRequire(import.meta.url).resolve("@scalar/api-reference")),
  "browser",
);

/**
 * The OpenAPI document and its Scalar reference page (Phase 10 spec 4.6). The page's script is served from the
 * package rather than the CDN the renderer defaults to, so it loads nothing from a third-party host (R10.10).
 */
export function createDocsRouter(document: object): express.Router {
  const router = express.Router();
  router.get("/openapi.json", noStore, (_req, res) => {
    res.json(document);
  });
  router.get(
    "/docs",
    noStore,
    apiReference({
      url: "/openapi.json",
      cdn: SCRIPT_PATH,
      // The package's defaults reach third-party hosts (fonts, usage telemetry); R10.10 allows none.
      withDefaultFonts: false,
      telemetry: false,
      pageTitle: "Watheeq API reference",
    }),
  );
  router.get(SCRIPT_PATH, (_req, res) => {
    // `root` keeps a dot directory above the package (a worktree, for one) from being refused as a dotfile.
    res.sendFile("standalone.js", { root: scriptDir });
  });
  return router;
}
