import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, space } from './theme';

export function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

type ButtonKind = 'primary' | 'plain' | 'danger';
export function Button({
  label,
  onPress,
  kind = 'plain',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.dangerSoft : colors.raised;
  const fg = kind === 'primary' ? '#FFFFFF' : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      <Text style={[styles.chipText, selected && { color: '#FFFFFF', fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export function ProgressBar({ percent, color = colors.accent }: { percent: number; color?: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Chip label="-" onPress={() => onChange(Math.max(min, value - 1))} />
        <Text style={[styles.rowValue, { minWidth: 36, textAlign: 'center' }]}>{value}</Text>
        <Chip label="+" onPress={() => onChange(Math.min(max, value + 1))} />
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: space.l,
    marginBottom: space.m,
  },
  cardTitle: { color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: space.s, letterSpacing: 0.5 },
  button: {
    minHeight: 44,
    paddingHorizontal: space.l,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  chip: {
    paddingHorizontal: space.m,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D5DDEA',
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.text, fontSize: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { color: colors.muted, fontSize: 15, flexShrink: 1, marginRight: space.s },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.raised, overflow: 'hidden', marginVertical: space.s },
  progressFill: { height: 8 },
  buttonRow: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap', marginTop: space.s },
});
