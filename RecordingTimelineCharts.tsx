/**
 * Timeline strip + tabbed SVG charts (Gluestack Tabs) for IMU recording.
 */

import React, {useMemo} from 'react';
import {Dimensions, StyleSheet, Text, View} from 'react-native';
import Svg, {Line, Polyline, Rect} from 'react-native-svg';

import {
  Tabs,
  TabsTab,
  TabsTabList,
  TabsTabPanel,
  TabsTabPanels,
  TabsTabTitle,
} from '@gluestack-ui/themed';

import type {ImuSample} from './bleRecordingProtocol';

const SCREEN_W = Dimensions.get('window').width;
/** Fits Gluestack screen padding + card padding */
const CHART_W = Math.min(SCREEN_W - 56, 340);
const CHART_H = 108;
const PAD = 8;
const MAX_POINTS = 400;

const COLORS = {
  ax: '#22d3ee',
  ay: '#e879f9',
  az: '#a3e635',
  gx: '#38bdf8',
  gy: '#f472b6',
  gz: '#bef264',
  mag: '#00f5ff',
  gyroMag: '#f472b6',
  grid: 'rgba(148, 163, 184, 0.22)',
  axis: 'rgba(148, 163, 184, 0.45)',
} as const;

/** Gluestack Tabs passes this shape via Tab children render prop (types still reflect Pressable). */
type TabSlotState = {
  active: boolean;
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
};

function downsampleIndices(length: number, maxPoints: number): number[] {
  if (length === 0) {
    return [];
  }
  if (length <= maxPoints) {
    return Array.from({length}, (_, i) => i);
  }
  const idx: number[] = [];
  for (let k = 0; k < maxPoints; k++) {
    idx.push(Math.min(length - 1, Math.floor((k / (maxPoints - 1)) * (length - 1))));
  }
  return idx;
}

function normalizeMinMax(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  const sp = Math.max(mx - mn, 1e-6);
  return values.map(v => (v - mn) / sp);
}

function polylinePointsShared(
  values: number[],
  vmin: number,
  vmax: number,
  height: number,
  pad: number,
): string {
  if (values.length === 0) {
    return '';
  }
  const span = Math.max(vmax - vmin, 1e-6);
  const innerH = height - pad * 2;
  const innerW = CHART_W - pad * 2;
  const n = values.length;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = pad + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yn = pad + (1 - (values[i] - vmin) / span) * innerH;
    pts.push(`${x},${yn}`);
  }
  return pts.join(' ');
}

type PanelProps = {
  title: string;
  subtitle?: string;
  series: {label: string; color: string; values: number[]}[];
};

function ChartPanel({title, subtitle, series}: PanelProps): React.JSX.Element {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
    }
  }
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
    vmin = 0;
    vmax = 1;
  }

  const span = Math.max(vmax - vmin, 1e-6);
  const midY = PAD + (1 - (0 - vmin) / span) * (CHART_H - PAD * 2);

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {subtitle ? <Text style={styles.panelSubtitle}>{subtitle}</Text> : null}
      <View style={styles.legendRow}>
        {series.map(s => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.legendSwatch, {backgroundColor: s.color}]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Svg width={CHART_W} height={CHART_H}>
        <Rect
          x={0}
          y={0}
          width={CHART_W}
          height={CHART_H}
          fill="rgba(15,23,42,0.5)"
          rx={6}
        />
        <Line
          x1={PAD}
          y1={midY}
          x2={CHART_W - PAD}
          y2={midY}
          stroke={COLORS.grid}
          strokeWidth={1}
        />
        <Line
          x1={PAD}
          y1={PAD}
          x2={PAD}
          y2={CHART_H - PAD}
          stroke={COLORS.axis}
          strokeWidth={1}
        />
        <Line
          x1={CHART_W - PAD}
          y1={PAD}
          x2={CHART_W - PAD}
          y2={CHART_H - PAD}
          stroke={COLORS.axis}
          strokeWidth={1}
        />
        {series.map(s => {
          const points = polylinePointsShared(
            s.values,
            vmin,
            vmax,
            CHART_H,
            PAD,
          );
          if (!points) {
            return null;
          }
          return (
            <Polyline
              key={s.label}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </Svg>
      <Text style={styles.rangeText}>
        span [{Math.round(vmin)} … {Math.round(vmax)}]
      </Text>
    </View>
  );
}

export function RecordingTimelineCharts({
  samples,
  windowId,
}: {
  samples: ImuSample[];
  windowId: number;
}): React.JSX.Element {
  const prepared = useMemo(() => {
    if (samples.length === 0) {
      return null;
    }
    const idx = downsampleIndices(samples.length, MAX_POINTS);
    const picked = idx.map(i => samples[i]);
    const ts = picked.map(s => s.t_ms);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);

    const xsNorm = picked.map(s => {
      const span = Math.max(tMax - tMin, 1);
      return (s.t_ms - tMin) / span;
    });

    const reorderByTime = (vals: number[]): number[] => {
      const pairs = xsNorm.map((x, i) => ({x, v: vals[i]}));
      pairs.sort((a, b) => a.x - b.x);
      return pairs.map(p => p.v);
    };

    const ax = reorderByTime(picked.map(s => s.ax));
    const ay = reorderByTime(picked.map(s => s.ay));
    const az = reorderByTime(picked.map(s => s.az));
    const gx = reorderByTime(picked.map(s => s.gx));
    const gy = reorderByTime(picked.map(s => s.gy));
    const gz = reorderByTime(picked.map(s => s.gz));
    const mag = reorderByTime(
      picked.map(s =>
        Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az),
      ),
    );
    const gyroMag = reorderByTime(
      picked.map(s =>
        Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz),
      ),
    );
    const magNorm = normalizeMinMax(mag);
    const gyroMagNorm = normalizeMinMax(gyroMag);

    return {
      tMin,
      tMax,
      ax,
      ay,
      az,
      gx,
      gy,
      gz,
      mag,
      gyroMag,
      magNorm,
      gyroMagNorm,
    };
  }, [samples]);

  if (!prepared) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No samples in this recording.</Text>
      </View>
    );
  }

  const {
    tMin,
    tMax,
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    mag,
    gyroMag,
    magNorm,
    gyroMagNorm,
  } = prepared;

  const tabChromeProps = {
    px: '$2',
    py: '$2',
    mr: '$1',
    mb: '$1',
    borderRadius: '$md',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.28)',
    bg: 'rgba(15,23,42,0.65)',
  } as const;

  return (
    <View style={styles.wrap}>
      <Tabs value="acc">
        <TabsTabList
          variant="scrollable"
          flexWrap="wrap"
          alignItems="center"
          py="$2"
          px="$1"
          mb="$2"
          borderRadius="$xl"
          borderWidth={1}
          borderColor="rgba(34,211,238,0.22)"
          bg="rgba(2,6,23,0.72)">
          <TabsTab value="acc" {...tabChromeProps}>
            {state => {
              const s = state as unknown as TabSlotState;
              return (
              <TabsTabTitle
                fontSize={10}
                fontFamily="Menlo"
                fontWeight="$extrabold"
                letterSpacing="$sm"
                color={s.active ? '#22d3ee' : '#64748b'}>
                ACC RAW
              </TabsTabTitle>
              );
            }}
          </TabsTab>
          <TabsTab value="gyro" {...tabChromeProps}>
            {state => {
              const s = state as unknown as TabSlotState;
              return (
              <TabsTabTitle
                fontSize={10}
                fontFamily="Menlo"
                fontWeight="$extrabold"
                letterSpacing="$sm"
                color={s.active ? '#f472b6' : '#64748b'}>
                GYRO RAW
              </TabsTabTitle>
              );
            }}
          </TabsTab>
          <TabsTab value="accMag" {...tabChromeProps}>
            {state => {
              const s = state as unknown as TabSlotState;
              return (
              <TabsTabTitle
                fontSize={10}
                fontFamily="Menlo"
                fontWeight="$extrabold"
                letterSpacing="$sm"
                color={s.active ? '#00f5ff' : '#64748b'}>
                ACC MAG
              </TabsTabTitle>
              );
            }}
          </TabsTab>
          <TabsTab value="gyroMag" {...tabChromeProps}>
            {state => {
              const s = state as unknown as TabSlotState;
              return (
              <TabsTabTitle
                fontSize={10}
                fontFamily="Menlo"
                fontWeight="$extrabold"
                letterSpacing="$sm"
                color={s.active ? '#f472b6' : '#64748b'}>
                GYRO MAG
              </TabsTabTitle>
              );
            }}
          </TabsTab>
          <TabsTab value="compare" {...tabChromeProps}>
            {state => {
              const s = state as unknown as TabSlotState;
              return (
              <TabsTabTitle
                fontSize={10}
                fontFamily="Menlo"
                fontWeight="$extrabold"
                letterSpacing="$sm"
                color={s.active ? '#a3e635' : '#64748b'}>
                COMPARE
              </TabsTabTitle>
              );
            }}
          </TabsTab>
        </TabsTabList>

        <TabsTabPanels>
          <TabsTabPanel value="acc">
            <ChartPanel
              title="Accelerometer"
              subtitle="Raw axes vs capture order (MCU time)."
              series={[
                {label: 'ax', color: COLORS.ax, values: ax},
                {label: 'ay', color: COLORS.ay, values: ay},
                {label: 'az', color: COLORS.az, values: az},
              ]}
            />
          </TabsTabPanel>
          <TabsTabPanel value="gyro">
            <ChartPanel
              title="Gyroscope"
              subtitle="Raw axes vs capture order (MCU time)."
              series={[
                {label: 'gx', color: COLORS.gx, values: gx},
                {label: 'gy', color: COLORS.gy, values: gy},
                {label: 'gz', color: COLORS.gz, values: gz},
              ]}
            />
          </TabsTabPanel>
          <TabsTabPanel value="accMag">
            <ChartPanel
              title="Acceleration magnitude"
              subtitle="‖a‖ = √(ax² + ay² + az²) in raw units."
              series={[{label: '‖a‖', color: COLORS.mag, values: mag}]}
            />
          </TabsTabPanel>
          <TabsTabPanel value="gyroMag">
            <ChartPanel
              title="Gyro magnitude"
              subtitle="‖ω‖ = √(gx² + gy² + gz²) — rotational energy envelope."
              series={[{label: '‖ω‖', color: COLORS.gyroMag, values: gyroMag}]}
            />
          </TabsTabPanel>
          <TabsTabPanel value="compare">
            <ChartPanel
              title="Normalized compare"
              subtitle="Each series min–max scaled to 0…1 to compare shape (not absolute units)."
              series={[
                {label: '‖a‖ norm', color: COLORS.mag, values: magNorm},
                {label: '‖ω‖ norm', color: COLORS.gyroMag, values: gyroMagNorm},
              ]}
            />
          </TabsTabPanel>
        </TabsTabPanels>
      </Tabs>

      <View style={styles.timelineBar}>
        <View style={styles.timelineTrack}>
          <View style={styles.timelineGlow} />
        </View>
        <View style={styles.timelineLabels}>
          <Text style={styles.tlab}>{tMin} ms</Text>
          <Text style={styles.tlabMuted}>window time →</Text>
          <Text style={styles.tlab}>{tMax} ms</Text>
        </View>
      </View>

      <Text style={styles.footer}>
        Recording #{windowId} · {samples.length} samples · Δt{' '}
        {tMax - tMin} ms (chart max {MAX_POINTS} pts)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    gap: 14,
  },
  timelineBar: {
    marginTop: 10,
    marginBottom: 2,
  },
  timelineTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(30,41,59,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(34,211,238,0.35)',
    overflow: 'hidden',
  },
  timelineGlow: {
    flex: 1,
    backgroundColor: 'rgba(0,245,255,0.35)',
    shadowColor: '#00f5ff',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  timelineLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  tlab: {
    color: '#67e8f9',
    fontSize: 10,
    fontFamily: 'Menlo',
    fontWeight: '700',
  },
  tlabMuted: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'Menlo',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  panel: {
    gap: 6,
  },
  panelTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  panelSubtitle: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'Menlo',
    lineHeight: 14,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 10,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'Menlo',
    fontWeight: '600',
  },
  rangeText: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'Menlo',
  },
  footer: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'Menlo',
  },
  empty: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 12,
  },
});
