import type { AuthUserType } from "@/modules/auth/auth.types.js";

// A .ts file, not .d.ts: skipLibCheck skips every .d.ts, so a broken import here would silently make `auth` any.
declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate()`; read it through `principalOf(req)`. */
      auth?: AuthUserType;
    }
  }
}
