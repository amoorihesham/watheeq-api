import { sql } from 'drizzle-orm';
import { type AuditContextType, writeAuditEntry } from '@/audit/index.js';
import { byName } from '@/db/order.js';
import type { Db, Executor } from '@/db/pool.js';
import { tenants } from '@/db/schema/index.js';
import { withTx } from '@/db/tx.js';
import type { EmailSenderType } from '@/email/index.js';
import { AppError, fromDatabaseError } from '@/http/errors.js';
import { listPage } from '@/http/list.js';
import type { PageType } from '@/http/respond.js';
import type { Logger } from '@/logging/logger.js';
import { type EmailSendOutcomeType, insertPendingUser, issuePasswordToken, sendInvitationLink, verificationEmail } from '@/modules/auth/index.js';
import { insertDefaultHours } from '@/modules/calendar/index.js';
import { assertSeatAvailable, createSubscriptionsRepository, toSubscriptionView, toUsage } from '@/modules/subscriptions/index.js';
import { SYSTEM_ROLE_NAME, systemRoleGrants } from '@/modules/tenant-access/index.js';
import { createPlansRepository } from '../plans/plans.repository.js';
import type { ChangeSubscriptionRequestType, CreateTenantRequestType, ListTenantsQueryType, TenantDetailType, TenantsRepositoryType, TenantsSettingsType } from './tenants.types.js';

const plansRepo = createPlansRepository();
const subscriptionsRepo = createSubscriptionsRepository();

interface DetailRowType {
  tenant: Omit<TenantDetailType['tenant'], 'owner'>;
  owner: Omit<TenantDetailType['tenant']['owner'], 'verificationEmail'> & { invitationEmail: EmailSendOutcomeType | null };
  subscription: Parameters<typeof toSubscriptionView>[0];
  activeUsers: number;
  storedBytes: number;
  today: string;
}

function toDetail(row: DetailRowType): TenantDetailType {
  const { invitationEmail, ...owner } = row.owner;
  return {
    // Once verified, the outcome of an old email no longer matters (P11.2).
    tenant: { ...row.tenant, owner: { ...owner, verificationEmail: owner.verifiedAt ? null : invitationEmail } },
    subscription: toSubscriptionView(row.subscription, row.today),
    usage: toUsage(row.activeUsers, row.storedBytes, row.subscription),
  };
}

/** The first admin's email is `admin.email` in the create body, not the `email` the constraint map names. */
function adminEmailPath(err: unknown): never {
  const known = fromDatabaseError(err);
  if (known?.code === 'TAKEN' && known.details?.[0]?.path === 'email') {
    throw new AppError('TAKEN', [{ path: 'admin.email', code: 'taken' }]);
  }
  throw err;
}

export function createTenantsService({ db, repo, emailSender, settings }: { db: Db; repo: TenantsRepositoryType; emailSender: EmailSenderType; settings: TenantsSettingsType }) {
  /** The tenant as `GET /operator/tenants/:tenantId` answers it, read inside the writing transaction. */
  async function detailOf(executor: Executor, tenantId: string): Promise<TenantDetailType> {
    const [row] = await repo.findById(executor, tenantId);
    if (!row) {
      throw new Error('tenant disappeared inside its own transaction');
    }
    return toDetail(row);
  }

  async function get(tenantId: string): Promise<TenantDetailType> {
    const [row] = await repo.findById(db, tenantId);
    if (!row) {
      throw new AppError('NOT_FOUND');
    }
    return toDetail(row);
  }

  return {
    /**
     * Creates the tenant, its subscription with the plan's terms copied, the first Tenant Admin, and their
     * membership in one transaction (R1.3); a taken email or slug rolls all of it back. The verification email
     * goes out only after commit, so a rolled-back tenant never sends one (P1.14).
     */
    async create(body: CreateTenantRequestType, context: AuditContextType, log: Logger): Promise<TenantDetailType> {
      const { admin, token, tenantId } = await withTx(db, async (tx) => {
        const today = (await subscriptionsRepo.today(tx)).rows[0]?.today ?? '';
        if (body.subscription.startDate > today) {
          throw new AppError('VALIDATION_FAILED', [{ path: 'subscription.startDate', code: 'in_future' }]);
        }
        const [plan] = await plansRepo.findById(tx, body.subscription.planId);
        if (!plan) {
          throw new AppError('VALIDATION_FAILED', [{ path: 'subscription.planId', code: 'unknown_plan' }]);
        }
        const admin = await insertPendingUser(tx, body.admin);
        const [tenant] = await repo.insertTenant(tx, {
          name: body.name,
          slug: body.slug,
          ownerId: admin.id,
        });
        if (!tenant) {
          throw new Error('insert returned no row');
        }
        const [subscription] = await subscriptionsRepo.insert(tx, {
          tenantId: tenant.id,
          planId: plan.id,
          planName: plan.name,
          userLimit: plan.userLimit,
          storageLimitGb: plan.storageLimitGb,
          graceDays: plan.graceDays,
          priceHalalas: plan.priceHalalas,
          paymentPeriod: plan.paymentPeriod,
          planDiscountPercent: plan.discountPercent,
          customerDiscountPercent: body.subscription.customerDiscountPercent,
          startDate: body.subscription.startDate,
          endDate: body.subscription.endDate,
        });
        if (!subscription) {
          throw new Error('insert returned no row');
        }
        await assertSeatAvailable(tx, tenant.id);
        // The owner holds the Tenant Admin role, the only role a new tenant starts with (P3.8, P3.9).
        const [adminRole] = await repo.insertSystemRole(tx, tenant.id, SYSTEM_ROLE_NAME);
        if (!adminRole) {
          throw new Error('insert returned no row');
        }
        await repo.insertAdminMember(tx, tenant.id, admin.id, adminRole.id);
        const token = await issuePasswordToken(tx, admin.id, 'invitation', settings.verificationTokenTtlSeconds);

        const entry = { tenantId: tenant.id, ...context };
        await writeAuditEntry(tx, {
          ...entry,
          action: 'tenant.created',
          resourceType: 'tenant',
          resourceId: tenant.id,
          details: { after: tenant },
        });
        await writeAuditEntry(tx, {
          ...entry,
          action: 'subscription.assigned',
          resourceType: 'subscription',
          resourceId: tenant.id,
          details: { after: subscription },
        });
        await writeAuditEntry(tx, {
          ...entry,
          action: 'role.created',
          resourceType: 'role',
          resourceId: adminRole.id,
          details: { name: SYSTEM_ROLE_NAME, isSystem: true, permissions: systemRoleGrants() },
        });
        await writeAuditEntry(tx, {
          ...entry,
          action: 'user.created',
          resourceType: 'user',
          resourceId: admin.id,
          details: { after: { ...admin, roleId: adminRole.id } },
        });
        // The tenant's calendar starts with the default normal hours (R4.1).
        await insertDefaultHours(tx, tenant.id, today, context);
        return { admin, token, tenantId: tenant.id };
      }).catch(adminEmailPath);

      // The tenant exists even when the email fails; its owner shows `failed` and Omar can resend (R11.2, P1.16).
      await sendInvitationLink(db, admin.id, verificationEmail(admin, token, settings.appBaseUrl), emailSender, (err) => log.warn({ err, tenantId }, 'verification email failed'));
      return get(tenantId);
    },

    async list(query: ListTenantsQueryType): Promise<PageType<TenantDetailType>> {
      const page = await listPage({
        db,
        list: 'tenants',
        query,
        keys: [
          { expr: byName(tenants.name), type: 'text' },
          { expr: sql`${tenants.id}`, type: 'uuid' },
        ],
        direction: 'asc',
        where: () => undefined,
        selectPage: repo.page,
        count: repo.count,
      });
      return { ...page, items: page.items.map(toDetail) };
    },

    get,

    /**
     * Sets the tenant's plan, period, and customer discount (R1.6). The plan's current terms are copied again
     * (D14); an omitted customer discount keeps the current one. The seat lock makes concurrent changes, and a
     * change racing a user creation, run one after the other (R1.5).
     */
    changeSubscription(id: string, body: ChangeSubscriptionRequestType, context: AuditContextType): Promise<TenantDetailType> {
      return withTx(db, async (tx) => {
        const today = (await subscriptionsRepo.today(tx)).rows[0]?.today ?? '';
        if (body.startDate > today) {
          throw new AppError('VALIDATION_FAILED', [{ path: 'startDate', code: 'in_future' }]);
        }
        const [plan] = await plansRepo.findById(tx, body.planId);
        if (!plan) {
          throw new AppError('VALIDATION_FAILED', [{ path: 'planId', code: 'unknown_plan' }]);
        }
        await subscriptionsRepo.lockSeats(tx, id);
        const [before] = await subscriptionsRepo.findByTenantId(tx, id);
        if (!before) {
          throw new AppError('NOT_FOUND');
        }
        const [after] = await subscriptionsRepo.update(tx, id, {
          planId: plan.id,
          planName: plan.name,
          userLimit: plan.userLimit,
          storageLimitGb: plan.storageLimitGb,
          graceDays: plan.graceDays,
          priceHalalas: plan.priceHalalas,
          paymentPeriod: plan.paymentPeriod,
          planDiscountPercent: plan.discountPercent,
          customerDiscountPercent: body.customerDiscountPercent ?? before.customerDiscountPercent,
          startDate: body.startDate,
          endDate: body.endDate,
        });
        if (!after) {
          throw new Error('update returned no row');
        }
        await writeAuditEntry(tx, {
          tenantId: id,
          ...context,
          action: 'subscription.changed',
          resourceType: 'subscription',
          resourceId: id,
          ...(body.reason ? { reason: body.reason } : {}),
          details: { before, after },
        });
        return detailOf(tx, id);
      });
    },

    /**
     * Issues a new link for the tenant's owner and retires every older one (P1.16). A send failure is not an error:
     * the answer's `owner.verificationEmail` tells Omar it did not go out (R11.3).
     */
    async resendVerification(id: string, context: AuditContextType, log: Logger): Promise<TenantDetailType> {
      const { owner, token } = await withTx(db, async (tx) => {
        const [owner] = await repo.findOwner(tx, id);
        if (!owner) {
          throw new AppError('NOT_FOUND');
        }
        if (owner.emailVerifiedAt) {
          throw new AppError('ALREADY_VERIFIED');
        }
        const token = await issuePasswordToken(tx, owner.id, 'invitation', settings.verificationTokenTtlSeconds);
        await writeAuditEntry(tx, {
          tenantId: id,
          ...context,
          action: 'user.verification_resent',
          resourceType: 'user',
          resourceId: owner.id,
        });
        return { owner, token };
      });
      await sendInvitationLink(db, owner.id, verificationEmail(owner, token, settings.appBaseUrl), emailSender, (err) => log.warn({ err, tenantId: id }, 'verification email failed'));
      return get(id);
    },
  };
}
