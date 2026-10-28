import { z } from 'zod';
import { idSchema } from '@/http/validate.js';

export const fileIdSchema = idSchema;

/**
 * `name` is a string, but a missing or repeated one becomes "" so that the file-name rules answer it with
 * `invalid_name`, as before. `default: undefined` keeps the catch value out of the document.
 */
export const uploadQuerySchema = z.object({
  name: z.string().catch('').meta({ description: 'The file name, with an extension.', default: undefined }),
});
