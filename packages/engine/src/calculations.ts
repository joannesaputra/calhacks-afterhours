import { parse } from "csv-parse/sync";
import { EngineError } from "./errors";

export interface SalesRow { row: number; month: string; channel: string; revenueMinor: number; orders: number }
export interface SalesMetrics {
  currency: "USD";
  months: Array<{ month: string; revenueMinor: number; orders: number; averageOrderValueMinor: number | null }>;
  channels: Array<{ channel: string; values: Record<string, number>; sharePercent: Record<string, number | null>; growthPercent: number | null }>;
  revenueChangeMinor: number;
  orderChange: number;
  revenueGrowthPercent: number | null;
  orderGrowthPercent: number | null;
  websiteSharePercent: Record<string, number | null>;
  rows: SalesRow[];
}

function minorUnits(value: unknown, field: string, row: number): number {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new EngineError("INVALID_CSV", `${field} at CSV row ${row} must be a nonnegative amount with at most two decimals; blank values are unknown, not zero.`, false);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function integer(value: unknown, field: string, row: number): number {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new EngineError("INVALID_CSV", `${field} at CSV row ${row} must be a nonnegative integer; blank values are unknown, not zero.`, false);
  return Number(text);
}

export function calculateSales(csv: string): SalesMetrics {
  let records: Record<string, string>[];
  try {
    records = parse(csv, { bom: true, columns: true, skip_empty_lines: true, trim: true, relax_column_count: false });
  } catch {
    throw new EngineError("INVALID_CSV", "The sales CSV is malformed.", false);
  }
  if (!records.length || records.length > 10_000) throw new EngineError("INVALID_CSV", "The sales CSV must contain 1-10,000 data rows.", false);
  const required = ["month", "channel", "revenue_usd", "orders"];
  if (required.some((key) => !(key in records[0]!))) throw new EngineError("INVALID_CSV", `The sales CSV requires columns: ${required.join(", ")}.`, false);
  if ("currency" in records[0]!) {
    const currencies = [...new Set(records.map((record) => (record.currency ?? "").trim().toUpperCase()))];
    if (currencies.length !== 1 || currencies[0] !== "USD") throw new EngineError("UNSUPPORTED_INPUT", `The sales CSV mixes or uses non-USD currencies (${currencies.map((item) => item || "blank").join(", ")}); amounts in different currencies are never summed.`, false);
  }
  const rows = records.map((record, index): SalesRow => {
    const row = index + 2;
    if (!/^\d{4}-\d{2}$/.test(record.month ?? "")) throw new EngineError("INVALID_CSV", `month at CSV row ${row} must use YYYY-MM.`, false);
    if (!(record.channel ?? "").trim()) throw new EngineError("INVALID_CSV", `channel at CSV row ${row} is required.`, false);
    return { row, month: record.month!, channel: record.channel!, revenueMinor: minorUnits(record.revenue_usd, "revenue_usd", row), orders: integer(record.orders, "orders", row) };
  });
  const monthKeys = [...new Set(rows.map((row) => row.month))].sort();
  if (monthKeys.length !== 2) throw new EngineError("UNSUPPORTED_INPUT", "Month-over-month reporting currently requires exactly two months.", false);
  const months = monthKeys.map((month) => {
    const selected = rows.filter((row) => row.month === month);
    const revenueMinor = selected.reduce((sum, row) => sum + row.revenueMinor, 0);
    const orders = selected.reduce((sum, row) => sum + row.orders, 0);
    return { month, revenueMinor, orders, averageOrderValueMinor: orders === 0 ? null : Math.round(revenueMinor / orders) };
  });
  const pct = (next: number, previous: number) => previous === 0 ? null : Math.round(((next - previous) / previous) * 10_000) / 100;
  const channelKeys = [...new Set(rows.map((row) => row.channel))].sort();
  // A month with no revenue has no channel shares (0 of 0 is undefined, not 0%).
  const share = (part: number, whole: number) => whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
  const channels = channelKeys.map((channel) => {
    const values = Object.fromEntries(monthKeys.map((month) => [month, rows.filter((row) => row.month === month && row.channel === channel).reduce((sum, row) => sum + row.revenueMinor, 0)]));
    return { channel, values, sharePercent: Object.fromEntries(monthKeys.map((month, index) => [month, share(values[month]!, months[index]!.revenueMinor)])), growthPercent: pct(values[monthKeys[1]!]!, values[monthKeys[0]!]!) };
  });
  const website = channels.find((channel) => channel.channel.toLowerCase() === "website");
  return {
    currency: "USD", months, channels, revenueChangeMinor: months[1]!.revenueMinor - months[0]!.revenueMinor,
    orderChange: months[1]!.orders - months[0]!.orders,
    revenueGrowthPercent: pct(months[1]!.revenueMinor, months[0]!.revenueMinor),
    orderGrowthPercent: pct(months[1]!.orders, months[0]!.orders),
    websiteSharePercent: Object.fromEntries(monthKeys.map((month, index) => [month, share(website?.values[month] ?? 0, months[index]!.revenueMinor)])),
    rows,
  };
}

/** The single display rounding for percentages (one decimal, half away from zero); content and verification both use it. */
export function displayPercent(value: number): number {
  return Math.sign(value) * Math.round(Number((Math.abs(value) * 10).toPrecision(12))) / 10;
}

/** "2026-01" -> "January 2026", computed in UTC so the machine timezone cannot shift it. */
export function monthLabel(key: string, withYear = true): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", ...(withYear ? { year: "numeric" } : {}) }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

export function usd(minor: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}
