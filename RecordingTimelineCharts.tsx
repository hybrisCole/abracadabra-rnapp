/**
 * Timeline strip + multi-series SVG charts for IMU recording (accel, gyro, ‖a‖).
 */

import React, {useMemo} from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {Line, Polyline, Rect} from 'react-native-svg';

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
  grid: 'rgba(148, 163, 184, 0.22)',
  axis: 'rgba(148, 163, 184, 0.45)',
} as const;

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
  series: {label: string; color: string; values: number[]}[];
};

function ChartPanel({title, series}: PanelProps): React.JSX.Element {
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
    };
  }, [samples]);

  if (!prepared) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No samples in this recording.</Text>
      </View>
    );
  }

  const {tMin, tMax, ax, ay, az, gx, gy, gz, mag} = prepared;

  return (
    <View style={styles.wrap}>
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

      <ChartPanel
        title="Accelerometer (raw)"
        series={[
          {label: 'ax', color: COLORS.ax, values: ax},
          {label: 'ay', color: COLORS.ay, values: ay},
          {label: 'az', color: COLORS.az, values: az},
        ]}
      />
      <ChartPanel
        title="Gyroscope (raw)"
        series={[
          {label: 'gx', color: COLORS.gx, values: gx},
          {label: 'gy', color: COLORS.gy, values: gy},
          {label: 'gz', color: COLORS.gz, values: gz},
        ]}
      />
      <ChartPanel
        title="Acceleration magnitude"
        series={[{label: '‖a‖', color: COLORS.mag, values: mag}]}
      />

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
    marginBottom: 4,
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
