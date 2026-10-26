import type { PeriodResponseType, PeriodViewType } from "../calendar.types.js";

/** A period view in its response shape: every key present, `null` where the variant has none (R8.4). */
export function toPeriodResponse(view: PeriodViewType): PeriodResponseType {
  const season = view.kind === "season";
  const shared = {
    id: view.id,
    name: view.name,
    kind: view.kind,
    week: season ? view.week : null,
    rank: season ? view.rank : null,
    replacesId: view.replacesId,
    next: view.next,
  };
  if (view.recurrence === "once") {
    return {
      ...shared,
      recurrence: "once",
      startDate: view.startDate,
      endDate: view.endDate,
      start: null,
      end: null,
      validFrom: null,
      validUntil: null,
      overrides: [],
    };
  }
  return {
    ...shared,
    recurrence: view.recurrence,
    startDate: null,
    endDate: null,
    start: view.start,
    end: view.end,
    validFrom: view.validFrom,
    validUntil: view.validUntil,
    overrides: view.overrides.map((override) => ({
      year: override.year,
      action: override.action,
      startDate: override.action === "move" ? override.startDate : null,
      endDate: override.action === "move" ? override.endDate : null,
    })),
  };
}
