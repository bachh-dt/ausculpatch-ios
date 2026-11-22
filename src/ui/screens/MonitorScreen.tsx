import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { session } from '../../ble/session';
import { Vitals } from '../../live/clinical';
import { ECG_FILTER, HEART_SOUND_FILTER, BREATHING_FILTER } from '../../dsp/filters';
import { Card, styles } from '../components';
import { ConnectionCard } from '../ConnectionCard';
import { useSession, useTicker } from '../hooks';
import { colors, space } from '../theme';
import { Trace } from '../Trace';
import { dutyInWords } from '../words';

const REFRESH_MS = 100;
const VITALS_MS = 2000;
const WINDOW_S = 10;

function KeepAwake() {
  useKeepAwake();
  return null;
}

function Tile({
  title,
  value,
  unit,
  color,
  note,
  decimals = 0,
  warn,
}: {
  title: string;
  value: number | null;
  unit: string;
  color: string;
  note?: string;
  decimals?: number;
  warn?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.raised,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.grid,
        padding: space.s,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text
          style={{ color: value === null ? colors.muted : color, fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] }}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {value === null ? '--' : value.toFixed(decimals)}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginLeft: 4, marginBottom: 8 }}>{unit}</Text>
      </View>
      <Text style={{ color: warn ? colors.warn : colors.muted, fontSize: 11 }} numberOfLines={2}>
        {note ?? (value === null ? 'not enough signal' : ' ')}
      </Text>
    </View>
  );
}

export function MonitorScreen() {
  const s = useSession();
  const { width } = useWindowDimensions();
  useTicker(REFRESH_MS, s.connected);
  const [vitals, setVitals] = useState<Vitals>({ heartRate: null, breathingRate: null, skinTempC: null, batteryV: null });
  const lastVitals = useRef(0);

  // Pull new samples through the filters on every redraw.
  if (s.connected) session.clinical.update();

  useEffect(() => {
    if (!s.connected) {
      setVitals({ heartRate: null, breathingRate: null, skinTempC: null, batteryV: null });
      return;
    }
    const id = setInterval(() => {
      lastVitals.current = Date.now();
      setVitals(session.clinical.vitals());
    }, VITALS_MS);
    return () => clearInterval(id);
  }, [s.connected]);

  const idle = s.duty?.state === 2;
  const idleNote = 'patch is resting between measurements';
  const traceWidth = width - 2 * space.m - 2 * space.m;

  const latest = session.buffers.latestTimeS();
  const tEnd = latest ?? WINDOW_S;
  const tStart = tEnd - WINDOW_S;
  const [ht, hv] = session.clinical.heartOut.snapshotRange(tStart, tEnd);
  const [et, ev] = session.clinical.ecgOut.snapshotRange(tStart, tEnd);
  const [bt, bv] = session.clinical.breathOut.snapshotRange(tStart, tEnd);

  return (
    <ScrollView contentContainerStyle={{ padding: space.m }}>
      {s.connected ? <KeepAwake /> : null}
      <ConnectionCard />

      <View style={{ flexDirection: 'row', gap: space.s, marginBottom: space.s }}>
        <Tile
          title="Heart rate"
          value={s.connected ? vitals.heartRate : null}
          unit="bpm"
          color={colors.ecg}
          note={!s.connected ? 'not connected' : idle && vitals.heartRate === null ? idleNote : undefined}
        />
        <Tile
          title="Breathing"
          value={s.connected ? vitals.breathingRate : null}
          unit="/min"
          color={colors.breath}
          note={!s.connected ? 'not connected' : idle && vitals.breathingRate === null ? idleNote : undefined}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.s, marginBottom: space.m }}>
        <Tile title="Skin temp" value={s.connected ? vitals.skinTempC : null} unit="°C" color={colors.temp} decimals={1} />
        <Tile
          title="Patch battery"
          value={s.connected ? vitals.batteryV : null}
          unit="V"
          color={colors.batt}
          decimals={2}
          warn={vitals.batteryV !== null && vitals.batteryV < 3.5}
          note={vitals.batteryV !== null && vitals.batteryV < 3.5 ? 'low: charge the patch soon' : undefined}
        />
      </View>

      {s.connected && s.duty ? (
        <Card>
          <Text style={styles.body}>{dutyInWords(s.duty)}</Text>
        </Card>
      ) : null}

      <Card>
        <Trace times={ht} values={hv} tStart={tStart} tEnd={tEnd} width={traceWidth} height={120} color={colors.heart} label="Heart sound" units="counts" />
        <Trace times={et} values={ev} tStart={tStart} tEnd={tEnd} width={traceWidth} height={120} color={colors.ecg} label="ECG" units="mV" />
        <Trace times={bt} values={bv} tStart={tStart} tEnd={tEnd} width={traceWidth} height={80} color={colors.breath} label="Breathing" />
        <Text style={[styles.note, { marginTop: space.xs }]}>
          {`${WINDOW_S} s window. Filters: heart sound ${HEART_SOUND_FILTER.describe()}; ECG ${ECG_FILTER.describe()}, in mV at the electrodes; breathing ${BREATHING_FILTER.describe()}.`}
        </Text>
      </Card>
    </ScrollView>
  );
}
