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
  inviteUserRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
  userIdSchema,
} from "./users.schemas.js";
import type {
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
    role: row.role,
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

  async function loadUser(executor: Executor, tenantId: string, userId: string) {
    const [row] = await repo.findById(executor, tenantId, userId);
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    return row;
  }

  /** Locks the user's membership, then reads them: every change to one user runs after the previous one. */
  async function lockUser(tx: Tx, tenantId: string, userId: string) {
    const [locked] = await repo.lockMember(tx, tenantId, userId);
    if (!locked) {
      throw new AppError("NOT_FOUND");
    }
    return loadUser(tx, tenantId, userId);
  }

  return {
    async list(tenantId: string, input: unknown): Promise<ListUsersResponseType> {
      const query = validate(listUsersQuerySchema, input);
      const [rows, [counted]] = await Promise.all([
        repo.list(db, tenantId, query),
        repo.count(db, tenantId, query),
      ]);
      return { users: rows.map(toUser), total: counted?.total ?? 0 };
    },

    async get(tenantId: string, userId: string): Promise<UserType> {
      return toUser(await loadUser(db, tenantId, existingUserId(userId)));
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
        await assertSeatAvailable(tx, tenantId);
        const created = await insertPendingUser(tx, { email: body.email, userName: body.userName });
        await repo.insertMember(tx, {
          tenantId,
          userId: created.id,
          unitId: body.unitId,
          isManager: body.isManager,
          role: body.role,
        });
        const token = await issuePasswordToken(
          tx,
          created.id,
          "invitation",
          settings.invitationTtlSeconds,
        );
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
            role: body.role,
          },
        });
        const [tenant] = await repo.tenantName(tx, tenantId);
        const user = toUser(await loadUser(tx, tenantId, created.id));
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
     * Changes name, unit, manager flag, and role (R2.11). Moving a manager ends their manager role unless the same
     * request sets it again (R2.7). The owner stays admin, and nobody changes their own role (R2.13).
     */
    update(
      tenantId: string,
      userId: string,
      input: UpdateUserRequestType,
      caller: CallerType,
      context: AuditContextType,
    ): Promise<UserType> {
      const id = existingUserId(userId);
      const body = validate(updateUserRequestSchema, input);
      return withTx(db, async (tx) => {
        const before = await lockUser(tx, tenantId, id);
        if (body.role !== undefined && body.role !== before.role) {
          if (id === caller.id) {
            throw new AppError("SELF_CHANGE_FORBIDDEN");
          }
          if (before.isOwner) {
            throw new AppError("OWNER_PROTECTED");
          }
        }
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
          role: body.role ?? before.role,
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
            before: Object.fromEntries(changed.map((key) => [key, before[key]])),
            after: Object.fromEntries(changed.map((key) => [key, next[key]])),
          },
        });
        return toUser(await loadUser(tx, tenantId, id));
      });
    },

    /** Frees the seat and ends the manager role, every link, and every session (R2.12). Repeating it is a no-op. */
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
        if (!before.isActive) {
          return toUser(before);
        }
        await repo.updateUser(tx, id, { isActive: false });
        if (before.isManager) {
          await repo.updateMember(tx, tenantId, id, { isManager: false });
        }
        await endUserAccess(tx, id);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "user.deactivated",
          resourceType: "user",
          resourceId: id,
          ...(before.isManager
            ? { details: { before: { isManager: true }, after: { isManager: false } } }
            : {}),
        });
        return toUser(await loadUser(tx, tenantId, id));
      });
    },

    /** Takes a seat again (R2.12, R1.12); the user comes back as a plain member of their unit. */
    reactivate(tenantId: string, userId: string, context: AuditContextType): Promise<UserType> {
      const id = existingUserId(userId);
      return withTx(db, async (tx) => {
        const before = await lockUser(tx, tenantId, id);
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
