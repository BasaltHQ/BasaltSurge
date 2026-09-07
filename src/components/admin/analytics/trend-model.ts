export type TrendMetric = "successRate" | "amountEarned";
export type TrendScale = "linear" | "log";
export interface TrendPoint {
  label?: string;
  timestamp?: number | string;
  bucketEnd?: number | string;
  date?: string;
  [key: string]: any;
}
export interface GitCommitEvent {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
  dateLabel: string;
  tag?: string;
  impactHighlight?: string;
}

export function finiteTrendValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function trendValue(point: TrendPoint, series: string, metric: TrendMetric): number | null {
  const details = point[`${series}Details`];
  if (metric === "successRate" && finiteTrendValue(details?.total) === 0) return null;
  return finiteTrendValue(point[series]);
}

/** Daily observations preserve elapsed time, including unobserved days. Undated legacy inputs remain categorical. */
export function trendXPositions(data: TrendPoint[], start = 35, end = 965): number[] {
  const times = data.map(point => trendTimestamp(point.timestamp ?? point.date));
  const validTimes = times.filter((time): time is number => time !== null);
  const dated = validTimes.length === data.length;
  const minimum = dated && validTimes.length ? Math.min(...validTimes) : 0;
  const maximum = dated && validTimes.length ? Math.max(...validTimes) : 0;
  return data.map((_, index) => dated && maximum > minimum
    ? start + (times[index]! - minimum) / (maximum - minimum) * (end - start)
    : data.length > 1 ? start + index / (data.length - 1) * (end - start) : (start + end) / 2);
}

/** Missing observations and absent daily buckets start a new segment, never an implied zero or interpolation. */
export function trendLinePath(points: Array<{ x: number; y: number | null; timestamp?: number | null }>, maximumGapMs = 26 * 60 * 60 * 1000): string {
  let open = false;
  let previousTime: number | null = null;
  return points.map(point => {
    const time = point.timestamp ?? null;
    if (time !== null && previousTime !== null && (time - previousTime > maximumGapMs || time < previousTime)) open = false;
    previousTime = time;
    if (point.y === null || !Number.isFinite(point.y)) { open = false; return ""; }
    const segment = `${open ? "L" : "M"} ${point.x} ${point.y}`;
    open = true;
    return segment;
  }).join(" ");
}

export const trendTimestamp = (value: unknown): number | null => {
  const timestamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

/** Match real events to explicit time intervals, or dated daily buckets in the selected timezone. */
export function matchTrendCommit(pointData: TrendPoint[], commit: GitCommitEvent, timezone = "America/Los_Angeles"): number | null {
  const eventTime = trendTimestamp(commit.timestamp);
  if (eventTime === null) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (let index = 0; index < pointData.length; index++) {
    const point = pointData[index];
    const start = trendTimestamp(point.timestamp ?? point.date);
    if (start === null) continue;
    const end = trendTimestamp(point.bucketEnd);
    if (end !== null ? eventTime >= start && eventTime < end : day.format(eventTime) === day.format(start)) return index;
  }
  return null;
}
