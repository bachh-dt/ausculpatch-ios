import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { State } from 'react-native-ble-plx';
import { session } from '../ble/session';
import { PROTOCOL_VERSION } from '../protocol/protocol';
import { Button, Card, styles } from './components';
import { useSession } from './hooks';
import { colors, space } from './theme';

export function ConnectionCard() {
  const s = useSession();

  if (s.bluetooth === State.PoweredOff) {
    return (
      <Card>
        <Text style={styles.body}>Bluetooth is off. Turn it on in Control Centre or Settings.</Text>
      </Card>
    );
  }
  if (s.bluetooth === State.Unauthorized) {
    return (
      <Card>
        <Text style={styles.body}>This app is not allowed to use Bluetooth.</Text>
        <Button label="Open Settings" onPress={() => Linking.openSettings()} style={{ marginTop: space.s }} />
      </Card>
    );
  }

  if (s.connected) {
    const proto = s.info?.proto;
    return (
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.body, { fontWeight: '700' }]}>{s.deviceName ?? 'AusculPatch'}</Text>
            <Text style={[styles.note, { color: colors.ok }]}>{s.status}</Text>
          </View>
          <Button label="Disconnect" onPress={() => session.disconnect()} />
        </View>
        {proto !== undefined && proto !== PROTOCOL_VERSION ? (
          <Text style={[styles.note, { color: colors.warn, marginTop: space.s }]}>
            {`The patch speaks protocol ${proto}; this app was built for protocol ${PROTOCOL_VERSION}. Some features may not work.`}
          </Text>
        ) : null}
      </Card>
    );
  }

  const reconnecting = s.status.startsWith('Connection lost') || s.status.startsWith('Connecting');
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[styles.note, { flex: 1 }]}>{s.status}</Text>
        {reconnecting ? (
          <Button label="Cancel" onPress={() => session.disconnect()} />
        ) : (
          <Button
            label={s.scanning ? 'Scanning...' : 'Scan'}
            kind="primary"
            busy={s.scanning}
            onPress={() => session.startScan()}
          />
        )}
      </View>
      {s.found.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => session.connect(d.id, d.name)}
          style={({ pressed }) => ({
            marginTop: space.s,
            padding: space.m,
            borderRadius: 10,
            backgroundColor: pressed ? colors.grid : colors.raised,
          })}
        >
          <Text style={[styles.body, { fontWeight: '600' }]}>{d.name}</Text>
          <Text style={styles.note}>{`Signal ${d.rssi ?? '?'} dBm. Tap to connect.`}</Text>
        </Pressable>
      ))}
      {!s.scanning && !s.found.length && !reconnecting ? (
        <Text style={[styles.note, { marginTop: space.s }]}>Switch the patch on, keep it near the phone, and tap Scan.</Text>
      ) : null}
    </Card>
  );
}
