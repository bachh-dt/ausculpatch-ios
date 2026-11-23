/**
 * A live trace drawn with Skia on the GPU.
 *
 * Each frame the engine ticks, the trace asks its ring buffer for the min/max of
 * every pixel column (no copying, no allocation) and turns those into one path.
 * A 4 kHz channel costs the same to draw as a 10 Hz one. The vertical scale
 * follows the signal but eases down slowly, so it does not jump on every beat.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { ChannelBuffer } from '../live/buffers';
import { engine } from '../live/engine';
import { session } from '../ble/session';
import { colors } from './theme';

export function SignalTrace({
  source,
  windowS,
  width,
  height,
  color,
  label,
}: {
  source: () => ChannelBuffer;
  windowS: number;
  width: number;
  height: number;
  color: string;
  label: string;
}) {
  const [, setFrame] = useState(0);
  useEffect(() => engine.onFrame(() => setFrame((f) => (f + 1) % 1000000)), []);

  const cols = Math.max(2, Math.floor(width));
  const mins = useMemo(() => new Float64Array(cols), [cols]);
  const maxs = useMemo(() => new Float64Array(cols), [cols]);
  const scale = useRef<{ lo: number; hi: number } | null>(null);

  const latest = session.buffers.latestTimeS();
  let path = null;
  let hasData = false;
  if (latest !== null) {
    const tEnd = latest;
    const tStart = tEnd - windowS;
    const used = source().reduceColumns(tStart, tEnd, mins, maxs);
    if (used > 0) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < cols; i++) {
        if (mins[i] < lo) lo = mins[i];
        if (maxs[i] > hi) hi = maxs[i];
      }
      if (Number.isFinite(lo)) {
        hasData = true;
        if (hi - lo < 1e-9) {
          hi += 1;
          lo -= 1;
        }
        const s = scale.current;
        // Expand at once; shrink by 5% of the gap per frame.
        scale.current = s
          ? { lo: lo < s.lo ? lo : s.lo + 0.05 * (lo - s.lo), hi: hi > s.hi ? hi : s.hi + 0.05 * (hi - s.hi) }
          : { lo, hi };
        const { lo: L, hi: H } = scale.current;
        const pad = (H - L) * 0.08;
        const top = H + pad;
        const k = height / (H - L + 2 * pad);
        const p = Skia.PathBuilder.Make();
        let started = false;
        for (let x = 0; x < cols; x++) {
          if (mins[x] === Infinity) continue;
          const y1 = (top - maxs[x]) * k;
          const y2 = (top - mins[x]) * k;
          if (!started) {
            p.moveTo(x, y1);
            started = true;
          } else p.lineTo(x, y1);
          if (y2 - y1 > 0.5) p.lineTo(x, y2);
        }
        path = p.detach();
      }
    }
  }
  if (!hasData) scale.current = null;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${label} trace, last ${windowS} seconds`}>
      <Canvas style={{ width, height }}>
        <Line p1={vec(0, height / 2)} p2={vec(width, height / 2)} color={colors.grid} strokeWidth={1} />
        {path ? <Path path={path} color={color} style="stroke" strokeWidth={1.6} strokeJoin="round" /> : null}
      </Canvas>
      {!hasData ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 12, color: colors.faint }}>No signal yet</Text>
        </View>
      ) : null}
    </View>
  );
}
