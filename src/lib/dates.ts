/** Deterministic date engine. The LLM returns the RULE; this code computes the date. */

export interface DueRuleDetail {
  anchor: "expiration_date" | "signature_date" | "effective_date" | "commencement_date" | "invoice_date" | `event:${string}` | "absolute";
  anchorValue?: string | null;
  offsetDays?: number | null;
  calendar?: "calendar" | "business";
  recurrence?: string | null;
}

export const ANCHOR_LABELS: Record<string, string> = {
  expiration_date: "expiration",
  signature_date: "signature",
  effective_date: "effective date",
  commencement_date: "commencement",
  invoice_date: "invoice",
  absolute: "fixed date"
};

export interface DateComputation {
  dueDate: string | null;
  math: string | null;
  needsAssumption: boolean;
  assumptionReason?: string;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

export function rollBusiness(iso: string): string {
  let d = parseISO(iso);
  while (!isBusinessDay(d)) {
    d = new Date(d.getTime() + 86400000);
  }
  return toISODate(d);
}

export function computeDueDate(
  rule: DueRuleDetail,
  anchors: Record<string, string | null | undefined>
): DateComputation {
  const calendar = rule.calendar ?? "calendar";

  if (rule.anchor === "absolute") {
    if (!rule.anchorValue) {
      return { dueDate: null, math: null, needsAssumption: true, assumptionReason: "No fixed date supplied." };
    }
    const due = calendar === "business" ? rollBusiness(rule.anchorValue) : rule.anchorValue;
    const math = calendar === "business"
      ? `fixed date ${rule.anchorValue} (business calendar) = ${due}`
      : `fixed date ${rule.anchorValue} = ${due}`;
    return { dueDate: due, math, needsAssumption: false };
  }

  if (rule.anchor.startsWith("event:")) {
    const eventName = rule.anchor.slice(6).replace(/_/g, " ");
    const ev = anchors[rule.anchor] ?? null;
    if (!ev) {
      return { dueDate: null, math: null, needsAssumption: true, assumptionReason: `The event "${eventName}" has not happened yet or is not dated in the document.` };
    }
    let due = addDays(ev, rule.offsetDays ?? 0);
    if (calendar === "business") due = rollBusiness(due);
    const math = `event "${eventName}" ${ev} ${fmtOffset(rule.offsetDays ?? 0)} = ${due}${calendar === "business" ? " (business days)" : ""}`;
    return { dueDate: due, math, needsAssumption: false };
  }

  const label = ANCHOR_LABELS[rule.anchor] ?? rule.anchor;
  const anchor = anchors[rule.anchor] ?? null;
  if (!anchor) {
    return {
      dueDate: null,
      math: null,
      needsAssumption: true,
      assumptionReason: `The ${label} date is not known — it is not stated in the document and no value has been supplied.`
    };
  }
  const offset = rule.offsetDays ?? 0;
  let due = addDays(anchor, offset);
  if (calendar === "business") due = rollBusiness(due);
  const math = `${label} ${anchor} ${fmtOffset(offset)} = ${due}${calendar === "business" ? " (business days)" : ""}`;
  return { dueDate: due, math, needsAssumption: false };
}

function fmtOffset(n: number): string {
  if (n === 0) return "(same day)";
  if (n > 0) return `plus ${n} days`;
  return `minus ${Math.abs(n)} days notice`;
}

/** Expand FREQ=MONTHLY;BYMONTHDAY=N or FREQ=YEARLY;MM-DD into concrete occurrences. */
export function expandRecurrence(rrule: string, fromISO: string, count: number): string[] {
  const out: string[] = [];
  const parts = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const freq = (parts.FREQ || "").toUpperCase();
  if (freq === "MONTHLY" && parts.BYMONTHDAY) {
    const monthDay = parseInt(parts.BYMONTHDAY, 10);
    let d = parseISO(fromISO);
    for (let i = 0; i < count * 3 && out.length < count; i++) {
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const day = Math.min(monthDay, lastDay);
      const occ = toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day)));
      if (occ >= fromISO) out.push(occ);
    }
    return out;
  }
  if (freq === "YEARLY" && parts.BYMONTH && parts.BYMONTHDAY) {
    const month = parseInt(parts.BYMONTH, 10);
    const day = parseInt(parts.BYMONTHDAY, 10);
    let year = parseISO(fromISO).getUTCFullYear();
    for (let i = 0; i < count + 2 && out.length < count; i++) {
      const occ = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (occ >= fromISO) out.push(occ);
      year++;
    }
    return out;
  }
  return [];
}

/** Build the anchors map the date engine needs from extracted field rows. */
export function anchorsFromFields(
  fields: { fieldKey: string; valueNormalized: string | null }[]
): Record<string, string | null> {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f.valueNormalized]));
  const parseNorm = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && "date" in v) return (v as { date: string }).date;
      if (typeof v === "string") return v;
    } catch { /* plain string */ }
    return null;
  };
  return {
    expiration_date: parseNorm(byKey.get("dates.expiration")),
    signature_date: parseNorm(byKey.get("dates.signature")),
    effective_date: parseNorm(byKey.get("dates.effective")),
    commencement_date: parseNorm(byKey.get("dates.commencement")),
    invoice_date: null
  };
}
