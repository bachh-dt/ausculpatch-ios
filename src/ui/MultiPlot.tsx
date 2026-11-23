/** Several signals on one time axis, drawn with Skia, with labelled vertical markers. */
import React from 'react';
import { Text, View } from 'react-native';
import { Canvas, DashPathEffect, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { colors } from './theme';

export interface PlotSeries {
  x: Float64Array;
  y: Float64Array; // scaled to about -1..1
  color: string;
  width?: number;
}

export interface PlotMarker {
  x: number;
  color: string;
  label?: string;
  dashed?: boolean;
}

export function MultiPlot({
  series,
  xMin,
  xMax,
  width,
  height,
  markers = [],
  stacked = false,
  ticks = [],
  tickFormat = (v: number) => String(v),
  label,
}: {
  series: PlotSeries[];
  xMin: number;
  xMax: number;
  width: number;
  height: number;
  markers?: PlotMarker[];
  stacked?: boolean;
  ticks?: number[];
  tickFormat?: (v: number) => string;
  label: string;
}) {
  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * width;
  const lanes = stacked ? Math.max(1, series.length) : 1;
  const laneH = height / lanes;
  const paths = series.map((s, idx) => {
    const lane = stacked ? idx : 0;
    const mid = lane * laneH + laneH / 2;
    const amp = laneH * 0.45;
    const b = Skia.PathBuilder.Make();
    let started = false;
    for (let i = 0; i < s.x.length; i++) {
      const X = sx(s.x[i]);
      if (X < -1 || X > width + 1) continue;
      const Y = mid - s.y[i] * amp;
      if (!started) {
        b.moveTo(X, Y);
        started = true;
      } else b.lineTo(X, Y);
    }
    return started ? b.detach() : null;
  });

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Canvas style={{ width, height }}>
        {Array.from({ length: lanes }, (_, i) => (
          <Line key={`m${i}`} p1={vec(0, i * laneH + laneH / 2)} p2={vec(width, i * laneH + laneH / 2)} color={colors.line} strokeWidth={1} />
        ))}
        {markers.map((m, i) => (
          <Line key={`k${i}`} p1={vec(sx(m.x), 0)} p2={vec(sx(m.x), height)} color={m.color} strokeWidth={1}>
            {m.dashed ? <DashPathEffect intervals={[4, 4]} /> : null}
          </Line>
        ))}
        {paths.map((p, i) => (p ? <Path key={`p${i}`} path={p} color={series[i].color} style="stroke" strokeWidth={series[i].width ?? 1.5} strokeJoin="round" /> : null))}
      </Canvas>
      {markers.some((m) => m.label) ? (
        <View style={{ height: 16 }}>
          {markers
            .filter((m) => m.label)
            .map((m, i) => (
              <Text key={i} style={{ position: 'absolute', left: Math.min(width - 24, Math.max(0, sx(m.x) - 12)), width: 24, textAlign: 'center', fontSize: 10, fontWeight: '700', color: m.color }}>
                {m.label}
              </Text>
            ))}
        </View>
      ) : null}
      {ticks.length ? (
        <View style={{ height: 14 }}>
          {ticks.map((t) => (
            <Text key={t} style={{ position: 'absolute', left: Math.min(width - 36, Math.max(0, sx(t) - 18)), width: 36, textAlign: 'center', fontSize: 10, color: colors.muted }}>
              {tickFormat(t)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
