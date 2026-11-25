import { useId } from 'react';
import type { SheetResult, Units } from '../lib/types';
import { formatLength } from '../lib/units';

interface Props {
  sheet: SheetResult;
  colors: Map<string, string>;
  units: Units;
  precision: number;
  showCuts: boolean;
  showLabels: boolean;
  showCutNumbers?: boolean;
  highlight: string | null;
  onHover?: (partId: string | null) => void;
  /** Plan step to emphasise (its cuts are drawn bold, others faded). */
  activeStep?: number | null;
  className?: string;
}

export function SheetDiagram({
  sheet,
  colors,
  units,
  precision,
  showCuts,
  showLabels,
  showCutNumbers,
  highlight,
  onHover,
  activeStep = null,
  className,
}: Props) {
  const uidBase = useId().replace(/:/g, '');
  const L = sheet.length;
  const W = sheet.width;
  const m = Math.max(L, W);
  const pad = m * 0.05;
  const fsBase = m * 0.024;
  const minFs = m * 0.0085;
  const fmt = (v: number) => formatLength(v, units, precision);
  const unit = units === 'in' ? '″' : '';
  const grainId = `grain-${uidBase}`;
  const hatchId = `hatch-${uidBase}`;
  const shadowId = `shadow-${uidBase}`;

  return (
    <svg
      className={`sheet-svg ${className ?? ''}`}
      viewBox={`${-pad} ${-pad} ${L + pad * 1.4} ${W + pad * 1.4}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${sheet.stockName} layout`}
    >
      <defs>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width={m * 0.014} height={m * 0.014} patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={m * 0.014} className="hatch-line" strokeWidth={m * 0.0025} />
        </pattern>
        <pattern id={grainId} patternUnits="userSpaceOnUse" width={m * 0.25} height={m * 0.018}>
          <path
            d={`M0 ${m * 0.009} Q ${m * 0.0625} ${m * 0.004} ${m * 0.125} ${m * 0.009} T ${m * 0.25} ${m * 0.009}`}
            fill="none"
            className="grain-line"
            strokeWidth={m * 0.0012}
          />
        </pattern>
        <filter id={shadowId} x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow dx="0" dy={m * 0.003} stdDeviation={m * 0.004} floodOpacity="0.18" />
        </filter>
      </defs>

      {/* Dimension guides */}
      <g className="dim-guides">
        <line x1={0} y1={-pad * 0.45} x2={L} y2={-pad * 0.45} vectorEffect="non-scaling-stroke" />
        <line x1={0} y1={-pad * 0.62} x2={0} y2={-pad * 0.28} vectorEffect="non-scaling-stroke" />
        <line x1={L} y1={-pad * 0.62} x2={L} y2={-pad * 0.28} vectorEffect="non-scaling-stroke" />
        <line x1={-pad * 0.45} y1={0} x2={-pad * 0.45} y2={W} vectorEffect="non-scaling-stroke" />
        <line x1={-pad * 0.62} y1={0} x2={-pad * 0.28} y2={0} vectorEffect="non-scaling-stroke" />
        <line x1={-pad * 0.62} y1={W} x2={-pad * 0.28} y2={W} vectorEffect="non-scaling-stroke" />
        <text x={L / 2} y={-pad * 0.45} fontSize={fsBase * 0.85} className="dim-text" textAnchor="middle" dominantBaseline="central">
          <tspan className="dim-bg">{fmt(L) + unit}</tspan>
        </text>
        <text
          x={-pad * 0.45}
          y={W / 2}
          fontSize={fsBase * 0.85}
          className="dim-text"
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(-90 ${-pad * 0.45} ${W / 2})`}
        >
          {fmt(W) + unit}
        </text>
      </g>

      {/* Sheet */}
      <rect x={0} y={0} width={L} height={W} className="sheet-bg" filter={`url(#${shadowId})`} />
      <rect x={0} y={0} width={L} height={W} fill={`url(#${hatchId})`} />
      {sheet.grain && <rect x={0} y={0} width={L} height={W} fill={`url(#${grainId})`} opacity={0.6} />}
      {sheet.trim > 0 && (
        <rect
          x={sheet.trim}
          y={sheet.trim}
          width={L - 2 * sheet.trim}
          height={W - 2 * sheet.trim}
          className="trim-line"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Offcuts */}
      {sheet.offcuts.map((r, i) => {
        const fs = Math.min(fsBase * 0.7, r.h / 3, r.w / 9);
        return (
          <g key={`o${i}`} className="offcut">
            <rect x={r.x} y={r.y} width={r.w} height={r.h} vectorEffect="non-scaling-stroke" />
            {showLabels && fs > minFs && (
              <text x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={fs} textAnchor="middle" dominantBaseline="central">
                {fmt(r.w)} × {fmt(r.h)}
              </text>
            )}
          </g>
        );
      })}

      {/* Parts */}
      {sheet.placements.map((p, i) => {
        const color = colors.get(p.partId) ?? '#888';
        const dim = highlight != null && highlight !== p.partId;
        const vertical = p.h > p.w * 1.2;
        const boxW = vertical ? p.h : p.w;
        const boxH = vertical ? p.w : p.h;
        const name = p.name || 'Part';
        const dims = `${fmt(p.length)} × ${fmt(p.width)}`;
        const chars = Math.max(name.length, dims.length);
        let fs = Math.min(fsBase, boxH / 3.1, (boxW * 0.9) / (chars * 0.58));
        let twoLines = true;
        if (fs < minFs) {
          // Try a single line with just the name.
          twoLines = false;
          fs = Math.min(fsBase, boxH / 1.6, (boxW * 0.9) / (name.length * 0.58));
        }
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        return (
          <g
            key={`p${i}`}
            className={`part ${dim ? 'dim' : ''} ${highlight === p.partId ? 'hl' : ''}`}
            onMouseEnter={() => onHover?.(p.partId)}
            onMouseLeave={() => onHover?.(null)}
          >
            <title>
              {`${name} #${p.instance}\n${fmt(p.length)} × ${fmt(p.width)}${unit}${p.rotated ? ' (rotated)' : ''}\nat ${fmt(p.x)}, ${fmt(p.y)}`}
            </title>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={color} className="part-rect" vectorEffect="non-scaling-stroke" stroke={color} />
            {sheet.grain && <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={`url(#${grainId})`} className="part-grain" />}
            {showLabels && fs >= minFs && (
              <g transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined} className="part-label">
                {twoLines ? (
                  <>
                    <text x={cx} y={cy - fs * 0.55} fontSize={fs} textAnchor="middle" dominantBaseline="central" className="part-name">
                      {name}
                    </text>
                    <text x={cx} y={cy + fs * 0.62} fontSize={fs * 0.82} textAnchor="middle" dominantBaseline="central" className="part-dims">
                      {dims}
                    </text>
                  </>
                ) : (
                  <text x={cx} y={cy} fontSize={fs} textAnchor="middle" dominantBaseline="central" className="part-name">
                    {name}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}

      {/* Cuts */}
      {(showCuts || activeStep != null) && sheet.cuts.length > 0 && (
        <g className={`cuts ${activeStep != null ? 'focus' : ''}`}>
          {sheet.cuts.map((c, i) => (
            <line
              key={`c${i}`}
              className={activeStep === c.step ? 'active' : ''}
              x1={c.x1}
              y1={c.y1}
              x2={c.x2}
              y2={c.y2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {showCutNumbers &&
            sheet.cuts.map((c, i) => {
              const r = fsBase * 0.5;
              const len = Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1);
              // Badge at the cut's midpoint.
              const t = len * 0.5;
              const x = c.dir === 'h' ? c.x1 + t : c.x1;
              const y = c.dir === 'h' ? c.y1 : c.y1 + t;
              return (
                <g key={`n${i}`} className={`cut-badge ${activeStep === c.step ? 'active' : ''}`}>
                  <circle cx={x} cy={y} r={r} vectorEffect="non-scaling-stroke" />
                  <text x={x} y={y} fontSize={r * 1.15} textAnchor="middle" dominantBaseline="central">
                    {i + 1}
                  </text>
                </g>
              );
            })}
        </g>
      )}
    </svg>
  );
}
