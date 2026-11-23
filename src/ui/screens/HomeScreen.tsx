import React from 'react';
import { Linking, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { State } from 'react-native-ble-plx';
import { useKeepAwake } from 'expo-keep-awake';
import { session } from '../../ble/session';
import { engine } from '../../live/engine';
import { settings } from '../../app/services';
import * as P from '../../protocol/protocol';
import { useEngine, useSession, useSettings } from '../hooks';
import { Badge, BigButton, Header, IconTile, Panel, qualityBadge, RoundButton, Screen, Segmented } from '../kit';
import { BluetoothIcon, BreathIcon, HeartIcon, RecordDot, ShieldIcon, SlidersIcon, SpeakerIcon } from '../icons';
import { SignalTrace } from '../SignalTrace';
import { colors, font, space } from '../theme';
import { batteryPercent, dutyInWords, greeting } from '../words';
import { WindowS } from '../../settings/settings';

function KeepAwake() {
  useKeepAwake();
  return null;
}

export const WINDOW_OPTIONS: { value: WindowS; label: string }[] = [
  { value: 5, label: '5 s' },
  { value: 10, label: '10 s' },
  { value: 30, label: '30 s' },
];

export function PatchCard() {
  const s = useSession();
  const e = useEngine();

  if (s.bluetooth === State.PoweredOff || s.bluetooth === State.Unauthorized) {
    const off = s.bluetooth === State.PoweredOff;
    return (
      <Panel>
        <Text style={font.body}>{off ? 'Bluetooth is off. Turn it on in Control Centre.' : 'AusculPatch is not allowed to use Bluetooth.'}</Text>
        {!off ? <BigButton label="Open Settings" kind="soft" onPress={() => Linking.openSettings()} /> : null}
      </Panel>
    );
  }

  if (s.connected) {
    const pct = batteryPercent(e.vitals.batteryV);
    const resting = s.duty?.state === 2;
    const proto = s.info?.proto;
    return (
      <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
        <IconTile bg={colors.accentSoft} size={44}>
          <BluetoothIcon color={colors.accent} />
        </IconTile>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Patch connected</Text>
          <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={2}>
            {[pct !== null ? `Battery ${pct}%` : null, resting && s.duty ? dutyInWords(s.duty) : 'streaming'].filter(Boolean).join(' · ')}
          </Text>
          {proto !== undefined && proto !== P.PROTOCOL_VERSION ? (
            <Text style={{ fontSize: 12, color: colors.warn }}>{`Firmware protocol ${proto}; this app expects ${P.PROTOCOL_VERSION}.`}</Text>
          ) : null}
        </View>
        <Badge text={resting ? 'Resting' : 'Live'} tone={resting ? 'neutral' : 'good'} />
      </Panel>
    );
  }

  const reconnecting = s.status.startsWith('Connection lost') || s.status.startsWith('Connecting');
  return (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile bg={colors.accentSoft} size={44}>
          <BluetoothIcon color={colors.accent} />
        </IconTile>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{reconnecting ? 'Reconnecting…' : 'Patch not connected'}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{s.status}</Text>
        </View>
      </View>
      {reconnecting ? (
        <BigButton label="Cancel" kind="soft" onPress={() => session.disconnect()} />
      ) : (
        <BigButton label={s.scanning ? 'Looking for the patch…' : 'Connect patch'} busy={s.scanning} onPress={() => session.startScan()} />
      )}
      {s.found.map((d) => (
        <Pressable
          key={d.id}
          accessibilityRole="button"
          onPress={() => session.connect(d.id, d.name)}
          style={({ pressed }) => ({ padding: 14, borderRadius: 16, backgroundColor: pressed ? colors.grid : colors.raised })}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{d.name}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{`Signal ${d.rssi ?? '?'} dBm · tap to connect`}</Text>
        </Pressable>
      ))}
      {!s.scanning && !s.found.length && !reconnecting ? (
        <Text style={font.small}>Switch the patch on and keep it near the phone.</Text>
      ) : null}
    </Panel>
  );
}

function VitalTile({
  title,
  value,
  unit,
  source,
  icon,
  iconBg,
  quality,
  connected,
}: {
  title: string;
  value: number | null;
  unit: string;
  source: string;
  icon: React.ReactNode;
  iconBg: string;
  quality: string;
  connected: boolean;
}) {
  const poor = quality === 'poor' || quality === 'none';
  const note = !connected ? 'Not connected' : value !== null ? source : poor ? 'Check patch contact' : 'Measuring…';
  return (
    <Panel style={{ flex: 1, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={font.label}>{title}</Text>
        <IconTile bg={iconBg} size={34}>
          {icon}
        </IconTile>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }} accessible accessibilityLabel={`${title} ${value === null ? 'not available' : `${Math.round(value)} ${unit}`}`}>
        <Text style={[font.big, { color: value === null ? colors.faint : colors.text, fontVariant: ['tabular-nums'] }]}>{value === null ? '--' : Math.round(value)}</Text>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.muted }}>{unit}</Text>
      </View>
      <Text style={{ fontSize: 12, color: poor && connected ? colors.warn : colors.muted }}>{note}</Text>
    </Panel>
  );
}

export function HomeScreen({ go }: { go: (route: 'listen' | 'settings') => void }) {
  const s = useSession();
  const e = useEngine();
  const st = useSettings();
  const { width } = useWindowDimensions();
  const traceWidth = width - 2 * space.xl - 2 * space.l;
  const goal = Math.max(1, st.stepGoal);
  const stepPct = Math.min(100, (100 * e.stepsToday) / goal);
  const hq = qualityBadge(e.heartQuality.level, s.connected);
  const eq = qualityBadge(e.ecgQuality.level, s.connected);

  return (
    <Screen>
      {s.connected ? <KeepAwake /> : null}
      <Header
        title="AusculPatch"
        right={
          <RoundButton label="Settings" onPress={() => go('settings')}>
            <SlidersIcon />
          </RoundButton>
        }
      />
      <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '500', marginTop: -12 }}>{greeting()}</Text>

      <PatchCard />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <VitalTile
          title="Heart rate"
          value={e.vitals.heartRate}
          unit="bpm"
          source="From ECG"
          icon={<HeartIcon size={18} color={colors.heart} />}
          iconBg={colors.heartSoft}
          quality={e.ecgQuality.level}
          connected={s.connected}
        />
        <VitalTile
          title="Breathing"
          value={e.vitals.breathingRate}
          unit="/ min"
          source="From heart sound"
          icon={<BreathIcon size={18} color={colors.accent} />}
          iconBg={colors.accentSoft}
          quality={e.heartQuality.level}
          connected={s.connected}
        />
      </View>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] }}>{e.stepsToday.toLocaleString()}</Text>
            <Text style={font.label}>steps today</Text>
          </View>
          {st.fallAlerts ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
              <ShieldIcon size={14} color={colors.accentText} strokeWidth={2.2} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accentText }}>Fall alerts on</Text>
            </View>
          ) : (
            <Badge text="Fall alerts off" tone="neutral" />
          )}
        </View>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: '#E8EEF8', overflow: 'hidden' }}>
          <View style={{ width: `${stepPct}%`, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />
        </View>
        <Text style={font.small}>{`Goal ${goal.toLocaleString()} · counted by the patch`}</Text>
      </Panel>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Live signals</Text>
          <Segmented label="Time window" options={WINDOW_OPTIONS} value={st.windowS} onChange={(v) => settings.update({ windowS: v })} />
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>● Heart sound</Text>
            <Badge {...hq} />
          </View>
          <SignalTrace
            source={() => (st.showRaw ? session.buffers.channels[P.CHANNEL_ACOUSTIC] : session.clinical.heartOut)}
            windowS={st.windowS}
            width={traceWidth}
            height={72}
            color={colors.heart}
            label="Heart sound"
          />
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>● ECG</Text>
            <Badge {...eq} />
          </View>
          <SignalTrace
            source={() => (st.showRaw ? session.clinical.ecgRawMv : session.clinical.ecgOut)}
            windowS={st.windowS}
            width={traceWidth}
            height={72}
            color={colors.ecg}
            label="ECG"
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>● Breathing</Text>
          <SignalTrace
            source={() => session.clinical.breathOut}
            windowS={Math.max(st.windowS, 30)}
            width={traceWidth}
            height={56}
            color={colors.breath}
            label="Breathing"
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <BigButton label="Listen" icon={<SpeakerIcon size={20} color="#FFFFFF" />} onPress={() => go('listen')} style={{ flex: 1 }} />
          <BigButton
            label={e.recording.active ? 'Recording' : 'Record'}
            kind="heart"
            icon={<RecordDot size={14} square={e.recording.active} />}
            disabled={!s.connected && !e.recording.active}
            onPress={() => {
              if (!e.recording.active) engine.startRecording();
              go('listen');
            }}
            style={{ flex: 1 }}
          />
        </View>
      </Panel>
    </Screen>
  );
}
