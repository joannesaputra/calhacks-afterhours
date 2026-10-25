import { displayPercent, monthLabel, usd, type SalesMetrics } from "./calculations";

/** Channel colors in template order (amber, pink, teal, purple, blues); "Others" is neutral. */
export const CHANNEL_COLORS = ["F5A623", "E84F95", "129C86", "8A4FC2", "1F6FB2", "4FA8E8"] as const;
const OTHERS_COLOR = "9FB3C8";
/** Six slots fit the slide list and the legends; more channels are folded into "Others". */
const MAX_CHANNELS = 6;

export type Direction = "up" | "down" | "flat" | "none";
export interface Kpi { label: string; value: string; change: string; direction: Direction }
export interface DashboardChannel {
  name: string;
  color: string;
  /** Revenue in each of the two months, in dollars. */
  revenue: [number, number];
  shareText: string;
  growthText: string;
  direction: Direction;
}
/** One-page sales dashboard: every value is calculated in code from the CSV, never by the model. */
export interface Dashboard {
  timeFrame: string;
  comparison: string;
  question: string;
  months: [string, string];
  /** Total orders and average order value (dollars, null without orders) for the two months. */
  orders: [number, number];
  averageOrderValue: [number | null, number | null];
  kpis: Kpi[];
  channels: DashboardChannel[];
  note: string;
}

const pct = (value: number) => `${displayPercent(value)}%`;

function change(next: number | null, previous: number | null): { change: string; direction: Direction } {
  if (next === null || previous === null) return { change: "n/a", direction: "none" };
  if (next === previous) return { change: "No change", direction: "flat" };
  if (previous === 0) return { change: "New (from zero)", direction: "up" };
  const value = Math.round(((next - previous) / previous) * 10_000) / 100;
  return { change: `${value > 0 ? "+" : "-"}${pct(Math.abs(value))}`, direction: value > 0 ? "up" : "down" };
}

function pointChange(next: number | null, previous: number | null): { change: string; direction: Direction } {
  if (next === null || previous === null) return { change: "n/a", direction: "none" };
  const points = Math.round((next - previous) * 10) / 10;
  if (points === 0) return { change: "No change", direction: "flat" };
  return { change: `${points > 0 ? "+" : "-"}${Math.abs(points)} pts`, direction: points > 0 ? "up" : "down" };
}

export function buildDashboard(metrics: SalesMetrics): Dashboard {
  const [first, second] = metrics.months as [SalesMetrics["months"][number], SalesMetrics["months"][number]];
  const share = (minor: number, total: number) => (total === 0 ? null : Math.round((minor / total) * 1000) / 10);
  const ranked = [...metrics.channels].sort((a, b) => (b.values[second.month]! - a.values[second.month]!) || a.channel.localeCompare(b.channel));
  const shown = ranked.length > MAX_CHANNELS ? ranked.slice(0, MAX_CHANNELS - 1) : ranked;
  const rest = ranked.slice(shown.length);
  const rows = [
    ...shown.map((channel, index) => ({ name: channel.channel, color: CHANNEL_COLORS[index]!, minor: [channel.values[first.month]!, channel.values[second.month]!] as [number, number] })),
    ...(rest.length ? [{ name: `Others (${rest.length})`, color: OTHERS_COLOR, minor: [rest.reduce((sum, c) => sum + c.values[first.month]!, 0), rest.reduce((sum, c) => sum + c.values[second.month]!, 0)] as [number, number] }] : []),
  ];
  const channels: DashboardChannel[] = rows.map((row) => {
    const shareNow = share(row.minor[1], second.revenueMinor);
    const growth = change(row.minor[1], row.minor[0]);
    return {
      name: row.name, color: row.color, revenue: [row.minor[0] / 100, row.minor[1] / 100],
      shareText: shareNow === null ? "n/a" : pct(shareNow),
      growthText: growth.direction === "flat" || growth.direction === "none" ? growth.change : growth.change.replace(/^[+-]/, ""),
      direction: growth.direction,
    };
  });
  const top = ranked[0]!;
  const topShare = pointChange(share(top.values[second.month]!, second.revenueMinor), share(top.values[first.month]!, first.revenueMinor));
  const m1 = monthLabel(first.month);
  const m2 = monthLabel(second.month);
  return {
    timeFrame: m2, comparison: m1,
    question: `How is sales performance trending in ${m2}?`,
    months: [monthLabel(first.month, false), monthLabel(second.month, false)],
    orders: [first.orders, second.orders],
    averageOrderValue: [first.averageOrderValueMinor === null ? null : first.averageOrderValueMinor / 100, second.averageOrderValueMinor === null ? null : second.averageOrderValueMinor / 100],
    kpis: [
      { label: "Total revenue", value: usd(second.revenueMinor), ...change(second.revenueMinor, first.revenueMinor) },
      { label: "Orders", value: second.orders.toLocaleString("en-US"), ...change(second.orders, first.orders) },
      { label: "Average order value", value: second.averageOrderValueMinor === null ? "n/a" : usd(second.averageOrderValueMinor), ...change(second.averageOrderValueMinor, first.averageOrderValueMinor) },
      { label: `${top.channel} share of revenue`, value: (() => { const s = share(top.values[second.month]!, second.revenueMinor); return s === null ? "n/a" : pct(s); })(), ...topShare },
    ],
    channels,
    note: `Calculated in code from the supplied CSV; changes compare ${m2} with ${m1}.`,
  };
}
