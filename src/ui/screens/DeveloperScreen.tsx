import React, { useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { session } from '../../ble/session';
import { settings } from '../../app/services';
import { BandSetting, DEFAULT_SETTINGS } from '../../settings/settings';
import { useEngine, useSession, useSettings } from '../hooks';
import { Badge, BigButton, Header, NumberStepper, Panel, qualityBadge, Segmented, SwitchRow } from '../kit';
import { SignalTrace } from '../SignalTrace';
import { colors, font, space } from '../theme';
import { DeviceScreen } from './DeviceScreen';
import { FilesScreen } from './FilesScreen';
import { LogScreen } from './LogScreen';
import { RecordingScreen } from './RecordingScreen';

type Tab = 'sampling' | 'filters' | 'log' | 'files';

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
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Breathing low-pass</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accentText }}>{`${st.breathCutHz.toFixed(1)} Hz · order ${st.breathOrder}`}</Text>
        </View>
        <NumberStepper label="Cut-off" value={st.breathCutHz} unit="Hz" step={0.1} min={0.1} max={2} decimals={1} onChange={(v) => settings.update({ breathCutHz: v })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <Text style={font.label}>Order</Text>
          <Segmented label="Breathing order" options={ORDERS} value={st.breathOrder} onChange={(v) => settings.update({ breathOrder: v })} />
        </View>
      </Panel>

      <Panel>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>Preview with the current filters</Text>
        <SignalTrace source={() => session.clinical.heartOut} windowS={5} width={traceWidth} height={64} color={colors.heart} label="Heart sound preview" />
        <SignalTrace source={() => session.clinical.ecgOut} windowS={5} width={traceWidth} height={64} color={colors.ecg} label="ECG preview" />
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
        onPress={() => settings.reset(['heartBand', 'ecgBand', 'breathCutHz', 'breathOrder', 'qualityThreshold', 'reattachDelayS', 'traceFps', 'showRaw'])}
      />
      <Text style={[font.small, { textAlign: 'center' }]}>
        {`Defaults: heart sound ${DEFAULT_SETTINGS.heartBand.lowHz}-${DEFAULT_SETTINGS.heartBand.highHz} Hz order ${DEFAULT_SETTINGS.heartBand.order}, ECG ${DEFAULT_SETTINGS.ecgBand.lowHz}-${DEFAULT_SETTINGS.ecgBand.highHz} Hz order ${DEFAULT_SETTINGS.ecgBand.order}, breathing ${DEFAULT_SETTINGS.breathCutHz} Hz order ${DEFAULT_SETTINGS.breathOrder}.`}
      </Text>
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
            { value: 'log', label: 'Log' },
            { value: 'files', label: 'Files' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'sampling' ? <DeviceScreen /> : tab === 'filters' ? <FiltersPanel /> : tab === 'log' ? <LogScreen /> : <FilesScreen />}
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
