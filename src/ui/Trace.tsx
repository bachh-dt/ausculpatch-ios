import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { colors } from './theme';

/**
 * One trace over a fixed time window. Samples are reduced to a min/max pair per
 * pixel column (peak decimation, as pyqtgraph does on the desktop) so a 4 kHz
 * channel draws as fast as a 10 Hz one without losing spikes.
 */
export function Trace({
  times,
  values,
  tStart,
  tEnd,
  width,
  height,
  color,
  label,
  units,
}: {
  times: Float64Array;
  values: Float64Array;
  tStart: number;
  tEnd: number;
  width: number;
  height: number;
  color: string;
  label: string;
  units?: string;
}) {
  const cols = Math.max(1, Math.floor(width));
  const span = tEnd - tStart || 1;
  const mins = new Float64Array(cols).fill(Infinity);
  const maxs = new Float64Array(cols).fill(-Infinity);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < times.length; i++) {
    const col = Math.floor(((times[i] - tStart) / span) * (cols - 1));
    if (col < 0 || col >= cols) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < mins[col]) mins[col] = v;
    if (v > maxs[col]) maxs[col] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  let d = '';
  if (Number.isFinite(lo)) {
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.08;
    const top = hi + pad;
    const range = hi - lo + 2 * pad;
    const y = (v: number) => ((top - v) / range) * height;
    let started = false;
    for (let x = 0; x < cols; x++) {
      if (mins[x] === Infinity) continue;
      const y1 = y(maxs[x]).toFixed(1);
      const y2 = y(mins[x]).toFixed(1);
      d += `${started ? 'L' : 'M'}${x} ${y1}L${x} ${y2}`;
      started = true;
    }
  }

  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toExponential(1) : v.toPrecision(3));
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {Number.isFinite(lo) ? `${fmt(lo)} to ${fmt(hi)}${units ? ` ${units}` : ''}` : 'no signal'}
        </Text>
      </View>
      <Svg width={width} height={height} style={{ backgroundColor: colors.bg, borderRadius: 6 }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke={colors.grid} strokeWidth={0.5} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <Line
            key={`v${i}`}
            x1={(width * (i + 1)) / 10}
            x2={(width * (i + 1)) / 10}
            y1={0}
            y2={height}
            stroke={colors.grid}
            strokeWidth={0.5}
          />
        ))}
        {d ? <Path d={d} stroke={color} strokeWidth={1.4} fill="none" /> : null}
      </Svg>
    </View>
  );
}
