/** Building blocks for the new screens, matching the mockups. */
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleProp, Switch, Text, View, ViewStyle } from 'react-native';
import { colors, font, radius, space } from './theme';
import { BackIcon, ChevronIcon } from './icons';
import { QualityLevel } from '../dsp/quality';

export function Screen({ children, bottomInset = 110 }: { children: React.ReactNode; bottomInset?: number }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: bottomInset, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.l, gap: 12 }, style]}>{children}</View>;
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  if (!onBack) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
        <Text style={font.title} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <RoundButton label="Back" onPress={onBack}>
        <BackIcon />
      </RoundButton>
      <Text style={font.heading} accessibilityRole="header">
        {title}
      </Text>
      <View style={{ width: 48, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function RoundButton({ label, onPress, children, size = 48, bg = colors.surface }: { label: string; onPress: () => void; children: React.ReactNode; size?: number; bg?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
    >
      {children}
    </Pressable>
  );
}

export function BigButton({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'soft' | 'heart' | 'dark' | 'plain';
  icon?: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = {
    primary: [colors.accent, '#FFFFFF'],
    soft: [colors.raised, colors.text],
    heart: [colors.heartSoft, '#B42136'],
    dark: [colors.ink, '#FFFFFF'],
    plain: [colors.surface, '#334155'],
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        {
          minHeight: 50,
          borderRadius: radius.button,
          backgroundColor: palette[0],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: space.l,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={palette[1]} /> : icon}
      <Text style={{ color: palette[1], fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

/** Pill-shaped single choice, like the 5 s / 10 s / 30 s window picker. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  onWhite = true,
  stretch = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  onWhite?: boolean;
  stretch?: boolean;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', gap: 4, backgroundColor: onWhite ? colors.bg : colors.surface, padding: 4, borderRadius: radius.pill, alignSelf: stretch ? 'stretch' : 'auto' }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: stretch ? 1 : undefined,
              minWidth: 44,
              height: 34,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? (onWhite ? colors.surface : colors.accent) : 'transparent',
              shadowColor: '#0F172A',
              shadowOpacity: on && onWhite ? 0.12 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: on ? (onWhite ? colors.accentText : '#FFFFFF') : colors.muted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' }) {
  const [bg, fg] = {
    good: [colors.okSoft, colors.ok],
    warn: [colors.warnSoft, colors.warn],
    bad: [colors.dangerSoft, colors.danger],
    info: [colors.accentSoft, colors.accentText],
    neutral: [colors.bg, '#334155'],
  }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function qualityBadge(level: QualityLevel, connected: boolean): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (!connected) return { text: 'Not connected', tone: 'neutral' };
  if (level === 'good') return { text: 'Good contact', tone: 'good' };
  if (level === 'poor') return { text: 'Noisy', tone: 'warn' };
  if (level === 'none') return { text: 'No contact', tone: 'bad' };
  return { text: 'Checking', tone: 'neutral' };
}

export function IconTile({ children, bg, size = 40 }: { children: React.ReactNode; bg: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

export function SectionLabel({ text }: { text: string }) {
  return <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, paddingHorizontal: 6, marginTop: 4, marginBottom: -6 }}>{text}</Text>;
}

/** A white group of rows separated by hairlines. */
export function Group({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.card }}>
      {items.map((c, i) => (
        <View key={i} style={{ borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, chevron }: { title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; chevron?: boolean }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingVertical: 14, gap: 12, minHeight: 52 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 13, color: colors.muted }}>{subtitle}</Text> : null}
      </View>
      {right}
      {chevron ? <ChevronIcon size={18} color={colors.faint} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function SwitchRow({ title, subtitle, value, onChange }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      right={<Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: '#CBD5E1' }} accessibilityLabel={title} />}
    />
  );
}

/** Number with - and + buttons, for filter cut-offs and the like. */
export function NumberStepper({
  label,
  value,
  step,
  min,
  max,
  unit,
  decimals = 0,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  unit?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  const btn = (text: string, v: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text === '-' ? 'Decrease' : 'Increase'} ${label}`}
      disabled={disabled}
      onPress={() => set(v)}
      style={({ pressed }) => ({ width: 40, height: 36, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}
    >
      <Text style={{ fontSize: 20, fontWeight: '600', color: colors.text }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.muted }}>{label}</Text>
      {btn('-', value - step, value <= min)}
      <Text style={{ minWidth: 74, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>
        {`${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`}
      </Text>
      {btn('+', value + step, value >= max)}
    </View>
  );
}

export function TabBar({ tabs, active, onChange }: { tabs: { key: string; label: string; icon: (color: string) => React.ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 20,
        height: 68,
        borderRadius: 34,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        shadowColor: '#0F172A',
        shadowOpacity: 0.1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      }}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.key)}
            style={{
              height: 48,
              minWidth: 48,
              paddingHorizontal: on ? 18 : 0,
              borderRadius: 24,
              backgroundColor: on ? colors.accent : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {t.icon(on ? '#FFFFFF' : colors.muted)}
            {on ? <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{t.label}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
