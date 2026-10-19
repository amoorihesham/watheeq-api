/** `last_seen_at` is rewritten at most once per minute per session (spec 4.3, "Request authentication"). */
export const LAST_SEEN_RESOLUTION_MS = 60_000;

/** A valid session as a realm's lookup returns it, with the principal it authenticates. */
export interface ResolvedSession<P> {
  sessionId: string;
  lastSeenAt: Date;
  principal: P;
}
