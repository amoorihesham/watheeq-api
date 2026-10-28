import express from 'express';

interface LayerType {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: LayerType[] };
}
interface RouterType {
  stack: LayerType[];
  use: (...args: unknown[]) => unknown;
}

/**
 * Express 5 keeps no mount prefix as a string: a layer holds only a compiled matcher. While the app is built, this
 * wraps `Router.prototype.use` to remember the path each layer was mounted at, so the stack can be walked afterwards.
 */
export function routesOfApp(build: () => express.Express): string[] {
  const proto = express.Router.prototype as unknown as RouterType;
  const original = proto.use;
  const prefixOf = new WeakMap<LayerType, string>();
  proto.use = function use(this: RouterType, ...args: unknown[]) {
    const before = this.stack.length;
    const result = original.apply(this, args);
    const path = args[0];
    if (Array.isArray(path)) {
      throw new Error('an array mount path cannot be listed by the contract test');
    }
    for (const layer of this.stack.slice(before)) {
      prefixOf.set(layer, typeof path === 'string' ? path : '/');
    }
    return result;
  };
  let app: express.Express;
  try {
    app = build();
  } finally {
    proto.use = original;
  }

  const joinPaths = (base: string, path: string) => `${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  const walk = (stack: LayerType[], base: string): string[] =>
    stack.flatMap((layer) => {
      if (layer.route) {
        const full = joinPaths(base, layer.route.path);
        return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${full}`);
      }
      return layer.handle?.stack ? walk(layer.handle.stack, joinPaths(base, prefixOf.get(layer) ?? '/')) : [];
    });
  return walk((app as unknown as { router: RouterType }).router.stack, '/');
}

/** Path parameter names are free (`:id` is `:requestId`), so every parameter compares as `:param`. */
export const normalize = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, ':param');
