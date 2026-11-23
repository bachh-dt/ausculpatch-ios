import React, { useEffect, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { engine } from '../../live/engine';
import { settings } from '../../app/services';
import { Interval, REFERENCE } from '../../dsp/cardiac';
import { useEngine, useSession, useSettings } from '../hooks';
import { Header, Panel, Screen, Segmented } from '../kit';
import { MultiPlot, PlotMarker, PlotSeries } from '../MultiPlot';
import { colors, font, space } from '../theme';

const SCG_COLOR = '#0F766E';
const SIGNALS = [
  { key: 'ecg', label: 'ECG', color: colors.ecg },
  { key: 'pcg', label: 'Heart sound', color: colors.heart },
  { key: 'scg', label: 'SCG', color: SCG_COLOR },
] as const;
type SigKey = (typeof SIGNALS)[number]['key'];

function Legend({ shown, toggle }: { shown: Record<SigKey, boolean>; toggle: (k: SigKey) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {SIGNALS.map((s) => (
        <Pressable
          key={s.key}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: shown[s.key] }}
          onPress={() => toggle(s.key)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 999, backgroundColor: shown[s.key] ? colors.bg : 'transparent', borderWidth: 1, borderColor: shown[s.key] ? 'transparent' : colors.grid }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: shown[s.key] ? s.color : colors.grid }} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: shown[s.key] ? colors.text : colors.faint }}>{s.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Measure({ name, what, value, range }: { name: string; what: string; value: string; range: string }) {
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 }}>{name}</Text>
        <Text style={{ fontSize: 17, fontWeight: '800', color: value === '--' ? colors.faint : colors.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      <Text style={font.small}>{what}</Text>
      <Text style={{ fontSize: 11, color: colors.faint }}>{`Typical at rest: ${range}`}</Text>
    </View>
  );
}

const fmtIv = (iv: Interval | null) => (iv ? `${Math.round(iv.ms)} ms${iv.iqrMs !== null ? ` ±${Math.round(iv.iqrMs / 2)}` : ''}` : '--');

export function ScienceScreen() {
  useEffect(() => engine.useScience(), []);
  const e = useEngine();
  const s = useSession();
  const st = useSettings();
  const { width } = useWindowDimensions();
  const plotW = width - 2 * space.xl - 2 * space.l;
  const [shown, setShown] = useState<Record<SigKey, boolean>>({ ecg: true, pcg: true, scg: true });
  const [stacked, setStacked] = useState(false);
  const toggle = (k: SigKey) => setShown((p) => ({ ...p, [k]: !p[k] }));
  const r = e.science;
  const iv = r?.intervals;

  // Last 5 s, overlaid.
  const live: PlotSeries[] = [];
  const liveMarks: PlotMarker[] = [];
  if (r?.overlay) {
    const o = r.overlay;
    if (shown.ecg) live.push({ x: o.t, y: o.ecg, color: colors.ecg });
    if (shown.pcg) live.push({ x: o.t, y: o.pcg, color: colors.heart, width: 1.2 });
    if (shown.scg && o.scg) live.push({ x: o.t, y: o.scg, color: SCG_COLOR });
    for (const x of o.r) liveMarks.push({ x, color: '#94A3B8', dashed: true, label: 'R' });
    for (const x of o.s1) liveMarks.push({ x, color: colors.heart });
    for (const x of o.s2) liveMarks.push({ x, color: '#E58A97' });
  }

  // Averaged beat.
  const beat: PlotSeries[] = [];
  const beatMarks: PlotMarker[] = [];
  if (r?.ensemble) {
    const en = r.ensemble;
    if (shown.ecg) beat.push({ x: en.t, y: en.ecg, color: colors.ecg, width: 2 });
    if (shown.pcg) beat.push({ x: en.t, y: en.pcg, color: colors.heart, width: 2 });
    if (shown.scg && en.scg) beat.push({ x: en.t, y: en.scg, color: SCG_COLOR, width: 2 });
    beatMarks.push({ x: 0, color: '#94A3B8', dashed: true, label: 'R' });
    const m = en.marks;
    if (m.s1 !== null) beatMarks.push({ x: m.s1, color: colors.heart, label: 'S1' });
    if (m.s2 !== null) beatMarks.push({ x: m.s2, color: colors.heart, label: 'S2' });
    if (m.ao !== null) beatMarks.push({ x: m.ao, color: SCG_COLOR, label: 'AO', dashed: true });
    if (m.ac !== null) beatMarks.push({ x: m.ac, color: SCG_COLOR, label: 'AC', dashed: true });
  }

  return (
    <Screen>
      <Header title="Science" />
      <Text style={{ fontSize: 14, color: colors.muted, marginTop: -12 }}>
        {s.connected ? `ECG, heart sound and chest vibration over the last 30 s · updates every 2 s` : 'Connect the patch to analyse its signals.'}
      </Text>

      <Legend shown={shown} toggle={toggle} />

      <Panel>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Last 5 seconds</Text>
          <Segmented
            label="Layout"
            options={[
              { value: 'overlay', label: 'Overlay' },
              { value: 'stacked', label: 'Stacked' },
            ]}
            value={stacked ? 'stacked' : 'overlay'}
            onChange={(v) => setStacked(v === 'stacked')}
          />
        </View>
        {r?.overlay ? (
          <MultiPlot
            series={live}
            xMin={-5}
            xMax={0}
            width={plotW}
            height={stacked ? 210 : 160}
            stacked={stacked}
            markers={liveMarks}
            ticks={[-5, -4, -3, -2, -1, 0]}
            tickFormat={(v) => `${v} s`}
            label="ECG, heart sound and SCG over the last 5 seconds"
          />
        ) : (
          <Text style={font.small}>Waiting for enough signal.</Text>
        )}
        <Text style={font.small}>Grey dashed lines are R peaks; red lines mark S1 and pink lines S2. Zero-phase filtered, so the filters do not shift one signal against another. Each signal is scaled to its own peak.</Text>
      </Panel>

      <Panel>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Average heartbeat</Text>
          <Text style={font.small}>{r ? `${r.beatsUsed} of ${r.beatsFound} beats` : ''}</Text>
        </View>
        {r?.ensemble ? (
          <MultiPlot
            series={beat}
            xMin={-0.2}
            xMax={0.8}
            width={plotW}
            height={180}
            stacked={stacked}
            markers={beatMarks}
            ticks={[-0.2, 0, 0.2, 0.4, 0.6, 0.8]}
            tickFormat={(v) => `${Math.round(v * 1000)}`}
            label="Average heartbeat aligned on the ECG R peak"
          />
        ) : (
          <Text style={font.small}>Needs about 6 clean heartbeats in the ECG.</Text>
        )}
        <Text style={font.small}>Every beat in the last 30 s, lined up on its R peak (0 ms) and averaged. Averaging removes noise that does not repeat with the heartbeat. The heart sound is shown as its envelope.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={font.label}>{`SCG axis${r?.scgAxis && st.scgAxis === 'auto' ? ` (using ${r.scgAxis.toUpperCase()})` : ''}`}</Text>
          <Segmented
            label="SCG axis"
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'x', label: 'X' },
              { value: 'y', label: 'Y' },
              { value: 'z', label: 'Z' },
            ]}
            value={st.scgAxis}
            onChange={(v) => settings.update({ scgAxis: v as 'auto' | 'x' | 'y' | 'z' })}
          />
        </View>
      </Panel>

      <Panel style={{ gap: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>Timing between the signals</Text>
        <Measure name="R → S1" what="Electromechanical activation: from the electrical trigger to the first heart sound." value={fmtIv(iv?.rS1 ?? null)} range={REFERENCE.rS1} />
        <Measure name="R → S2" what="Electromechanical systole (QS2 proxy): electrical trigger to aortic valve closure." value={fmtIv(iv?.rS2 ?? null)} range={REFERENCE.rS2} />
        <Measure name="S1 → S2" what="Mechanical systole: how long the heart contracts." value={fmtIv(iv?.s1s2 ?? null)} range={REFERENCE.s1s2} />
        <Measure name="R → AO" what="Pre-ejection period proxy: trigger to aortic valve opening, seen in the SCG." value={fmtIv(iv?.rAO ?? null)} range={REFERENCE.rAO} />
        <Measure name="AO → AC" what="Ejection time proxy (LVET): how long blood leaves the left ventricle." value={fmtIv(iv?.aoAC ?? null)} range={REFERENCE.aoAC} />
        <Measure name="PEP / LVET" what="Contractility index; it rises when the heart pumps less forcefully." value={iv?.pepLvet != null ? iv.pepLvet.toFixed(2) : '--'} range={REFERENCE.pepLvet} />
        <Measure name="R → S2 / RR" what="Share of each heartbeat spent in systole." value={iv?.qs2Fraction != null ? `${Math.round(iv.qs2Fraction * 100)}%` : '--'} range="about 40-50% at rest" />
        <Text style={[font.small, { marginTop: 8 }]}>± is half the spread across single beats. R stands in for the Q wave, so the R-based intervals are 20-40 ms shorter than the Q-based values in textbooks.</Text>
      </Panel>

      <Panel style={{ gap: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>Heart-rate variability (30 s)</Text>
        <Measure name="Mean heart rate" what="From the R-R intervals." value={r?.hrv ? `${Math.round(r.hrv.meanHr)} bpm` : '--'} range="60-100 bpm" />
        <Measure name="SDNN" what="Overall variation of the beat-to-beat interval." value={r?.hrv ? `${Math.round(r.hrv.sdnnMs)} ms` : '--'} range={REFERENCE.sdnn} />
        <Measure name="RMSSD" what="Short-term variation, mostly from breathing (vagal tone)." value={r?.hrv ? `${Math.round(r.hrv.rmssdMs)} ms` : '--'} range={REFERENCE.rmssd} />
        <Measure name="pNN50" what="Share of successive intervals that differ by more than 50 ms." value={r?.hrv ? `${Math.round(r.hrv.pnn50 * 100)}%` : '--'} range="varies widely between people" />
        <Text style={[font.small, { marginTop: 8 }]}>30 s is short for HRV. Standard short-term HRV uses 5 minutes, so treat these as a trend.</Text>
      </Panel>

      {r?.notes.length ? (
        <Panel style={{ gap: 6 }}>
          {r.notes.map((n, i) => (
            <Text key={i} style={font.small}>
              {n}
            </Text>
          ))}
        </Panel>
      ) : null}
      <Text style={[font.small, { textAlign: 'center' }]}>Research measures from a wearable sensor. They are not a diagnosis.</Text>
    </Screen>
  );
}
