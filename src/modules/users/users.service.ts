import type { SQL } from "drizzle-orm";
import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor, Tx } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import type { EmailSenderType } from "@/email/index.js";
import { AppError } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import type { Logger } from "@/logging/logger.js";
import {
  endUserAccess,
  insertPendingUser,
  invitationEmail,
  issuePasswordToken,
} from "@/modules/auth/index.js";
import { assertSeatAvailable } from "@/modules/subscriptions/index.js";
import {
  assertGrantsHeld,
  type GrantMapType,
  grantListOf,
  loadRoleGrants,
  type TenantPermissionType,
} from "@/modules/tenant-access/index.js";
import {
  assignRoleRequestSchema,
  inviteUserRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
  userIdSchema,
} from "./users.schemas.js";
import type {
  AssignRoleRequestType,
  CallerType,
  InviteUserRequestType,
  ListUsersResponseType,
  MemberChangesType,
  UpdateUserRequestType,
  UserRowType,
  UsersRepositoryType,
  UsersSettingsType,
  UserType,
} from "./users.types.js";

/** A non-UUID id is answered like an unknown one, never as a database cast error. */
function existingUserId(userId: string): string {
  if (!userIdSchema.safeParse(userId).success) {
    throw new AppError("NOT_FOUND");
  }
  return userId;
}

function toUser(row: UserRowType): UserType {
  return {
    id: row.id,
    email: row.email,
    userName: row.userName,
    unit:
      row.unitId && row.unitName && row.unitKind
        ? { id: row.unitId, name: row.unitName, kind: row.unitKind }
        : null,
    isManager: row.isManager,
    role: { id: row.roleId, name: row.roleName, isSystem: row.roleIsSystem },
    isOwner: row.isOwner,
    status: !row.isActive ? "inactive" : row.emailVerifiedAt ? "active" : "invited",
    createdAt: row.createdAt,
  };
}

const managerNeedsUnit = () =>
  new AppError("VALIDATION_FAILED", [{ path: "isManager", code: "manager_needs_unit" }]);

export function createUsersService({
  db,
  repo,
  emailSender,
  settings,
}: {
  db: Db;
  repo: UsersRepositoryType;
  emailSender: EmailSenderType;
  settings: UsersSettingsType;
}) {
  async function assertUnit(executor: Executor, tenantId: string, unitId: string | null) {
    if (unitId && !(await repo.unitExists(executor, tenantId, unitId)).length) {
      throw new AppError("VALIDATION_FAILED", [{ path: "unitId", code: "unknown_unit" }]);
    }
  }

  async function grantsOfRole(executor: Executor, tenantId: string, roleId: string) {
    const grants = await loadRoleGrants(executor, tenantId, roleId);
    if (!grants) {
      throw new AppError("VALIDATION_FAILED", [{ path: "roleId", code: "unknown_role" }]);
    }
    return grants;
  }

  /**
   * The subset rule for users (R3.10, P3.11): the caller must hold the route's permission and every grant of each
   * role involved, as their role is now (R3.12).
   */
  function assertWithinCaller(
    tx: Tx,
    tenantId: string,
    caller: CallerType,
    permission: TenantPermissionType,
    roles: GrantMapType[],
  ) {
    return assertGrantsHeld(tx, tenantId, caller.id, [
      { key: permission, scope: "organization" },
      ...roles.flatMap(grantListOf),
    ]);
  }

  async function loadUser(executor: Executor, tenantId: string, userId: string, visible?: SQL) {
    const [row] = await repo.findById(executor, tenantId, userId, visible);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  /** Locks the user's membership, then reads them: every change to one user runs after the previous one. */
  async function lockUser(tx: Tx, tenantId: string, userId: string, visible?: SQL) {
    const [locked] = await repo.lockMember(tx, tenantId, userId);
    if (!locked) {
      throw new AppError("NOT_FOUND");
    }
    return loadUser(tx, tenantId, userId, visible);
  }

  return {
    async list(tenantId: string, callerId: string, input: unknown): Promise<ListUsersResponseType> {
      const query = validate(listUsersQuerySchema, input);
      const visible = repo.visibleTo(tenantId, callerId);
      const [rows, [counted]] = await Promise.all([
        repo.list(db, tenantId, query, visible),
        repo.count(db, tenantId, query, visible),
      ]);
      return { users: rows.map(toUser), total: counted?.total ?? 0 };
    },

    /** A user outside the caller's scope is 404, like one of another tenant (R3.15). */
    async get(tenantId: string, callerId: string, userId: string): Promise<UserType> {
      return toUser(
        await loadUser(db, tenantId, existingUserId(userId), repo.visibleTo(tenantId, callerId)),
      );
    },

    /**
     * Creates the user without a password, takes a seat (R2.9), and emails the invitation after commit (P1.14).
     * A send failure is logged; the user exists and the admin can resend.
     */
    async invite(
      tenantId: string,
      input: InviteUserRequestType,
      caller: CallerType,
      context: AuditContextType,
      log: Logger,
    ): Promise<UserType> {
      const body = validate(inviteUserRequestSchema, input);
      if (body.isManager && !body.unitId) {
        throw managerNeedsUnit();
      }
      const { user, token, tenantName } = await withTx(db, async (tx) => {
        await assertUnit(tx, tenantId, body.unitId);
        const role = await grantsOfRole(tx, tenantId, body.roleId);
        await assertWithinCaller(tx, tenantId, caller, "user.create", [role]);
        await assertSeatAvailable(tx, tenantId);
        const created = await insertPendingUser(tx, { email: body.email, userName: body.userName });
        await repo.insertMember(tx, {
          tenantId,
          userId: created.id,
          unitId: body.unitId,
          isManager: body.isManager,
          roleId: body.roleId,
        });
        const token = await issuePasswordToken(
          tx,
          created.id,
          "invitation",
          settings.invitationTtlSeconds,
        );
        const user = toUser(await loadUser(tx, tenantId, created.id));
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.invited",
          resourceType: "user",
          resourceId: created.id,
          details: {
            email: body.email,
            userName: body.userName,
            unitId: body.unitId,
            isManager: body.isManager,
            roleId: user.role.id,
            roleName: user.role.name,
          },
        });
        const [tenant] = await repo.tenantName(tx, tenantId);
        return { user, token, tenantName: tenant?.name ?? "" };
      });

      try {
        await emailSender.send(
          invitationEmail(
            user,
            { userName: caller.userName, tenantName },
            token,
            settings.appBaseUrl,
          ),
        );
      } catch (err) {
        // The token is never logged.
        log.warn({ err, userId: user.id }, "invitation email failed");
      }
      return user;
    },

    /**
     * Changes name, unit, and manager flag (R2.11); the role has its own endpoint (P3.12). Moving a manager ends
     * their manager role unless the same request sets it again (R2.7).
     */
    update(
      tenantId: string,
      userId: string,
      input: UpdateUserRequestType,
      context: AuditContextType,
    ): Promise<UserType> {
      const id = existingUserId(userId);
      const body = validate(updateUserRequestSchema, input);
      return withTx(db, async (tx) => {
        const before = await lockUser(tx, tenantId, id);
        const unitId = body.unitId === undefined ? before.unitId : body.unitId;
        if (unitId !== before.unitId) {
          await assertUnit(tx, tenantId, unitId);
        }
        const isManager = body.isManager ?? (unitId === before.unitId ? before.isManager : false);
        if (isManager && !unitId) {
          throw managerNeedsUnit();
        }

        const next = {
          userName: body.userName ?? before.userName,
          unitId,
          isManager,
        };
        const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
          (key) => next[key] !== before[key],
        );
        if (changed.length === 0) {
          return toUser(before);
        }
        if (changed.includes("userName")) {
          await repo.updateUser(tx, id, { userName: next.userName });
        }
        const memberChanges: MemberChangesType = Object.fromEntries(
          changed.filter((key) => key !== "userName").map((key) => [key, next[key]]),
        );
        // A holder must sit in the position's unit, so a move ends the position (R5.3).
        const losesPosition = changed.includes("unitId") && before.positionId !== null;
        if (losesPosition) {
          memberChanges.positionId = null;
        }
        if (Object.keys(memberChanges).length > 0) {
          await repo.updateMember(tx, tenantId, id, memberChanges);
        }
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.updated",
          resourceType: "user",
          resourceId: id,
          details: {
            before: {
              ...Object.fromEntries(changed.map((key) => [key, before[key]])),
              ...(losesPosition ? { positionId: before.positionId } : {}),
            },
            after: {
              ...Object.fromEntries(changed.map((key) => [key, next[key]])),
              ...(losesPosition ? { positionId: null } : {}),
            },
          },
        });
        return toUser(await loadUser(tx, tenantId, id));
      });
    },

    /**
     * Gives the user another role (R3.9). Both the current and the new role must be within the caller's grants
     * (R3.10); nobody changes their own role (R3.11), and the owner keeps the Tenant Admin role (R3.3).
     */
    assignRole(
      tenantId: string,
      userId: string,
      input: AssignRoleRequestType,
      caller: CallerType,
      context: AuditContextType,
    ): Promise<UserType> {
      const id = existingUserId(userId);
      const { roleId } = validate(assignRoleRequestSchema, input);
      return withTx(db, async (tx) => {
        // The caller's directory scope bounds whom they can reach (Phase 3 spec, step 3.4).
        const before = await lockUser(tx, tenantId, id, repo.visibleTo(tenantId, caller.id));
        if (id === caller.id) {
          throw new AppError("SELF_CHANGE_FORBIDDEN");
        }
        if (before.isOwner && roleId !== before.roleId) {
          throw new AppError("OWNER_PROTECTED");
        }
        const role = await grantsOfRole(tx, tenantId, roleId);
        const current = await grantsOfRole(tx, tenantId, before.roleId);
        await assertWithinCaller(tx, tenantId, caller, "role.assign", [current, role]);
        if (roleId === before.roleId) {
          return toUser(before);
        }
        await repo.updateMember(tx, tenantId, id, { roleId });
        const after = toUser(await loadUser(tx, tenantId, id));
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.role_assigned",
          resourceType: "user",
          resourceId: id,
          details: {
            before: { roleId: before.roleId, roleName: before.roleName },
            after: { roleId: after.role.id, roleName: after.role.name },
          },
        });
        return after;
      });
    },

    /** Frees the seat and ends the manager role, the position held (R5.3), every link, and every session (R2.12). Repeating it is a no-op. */
    deactivate(
      tenantId: string,
      userId: string,
      caller: CallerType,
      context: AuditContextType,
    ): Promise<UserType> {
      const id = existingUserId(userId);
      return withTx(db, async (tx) => {
        const before = await lockUser(tx, tenantId, id);
        if (id === caller.id) {
          throw new AppError("SELF_CHANGE_FORBIDDEN");
        }
        if (before.isOwner) {
          throw new AppError("OWNER_PROTECTED");
        }
        const role = await grantsOfRole(tx, tenantId, before.roleId);
        await assertWithinCaller(tx, tenantId, caller, "user.deactivate", [role]);
        if (!before.isActive) {
          return toUser(before);
        }
        await repo.updateUser(tx, id, { isActive: false });
        const ended: MemberChangesType = {
          ...(before.isManager ? { isManager: false } : {}),
          ...(before.positionId ? { positionId: null } : {}),
        };
        const hasEnded = Object.keys(ended).length > 0;
        if (hasEnded) {
          await repo.updateMember(tx, tenantId, id, ended);
        }
        await endUserAccess(tx, id);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.deactivated",
          resourceType: "user",
          resourceId: id,
          ...(hasEnded
            ? {
                details: {
                  before: {
                    ...(before.isManager ? { isManager: true } : {}),
                    ...(before.positionId ? { positionId: before.positionId } : {}),
                  },
                  after: ended,
                },
              }
            : {}),
        });
        return toUser(await loadUser(tx, tenantId, id));
      });
    },

    /**
     * Takes a seat again (R2.12, R1.12); the user comes back as a plain member of their unit. Their role must be
     * within the caller's grants, since reactivating gives its powers back (P3.11).
     */
    reactivate(
      tenantId: string,
      userId: string,
      caller: CallerType,
      context: AuditContextType,
    ): Promise<UserType> {
      const id = existingUserId(userId);
      return withTx(db, async (tx) => {
        const before = await lockUser(tx, tenantId, id);
        const role = await grantsOfRole(tx, tenantId, before.roleId);
        await assertWithinCaller(tx, tenantId, caller, "user.deactivate", [role]);
        if (before.isActive) {
          return toUser(before);
        }
        await assertSeatAvailable(tx, tenantId);
        await repo.updateUser(tx, id, { isActive: true });
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.reactivated",
          resourceType: "user",
          resourceId: id,
        });
        return toUser(await loadUser(tx, tenantId, id));
      });
    },

    /**
     * Issues a new invitation link and retires the older ones (R2.14). A send failure surfaces as an error:
     * the admin asked for an email, so they must not be told it went out.
     */
    async resendInvitation(
      tenantId: string,
      userId: string,
      caller: CallerType,
      context: AuditContextType,
    ): Promise<void> {
      const id = existingUserId(userId);
      const { user, token, tenantName } = await withTx(db, async (tx) => {
        const user = await lockUser(tx, tenantId, id);
        if (user.emailVerifiedAt) {
          throw new AppError("ALREADY_VERIFIED");
        }
        if (!user.isActive) {
          throw new AppError("USER_INACTIVE");
        }
        const token = await issuePasswordToken(tx, id, "invitation", settings.invitationTtlSeconds);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.invitation_resent",
          resourceType: "user",
          resourceId: id,
        });
        const [tenant] = await repo.tenantName(tx, tenantId);
        return { user, token, tenantName: tenant?.name ?? "" };
      });
      await emailSender.send(
        invitationEmail(
          user,
          { userName: caller.userName, tenantName },
          token,
          settings.appBaseUrl,
        ),
      );
    },
  };
}
