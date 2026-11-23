import React, { useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { session } from '../../ble/session';
import { engine } from '../../live/engine';
import * as P from '../../protocol/protocol';
import { CLEAR_ANGLE_DEG, FALL_PROFILES } from '../../dsp/motion';
import { settings } from '../../app/services';
import { BandSetting, DEFAULT_SETTINGS, FallSensitivity } from '../../settings/settings';
import { useEngine, useSession, useSettings } from '../hooks';
import { Badge, BigButton, Header, NumberStepper, Panel, qualityBadge, Segmented, SwitchRow } from '../kit';
import { SignalTrace } from '../SignalTrace';
import { colors, font, space } from '../theme';
import { DeviceScreen } from './DeviceScreen';
import { FilesScreen } from './FilesScreen';
import { LogScreen } from './LogScreen';
import { RecordingScreen } from './RecordingScreen';

type Tab = 'sampling' | 'filters' | 'motion' | 'log' | 'files';

const ORDERS = [
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 6, label: '6' },
];

function BandEditor({
  title,
  band,
  low,
  high,
  onChange,
}: {
  title: string;
  band: BandSetting;
  low: { min: number; max: number; step: number; decimals: number };
  high: { min: number; max: number; step: number; decimals: number };
  onChange: (b: BandSetting) => void;
}) {
  const set = (patch: Partial<BandSetting>) => {
    const next = { ...band, ...patch };
    if (next.lowHz < next.highHz) onChange(next);
  };
  return (
    <Panel style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title}</Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accentText }}>{`${band.lowHz.toFixed(low.decimals)} to ${band.highHz.toFixed(high.decimals)} Hz · order ${band.order}`}</Text>
      </View>
      <NumberStepper label="Low cut" value={band.lowHz} unit="Hz" {...low} onChange={(v) => set({ lowHz: v })} />
      <NumberStepper label="High cut" value={band.highHz} unit="Hz" {...high} onChange={(v) => set({ highHz: v })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
        <Text style={font.label}>Order</Text>
        <Segmented label={`${title} order`} options={ORDERS} value={band.order} onChange={(v) => set({ order: v })} />
      </View>
    </Panel>
  );
}

function FiltersPanel() {
  const st = useSettings();
  const e = useEngine();
  const s = useSession();
  const { width } = useWindowDimensions();
  const traceWidth = width - 2 * space.xl - 2 * space.l;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 40, gap: 12 }}>
      <BandEditor
        title="Heart sound band-pass"
        band={st.heartBand}
        low={{ min: 5, max: 200, step: 5, decimals: 0 }}
        high={{ min: 30, max: 1000, step: 5, decimals: 0 }}
        onChange={(b) => settings.update({ heartBand: b })}
      />
      <BandEditor
        title="ECG band-pass"
        band={st.ecgBand}
        low={{ min: 0.1, max: 5, step: 0.1, decimals: 1 }}
        high={{ min: 15, max: 150, step: 1, decimals: 0 }}
        onChange={(b) => settings.update({ ecgBand: b })}
      />
      <Panel style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Breathing {st.breathLowHz > 0 ? 'band-pass' : 'low-pass'}</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accentText }}>
            {st.breathLowHz > 0 ? `${st.breathLowHz.toFixed(2)} to ${st.breathCutHz.toFixed(1)} Hz · order ${st.breathOrder}` : `${st.breathCutHz.toFixed(1)} Hz · order ${st.breathOrder}`}
          </Text>
        </View>
        <NumberStepper
          label="Low cut (0 = off)"
          value={st.breathLowHz}
          unit="Hz"
          step={0.05}
          min={0}
          max={Math.max(0, st.breathCutHz - 0.05)}
          decimals={2}
          onChange={(v) => settings.update({ breathLowHz: v })}
        />
        <NumberStepper label="High cut" value={st.breathCutHz} unit="Hz" step={0.1} min={0.2} max={2} decimals={1} onChange={(v) => settings.update({ breathCutHz: v })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <Text style={font.label}>Order</Text>
          <Segmented label="Breathing order" options={ORDERS} value={st.breathOrder} onChange={(v) => settings.update({ breathOrder: v })} />
        </View>
        <Text style={font.small}>Breathing comes from the slow swell of the heart-sound envelope. 0.1 to 0.5 Hz covers 6 to 30 breaths a minute.</Text>
      </Panel>

      <Panel>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>Preview with the current filters</Text>
        <SignalTrace source={() => session.clinical.heartOut} windowS={5} width={traceWidth} height={64} color={colors.heart} label="Heart sound preview" />
        <SignalTrace source={() => session.clinical.ecgOut} windowS={5} width={traceWidth} height={64} color={colors.ecg} label="ECG preview" />
        <SignalTrace source={() => session.clinical.breathOut} windowS={30} width={traceWidth} height={56} color={colors.breath} label="Breathing preview, 30 s" />
        <Text style={font.small}>Filters run on the phone. They change the traces, heart rate and breathing rate. Recordings always keep the raw samples.</Text>
      </Panel>

      <Panel style={{ gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Signal quality</Text>
        {[
          ['ECG', e.ecgQuality],
          ['Heart sound', e.heartQuality],
        ].map(([name, q]) => {
          const qq = q as typeof e.heartQuality;
          return (
            <View key={name as string} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ width: 92, fontSize: 14, fontWeight: '600', color: colors.text }}>{name as string}</Text>
              <Text style={{ width: 44, fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>{qq.level === 'unknown' ? '--' : qq.score.toFixed(2)}</Text>
              <Text style={[font.small, { flex: 1 }]} numberOfLines={2}>
                {qq.reason}
              </Text>
              <Badge {...qualityBadge(qq.level, s.connected)} />
            </View>
          );
        })}
        <NumberStepper label="Good above" value={st.qualityThreshold} step={0.05} min={0.2} max={0.8} decimals={2} onChange={(v) => settings.update({ qualityThreshold: v })} />
        <NumberStepper label="Remind after" value={st.reattachDelayS} unit="s" step={1} min={3} max={60} onChange={(v) => settings.update({ reattachDelayS: v })} />
      </Panel>

      <Panel style={{ gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Display</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={font.label}>Trace refresh</Text>
          <Segmented
            label="Trace refresh"
            options={[
              { value: 15, label: '15 fps' },
              { value: 30, label: '30 fps' },
              { value: 60, label: '60 fps' },
            ]}
            value={st.traceFps}
            onChange={(v) => settings.update({ traceFps: v as 15 | 30 | 60 })}
          />
        </View>
        <Text style={font.small}>Lower refresh saves battery on long sessions. Recording always keeps every sample.</Text>
      </Panel>
      <View style={{ backgroundColor: colors.surface, borderRadius: 22 }}>
        <SwitchRow title="Show unfiltered signals on Home" value={st.showRaw} onChange={(v) => settings.update({ showRaw: v })} />
      </View>

      <BigButton
        label="Reset filters and quality to defaults"
        kind="plain"
        onPress={() => settings.reset(['heartBand', 'ecgBand', 'breathLowHz', 'breathCutHz', 'breathOrder', 'qualityThreshold', 'reattachDelayS', 'traceFps', 'showRaw'])}
      />
      <Text style={[font.small, { textAlign: 'center' }]}>
        {`Defaults: heart sound ${DEFAULT_SETTINGS.heartBand.lowHz}-${DEFAULT_SETTINGS.heartBand.highHz} Hz order ${DEFAULT_SETTINGS.heartBand.order}, ECG ${DEFAULT_SETTINGS.ecgBand.lowHz}-${DEFAULT_SETTINGS.ecgBand.highHz} Hz order ${DEFAULT_SETTINGS.ecgBand.order}, breathing ${DEFAULT_SETTINGS.breathLowHz}-${DEFAULT_SETTINGS.breathCutHz} Hz order ${DEFAULT_SETTINGS.breathOrder}.`}
      </Text>
    </ScrollView>
  );
}

function MotionPanel() {
  const e = useEngine();
  const st = useSettings();
  const s = useSession();
  const { width } = useWindowDimensions();
  const traceWidth = width - 2 * space.xl - 2 * space.l;
  const p = FALL_PROFILES[st.fallSensitivity];
  const c = e.motion.lastCheck;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 40, gap: 12 }}>
      <Panel style={{ gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Accelerometer</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={font.label}>Largest |a|, last 5 s</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: e.motion.peakG >= p.impactG ? colors.alert : colors.text }}>{s.connected ? `${e.motion.peakG.toFixed(2)} g` : '--'}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={font.label}>IMU rate</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{s.connected ? `${Math.round(e.motion.imuHz)} Hz` : '--'}</Text>
        </View>
        <SignalTrace source={() => session.buffers.channels[P.CHANNEL_IMU]} windowS={10} width={traceWidth} height={64} color={colors.ink} label="Accelerometer X, 10 s" />
        <Text style={font.small}>If the largest value never goes above about 2 g however hard you tap the patch, the accelerometer range on the patch is ±2 g. Set sensitivity to High, or raise the BMI270 range in the firmware.</Text>
      </Panel>

      <Panel style={{ gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Fall detector</Text>
        <Text style={font.small}>{`${st.fallSensitivity[0].toUpperCase()}${st.fallSensitivity.slice(1)} sensitivity: an impact of ${p.impactG} g (${(0.8 * p.impactG).toFixed(1)} g after a free fall), then the body turned at least ${p.angleDeg}° and, unless it turned more than ${CLEAR_ANGLE_DEG}°, stayed still (movement under ${p.stillG} g) for 5 s.`}</Text>
        <Segmented
          label="Fall sensitivity"
          options={[
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
          value={st.fallSensitivity}
          onChange={(v) => settings.update({ fallSensitivity: v as FallSensitivity })}
        />
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 }}>Last impact checked</Text>
        {c ? (
          <>
            <Text style={font.body}>{`${c.fall ? 'Fall' : 'Not a fall'}: ${c.reason}`}</Text>
            <Text style={font.small}>{`Impact ${c.impactG.toFixed(2)} g${c.freeFall ? ' after a free fall' : ''} · turned ${Math.round(c.angleDeg)}° · movement afterwards ${c.stillnessG.toFixed(2)} g`}</Text>
          </>
        ) : (
          <Text style={font.small}>No impact above the threshold yet. Tap the patch firmly to see a check here 6 s later.</Text>
        )}
        <BigButton label="Test the fall alert" kind="soft" onPress={() => engine.testFallAlert()} />
      </Panel>
    </ScrollView>
  );
}

export function DeveloperScreen({ back }: { back: () => void }) {
  const [tab, setTab] = useState<Tab>('sampling');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.s, gap: 12, paddingBottom: 12 }}>
        <Header title="Developer" onBack={back} />
        <Segmented
          label="Developer sections"
          onWhite={false}
          stretch
          options={[
            { value: 'sampling', label: 'Sampling' },
            { value: 'filters', label: 'Filters' },
            { value: 'motion', label: 'Motion' },
            { value: 'log', label: 'Log' },
            { value: 'files', label: 'Files' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'sampling' ? <DeviceScreen /> : tab === 'filters' ? <FiltersPanel /> : tab === 'motion' ? <MotionPanel /> : tab === 'log' ? <LogScreen /> : <FilesScreen />}
      </View>
    </View>
  );
}

export function PatchRecordingScreen({ back }: { back: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: 4 }}>
        <Header title="Patch recording" onBack={back} />
      </View>
      <View style={{ flex: 1 }}>
        <RecordingScreen />
      </View>
    </View>
  );
}
