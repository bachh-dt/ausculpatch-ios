import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { FilePlayer } from '../../audio/audio';
import { waveformBars } from '../../audio/pcm';
import { RecordingMeta, recordings } from '../../storage/recordings';
import { useRecordingsVersion, useTicker } from '../hooks';
import { Badge, Header, IconTile, Panel, RoundButton, Screen } from '../kit';
import { PauseIcon, PlayIcon, ShareIcon, WaveIcon } from '../icons';
import { colors, font } from '../theme';
import { clock, mmss } from '../words';

const player = new FilePlayer();
const BARS = 40;

function describe(m: RecordingMeta): string {
  const parts = [mmss(m.durationS)];
  if (m.avgHeartRate !== null) parts.push(`${Math.round(m.avgHeartRate)} bpm`);
  parts.push(m.note.toLowerCase());
  return parts.join(' · ');
}

function title(m: RecordingMeta): string {
  const d = new Date(m.startedAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return `${sameDay ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(m.startedAt)}`;
}

/** Peaks of a 16-bit mono WAV for the preview, read once per file. */
function useWaveform(m: RecordingMeta | undefined): number[] {
  return useMemo(() => {
    if (!m?.wav) return [];
    try {
      const uri = recordings.uri(m.wav);
      if (!uri) return [];
      const bytes = new File(uri).bytesSync();
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, Math.floor((bytes.length - 44) / 2));
      return waveformBars(pcm, BARS);
    } catch {
      return [];
    }
  }, [m?.id]);
}

export function SoundsScreen() {
  const version = useRecordingsVersion();
  const items = useMemo(() => recordings.list(), [version]);
  const [selId, setSelId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTicker(250, playing);
  const sel = items.find((m) => m.id === selId) ?? items[0];
  const wave = useWaveform(sel);
  const mounted = useRef(true);

  useEffect(() => {
    player.onEnded = () => mounted.current && setPlaying(false);
    return () => {
      mounted.current = false;
      void player.stop();
    };
  }, []);

  const toggle = async () => {
    if (!sel?.wav) return;
    setError(null);
    if (playing) {
      await player.stop();
      setPlaying(false);
      return;
    }
    try {
      await player.play(recordings.uri(sel.wav) as string);
      setPlaying(true);
    } catch (e) {
      setError(`Could not play this file: ${String((e as Error).message ?? e)}`);
      setPlaying(false);
    }
  };

  const share = async (m: RecordingMeta) => {
    const name = m.wav ?? m.csv ?? m.bin;
    const uri = recordings.uri(name);
    if (!uri) return;
    const wav = name?.endsWith('.wav');
    await Sharing.shareAsync(uri, wav ? { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' } : { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  };

  const remove = (m: RecordingMeta) =>
    Alert.alert('Delete recording', `Delete ${title(m)} and its files from this phone? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (player.uri && sel?.id === m.id) await player.stop();
          setPlaying(false);
          recordings.remove(m.id);
        },
      },
    ]);

  const progress = playing && player.duration ? player.position() / player.duration : 0;

  return (
    <Screen>
      <Header title="Recordings" />

      {sel ? (
        <View style={{ backgroundColor: colors.accent, borderRadius: 24, padding: 18, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#DBE6FF' }}>{playing ? 'Now playing' : 'Selected'}</Text>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>{title(sel)}</Text>
            </View>
            <RoundButton label="Share recording" onPress={() => share(sel)} size={44} bg="rgba(255,255,255,0.18)">
              <ShareIcon size={20} color="#FFFFFF" />
            </RoundButton>
          </View>
          {sel.wav ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 44 }} accessibilityElementsHidden>
                {(wave.length ? wave : Array(BARS).fill(0.1)).map((h, i) => (
                  <View key={i} style={{ width: 4, height: Math.max(4, h * 44), borderRadius: 2, backgroundColor: i / BARS < progress ? '#FFFFFF' : 'rgba(255,255,255,0.45)' }} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <RoundButton label={playing ? 'Pause' : 'Play'} onPress={toggle} size={52} bg="#FFFFFF">
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </RoundButton>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#DBE6FF' }}>{`${mmss(playing ? player.position() : 0)} / ${mmss(sel.durationS)} · plays through the speaker`}</Text>
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 14, color: '#DBE6FF' }}>Downloaded from the patch. It has no audio file; share it as a CSV to listen or analyse on a computer.</Text>
          )}
          {error ? <Text style={{ fontSize: 13, color: '#FFFFFF' }}>{error}</Text> : null}
        </View>
      ) : (
        <Panel>
          <Text style={font.body}>No recordings yet.</Text>
          <Text style={font.small}>Tap Record on the Home or Listen screen, or download what the patch has stored from Settings.</Text>
        </Panel>
      )}

      {items.map((m) => {
        const on = m.id === sel?.id;
        return (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityHint="Long press to delete"
            onPress={async () => {
              if (playing) await player.stop();
              setPlaying(false);
              setSelId(m.id);
            }}
            onLongPress={() => remove(m)}
            style={({ pressed }) => ({
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 12,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderWidth: 2,
              borderColor: on ? colors.accent : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <IconTile bg={on ? colors.accent : colors.heartSoft} size={44}>
              <WaveIcon size={20} color={on ? '#FFFFFF' : colors.heart} />
            </IconTile>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title(m)}</Text>
              <Text style={font.small} numberOfLines={1}>
                {describe(m)}
              </Text>
            </View>
            <Badge text={m.kind === 'patch' ? 'Patch' : 'Live'} tone="neutral" />
          </Pressable>
        );
      })}
      {items.length ? <Text style={[font.small, { textAlign: 'center' }]}>Long press a recording to delete it.</Text> : null}
    </Screen>
  );
}
