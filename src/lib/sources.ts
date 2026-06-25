/**
 * Helpers for the source breakdown donut card.
 *
 * `aggregateSources` ranks raw GHL opp source strings into top-N buckets,
 * optionally aggregated by COUNT (leads-by-source) or by REVENUE (sum of
 * monetary_value-by-source). Anything that doesn't make the top-N cut OR
 * falls below `minShare` gets collapsed into a synthetic "Other" bucket.
 */

/** Strip common ad-platform prefixes and clip overly long names. */
export function displaySource(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return "Direct / Untagged";
  let s = raw.trim();
  s = s.replace(/^Meta\s*[-–]\s*/i, "");
  s = s.replace(/^Facebook\s*[-–]\s*/i, "");
  s = s.replace(/^Instagram\s*[-–]\s*/i, "");
  s = s.replace(/^Google\s*[-–]\s*/i, "");
  if (s.length > 32) s = s.slice(0, 30) + "…";
  return s;
}

export type AggregationMode = "count" | "revenue";

export type SourceBucket = {
  label: string;
  raw: string | null;
  /** Either count of opps (mode=count) OR sum of monetary_value (mode=revenue) */
  value: number;
  /** 0..1 share of total */
  share: number;
  isOther?: boolean;
  rolledUp?: string[];
};

type OppRow = {
  source: string | null | undefined;
  monetary_value?: number | null;
};

type Options = {
  mode?: AggregationMode;
  /** Maximum named slices before everything else collapses to "Other". */
  maxSlices?: number;
  /** Minimum share required for a slice to stay named (else rolls into "Other"). */
  minShare?: number;
};

export function aggregateSources(
  opps: OppRow[],
  { mode = "count", maxSlices = 6, minShare = 0.04 }: Options = {},
): SourceBucket[] {
  // Per-opp value: 1 for counting, monetary_value (numeric) for revenue.
  const valueOf = (o: OppRow): number =>
    mode === "count" ? 1 : Number(o.monetary_value ?? 0) || 0;

  const total = opps.reduce((acc, o) => acc + valueOf(o), 0);
  if (total === 0) return [];

  // Aggregate by source key (collapsing blank/null sources into one bucket)
  const sums = new Map<string, number>();
  for (const o of opps) {
    const key = o.source && o.source.trim() ? o.source.trim() : "__direct__";
    sums.set(key, (sums.get(key) ?? 0) + valueOf(o));
  }

  const ranked = [...sums.entries()]
    .map(([raw, value]) => ({ raw, value, share: value / total }))
    .filter((e) => e.value > 0)            // skip sources with no contribution in this mode
    .sort((a, b) => b.value - a.value);

  const named: SourceBucket[] = [];
  const other: { raw: string; value: number }[] = [];

  for (const entry of ranked) {
    const tooSmall = entry.share < minShare;
    const overSliceLimit = named.length >= maxSlices;
    if (tooSmall || overSliceLimit) {
      other.push(entry);
    } else {
      named.push({
        label: displaySource(entry.raw === "__direct__" ? null : entry.raw),
        raw: entry.raw === "__direct__" ? null : entry.raw,
        value: entry.value,
        share: entry.share,
      });
    }
  }

  if (other.length > 0) {
    const otherTotal = other.reduce((acc, o) => acc + o.value, 0);
    named.push({
      label: "Other",
      raw: null,
      value: otherTotal,
      share: otherTotal / total,
      isOther: true,
      rolledUp: other.map((o) => (o.raw === "__direct__" ? "Direct / Untagged" : o.raw)),
    });
  }

  return named;
}
