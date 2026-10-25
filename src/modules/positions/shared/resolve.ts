import type { Executor } from "@/db/pool.js";
import { createPositionsRepository } from "../positions.repository.js";
import type {
  AssigneeContextType,
  AssigneeLevelType,
  AssigneeTargetType,
  PartyType,
  ResolvedAssigneesType,
  ResolveOptionsType,
} from "../positions.types.js";

const repo = createPositionsRepository();

const partyId = (context: AssigneeContextType, party: PartyType) =>
  party === "handler" ? context.handlerId : context.requesterId;

/** The unit a person sits in; none for someone directly under the organization (D19) or no one at all. */
async function unitOfParty(
  db: Executor,
  tenantId: string,
  context: AssigneeContextType,
  party: PartyType,
): Promise<string | null> {
  const id = partyId(context, party);
  if (!id) {
    return null;
  }
  const [member] = await repo.unitOfMember(db, tenantId, id);
  return member?.unitId ?? null;
}

/** A department is its own department; a section's is its parent. */
async function departmentOf(
  db: Executor,
  tenantId: string,
  unitId: string | null,
): Promise<string | null> {
  if (!unitId) {
    return null;
  }
  const [unit] = await repo.findUnit(db, tenantId, unitId);
  return unit ? (unit.parentId ?? unit.id) : null;
}

/** The level a target starts at (R5.4). */
async function startLevel(
  db: Executor,
  tenantId: string,
  target: AssigneeTargetType,
  context: AssigneeContextType,
): Promise<AssigneeLevelType> {
  if ("position" in target) {
    return { kind: "position", positionId: target.position };
  }
  const [party, scope] = (() => {
    switch (target.builtin) {
      case "handler":
      case "requester":
        return [target.builtin, "person"] as const;
      case "handler_unit_managers":
        return ["handler", "unit"] as const;
      case "handler_department_managers":
        return ["handler", "department"] as const;
      case "requester_unit_managers":
        return ["requester", "unit"] as const;
      case "requester_department_managers":
        return ["requester", "department"] as const;
    }
  })();
  if (scope === "person") {
    return { kind: "person", party };
  }
  const unitId = await unitOfParty(db, tenantId, context, party);
  return {
    kind: "managers",
    unitId: scope === "unit" ? unitId : await departmentOf(db, tenantId, unitId),
    anchor: party,
  };
}

/** The people at one level, after the exclusions of R5.6. */
export async function peopleAtLevel(
  db: Executor,
  tenantId: string,
  level: AssigneeLevelType,
  context: AssigneeContextType,
  options: ResolveOptionsType,
): Promise<string[]> {
  const excluded = [
    ...(level.kind === "managers" && level.anchor ? [partyId(context, level.anchor)] : []),
    ...(options.excludeParties ? [context.handlerId, context.requesterId] : []),
  ].filter((id): id is string => id !== null);

  switch (level.kind) {
    case "position":
      return (await repo.holdersOf(db, tenantId, level.positionId, excluded)).map((r) => r.userId);
    case "person": {
      const id = partyId(context, level.party);
      return id ? (await repo.activePerson(db, tenantId, id, excluded)).map((r) => r.userId) : [];
    }
    case "managers":
      return level.unitId
        ? (await repo.managersOf(db, tenantId, level.unitId, excluded)).map((r) => r.userId)
        : [];
  }
}

/** The level above one: the managers of the unit it sits in, then of that unit's department, then none (Q18). */
async function levelAbove(
  db: Executor,
  tenantId: string,
  level: AssigneeLevelType,
  context: AssigneeContextType,
): Promise<AssigneeLevelType | null> {
  switch (level.kind) {
    case "position": {
      const [position] = await repo.findById(db, tenantId, level.positionId);
      return position?.unitId ? { kind: "managers", unitId: position.unitId } : null;
    }
    case "person": {
      const unitId = await unitOfParty(db, tenantId, context, level.party);
      return unitId ? { kind: "managers", unitId, anchor: level.party } : null;
    }
    case "managers": {
      const [unit] = level.unitId ? await repo.findUnit(db, tenantId, level.unitId) : [];
      return unit?.parentId
        ? {
            kind: "managers",
            unitId: unit.parentId,
            ...(level.anchor ? { anchor: level.anchor } : {}),
          }
        : null;
    }
  }
}

/**
 * Turns a stage's or a recipient's target into the people who may act, and the level they were found at
 * (Phase 5 spec, 4.3). Reads current membership, unit, manager flag, and active status at the moment of the call.
 */
export async function resolveAssignees(
  db: Executor,
  tenantId: string,
  target: AssigneeTargetType,
  context: AssigneeContextType,
  options: ResolveOptionsType,
): Promise<ResolvedAssigneesType> {
  const level = await startLevel(db, tenantId, target, context);
  return { level, userIds: await peopleAtLevel(db, tenantId, level, context, options) };
}

/**
 * The next level up from `level` that has anybody eligible, passing over empty ones (R5.7); null when the chain
 * ends after the department's managers, and the stage then holds (Q18).
 */
export async function nextLevel(
  db: Executor,
  tenantId: string,
  level: AssigneeLevelType,
  context: AssigneeContextType,
  options: ResolveOptionsType,
): Promise<ResolvedAssigneesType | null> {
  let above = await levelAbove(db, tenantId, level, context);
  while (above) {
    const userIds = await peopleAtLevel(db, tenantId, above, context, options);
    if (userIds.length > 0) {
      return { level: above, userIds };
    }
    above = await levelAbove(db, tenantId, above, context);
  }
  return null;
}
