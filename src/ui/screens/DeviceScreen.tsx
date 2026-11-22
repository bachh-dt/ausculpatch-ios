import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { session } from '../../ble/session';
import * as P from '../../protocol/protocol';
import { Button, Card, Chip, Row, Stepper, styles } from '../components';
import { useSession, useTicker } from '../hooks';
import { colors, space } from '../theme';

const CHANNEL_FOR: Record<P.RateSensor, P.ChannelName> = {
  ACO: P.CHANNEL_ACOUSTIC,
  ECG: P.CHANNEL_ECG,
  IMU: P.CHANNEL_IMU,
  TMP: P.CHANNEL_TEMP,
  BATT: P.CHANNEL_BATT,
};

export function DeviceScreen() {
  const s = useSession();
  useTicker(1000, s.connected);
  const [gain, setGain] = useState(0);
  const [offset, setOffset] = useState(128);

  const setRate = (sensor: P.RateSensor, hz: number) => {
    session.send(P.cmdSetRate(sensor, hz));
    setTimeout(() => session.send(P.cmdQueryRates()), 300);
  };

  const rst = s.info?.rst;
  return (
    <ScrollView contentContainerStyle={{ padding: space.m }}>
      {!s.connected ? (
        <Card>
          <Text style={styles.body}>Connect a patch on the Monitor tab first.</Text>
        </Card>
      ) : null}

      <Card title="PATCH">
        <Row label="Name" value={s.deviceName ?? '-'} />
        <Row label="Protocol" value={s.info?.proto !== undefined ? String(s.info.proto) : '-'} valueColor={s.info?.proto !== undefined && s.info.proto !== P.PROTOCOL_VERSION ? colors.warn : undefined} />
        <Row label="Mode" value={s.info?.mode !== undefined ? String(s.info.mode) : '-'} />
        <Row label="MTU" value={s.mtu ? String(s.mtu) : '-'} />
        <Row
          label="Last reset"
          value={rst !== undefined ? P.describeResetReason(rst) : '-'}
          valueColor={rst !== undefined && P.resetWasUnexpected(rst) ? colors.warn : undefined}
        />
        {rst !== undefined && P.resetWasUnexpected(rst) ? (
          <Text style={styles.note}>A software reset also follows flashing with a debugger, so this is a prompt to look, not proof of a crash.</Text>
        ) : null}
        <View style={styles.buttonRow}>
          <Button label="Refresh" disabled={!s.connected} onPress={() => session.refreshAll()} />
        </View>
      </Card>

      <Card title="SAMPLING RATES">
        {P.RATE_SENSORS.map((sensor) => {
          const buf = session.buffers.channels[CHANNEL_FOR[sensor]];
          const measured = s.connected ? buf.timestampRateHz(5) : 0;
          const configured = s.rates[sensor];
          return (
            <View key={sensor} style={{ marginBottom: space.m }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.body, { fontWeight: '600' }]}>{P.RATE_SENSOR_LABELS[sensor]}</Text>
                <Text style={styles.note}>{s.connected ? `measured ${measured.toFixed(measured < 10 ? 1 : 0)} Hz` : ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.xs }}>
                {P.RATE_CHOICES_HZ[sensor].map((hz) => (
                  <Chip key={hz} label={`${hz}`} selected={configured === hz} onPress={() => s.connected && setRate(sensor, hz)} />
                ))}
              </View>
            </View>
          );
        })}
        <Text style={styles.note}>
          Heart sound and ECG rates are set by their converters, so only these values exist. Measured rates come from the patch's own timestamps.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            label="Factory rates"
            disabled={!s.connected}
            onPress={() => {
              session.send(P.cmdResetRates());
              setTimeout(() => session.send(P.cmdQueryRates()), 300);
            }}
          />
        </View>
      </Card>

      <Card title="HEART-SOUND FRONT END">
        <Stepper label="ADS1220 gain index (0-7)" value={gain} min={0} max={7} onChange={setGain} />
        <Stepper label="Offset wiper (0-255)" value={offset} min={0} max={255} onChange={setOffset} />
        <View style={styles.buttonRow}>
          <Button label="Send" disabled={!s.connected} onPress={() => session.send(P.cmdSetGainOffset(gain, offset))} />
          <Chip label="-10" onPress={() => setOffset(Math.max(0, offset - 10))} />
          <Chip label="+10" onPress={() => setOffset(Math.min(255, offset + 10))} />
        </View>
      </Card>

      <Card title="FLASH">
        <Text style={styles.note}>The self-test writes and reads back the last good block, not page 0.</Text>
        <View style={styles.buttonRow}>
          <Button label="Flash self-test" disabled={!s.connected} onPress={() => session.send(P.cmdFlashSelftest())} />
        </View>
      </Card>
    </ScrollView>
  );
}
