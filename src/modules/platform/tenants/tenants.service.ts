import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import type { EmailSenderType } from "@/email/index.js";
import { AppError } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import type { Logger } from "@/logging/logger.js";
import {
  insertPendingUser,
  issueEmailVerification,
  verificationEmail,
} from "@/modules/auth/index.js";
import {
  assertSeatAvailable,
  createSubscriptionsRepository,
  toSubscriptionView,
  toUsage,
} from "@/modules/subscriptions/index.js";
import { createPlansRepository } from "../plans/plans.repository.js";
import {
  changeSubscriptionRequestSchema,
  createTenantRequestSchema,
  tenantIdSchema,
} from "./tenants.schemas.js";
import type {
  ChangeSubscriptionRequestType,
  ChangeSubscriptionResponseType,
  CreateTenantRequestType,
  CreateTenantResponseType,
  TenantDetailType,
  TenantsRepositoryType,
  TenantsSettingsType,
} from "./tenants.types.js";

const plansRepo = createPlansRepository();
const subscriptionsRepo = createSubscriptionsRepository();

function existingTenantId(tenantId: string): string {
  if (!tenantIdSchema.safeParse(tenantId).success) {
    throw new AppError("NOT_FOUND");
  }
  return tenantId;
}

function toDetail(row: {
  tenant: TenantDetailType["tenant"];
  subscription: Parameters<typeof toSubscriptionView>[0];
  activeUsers: number;
  today: string;
}): TenantDetailType {
  return {
    tenant: row.tenant,
    subscription: toSubscriptionView(row.subscription, row.today),
    usage: toUsage(row.activeUsers, row.subscription.userLimit),
  };
}

export function createTenantsService({
  db,
  repo,
  emailSender,
  settings,
}: {
  db: Db;
  repo: TenantsRepositoryType;
  emailSender: EmailSenderType;
  settings: TenantsSettingsType;
}) {
  return {
    /**
     * Creates the tenant, its subscription with the plan's terms copied, the first Tenant Admin, and their
     * membership in one transaction (R1.3); a taken email or slug rolls all of it back. The verification email
     * goes out only after commit, so a rolled-back tenant never sends one (P1.14).
     */
    async create(
      input: CreateTenantRequestType,
      context: AuditContextType,
      log: Logger,
    ): Promise<CreateTenantResponseType> {
      const body = validate(createTenantRequestSchema, input);
      const { admin, token, response } = await withTx(db, async (tx) => {
        const today = (await subscriptionsRepo.today(tx)).rows[0]?.today ?? "";
        if (body.subscription.startDate > today) {
          throw new AppError("VALIDATION_FAILED", [
            { path: "subscription.startDate", code: "in_future" },
          ]);
        }
        const [plan] = await plansRepo.findById(tx, body.subscription.planId);
        if (!plan) {
          throw new AppError("VALIDATION_FAILED", [
            { path: "subscription.planId", code: "unknown_plan" },
          ]);
        }
        const admin = await insertPendingUser(tx, body.admin);
        const [tenant] = await repo.insertTenant(tx, {
          name: body.name,
          slug: body.slug,
          ownerId: admin.id,
        });
        if (!tenant) {
          throw new Error("insert returned no row");
        }
        const [subscription] = await subscriptionsRepo.insert(tx, {
          tenantId: tenant.id,
          planId: plan.id,
          planName: plan.name,
          userLimit: plan.userLimit,
          graceDays: plan.graceDays,
          priceHalalas: plan.priceHalalas,
          paymentPeriod: plan.paymentPeriod,
          planDiscountPercent: plan.discountPercent,
          customerDiscountPercent: body.subscription.customerDiscountPercent,
          startDate: body.subscription.startDate,
          endDate: body.subscription.endDate,
        });
        if (!subscription) {
          throw new Error("insert returned no row");
        }
        await assertSeatAvailable(tx, tenant.id);
        await repo.insertAdminMember(tx, tenant.id, admin.id);
        const token = await issueEmailVerification(
          tx,
          admin.id,
          settings.verificationTokenTtlSeconds,
        );

        const entry = { tenantId: tenant.id, ...context };
        await writeAuditEntry(tx, {
          ...entry,
          action: "tenant.created",
          resourceType: "tenant",
          resourceId: tenant.id,
          details: { after: tenant },
        });
        await writeAuditEntry(tx, {
          ...entry,
          action: "subscription.assigned",
          resourceType: "subscription",
          resourceId: tenant.id,
          details: { after: subscription },
        });
        await writeAuditEntry(tx, {
          ...entry,
          action: "user.created",
          resourceType: "user",
          resourceId: admin.id,
          details: { after: { ...admin, tenantRole: "admin" } },
        });
        return {
          admin,
          token,
          response: {
            tenant,
            subscription: toSubscriptionView(subscription, today),
            admin: { id: admin.id, email: admin.email },
          },
        };
      });

      try {
        await emailSender.send(verificationEmail(admin, token, settings.appBaseUrl));
      } catch (err) {
        // The tenant exists; Omar can resend the link (P1.16). The token is never logged.
        log.warn({ err, tenantId: response.tenant.id }, "verification email failed");
      }
      return response;
    },

    async list(): Promise<TenantDetailType[]> {
      return (await repo.list(db)).map(toDetail);
    },

    async get(tenantId: string): Promise<TenantDetailType> {
      const [row] = await repo.findById(db, existingTenantId(tenantId));
      if (!row) {
        throw new AppError("NOT_FOUND");
      }
      return toDetail(row);
    },

    /**
     * Sets the tenant's plan, period, and customer discount (R1.6). The plan's current terms are copied again
     * (D14); an omitted customer discount keeps the current one. The seat lock makes concurrent changes, and a
     * change racing a user creation, run one after the other (R1.5).
     */
    changeSubscription(
      tenantId: string,
      input: ChangeSubscriptionRequestType,
      context: AuditContextType,
    ): Promise<ChangeSubscriptionResponseType> {
      const id = existingTenantId(tenantId);
      const body = validate(changeSubscriptionRequestSchema, input);
      return withTx(db, async (tx) => {
        const today = (await subscriptionsRepo.today(tx)).rows[0]?.today ?? "";
        if (body.startDate > today) {
          throw new AppError("VALIDATION_FAILED", [{ path: "startDate", code: "in_future" }]);
        }
        const [plan] = await plansRepo.findById(tx, body.planId);
        if (!plan) {
          throw new AppError("VALIDATION_FAILED", [{ path: "planId", code: "unknown_plan" }]);
        }
        await subscriptionsRepo.lockSeats(tx, id);
        const [before] = await subscriptionsRepo.findByTenantId(tx, id);
        if (!before) {
          throw new AppError("NOT_FOUND");
        }
        const [after] = await subscriptionsRepo.update(tx, id, {
          planId: plan.id,
          planName: plan.name,
          userLimit: plan.userLimit,
          graceDays: plan.graceDays,
          priceHalalas: plan.priceHalalas,
          paymentPeriod: plan.paymentPeriod,
          planDiscountPercent: plan.discountPercent,
          customerDiscountPercent: body.customerDiscountPercent ?? before.customerDiscountPercent,
          startDate: body.startDate,
          endDate: body.endDate,
        });
        if (!after) {
          throw new Error("update returned no row");
        }
        const [usage] = await subscriptionsRepo.countActiveMembers(tx, id);
        await writeAuditEntry(tx, {
          tenantId: id,
          ...context,
          action: "subscription.changed",
          resourceType: "subscription",
          resourceId: id,
          ...(body.reason ? { reason: body.reason } : {}),
          details: { before, after },
        });
        return {
          subscription: toSubscriptionView(after, today),
          usage: toUsage(usage?.activeUsers ?? 0, after.userLimit),
        };
      });
    },

    /**
     * Issues a new link for the tenant's owner and retires every older one (P1.16).
     * A send failure surfaces as an error: Omar asked for an email, so he must not be told it went out.
     */
    async resendVerification(tenantId: string, context: AuditContextType): Promise<void> {
      const id = existingTenantId(tenantId);
      const { owner, token } = await withTx(db, async (tx) => {
        const [owner] = await repo.findOwner(tx, id);
        if (!owner) {
          throw new AppError("NOT_FOUND");
        }
        if (owner.emailVerifiedAt) {
          throw new AppError("ALREADY_VERIFIED");
        }
        const token = await issueEmailVerification(
          tx,
          owner.id,
          settings.verificationTokenTtlSeconds,
        );
        await writeAuditEntry(tx, {
          tenantId: id,
          ...context,
          action: "user.verification_resent",
          resourceType: "user",
          resourceId: owner.id,
        });
        return { owner, token };
      });
      await emailSender.send(verificationEmail(owner, token, settings.appBaseUrl));
    },
  };
}
