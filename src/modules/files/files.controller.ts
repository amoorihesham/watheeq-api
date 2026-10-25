import type { Request, RequestHandler } from "express";
import { principalOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { FileResponseType, FilesServiceType } from "./files.types.js";
import { sendDownload } from "./shared/download.js";
import { declaredSizeOf } from "./shared/upload-headers.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const userOf = (req: Request) => principalOf(req).id;
const fileIdOf = (req: Request) => String(req.params.fileId);

export function createFilesController({ service }: { service: FilesServiceType }) {
  return {
    upload: (async (req, res) => {
      const declaredSize = declaredSizeOf(req);
      const file = await service.upload(
        {
          tenantId: tenantOf(req),
          userId: userOf(req),
          name: req.query.name,
          declaredSize,
          body: req,
        },
        req.log,
      );
      res.status(201).json({ file } satisfies FileResponseType);
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const file = await service.get(tenantOf(req), userOf(req), fileIdOf(req));
      res.status(200).json({ file } satisfies FileResponseType);
    }) satisfies RequestHandler,

    content: (async (req, res) => {
      const { file, body } = await service.open(tenantOf(req), userOf(req), fileIdOf(req));
      await sendDownload(res, file, body);
    }) satisfies RequestHandler,

    discard: (async (req, res) => {
      await service.discard(tenantOf(req), userOf(req), fileIdOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
