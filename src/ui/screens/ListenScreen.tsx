import React, { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { session } from '../../ble/session';
import { engine } from '../../live/engine';
import { settings } from '../../app/services';
import { useEngine, useSession, useSettings } from '../hooks';
import { Badge, BigButton, Header, Panel, qualityBadge, Screen, Segmented } from '../kit';
import { PauseIcon, RecordDot, SpeakerIcon } from '../icons';
import { SignalTrace } from '../SignalTrace';
import { colors, font, space } from '../theme';
import { mmss } from '../words';
import { WINDOW_OPTIONS } from './HomeScreen';

const VOLUMES = [
  { value: 0.4, label: 'Low' },
  { value: 0.7, label: 'Medium' },
  { value: 1, label: 'High' },
];

function KeepAwake() {
  useKeepAwake();
  return null;
}

export function ListenScreen({ back, openRecordings }: { back: () => void; openRecordings: () => void }) {
  const s = useSession();
  const e = useEngine();
  const st = useSettings();
  const [busy, setBusy] = useState(false);
  const [toneBusy, setToneBusy] = useState<null | 'ios' | 'web'>(null);
  const [toneResult, setToneResult] = useState<string | null>(null);
  const [listenError, setListenError] = useState<string | null>(null);
  const testTone = async (route: 'ios' | 'web') => {
    setToneBusy(route);
    setToneResult(null);
    try {
      setToneResult(await engine.testTone(route));
    } finally {
      setToneBusy(null);
    }
  };
  const { width } = useWindowDimensions();
  const traceWidth = width - 2 * space.xl - 2 * space.l;
  const volume = VOLUMES.reduce((best, v) => (Math.abs(v.value - st.listenVolume) < Math.abs(best.value - st.listenVolume) ? v : best)).value;

  const toggleListen = async () => {
    setBusy(true);
    try {
      setListenError(null);
      if (e.listening) await engine.stopListening();
      else await engine.startListening();
    } catch (err) {
      setListenError(`Could not start sound: ${String((err as Error).message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen bottomInset={40}>
      {s.connected ? <KeepAwake /> : null}
      <Header title="Heart sound" onBack={back} />

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontSize: 34, fontWeight: '800', letterSpacing: -1, color: e.vitals.heartRate === null ? colors.faint : colors.text }}>
              {e.vitals.heartRate === null ? '--' : Math.round(e.vitals.heartRate)}
            </Text>
            <Text style={font.label}>bpm</Text>
          </View>
          <Segmented label="Time window" options={WINDOW_OPTIONS} value={st.windowS} onChange={(v) => settings.update({ windowS: v })} />
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>● Heart sound</Text>
            <Badge {...qualityBadge(e.heartQuality.level, s.connected)} />
          </View>
          <SignalTrace source={() => session.clinical.heartOut} windowS={st.windowS} width={traceWidth} height={140} color={colors.heart} label="Heart sound" />
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>● ECG, same time axis</Text>
            <Badge {...qualityBadge(e.ecgQuality.level, s.connected)} />
          </View>
          <SignalTrace source={() => session.clinical.ecgOut} windowS={st.windowS} width={traceWidth} height={80} color={colors.ecg} label="ECG" />
        </View>
      </Panel>

      <Panel style={{ alignItems: 'center', gap: 14, paddingVertical: 18 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={e.listening ? 'Stop listening' : 'Start listening'}
          accessibilityState={{ selected: e.listening, busy }}
          disabled={busy || (!s.connected && !e.listening)}
          onPress={toggleListen}
          style={({ pressed }) => ({
            width: 88,
            height: 88,
            borderRadius: 44,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: e.listening ? colors.accent : colors.accentSoft,
            borderWidth: e.listening ? 10 : 0,
            borderColor: colors.accentSoft,
            opacity: !s.connected && !e.listening ? 0.45 : pressed ? 0.8 : 1,
          })}
        >
          {e.listening ? <PauseIcon size={30} color="#FFFFFF" /> : <SpeakerIcon size={34} color={colors.accentText} />}
        </Pressable>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
          {e.listening ? 'Playing live' : s.connected ? 'Tap to listen live' : 'Connect the patch to listen'}
        </Text>
        <Text style={[font.small, { textAlign: 'center' }]}>
          {st.listenBand === 'heart'
            ? `Plays the ${st.heartBand.lowHz} to ${st.heartBand.highHz} Hz heart band as it is. The iPhone speaker cannot play sound this low, so this mode needs headphones.`
            : 'Plays 25 to 400 Hz and adds harmonics of the heart sounds so the iPhone speaker can play them. It sounds less natural than headphones.'}
        </Text>
        <Segmented
          label="Listening band"
          options={[
            { value: 'heart', label: 'Headphones' },
            { value: 'wide', label: 'Speaker boost' },
          ]}
          value={st.listenBand}
          onChange={(v) => settings.update({ listenBand: v as 'heart' | 'wide' })}
        />
        {listenError ? <Text style={[font.small, { color: colors.danger, textAlign: 'center' }]}>{listenError}</Text> : null}
        <Segmented
          label="Audio route"
          options={[
            { value: 'ios', label: 'iOS player' },
            { value: 'web', label: 'Web Audio' },
          ]}
          value={st.audioEngine}
          onChange={(v) => settings.update({ audioEngine: v as 'ios' | 'web' })}
        />
        <Text style={[font.small, { textAlign: 'center' }]}>
          {st.audioEngine === 'ios' ? 'Apple’s standard player. Reliable, about 1 s behind the traces.' : 'Lower delay, but it was silent on your iPhone before.'}
          {e.listening ? `  ${e.audio.buffers} pieces played, ${e.audio.underruns} gaps.` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
          <BigButton label="Test iOS player" kind="soft" busy={toneBusy === 'ios'} disabled={toneBusy !== null} onPress={() => testTone('ios')} style={{ flex: 1, minHeight: 40 }} />
          <BigButton label="Test Web Audio" kind="soft" busy={toneBusy === 'web'} disabled={toneBusy !== null} onPress={() => testTone('web')} style={{ flex: 1, minHeight: 40 }} />
        </View>
        {toneResult ? <Text style={[font.small, { textAlign: 'center' }]}>{toneResult}</Text> : null}
        <Text style={[font.small, { textAlign: 'center' }]}>Each test plays a 1 s beep. If neither beeps, turn the media volume up with the side buttons while a test is playing.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={font.label}>Volume</Text>
          <Segmented label="Volume" options={VOLUMES} value={volume} onChange={(v) => settings.update({ listenVolume: v })} />
        </View>
      </Panel>

      <Panel style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={e.recording.active ? 'Stop recording' : 'Start recording'}
          disabled={!s.connected && !e.recording.active}
          onPress={() => (e.recording.active ? engine.stopRecording() : engine.startRecording())}
          style={({ pressed }) => ({
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: colors.heartSoft,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !s.connected && !e.recording.active ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <RecordDot size={e.recording.active ? 20 : 22} square={e.recording.active} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
            {e.recording.active ? `Recording  ${mmss(e.recording.seconds)}` : 'Record heart sound'}
          </Text>
          <Text style={font.small}>{e.recording.active ? 'Sound, ECG and motion are saved together' : 'Saved to Recordings with the time and heart rate'}</Text>
        </View>
        <BigButton label="Library" kind="plain" onPress={openRecordings} style={{ minHeight: 40, paddingHorizontal: 8 }} />
      </Panel>
    </Screen>
  );
}
