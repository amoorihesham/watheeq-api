import { and, count, eq, ilike, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { byName } from "@/db/order.js";
import type { Executor } from "@/db/pool.js";
import { orgUnits, roles, tenantMembers, tenants, users } from "@/db/schema/index.js";
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
  unitName: orgUnits.name,
  unitKind: orgUnits.kind,
  isOwner: sql<boolean>`${tenants.ownerId} = ${users.id}`,
};

/** `%`, `_`, and `\` in a search are matched literally. */
const containing = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

function listFilter(tenantId: string, query: ListUsersQueryType): SQL | undefined {
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
    query.unitId && query.unitId !== "none" ? eq(tenantMembers.unitId, query.unitId) : undefined,
    query.managers ? eq(tenantMembers.isManager, query.managers === "true") : undefined,
    query.roleId ? eq(tenantMembers.roleId, query.roleId) : undefined,
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
    list(db: Executor, tenantId: string, query: ListUsersQueryType): Promise<UserRowType[]> {
      return selectUsers(db)
        .where(listFilter(tenantId, query))
        .orderBy(byName(users.userName), users.id)
        .limit(query.limit)
        .offset(query.offset);
    },

    count(db: Executor, tenantId: string, query: ListUsersQueryType): Promise<{ total: number }[]> {
      return db
        .select({ total: count() })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(listFilter(tenantId, query));
    },

    findById(db: Executor, tenantId: string, userId: string): Promise<UserRowType[]> {
      return selectUsers(db).where(
        and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)),
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
