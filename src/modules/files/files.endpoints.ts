import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { fileResponseSchema } from "./files.responses.js";
import { fileIdSchema, uploadQuerySchema } from "./files.schemas.js";

const fileParams = z.strictObject({ fileId: fileIdSchema });

/**
 * Any active member may use these (Q9, a recorded exception to T24), so no permission is declared; every query is
 * limited to the caller's own pending uploads.
 */
export const filesApi = defineApi({
  tag: "files",
  prefix: "/files",
  realm: "tenant",
  endpoints: {
    upload: defineEndpoint({
      method: "post",
      path: "/",
      summary:
        "Upload a file as raw bytes (application/octet-stream, Content-Length required) to attach later",
      query: uploadQuerySchema,
      body: { kind: "binary" },
      response: { kind: "data", status: 201, schema: fileResponseSchema },
      errors: [
        "UPLOAD_QUOTA_REACHED",
        "STORAGE_LIMIT_REACHED",
        "LENGTH_REQUIRED",
        "FILE_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "FILE_TYPE_NOT_ALLOWED",
      ],
    }),
    get: defineEndpoint({
      method: "get",
      path: "/:fileId",
      summary: "One of the caller's pending uploads",
      params: fileParams,
      response: { kind: "data", status: 200, schema: fileResponseSchema },
    }),
    content: defineEndpoint({
      method: "get",
      path: "/:fileId/content",
      summary: "Download one of the caller's pending uploads",
      params: fileParams,
      response: { kind: "download" },
    }),
    discard: defineEndpoint({
      method: "delete",
      path: "/:fileId",
      summary: "Discard one of the caller's pending uploads",
      params: fileParams,
      response: { kind: "noContent" },
    }),
  },
});
