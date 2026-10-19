import type { Db, Tx } from "./pool.js";

/**
 * What a repository function runs its query on: the pool-backed `Db` for a standalone statement,
 * or a `Tx` when the service has opened a transaction. Repositories never open transactions themselves.
 */
export type Executor = Db | Tx;
