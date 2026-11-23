import React from 'react';
import { Alert, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { session } from '../../ble/session';
import { ensureNotificationPermission, history, settings } from '../../app/services';
import { listRecordings, newFile, stampedName } from '../../storage/files';
import { useEngine, useSession, useSettings } from '../hooks';
import { BigButton, Group, Header, IconTile, ListRow, NumberStepper, Screen, SectionLabel, Segmented, SwitchRow } from '../kit';
import { BluetoothIcon, ChevronIcon, CodeIcon } from '../icons';
import { colors } from '../theme';
import { batteryPercent, bytes } from '../words';
import { FallSensitivity } from '../../settings/settings';
import { Pressable } from 'react-native';

export function SettingsScreen({ go }: { go: (route: 'developer' | 'download') => void }) {
  const s = useSession();
  const e = useEngine();
  const st = useSettings();
  let used = 0;
  try {
    used = listRecordings().reduce((a, f) => a + f.size, 0);
  } catch {
    used = 0;
  }
  const pct = batteryPercent(e.vitals.batteryV);
  const fw = s.info?.proto !== undefined ? `protocol ${s.info.proto}` : null;

  const exportHistory = async () => {
    try {
      const f = newFile(stampedName('AusculPatch_history', 'csv'));
      f.writeSync(history.exportCsv());
      await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch (err) {
      Alert.alert('Export failed', String((err as Error).message ?? err));
    }
  };

  return (
    <Screen>
      <Header title="Settings" />

      <SectionLabel text="Patch" />
      <Group>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
          <IconTile bg={colors.accentSoft}>
            <BluetoothIcon size={20} color={colors.accent} />
          </IconTile>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{s.connected ? s.deviceName ?? 'AusculPatch' : 'Not connected'}</Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>
              {s.connected ? [pct !== null ? `Battery ${pct}%` : null, fw].filter(Boolean).join(' · ') || 'Connected' : s.status}
            </Text>
          </View>
          {s.connected ? (
            <BigButton label="Disconnect" kind="plain" onPress={() => session.disconnect()} style={{ minHeight: 36, borderWidth: 1, borderColor: '#D5DDEA', paddingHorizontal: 12 }} />
          ) : (
            <BigButton label="Connect" onPress={() => session.startScan()} busy={s.scanning} style={{ minHeight: 36, paddingHorizontal: 12 }} />
          )}
        </View>
        <ListRow
          title="Recording on the patch"
          subtitle="Measurement schedule, download and erase"
          onPress={() => go('download')}
          chevron
          right={s.download.phase === 'receiving' || s.download.phase === 'decoding' ? <Text style={{ color: colors.accentText, fontWeight: '700' }}>{`${Math.round(s.download.progress)}%`}</Text> : undefined}
        />
      </Group>

      <SectionLabel text="Monitoring" />
      <Group>
        <SwitchRow
          title="Fall alerts"
          subtitle="Notification on this phone only"
          value={st.fallAlerts}
          onChange={async (v) => {
            settings.update({ fallAlerts: v });
            if (v && !(await ensureNotificationPermission())) {
              Alert.alert('Notifications are off', 'The app will still show fall alerts while it is open. To get them on the lock screen, allow notifications for AusculPatch in the Settings app.');
            }
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>Fall sensitivity</Text>
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
        </View>
        <SwitchRow
          title="Reattach reminders"
          subtitle="When the patch loses contact with the skin"
          value={st.reattachReminders}
          onChange={(v) => settings.update({ reattachReminders: v })}
        />
        <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
          <NumberStepper label="Daily step goal" value={st.stepGoal} step={500} min={1000} max={30000} onChange={(v) => settings.update({ stepGoal: v })} />
        </View>
      </Group>

      <SectionLabel text="Data" />
      <Group>
        <ListRow title="Export history as CSV" subtitle="Heart rate, breathing and steps per minute" onPress={exportHistory} chevron />
        <ListRow title="Storage used" right={<Text style={{ fontSize: 14, color: colors.muted }}>{bytes(used)}</Text>} />
        <ListRow
          title="Delete history"
          subtitle="Clears Trends: heart rate, breathing, steps and falls. Recordings stay."
          onPress={() =>
            Alert.alert('Delete all history?', 'Trends will start again from now. Recordings are not deleted. This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => history.clear() },
            ])
          }
        />
      </Group>

      <Pressable
        accessibilityRole="button"
        onPress={() => go('developer')}
        style={({ pressed }) => ({
          marginTop: 4,
          backgroundColor: colors.ink,
          borderRadius: 22,
          padding: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <IconTile bg="rgba(255,255,255,0.12)">
          <CodeIcon size={20} color="#FFFFFF" />
        </IconTile>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>Developer</Text>
          <Text style={{ fontSize: 13, color: '#CBD5E1' }}>Sampling rates, filters, signal quality, log, files</Text>
        </View>
        <ChevronIcon size={18} color="#FFFFFF" />
      </Pressable>
    </Screen>
  );
}
