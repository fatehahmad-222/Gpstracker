import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG charts.
 *
 * Deliberately no chart library: the only widget the spec needs is a small
 * 7-day trend. Recharts/Chart.js would add ~100 kB for one sparkline. These are
 * pure SVG, so they inherit the module's tokens and print correctly.
 */

/**
 * Minimal bar chart. Used for the Dashboard's "Weekly Trend" card.
 *
 * @param {Array<{label:string,value:number}>} data
 */
export function BarChart({
  data = [],
  height = 140,
  color = "rgb(var(--brand))",
  valueFormat = (v) => String(v),
  className,
  ariaLabel = "Bar chart",
}) {
  const max = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const gap = 6;
  const barWidth = data.length ? 100 / data.length : 100;

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {/* baseline + quarter gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1="0"
            x2="100"
            y1={height - t * (height - 12) - 4}
            y2={height - t * (height - 12) - 4}
            stroke="rgb(var(--line))"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {data.map((d, i) => {
          const value = Number(d.value) || 0;
          const h = (value / max) * (height - 16);
          const x = i * barWidth + gap / 2;
          const w = barWidth - gap;
          return (
            <rect
              key={i}
              x={x}
              y={height - h - 4}
              width={w}
              height={Math.max(h, value > 0 ? 1.5 : 0)}
              rx="1.5"
              fill={d.color || color}
              opacity={d.dim ? 0.45 : 1}
            >
              <title>{`${d.label}: ${valueFormat(value)}`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="mt-1.5 flex text-[10px] font-medium uppercase tracking-wide text-ink-dim">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact line chart with an optional area fill and dots.
 */
export function LineChart({
  data = [],
  height = 140,
  stroke = "rgb(var(--brand))",
  fill = "rgb(var(--brand) / 0.12)",
  valueFormat = (v) => String(v),
  className,
  ariaLabel = "Line chart",
  showDots = true,
}) {
  if (data.length === 0) return null;

  const values = data.map((d) => Number(d.value) || 0);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;

  const pad = 6;
  const innerH = height - pad * 2;
  const stepX = data.length > 1 ? 100 / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((Number(d.value) || 0) - min) / span * innerH;
    return { x, y, d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L100,${height} L0,${height} Z`;

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        <path d={areaPath} fill={fill} />
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {showDots
          ? points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="1.6" fill={stroke}>
                <title>{`${p.d.label}: ${valueFormat(p.d.value)}`}</title>
              </circle>
            ))
          : null}
      </svg>

      <div className="mt-1.5 flex text-[10px] font-medium uppercase tracking-wide text-ink-dim">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline trend indicator, e.g. next to a KPI. */
export function Sparkline({ values = [], width = 64, height = 20, className, stroke = "rgb(var(--brand))" }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  const path = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Horizontal stacked bar for the timeline view (in / out / offline segments).
 */
export function SegmentBar({ segments = [], className, ariaLabel }) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, Number(s.minutes) || 0), 0);
  if (total <= 0) return <div className={cn("h-2 w-full rounded-pill bg-surface-2", className)} />;

  return (
    <div
      className={cn("flex h-2 w-full overflow-hidden rounded-pill bg-surface-2", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((s, i) => {
        const pct = (Math.max(0, Number(s.minutes) || 0) / total) * 100;
        if (pct <= 0) return null;
        return (
          <span
            key={i}
            style={{ width: `${pct}%`, backgroundColor: s.color || "rgb(var(--brand))" }}
            title={`${s.label}: ${s.minutes} min`}
          />
        );
      })}
    </div>
  );
}