import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { filesApi } from "./files.endpoints.js";
import type { FilesServiceType } from "./files.types.js";
import { declaredSizeOf } from "./shared/upload-headers.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const userOf = (req: Request) => principalOf(req).id;

export function createFilesController({ service }: { service: FilesServiceType }) {
  return {
    upload: (async ({ query }, req) =>
      service.upload(
        {
          tenantId: tenantOf(req),
          userId: userOf(req),
          name: query.name,
          declaredSize: declaredSizeOf(req),
          body: req,
        },
        req.log,
      )) satisfies HandlerOf<typeof filesApi.endpoints.upload>,

    get: (async ({ params }, req) =>
      service.get(tenantOf(req), userOf(req), params.fileId)) satisfies HandlerOf<
      typeof filesApi.endpoints.get
    >,

    content: (async ({ params }, req) =>
      service.open(tenantOf(req), userOf(req), params.fileId)) satisfies HandlerOf<
      typeof filesApi.endpoints.content
    >,

    discard: (async ({ params }, req) => {
      await service.discard(tenantOf(req), userOf(req), params.fileId);
    }) satisfies HandlerOf<typeof filesApi.endpoints.discard>,
  };
}
