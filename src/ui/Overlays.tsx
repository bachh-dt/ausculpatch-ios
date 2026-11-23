/** The two screens that interrupt: the reattach reminder and the fall alert. */
import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { engine } from '../live/engine';
import { session } from '../ble/session';
import * as P from '../protocol/protocol';
import { useEngine, useSession } from './hooks';
import { Badge, BigButton, IconTile, qualityBadge } from './kit';
import { HeartIcon, PatchIcon, WarningIcon } from './icons';
import { SignalTrace } from './SignalTrace';
import { colors, font } from './theme';
import { clock } from './words';
import { useWindowDimensions } from 'react-native';

const STEPS = [
  'Place the patch on the left side of the chest, below the collarbone.',
  'Press the centre firmly for 5 seconds, then smooth down the edges.',
  'If it still lifts, dry the skin or use a new adhesive.',
];

export function ReattachSheet() {
  const e = useEngine();
  const s = useSession();
  const { width } = useWindowDimensions();
  const tw = width - 40 - 28;
  const visible = e.reattach && !e.fall;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => engine.snoozeReattach(5)}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '92%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 14 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: '#D5DDEA', alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <IconTile bg={colors.alertSoft} size={52}>
                <PatchIcon size={26} color={colors.alert} />
              </IconTile>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }} accessibilityRole="header">
                  Check the patch
                </Text>
                <Text style={{ fontSize: 14, color: '#475569' }}>The signals are too weak to read.</Text>
              </View>
            </View>

            <View style={{ backgroundColor: colors.raised, borderRadius: 20, padding: 14, gap: 12 }}>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Heart sound</Text>
                  <Badge {...qualityBadge(e.heartQuality.level, s.connected)} />
                </View>
                <SignalTrace source={() => session.buffers.channels[P.CHANNEL_ACOUSTIC]} windowS={5} width={tw} height={56} color={colors.heart} label="Heart sound" />
                <Text style={font.small}>{e.heartQuality.reason}</Text>
              </View>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>ECG</Text>
                  <Badge {...qualityBadge(e.ecgQuality.level, s.connected)} />
                </View>
                <SignalTrace source={() => session.clinical.ecgOut} windowS={5} width={tw} height={56} color={colors.ecg} label="ECG" />
                <Text style={font.small}>{e.ecgQuality.reason}</Text>
              </View>
            </View>

            <View style={{ gap: 10 }} accessibilityRole="list">
              {STEPS.map((t, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: colors.accentText }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, color: '#1E293B' }}>{t}</Text>
                </View>
              ))}
            </View>

            <BigButton label="Check again" onPress={() => engine.checkContactNow()} style={{ minHeight: 56 }} />
            <BigButton label="Remind me in 5 minutes" kind="soft" onPress={() => engine.snoozeReattach(5)} />
            <Text style={[font.small, { textAlign: 'center', lineHeight: 18 }]}>
              This closes by itself once both signals are good. Heart rate and breathing rate are hidden until then, so a wrong number is never shown.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function FallAlert() {
  const e = useEngine();
  const f = e.fall;
  return (
    <Modal visible={f !== null} transparent animationType="fade" onRequestClose={() => engine.dismissFall()}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', padding: 16 }}>
        <SafeAreaView edges={['bottom']}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 32, padding: 22, paddingTop: 28, alignItems: 'center', gap: 14 }}>
            <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.alertSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 12, borderColor: '#FFF8F2' }}>
              <WarningIcon size={40} color={colors.alert} />
            </View>
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' }} accessibilityRole="header">
              Possible fall detected
            </Text>
            {f ? (
              <>
                <Text style={{ fontSize: 15, lineHeight: 22, color: '#475569', textAlign: 'center' }}>
                  {`At ${clock(f.epochMs)} the patch felt a sudden impact, then lay still at a different angle.`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                  {[
                    ['Impact', `${f.impactG.toFixed(1)} g`],
                    ['Heart rate', f.heartRate !== null ? `${Math.round(f.heartRate)} bpm` : '--'],
                    ['Turned', `${Math.round(f.angleDeg)}°`],
                  ].map(([k, v]) => (
                    <View key={k} style={{ flex: 1, backgroundColor: colors.raised, borderRadius: 16, paddingVertical: 10, alignItems: 'center', gap: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.muted }}>{k}</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{v}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            <BigButton label="I'm OK" onPress={() => engine.dismissFall()} style={{ alignSelf: 'stretch', minHeight: 56 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <HeartIcon size={14} color={colors.muted} />
              <Text style={[font.small, { textAlign: 'center' }]}>Saved in Trends. Nobody has been contacted.</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
