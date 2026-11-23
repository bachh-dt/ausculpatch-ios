import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { size?: number; color?: string; strokeWidth?: number };

function Stroke({ size = 22, color = '#0F172A', strokeWidth = 2, children }: P & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const HomeIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Stroke>
);
export const TrendsIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M5 20V11M11 20V5M17 20v-7M3 20h18" />
  </Stroke>
);
export const WaveIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M3 12h1M7 8v8M11 5v14M15 9v6M19 7v10" />
  </Stroke>
);
export const SlidersIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
    <Circle cx={16} cy={6} r={2} />
    <Circle cx={10} cy={12} r={2} />
    <Circle cx={18} cy={18} r={2} />
  </Stroke>
);
export const HeartIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M12 20s-7-4.4-9-9a4.9 4.9 0 0 1 9-3 4.9 4.9 0 0 1 9 3c-2 4.6-9 9-9 9z" />
  </Stroke>
);
export const BreathIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
  </Stroke>
);
export const BluetoothIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M7 7l10 10-5 4V3l5 4L7 17" />
  </Stroke>
);
export const ShieldIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
    <Path d="M9 12l2 2 4-4" />
  </Stroke>
);
export const SpeakerIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M4 9h4l5-4v14l-5-4H4z" />
    <Path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </Stroke>
);
export const BackIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M15 5l-7 7 7 7" />
  </Stroke>
);
export const ChevronIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M9 5l7 7-7 7" />
  </Stroke>
);
export const ShareIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Stroke>
);
export const WarningIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M12 3 2 20h20z" />
    <Path d="M12 10v4M12 17h0" />
  </Stroke>
);
export const CodeIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
  </Stroke>
);
export const DownloadIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Stroke>
);
export const PatchIcon = (p: P) => (
  <Stroke {...p}>
    <Rect x={5} y={5} width={14} height={14} rx={4} />
    <Path d="M9 12h6M12 9v6" />
  </Stroke>
);
export const StepsIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 16h4v2a2 2 0 0 1-4 0zM16 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM14 20h4" />
  </Stroke>
);

export function PlayIcon({ size = 22, color = '#1D4ED8' }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 5v14l11-7z" fill={color} />
    </Svg>
  );
}
export function PauseIcon({ size = 22, color = '#1D4ED8' }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6} y={5} width={4} height={14} rx={1} fill={color} />
      <Rect x={14} y={5} width={4} height={14} rx={1} fill={color} />
    </Svg>
  );
}
export function RecordDot({ size = 16, color = '#C8283E', square = false }: P & { square?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {square ? <Rect x={5} y={5} width={14} height={14} rx={2} fill={color} /> : <Circle cx={12} cy={12} r={9} fill={color} />}
    </Svg>
  );
}
export const PulseIcon = (p: P) => (
  <Stroke {...p}>
    <Path d="M3 12h4l3-8 4 16 3-8h4" />
  </Stroke>
);
