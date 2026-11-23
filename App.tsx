import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { engine } from './src/live/engine';
import { ensureNotificationPermission, history, settings } from './src/app/services';
import { TabBar } from './src/ui/kit';
import { HomeIcon, PulseIcon, SlidersIcon, TrendsIcon, WaveIcon } from './src/ui/icons';
import { ScienceScreen } from './src/ui/screens/ScienceScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { ListenScreen } from './src/ui/screens/ListenScreen';
import { TrendsScreen } from './src/ui/screens/TrendsScreen';
import { SoundsScreen } from './src/ui/screens/SoundsScreen';
import { SettingsScreen } from './src/ui/screens/SettingsScreen';
import { DeveloperScreen, PatchRecordingScreen } from './src/ui/screens/DeveloperScreen';
import { FallAlert, ReattachSheet } from './src/ui/Overlays';
import { colors } from './src/ui/theme';
import { AppState } from 'react-native';

type Tab = 'home' | 'trends' | 'science' | 'sounds' | 'settings';
type Sub = null | 'listen' | 'developer' | 'download';

const TABS = [
  { key: 'home', label: 'Home', icon: (c: string) => <HomeIcon size={20} color={c} /> },
  { key: 'trends', label: 'Trends', icon: (c: string) => <TrendsIcon size={20} color={c} /> },
  { key: 'science', label: 'Science', icon: (c: string) => <PulseIcon size={20} color={c} /> },
  { key: 'sounds', label: 'Sounds', icon: (c: string) => <WaveIcon size={20} color={c} /> },
  { key: 'settings', label: 'Settings', icon: (c: string) => <SlidersIcon size={20} color={c} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<Sub>(null);

  useEffect(() => {
    void engine; // start the live engine
    if (settings.get().fallAlerts) void ensureNotificationPermission();
    // Save unsaved history minutes when the app goes to the background.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') history.flushLive(true);
    });
    return () => sub.remove();
  }, []);

  const openTab = (k: string) => {
    setSub(null);
    setTab(k as Tab);
  };

  let content: React.ReactNode;
  if (sub === 'listen') content = <ListenScreen back={() => setSub(null)} openRecordings={() => openTab('sounds')} />;
  else if (sub === 'developer') content = <DeveloperScreen back={() => setSub(null)} />;
  else if (sub === 'download') content = <PatchRecordingScreen back={() => setSub(null)} />;
  else if (tab === 'home') content = <HomeScreen go={(r) => (r === 'settings' ? openTab('settings') : setSub('listen'))} />;
  else if (tab === 'trends') content = <TrendsScreen />;
  else if (tab === 'science') content = <ScienceScreen />;
  else if (tab === 'sounds') content = <SoundsScreen />;
  else content = <SettingsScreen go={(r) => setSub(r)} />;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1 }}>{content}</View>
      </SafeAreaView>
      {sub === null ? (
        <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
          <View style={{ height: 88 }} pointerEvents="box-none">
            <TabBar tabs={TABS} active={tab} onChange={openTab} />
          </View>
        </SafeAreaView>
      ) : null}
      <ReattachSheet />
      <FallAlert />
    </SafeAreaProvider>
  );
}
