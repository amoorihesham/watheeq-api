import { type AuditContextType, writeAuditEntry } from "@/audit/index.js";
import type { Db, Executor } from "@/db/pool.js";
import { withTx } from "@/db/tx.js";
import { AppError, type ErrorDetail } from "@/http/errors.js";
import { validate } from "@/http/validate.js";
import { putEscalationRequestSchema, targetKey } from "./escalation.schemas.js";
import type {
  EscalationInputType,
  EscalationRepositoryType,
  EscalationRuleType,
  EscalationType,
  PutEscalationRequestType,
  EscalationResponseType,
  RecipientType,
} from "./escalation.types.js";
import { readEscalation } from "./shared/settings.js";

const RULES: EscalationRuleType[] = ["r0", "r1", "r2"];

/** A recipient in the shape a save sends: no names, ids in one case, in a fixed order. */
function canonicalRecipients(
  recipients: (RecipientType | EscalationInputType["r0"]["recipients"][number])[],
) {
  return recipients
    .map((target) =>
      "position" in target ? { position: target.position } : { builtin: target.builtin },
    )
    .sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
}

/** The settings in the shape a save sends, so a save can be compared with what is stored, and audited. */
function canonical(settings: EscalationType | EscalationInputType) {
  return {
    r0: {
      enabled: settings.r0.enabled,
      days: settings.r0.days,
      recipients: canonicalRecipients(settings.r0.recipients),
    },
    r1: {
      enabled: settings.r1.enabled,
      percent: settings.r1.percent,
      recipients: canonicalRecipients(settings.r1.recipients),
    },
    r2: { enabled: settings.r2.enabled, recipients: canonicalRecipients(settings.r2.recipients) },
  };
}

const toRecipient = (target: RecipientType) =>
  "position" in target
    ? { position: target.position, name: target.name, builtin: null }
    : { position: null, name: null, builtin: target.builtin };

/** The response shape of the read: every rule with its recipients, and the saved flag. */
function toResponse(settings: EscalationType | null): EscalationResponseType {
  if (!settings) {
    return { configured: false, settings: null };
  }
  return {
    configured: true,
    settings: {
      r0: { ...settings.r0, recipients: settings.r0.recipients.map(toRecipient) },
      r1: { ...settings.r1, recipients: settings.r1.recipients.map(toRecipient) },
      r2: { ...settings.r2, recipients: settings.r2.recipients.map(toRecipient) },
    },
  };
}

export function createEscalationService({ db, repo }: { db: Db; repo: EscalationRepositoryType }) {
  /**
   * Locks every tenant position the settings name, so none can be retired until this transaction ends, and
   * refuses the unknown and the retired. A position of another tenant is unknown (R5.19).
   */
  async function assertPositionsActive(
    tx: Executor,
    tenantId: string,
    settings: EscalationInputType,
  ) {
    const named = [
      ...new Set(
        RULES.flatMap((rule) =>
          settings[rule].recipients.flatMap((t) => ("position" in t ? [t.position] : [])),
        ),
      ),
    ];
    if (named.length === 0) {
      return;
    }
    const states = new Map(
      (await repo.lockPositions(tx, tenantId, named)).map((state) => [state.id, state]),
    );
    const details: ErrorDetail[] = [];
    RULES.forEach((rule) => {
      settings[rule].recipients.forEach((target, index) => {
        if (!("position" in target)) {
          return;
        }
        const state = states.get(target.position);
        const path = `${rule}.recipients.${index}.position`;
        if (!state) {
          details.push({ path, code: "unknown_position" });
        } else if (state.retiredAt) {
          details.push({ path, code: "position_retired" });
        }
      });
    });
    if (details.length > 0) {
      throw new AppError("VALIDATION_FAILED", details);
    }
  }

  return {
    async get(tenantId: string): Promise<EscalationResponseType> {
      return toResponse(await readEscalation(db, tenantId));
    },

    /**
     * Replaces the whole configuration (R5.13). A save that changes nothing writes nothing. Recipients of a rule
     * that is off are kept.
     */
    put(
      tenantId: string,
      input: PutEscalationRequestType,
      context: AuditContextType,
    ): Promise<EscalationResponseType> {
      const body = validate(putEscalationRequestSchema, input);
      return withTx(db, async (tx) => {
        await repo.lockSettings(tx, tenantId);
        const after = canonical(body);
        await assertPositionsActive(tx, tenantId, body);

        const stored = await readEscalation(tx, tenantId);
        const before = stored ? canonical(stored) : null;
        if (stored && JSON.stringify(before) === JSON.stringify(after)) {
          return toResponse(stored);
        }
        await repo.upsertSettings(tx, tenantId, body);
        await repo.deleteRecipients(tx, tenantId);
        await repo.insertRecipients(tx, tenantId, body);
        await writeAuditEntry(tx, {
          tenantId,
          ...context,
          action: "escalation.updated",
          resourceType: "escalation",
          resourceId: tenantId,
          details: { before, after },
        });
        const settings = await readEscalation(tx, tenantId);
        if (!settings) {
          throw new Error("escalation settings missing after save");
        }
        return toResponse(settings);
      });
    },
  };
}
