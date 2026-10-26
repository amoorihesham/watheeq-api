import { and, count, eq, ilike, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Executor } from "@/db/pool.js";
import { orgUnits, roles, tenantMembers, tenants, users } from "@/db/schema/index.js";
import type { PageRequestType } from "@/http/list.js";
import { withinScope } from "@/modules/tenant-access/index.js";
import type {
  ListUsersQueryType,
  MemberChangesType,
  NewMemberType,
  UserRowType,
} from "./users.types.js";

const userColumns = {
  id: users.id,
  email: users.email,
  userName: users.userName,
  isActive: users.isActive,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
  roleId: tenantMembers.roleId,
  roleName: roles.name,
  roleIsSystem: roles.isSystem,
  unitId: tenantMembers.unitId,
  isManager: tenantMembers.isManager,
  positionId: tenantMembers.positionId,
  unitName: orgUnits.name,
  unitKind: orgUnits.kind,
  isOwner: sql<boolean>`${tenants.ownerId} = ${users.id}`,
};

/** `%`, `_`, and `\` in a search are matched literally. */
const containing = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

type UserFiltersType = Omit<ListUsersQueryType, "cursor" | "limit">;

function listFilter(tenantId: string, query: UserFiltersType): SQL | undefined {
  const verified = isNotNull(users.emailVerifiedAt);
  const byStatus = {
    active: and(eq(users.isActive, true), verified),
    invited: and(eq(users.isActive, true), isNull(users.emailVerifiedAt)),
    inactive: eq(users.isActive, false),
    all: undefined,
  }[query.status];
  return and(
    eq(tenantMembers.tenantId, tenantId),
    byStatus,
    query.unitId === "none" ? isNull(tenantMembers.unitId) : undefined,
    query.unitId !== "all" && query.unitId !== "none"
      ? eq(tenantMembers.unitId, query.unitId)
      : undefined,
    query.managers === "all" ? undefined : eq(tenantMembers.isManager, query.managers === "true"),
    query.roleId === "all" ? undefined : eq(tenantMembers.roleId, query.roleId),
    query.q
      ? or(ilike(users.userName, containing(query.q)), ilike(users.email, containing(query.q)))
      : undefined,
  );
}

/** Tenant code: every query is filtered by the caller's tenant (T2). */
export function createUsersRepository() {
  const selectUsers = (db: Executor) =>
    db
      .select(userColumns)
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .innerJoin(
        roles,
        and(eq(roles.tenantId, tenantMembers.tenantId), eq(roles.id, tenantMembers.roleId)),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, tenantMembers.unitId));

  return {
    /** The members the caller may see in the directory: their `user.view` scope (R3.15). */
    visibleTo(tenantId: string, callerId: string): SQL {
      return withinScope({
        tenantId,
        callerId,
        permission: "user.view",
        ownerId: tenantMembers.userId,
        unitId: tenantMembers.unitId,
      });
    },

    page(db: Executor, page: PageRequestType) {
      return db
        .select({ ...userColumns, sortValues: page.sortValues })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .innerJoin(
          roles,
          and(eq(roles.tenantId, tenantMembers.tenantId), eq(roles.id, tenantMembers.roleId)),
        )
        .leftJoin(orgUnits, eq(orgUnits.id, tenantMembers.unitId))
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
    },

    /** The conditions of a list: the caller's tenant, the filters, and the caller's directory scope (T2, R3.15). */
    listWhere(tenantId: string, filters: UserFiltersType, visible: SQL): SQL | undefined {
      return and(listFilter(tenantId, filters), visible);
    },

    async count(db: Executor, where: SQL | undefined): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(where);
      return row?.total ?? 0;
    },

    /** `visible` limits the lookup to users within the caller's scope (R3.15). */
    findById(
      db: Executor,
      tenantId: string,
      userId: string,
      visible?: SQL,
    ): Promise<UserRowType[]> {
      return selectUsers(db).where(
        and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId), visible),
      );
    },

    /** Locks the membership row, so changes to one user run one after the other. */
    lockMember(db: Executor, tenantId: string, userId: string): Promise<{ userId: string }[]> {
      return db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
        .for("update");
    },

    unitExists(db: Executor, tenantId: string, unitId: string): Promise<{ id: string }[]> {
      return db
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)));
    },

    tenantName(db: Executor, tenantId: string): Promise<{ name: string }[]> {
      return db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    },

    insertMember(db: Executor, values: NewMemberType) {
      return db.insert(tenantMembers).values(values);
    },

    updateMember(db: Executor, tenantId: string, userId: string, changes: MemberChangesType) {
      return db
        .update(tenantMembers)
        .set(changes)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)));
    },

    updateUser(db: Executor, userId: string, changes: { userName?: string; isActive?: boolean }) {
      return db.update(users).set(changes).where(eq(users.id, userId));
    },
  };
}
