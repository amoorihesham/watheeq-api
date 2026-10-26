import { z } from "zod";

/** A pending file as the API returns it. */
export const fileResponseSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
  sha256: z.string(),
  expiresAt: z.date(),
});
