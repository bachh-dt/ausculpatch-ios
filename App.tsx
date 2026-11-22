import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MonitorScreen } from './src/ui/screens/MonitorScreen';
import { RecordingScreen } from './src/ui/screens/RecordingScreen';
import { DeviceScreen } from './src/ui/screens/DeviceScreen';
import { FilesScreen } from './src/ui/screens/FilesScreen';
import { LogScreen } from './src/ui/screens/LogScreen';
import { useSession } from './src/ui/hooks';
import { colors } from './src/ui/theme';

const TABS = [
  { key: 'monitor', label: 'Monitor', Screen: MonitorScreen },
  { key: 'recording', label: 'Recording', Screen: RecordingScreen },
  { key: 'device', label: 'Device', Screen: DeviceScreen },
  { key: 'files', label: 'Files', Screen: FilesScreen },
  { key: 'log', label: 'Log', Screen: LogScreen },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('monitor');
  const s = useSession();
  const { Screen } = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
        <StatusBar style="light" />
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 }}>AusculPatch</Text>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              marginRight: 6,
              backgroundColor: s.connected ? colors.ok : colors.muted,
            }}
          />
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {s.connected ? 'Connected' : s.status.startsWith('Connection lost') ? 'Reconnecting' : 'Offline'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Screen />
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface }}>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.grid }}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{ flex: 1, paddingVertical: 12, alignItems: 'center' }}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
            >
              <Text
                style={{
                  color: tab === t.key ? colors.accent : colors.muted,
                  fontSize: 13,
                  fontWeight: tab === t.key ? '700' : '500',
                }}
              >
                {t.label}
              </Text>
              {t.key === 'recording' && (s.download.phase === 'receiving' || s.download.phase === 'decoding') ? (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 3 }} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
