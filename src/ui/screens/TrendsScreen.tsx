import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { history } from '../../app/services';
import { Bin, Period, periodRange } from '../../history/aggregate';
import { useHistoryVersion, useTicker } from '../hooks';
import { Header, Panel, Screen, Segmented } from '../kit';
import { DownloadIcon, WarningIcon } from '../icons';
import { colors, font } from '../theme';
import { clock } from '../words';

type Metric = 'hr' | 'br' | 'steps';

const METRICS: Record<Metric, { label: string; unit: string; lo: number; hi: number; color: string }> = {
  hr: { label: 'Heart rate', unit: 'bpm', lo: 40, hi: 140, color: colors.heart },
  br: { label: 'Breathing', unit: '/ min', lo: 5, hi: 30, color: colors.accent },
  steps: { label: 'Steps', unit: 'steps', lo: 0, hi: 0, color: colors.accent },
};

const CHART_H = 180;

function value(b: Bin, m: Metric): [number, number] | null {
  if (m === 'steps') return b.steps > 0 ? [0, b.steps] : null;
  const lo = m === 'hr' ? b.hrMin : b.brMin;
  const hi = m === 'hr' ? b.hrMax : b.brMax;
  return lo === null || hi === null ? null : [lo, hi];
}

export function TrendsScreen() {
  const version = useHistoryVersion();
  useTicker(30000); // pick up live minutes that are not saved yet
  const [period, setPeriod] = useState<Period>('week');
  const [metric, setMetric] = useState<Metric>('hr');
  const m = METRICS[metric];

  const bins = useMemo(() => history.bins(period), [period, version]);
  const falls = useMemo(() => {
    const [from, to] = periodRange(period, new Date());
    return history.events(from, to);
  }, [period, version]);

  const spans = bins.map((b) => value(b, metric));
  const hasData = spans.some((s) => s !== null);
  const stepsMax = Math.max(1000, ...bins.map((b) => b.steps));
  const lo = metric === 'steps' ? 0 : Math.min(m.lo, ...spans.filter(Boolean).map((s) => (s as [number, number])[0] - 5));
  const hi = metric === 'steps' ? Math.ceil(stepsMax / 1000) * 1000 : Math.max(m.hi, ...spans.filter(Boolean).map((s) => (s as [number, number])[1] + 5));
  const range = hi - lo || 1;

  // Summary numbers.
  let headline: string = '--';
  let s1 = '--', s2 = '--', s3 = '--';
  const labels = metric === 'steps' ? ['Total', 'Daily average', 'Best day'] : ['Lowest', 'Average', 'Highest'];
  if (hasData) {
    if (metric === 'steps') {
      const total = bins.reduce((a, b) => a + b.steps, 0);
      const days = period === 'day' ? 1 : bins.filter((b) => !b.future).length || 1;
      headline = Math.round(total / days).toLocaleString();
      s1 = total.toLocaleString();
      s2 = headline;
      s3 = Math.max(...bins.map((b) => b.steps)).toLocaleString();
      if (period === 'day') {
        headline = total.toLocaleString();
        labels[1] = 'Per 3 hours';
        s2 = Math.round(total / Math.max(1, bins.filter((b) => !b.future).length)).toLocaleString();
        labels[2] = 'Busiest 3 hours';
      }
    } else {
      const means = bins.map((b) => (metric === 'hr' ? b.hrMean : b.brMean)).filter((v): v is number => v !== null);
      const avg = means.reduce((a, b) => a + b, 0) / means.length;
      headline = String(Math.round(avg));
      s1 = String(Math.round(Math.min(...spans.filter(Boolean).map((s) => (s as [number, number])[0]))));
      s2 = headline;
      s3 = String(Math.round(Math.max(...spans.filter(Boolean).map((s) => (s as [number, number])[1]))));
    }
  }
  const periodText = period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month';
  const barW = period === 'month' ? 7 : 22;

  return (
    <Screen>
      <Header title="Trends" right={<Segmented label="Period" onWhite={false} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} value={period} onChange={setPeriod} />} />

      <Segmented
        label="Measurement"
        onWhite={false}
        stretch
        options={[
          { value: 'hr', label: 'Heart rate' },
          { value: 'br', label: 'Breathing' },
          { value: 'steps', label: 'Steps' },
        ]}
        value={metric}
        onChange={(v) => setMetric(v as Metric)}
      />

      <Panel style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontSize: 34, fontWeight: '800', letterSpacing: -1, color: hasData ? colors.text : colors.faint }}>{headline}</Text>
            <Text style={font.label}>{m.unit}</Text>
          </View>
          <Text style={font.label}>{metric === 'steps' && period !== 'day' ? `Daily average, ${periodText}` : metric === 'steps' ? 'Total today' : `Average ${periodText}`}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }} accessible accessibilityLabel={`${m.label} chart, ${periodText}`}>
          <View style={{ height: CHART_H, justifyContent: 'space-between', width: 36 }}>
            <Text style={font.small}>{Math.round(hi).toLocaleString()}</Text>
            <Text style={font.small}>{Math.round((hi + lo) / 2).toLocaleString()}</Text>
            <Text style={font.small}>{Math.round(lo).toLocaleString()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ height: CHART_H, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.grid }}>
              {bins.map((b, i) => {
                const s = spans[i];
                const top = s ? ((hi - s[1]) / range) * CHART_H : 0;
                const h = s ? Math.max(6, ((s[1] - s[0]) / range) * CHART_H) : 0;
                return (
                  <View key={i} style={{ width: barW, height: CHART_H, borderRadius: barW / 2, backgroundColor: b.future ? 'transparent' : '#F3F6FB' }}>
                    {s ? <View style={{ position: 'absolute', left: 0, right: 0, top, height: h, borderRadius: barW / 2, backgroundColor: m.color }} /> : null}
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              {bins.map((b, i) => (
                <Text key={i} style={{ width: 24, marginHorizontal: (barW - 24) / 2, textAlign: 'center', fontSize: 11, color: colors.muted }} numberOfLines={1}>
                  {b.label}
                </Text>
              ))}
            </View>
          </View>
        </View>
        {!hasData ? <Text style={[font.small, { textAlign: 'center' }]}>No data for this period yet. Wear the patch while the app is connected, or download a recording from the patch.</Text> : null}
      </Panel>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          [labels[0], s1],
          [labels[1], s2],
          [labels[2], s3],
        ].map(([l, v]) => (
          <Panel key={l} style={{ flex: 1, padding: 14, gap: 4, borderRadius: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted }}>{l}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{v}</Text>
          </Panel>
        ))}
      </View>

      {falls.length ? (
        <Panel>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{`Possible falls ${periodText}`}</Text>
          {falls.slice(0, 10).map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <WarningIcon size={18} color={colors.alert} />
              <Text style={font.body}>{`${new Date(f.time).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(f.time)}`}</Text>
              <Text style={font.small}>{f.source === 'patch' ? 'from download' : 'live'}</Text>
            </View>
          ))}
        </Panel>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
        <DownloadIcon size={16} color={colors.muted} />
        <Text style={[font.small, { flex: 1 }]}>Includes live sessions and data recovered from patch downloads. Heart rate and breathing are only stored while the signal quality is good.</Text>
      </View>
    </Screen>
  );
}
