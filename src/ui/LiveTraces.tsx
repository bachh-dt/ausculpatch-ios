/** The live traces chosen under Developer > Signals, stacked on one time axis. */
import React from 'react';
import { Text, View } from 'react-native';
import { session } from '../ble/session';
import * as P from '../protocol/protocol';
import { TraceVisibility } from '../settings/settings';
import { ChannelBuffer } from '../live/buffers';
import { useEngine, useSession, useSettings } from './hooks';
import { Badge, qualityBadge } from './kit';
import { SignalTrace } from './SignalTrace';
import { colors } from './theme';

export const TRACE_INFO: { key: keyof TraceVisibility; label: string; note: string; color: string }[] = [
  { key: 'heart', label: 'Heart sound', note: 'Acoustic sensor, heart band', color: colors.heart },
  { key: 'ecg', label: 'ECG', note: 'Electrodes, in mV', color: colors.ecg },
  { key: 'breath', label: 'Breathing', note: 'Slow swell of the heart-sound envelope', color: colors.breath },
  { key: 'scg', label: 'SCG', note: 'Chest vibration from the accelerometer, 1-30 Hz', color: '#0F766E' },
  { key: 'accel', label: 'Acceleration', note: 'Accelerometer magnitude, in g', color: colors.ink },
];

export function LiveTraces({ width, windowS, height = 72 }: { width: number; windowS: number; height?: number }) {
  const st = useSettings();
  const e = useEngine();
  const s = useSession();
  const c = session.clinical;
  const sources: Record<keyof TraceVisibility, () => ChannelBuffer> = {
    heart: () => (st.showRaw ? session.buffers.channels[P.CHANNEL_ACOUSTIC] : c.heartOut),
    ecg: () => (st.showRaw ? c.ecgRawMv : c.ecgOut),
    breath: () => c.breathOut,
    scg: () => c.scgOut,
    accel: () => c.accelMag,
  };
  const shown = TRACE_INFO.filter((t) => st.traces[t.key]);
  if (!shown.length) {
    return <Text style={{ fontSize: 13, color: colors.muted }}>All traces are hidden. Turn them on under Settings › Developer › Signals.</Text>;
  }
  return (
    <>
      {shown.map((t) => {
        const q = t.key === 'heart' ? e.heartQuality.level : t.key === 'ecg' ? e.ecgQuality.level : null;
        const slow = t.key === 'breath';
        return (
          <View key={t.key} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>{`● ${t.label}${slow && windowS < 30 ? ' (30 s)' : ''}`}</Text>
              {q ? <Badge {...qualityBadge(q, s.connected)} /> : null}
            </View>
            <SignalTrace
              source={sources[t.key]}
              windowS={slow ? Math.max(windowS, 30) : windowS}
              width={width}
              height={slow || t.key === 'accel' ? Math.round(height * 0.78) : height}
              color={t.color}
              label={t.label}
            />
          </View>
        );
      })}
    </>
  );
}
