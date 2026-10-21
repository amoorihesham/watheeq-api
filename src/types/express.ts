import type { AuthUserType } from "@/modules/auth/auth.types.js";
import type { SubscriptionContextType } from "@/modules/subscriptions/subscriptions.types.js";

// A .ts file, not .d.ts: skipLibCheck skips every .d.ts, so a broken import here would silently make these any.
declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate()`; read it through `principalOf(req)`. */
      auth?: AuthUserType;
      /** Set by `subscriptionGuard`; read it through `subscriptionOf(req)`. */
      subscription?: SubscriptionContextType;
    }
  }
}
