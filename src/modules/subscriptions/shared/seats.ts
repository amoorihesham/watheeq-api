import type { Tx } from "@/db/pool.js";
import { AppError } from "@/http/errors.js";
import { createSubscriptionsRepository } from "../subscriptions.repository.js";

const repo = createSubscriptionsRepository();

/**
 * Throws USER_LIMIT_REACHED when the tenant already has as many active members as its limit (R1.12).
 * Call it in the same transaction, right before adding or reactivating a member. The advisory lock makes a
 * second concurrent caller wait, then count the first caller's member, so the limit holds.
 */
export async function assertSeatAvailable(tx: Tx, tenantId: string): Promise<void> {
  await repo.lockSeats(tx, tenantId);
  const [limit] = await repo.findUserLimit(tx, tenantId);
  if (!limit) {
    throw new Error(`tenant ${tenantId} has no subscription`);
  }
  const [usage] = await repo.countActiveMembers(tx, tenantId);
  if ((usage?.activeUsers ?? 0) >= limit.userLimit) {
    throw new AppError("USER_LIMIT_REACHED");
  }
}
