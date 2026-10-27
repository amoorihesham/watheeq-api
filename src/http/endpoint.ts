import type { Readable } from "node:stream";
import { type Request, type RequestHandler, type Response, Router } from "express";
import type { z } from "zod";
import type { Db } from "@/db/pool.js";
import { noStore } from "@/middleware/no-store.js";
import { authenticate, requireRole } from "@/modules/auth/shared/middlewares.js";
import type { FileDownloadType } from "@/modules/files/files.types.js";
import { sendDownload } from "@/modules/files/shared/download.js";
import { requirePlatformPermission } from "@/modules/platform/shared/middlewares.js";
import {
  requireActiveSubscription,
  subscriptionGuard,
} from "@/modules/subscriptions/shared/middlewares.js";
import { requireTenantPermission } from "@/modules/tenant-access/shared/middlewares.js";
import { AppError, type ErrorCode } from "./errors.js";
import { type PageType, sendData, sendNoContent, sendPage } from "./respond.js";
import { validate } from "./validate.js";

/**
 * Every endpoint is declared once as data (Phase 10 spec 4.3); the router, the input validation, the response, and
 * the OpenAPI document are all built from the declaration. Middleware is imported from the modules' `shared/` files,
 * never their index: each module's `<module>.endpoints.ts` imports this file, and an index would close a cycle.
 */

/** Which guards run before an endpoint; each realm is today's `router.use` chain of that kind of route. */
export type RealmType = "open" | "public" | "session" | "operator" | "tenant" | "tenantInbox";

type StepType = "noStore" | "authenticate" | "operator" | "user" | "subscription";

const REALM_STEPS: Record<RealmType, readonly StepType[]> = {
  open: [],
  public: ["noStore"],
  session: ["noStore", "authenticate"],
  operator: ["noStore", "authenticate", "operator"],
  tenant: ["noStore", "authenticate", "user", "subscription"],
  tenantInbox: ["noStore", "authenticate", "user"],
};

export type MethodType = "get" | "post" | "put" | "patch" | "delete";

export type PermissionDeclType =
  | { tenant: Parameters<typeof requireTenantPermission>[0] }
  | { platform: Parameters<typeof requirePlatformPermission>[0] };

export type ResponseDeclType =
  | { kind: "data"; status: 200 | 201; schema: z.ZodType }
  | { kind: "page"; schema: z.ZodType }
  | { kind: "noContent" }
  | { kind: "download" };

export interface BinaryBodyType {
  kind: "binary";
}

export interface EndpointType {
  method: MethodType;
  /** As mounted inside the group; `:name` is a path parameter. */
  path: string;
  summary: string;
  /** Overrides the group's realm; its guards must extend the group's (auth's `me` and `password`). */
  realm?: RealmType;
  permission?: PermissionDeclType;
  activeSubscription?: true;
  /** Required when the path has parameters; its keys are exactly their names. */
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType | BinaryBodyType;
  response: ResponseDeclType;
  /** The codes this endpoint adds to those its realm, permission, and inputs imply (spec 4.5). */
  errors?: readonly ErrorCode[];
}

export interface ApiType<E extends Record<string, EndpointType> = Record<string, EndpointType>> {
  tag: string;
  prefix: string;
  realm: RealmType;
  endpoints: E;
}

export const defineEndpoint = <const E extends EndpointType>(endpoint: E): E => endpoint;

export const defineApi = <const E extends Record<string, EndpointType>>(
  api: ApiType<E>,
): ApiType<E> => api;

export const isBinaryBody = (body: EndpointType["body"]): body is BinaryBodyType =>
  body !== undefined && "kind" in body && body.kind === "binary";

export const realmOf = (api: ApiType, endpoint: EndpointType): RealmType =>
  endpoint.realm ?? api.realm;

/** Whether the realm requires the access cookie. */
export const isAuthenticatedRealm = (realm: RealmType): boolean =>
  REALM_STEPS[realm].includes("authenticate");

/** The path as the document and the route list write it: prefix and path joined, no trailing slash. */
export const fullPathOf = (api: ApiType, endpoint: EndpointType): string =>
  `${api.prefix}/${endpoint.path}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

export const pathParamNames = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? "");

// What a handler receives and returns, inferred from the declaration.
type InputOf<E extends EndpointType> = (E extends { params: infer P extends z.ZodType }
  ? { params: z.output<P> }
  : unknown) &
  (E extends { query: infer Q extends z.ZodType } ? { query: z.output<Q> } : unknown) &
  (E extends { body: infer B extends z.ZodType } ? { body: z.output<B> } : unknown);

export interface DownloadResultType {
  file: FileDownloadType;
  body: Readable;
}

type ResultOf<E extends EndpointType> = E extends {
  response: { kind: "data"; schema: infer S extends z.ZodType };
}
  ? z.output<S>
  : E extends { response: { kind: "page"; schema: infer S extends z.ZodType } }
    ? PageType<z.output<S>>
    : E extends { response: { kind: "download" } }
      ? DownloadResultType
      : never;

/** A handler gets the parsed input and returns what the builder sends; it keeps `req` and `res` for the caller and cookies. */
export type HandlerOf<E extends EndpointType> = (
  input: InputOf<E>,
  req: Request,
  res: Response,
) => E extends { response: { kind: "noContent" } } ? Promise<void> : Promise<ResultOf<E>>;

export type HandlersOf<A extends ApiType> = {
  [K in keyof A["endpoints"]]: HandlerOf<A["endpoints"][K]>;
};

type NoExtraKeys<H, A extends ApiType> = { [K in Exclude<keyof H, keyof A["endpoints"]>]: never };

export interface EndpointDepsType {
  db: Db;
  jwtSecret: string;
}

function stepHandler(step: StepType, deps: EndpointDepsType | undefined): RequestHandler {
  if (step === "noStore") {
    return noStore;
  }
  if (!deps) {
    throw new Error(`the guard "${step}" needs buildRouter deps`);
  }
  const { db, jwtSecret } = deps;
  switch (step) {
    case "authenticate":
      return authenticate(jwtSecret);
    case "operator":
      return requireRole("operator");
    case "user":
      return requireRole("user");
    case "subscription":
      return subscriptionGuard(db);
  }
}

/** The guards an endpoint adds to its group's realm; its own realm must start with the group's guards. */
function extraSteps(api: ApiType, endpoint: EndpointType, name: string): readonly StepType[] {
  const group = REALM_STEPS[api.realm];
  const own = REALM_STEPS[realmOf(api, endpoint)];
  if (!group.every((step, index) => own[index] === step)) {
    throw new Error(`${api.tag}.${name}: its realm must extend the realm of its group`);
  }
  return own.slice(group.length);
}

function checkDeclaration(api: ApiType, name: string, endpoint: EndpointType): void {
  const declared = Object.keys(endpoint.params?.shape ?? {}).sort();
  const inPath = pathParamNames(endpoint.path).sort();
  if (declared.join() !== inPath.join()) {
    throw new Error(
      `${api.tag}.${name}: params [${declared.join(", ")}] do not match the path ${endpoint.path}`,
    );
  }
}

function permissionGuard(permission: PermissionDeclType): RequestHandler {
  return "tenant" in permission
    ? requireTenantPermission(permission.tenant)
    : requirePlatformPermission(permission.platform);
}

/**
 * The last step of an endpoint: parses params, then query, then body (R10.3), calls the handler, and sends its
 * result with the declared kind. The parsed input is passed on as an argument, never written back to `req`:
 * `req.query` is a getter in Express 5.
 */
function inputStep(
  endpoint: EndpointType,
  handler: (input: object, req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  const { params, query, body, response } = endpoint;
  return async (req, res) => {
    const input: { params?: unknown; query?: unknown; body?: unknown } = {};
    if (params) {
      const parsed = params.safeParse(req.params);
      // A malformed ID is answered like an unknown one.
      if (!parsed.success) {
        throw new AppError("NOT_FOUND");
      }
      input.params = parsed.data;
    }
    if (query) {
      input.query = validate(query, req.query);
    }
    if (body && !isBinaryBody(body)) {
      input.body = validate(body, req.body);
    }
    const result = await handler(input, req, res);
    switch (response.kind) {
      case "data":
        sendData(res, response.status, response.schema, result);
        return;
      case "page":
        sendPage(res, response.schema, result as PageType<unknown>);
        return;
      case "noContent":
        sendNoContent(res);
        return;
      case "download": {
        const { file, body: stream } = result as DownloadResultType;
        await sendDownload(res, file, stream);
        return;
      }
    }
  };
}

/**
 * Mounts a group's endpoints in declaration order, so a literal path declared before `/:id` wins as it does in
 * Express. Per endpoint: the group's realm chain once, then the realm extras, the permission, the active-subscription
 * guard, and the input step.
 */
export function buildRouter<A extends ApiType, H extends HandlersOf<A>>(
  api: A,
  handlers: H & NoExtraKeys<H, A>,
  /** Only the `open` and `public` realms may leave it out. */
  deps?: EndpointDepsType,
): Router {
  const router = Router();
  const groupSteps = REALM_STEPS[api.realm].map((step) => stepHandler(step, deps));
  if (groupSteps.length > 0) {
    router.use(...groupSteps);
  }
  for (const [name, endpoint] of Object.entries(api.endpoints)) {
    checkDeclaration(api, name, endpoint);
    const handler = (handlers as Record<string, unknown>)[name];
    if (typeof handler !== "function") {
      throw new Error(`${api.tag}.${name} has no handler`);
    }
    router[endpoint.method](
      endpoint.path,
      ...extraSteps(api, endpoint, name).map((step) => stepHandler(step, deps)),
      ...(endpoint.permission ? [permissionGuard(endpoint.permission)] : []),
      ...(endpoint.activeSubscription ? [requireActiveSubscription()] : []),
      inputStep(endpoint, handler as Parameters<typeof inputStep>[1]),
    );
  }
  return router;
}
