import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { session } from '../../ble/session';
import * as P from '../../protocol/protocol';
import { Button, Card, Chip, ProgressBar, Row, styles } from '../components';
import { useSession } from '../hooks';
import { colors, space } from '../theme';
import { bytes, duration, dutyInWords } from '../words';

type Unit = 'seconds' | 'minutes' | 'hours';
const UNITS: Unit[] = ['seconds', 'minutes', 'hours'];

function bestUnit(seconds: number): [number, Unit] {
  if (seconds % 3600 === 0) return [seconds / 3600, 'hours'];
  if (seconds % 60 === 0) return [seconds / 60, 'minutes'];
  return [seconds, 'seconds'];
}

function DurationInput({
  label,
  value,
  unit,
  onValue,
  onUnit,
}: {
  label: string;
  value: string;
  unit: Unit;
  onValue: (v: string) => void;
  onUnit: (u: Unit) => void;
}) {
  return (
    <View style={{ marginVertical: space.xs }}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.xs }}>
        <TextInput
          value={value}
          onChangeText={onValue}
          keyboardType="number-pad"
          style={{
            color: colors.text,
            backgroundColor: colors.raised,
            borderRadius: 8,
            paddingHorizontal: space.m,
            paddingVertical: 8,
            minWidth: 72,
            fontSize: 16,
          }}
        />
        {UNITS.map((u) => (
          <Chip key={u} label={u.replace('seconds', 's').replace('minutes', 'min').replace('hours', 'h')} selected={unit === u} onPress={() => onUnit(u)} />
        ))}
      </View>
    </View>
  );
}

async function share(uri: string, csv: boolean) {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Sharing is not available on this device.');
    return;
  }
  await Sharing.shareAsync(uri, csv ? { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' } : { UTI: 'public.data' });
}

export function RecordingScreen() {
  const s = useSession();
  const d = s.download;

  const [mode, setMode] = useState<'continuous' | 'bursts'>('continuous');
  const [onValue, setOnValue] = useState(String(1));
  const [onUnit, setOnUnit] = useState<Unit>('minutes');
  const [offValue, setOffValue] = useState(String(4));
  const [offUnit, setOffUnit] = useState<Unit>('minutes');

  // Mirror the patch's schedule whenever it reports one.
  useEffect(() => {
    if (!s.duty) return;
    setMode(s.duty.enabled ? 'bursts' : 'continuous');
    const [ov, ou] = bestUnit(s.duty.onSeconds);
    const [fv, fu] = bestUnit(s.duty.offSeconds);
    setOnValue(String(ov));
    setOnUnit(ou);
    setOffValue(String(fv));
    setOffUnit(fu);
  }, [s.duty?.enabled, s.duty?.onSeconds, s.duty?.offSeconds]);

  const applySchedule = () => {
    const on = Math.round(Number(onValue) * P.DUTY_TIME_UNITS[onUnit]);
    const off = Math.round(Number(offValue) * P.DUTY_TIME_UNITS[offUnit]);
    if (mode === 'bursts') {
      if (!(on >= P.DUTY_MIN_SECONDS && on <= P.DUTY_MAX_SECONDS && off >= P.DUTY_MIN_SECONDS && off <= P.DUTY_MAX_SECONDS)) {
        Alert.alert('Check the times', 'Each period must be between 1 second and 24 hours.');
        return;
      }
    }
    // A patient's patch records bursts to its own memory: a live-only schedule
    // loses everything once the phone is out of range.
    session.send(
      P.cmdSetDutyCycle(
        mode === 'bursts',
        mode === 'bursts' ? on : P.DUTY_DEFAULT_ON_SECONDS,
        mode === 'bursts' ? off : P.DUTY_DEFAULT_OFF_SECONDS,
        P.DUTY_SINK_FLASH,
      ),
    );
    setTimeout(() => session.send(P.cmdQueryDuty()), 300);
  };

  const startRecording = () =>
    Alert.alert(
      'Start a new recording',
      'Start recording continuously on the patch? This replaces the recording currently stored and switches off measuring in bursts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: () => {
            session.send(P.cmdStartStore());
            setTimeout(() => session.refreshAll(), 400);
          },
        },
      ],
    );

  const erase = () =>
    Alert.alert(
      'Erase the recording',
      'Permanently erase the recording stored on the patch? Download it first if you have not already. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            session.send(P.cmdEraseLog());
            setTimeout(() => session.send(P.cmdQueryFlash()), 400);
          },
        },
      ],
    );

  const f = s.flash;
  const busy = d.phase === 'receiving' || d.phase === 'decoding';
  const onS = Math.round(Number(onValue) * P.DUTY_TIME_UNITS[onUnit]) || 0;
  const offS = Math.round(Number(offValue) * P.DUTY_TIME_UNITS[offUnit]) || 0;

  return (
    <ScrollView contentContainerStyle={{ padding: space.m }} keyboardShouldPersistTaps="handled">
      {!s.connected ? (
        <Card>
          <Text style={styles.body}>Connect the patch on the Home tab first.</Text>
        </Card>
      ) : null}

      <Card title="PATCH STATUS">
        <Text style={styles.body}>{s.duty ? dutyInWords(s.duty) : s.connected ? 'Waiting for the patch...' : 'Not connected.'}</Text>
      </Card>

      <Card title="MEASUREMENT SCHEDULE">
        <View style={{ flexDirection: 'row', gap: space.s, marginBottom: space.s }}>
          <Chip label="Continuous" selected={mode === 'continuous'} onPress={() => setMode('continuous')} />
          <Chip label="In bursts" selected={mode === 'bursts'} onPress={() => setMode('bursts')} />
        </View>
        {mode === 'bursts' ? (
          <>
            <DurationInput label="Measure for" value={onValue} unit={onUnit} onValue={setOnValue} onUnit={setOnUnit} />
            <DurationInput label="Then rest for" value={offValue} unit={offUnit} onValue={setOffValue} onUnit={setOffUnit} />
            {onS > 0 && offS > 0 ? (
              <Text style={[styles.note, { marginTop: space.s }]}>
                {`Measures ${duration(onS)} out of every ${duration(onS + offS)} (${((100 * onS) / (onS + offS)).toFixed(0)}% of the time). Bursts are saved to the patch's memory.`}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.note}>The patch measures all the time. Most detail, shortest battery life.</Text>
        )}
        <View style={styles.buttonRow}>
          <Button label="Apply to patch" kind="primary" disabled={!s.connected} onPress={applySchedule} />
        </View>
      </Card>

      <Card title="RECORDING ON THE PATCH">
        {f ? (
          <>
            <Row label="Stored" value={`${bytes(f.bytesUsed)} (${f.pagesUsed.toLocaleString()} pages)`} />
            <Row
              label="Memory used"
              value={f.pagesTotal ? `${((100 * f.pagesUsed) / f.pagesTotal).toFixed(1)}%` : '-'}
              valueColor={f.full ? colors.danger : undefined}
            />
            <Row label="Session" value={String(f.session)} />
            {f.recovered ? <Text style={[styles.note, { color: colors.warn }]}>Recovered from before the last power-up.</Text> : null}
            {f.full ? <Text style={[styles.note, { color: colors.danger }]}>Memory is full. Download and erase to record again.</Text> : null}
            {f.badBlocks > 20 ? (
              <Text style={[styles.note, { color: colors.warn }]}>{`${f.badBlocks} bad blocks. More than about 20 suggests the flash is wearing out.`}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.note}>{s.connected ? 'Waiting for the patch...' : 'Not connected.'}</Text>
        )}
        <View style={styles.buttonRow}>
          <Button label="Record continuously" disabled={!s.connected || busy} onPress={startRecording} />
          <Button
            label="Stop"
            disabled={!s.connected || busy}
            onPress={() => {
              session.send(P.cmdStopStore());
              setTimeout(() => session.refreshAll(), 400);
            }}
          />
        </View>
        <View style={styles.buttonRow}>
          <Button label="Download to phone" kind="primary" disabled={!s.connected || busy} onPress={() => session.startDownload(false)} />
          <Button label="Erase" kind="danger" disabled={!s.connected || busy} onPress={erase} />
        </View>
      </Card>

      {d.phase !== 'idle' ? (
        <Card title="DOWNLOAD">
          <Text style={[styles.body, { color: d.phase === 'done' ? (d.ok ? colors.ok : colors.warn) : d.phase === 'interrupted' ? colors.warn : colors.text }]}>
            {d.headline}
          </Text>
          {busy ? (
            <>
              <ProgressBar percent={d.progress} />
              <Text style={styles.note}>
                {d.phase === 'receiving'
                  ? `Receiving ${d.progress.toFixed(0)}%. Keep the phone near the patch. The screen can lock.`
                  : `Decoding ${d.progress.toFixed(0)}%`}
              </Text>
            </>
          ) : null}
          {d.report && !busy ? <Text style={[styles.note, { fontFamily: 'Menlo', marginTop: space.s }]}>{d.report}</Text> : null}
          <View style={styles.buttonRow}>
            {d.csvUri ? <Button label="Share CSV" kind="primary" onPress={() => share(d.csvUri as string, true)} /> : null}
            {d.binUri ? <Button label="Share raw image" onPress={() => share(d.binUri as string, false)} /> : null}
            {d.canResume && !busy ? (
              <Button label="Resume download" disabled={!s.connected} onPress={() => session.startDownload(true)} />
            ) : null}
            {!busy ? <Button label="Close" onPress={() => session.dismissDownload()} /> : null}
          </View>
        </Card>
      ) : null}

      <Card title="LIVE RECORDING">
        <Text style={styles.note}>
          To record what is streaming right now, use Record on the Home or Listen screen. It saves the heart sound as audio and every sample as a CSV.
        </Text>
      </Card>
    </ScrollView>
  );
}
