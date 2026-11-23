/** Light theme from the approved mockups: blue-grey ground, white cards, one blue accent, coral for heart. */
export const colors = {
  // Base
  bg: '#EEF3FB',
  surface: '#FFFFFF',
  raised: '#F3F6FB',
  grid: '#E2E8F2',
  line: '#EEF2F8',
  text: '#0F172A',
  muted: '#5B6475',
  faint: '#94A3B8',
  // Accent
  accent: '#2563EB',
  accentText: '#1D4ED8',
  accentSoft: '#E6EEFE',
  ink: '#0F172A',
  // Signals
  heart: '#C8283E',
  heartSoft: '#FDECEE',
  ecg: '#2563EB',
  breath: '#2563EB',
  temp: '#B4537A',
  batt: '#64748B',
  // States
  ok: '#166534',
  okSoft: '#DCFCE7',
  warn: '#9A3412',
  warnSoft: '#FFEDD5',
  danger: '#991B1B',
  dangerSoft: '#FEE2E2',
  alert: '#C2410C',
  alertSoft: '#FFF1E6',
  overlay: 'rgba(15, 23, 42, 0.55)',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24 };
export const radius = { card: 22, button: 16, pill: 999 };
export const font = {
  title: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  big: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1, color: colors.text },
  label: { fontSize: 14, fontWeight: '600' as const, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  body: { fontSize: 15, color: colors.text },
};
