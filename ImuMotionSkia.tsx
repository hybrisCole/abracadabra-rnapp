/**
 * Skia visualization: pseudo-motion trail from accel XY + energy ribbon from |a|.
 */

import React, {useMemo} from 'react';
import {Dimensions, StyleSheet, Text, View} from 'react-native';
import {
  BlurMask,
  Canvas,
  Path,
  Skia,
} from '@shopify/react-native-skia';
import type {ImuSample} from './bleRecordingProtocol';

const W = Math.min(Dimensions.get('window').width - 80, 340);
const H = 200;
const RIBBON_TOP = H * 0.72;
const RIBBON_H = H * 0.22;

function magnitudeSq(s: ImuSample): number {
  const {ax, ay, az} = s;
  return ax * ax + ay * ay + az * az;
}

function buildTrailAndRibbon(samples: ImuSample[]): {
  trail: ReturnType<typeof Skia.Path.Make>;
  ribbon: ReturnType<typeof Skia.Path.Make>;
  energyPeak: number;
} {
  const trail = Skia.Path.Make();
  const ribbon = Skia.Path.Make();

  if (samples.length === 0) {
    return {trail, ribbon, energyPeak: 0};
  }

  const k = 0.018;
  let x = 0;
  let y = 0;
  const pts: {x: number; y: number}[] = [];
  pts.push({x: 0, y: 0});
  for (const s of samples) {
    x += s.ax * k;
    y += s.ay * k;
    const clamp = 140;
    x = Math.max(-clamp, Math.min(clamp, x));
    y = Math.max(-clamp, Math.min(clamp, y));
    pts.push({x, y});
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 16;
  const bw = Math.max(maxX - minX, 8);
  const bh = Math.max(maxY - minY, 8);
  const sx = (W - pad * 2) / bw;
  const sy = (H * 0.62 - pad * 2) / bh;
  const scale = Math.min(sx, sy);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = W / 2 - cx * scale;
  const oy = H * 0.38 - cy * scale;

  trail.moveTo(pts[0].x * scale + ox, pts[0].y * scale + oy);
  for (let i = 1; i < pts.length; i++) {
    trail.lineTo(pts[i].x * scale + ox, pts[i].y * scale + oy);
  }

  let peak = 0;
  const padX = 16;
  const step = Math.max(1, Math.floor(samples.length / 120));
  ribbon.moveTo(padX, RIBBON_TOP + RIBBON_H);
  for (let i = 0; i < samples.length; i += step) {
    const e = Math.sqrt(magnitudeSq(samples[i]));
    peak = Math.max(peak, e);
    const nx =
      padX +
      (i / Math.max(samples.length - 1, 1)) * (W - padX * 2);
    const nh = Math.min(RIBBON_H, e * 0.035);
    ribbon.lineTo(nx, RIBBON_TOP + RIBBON_H - nh);
  }
  ribbon.lineTo(W - padX, RIBBON_TOP + RIBBON_H);
  ribbon.close();

  return {trail, ribbon, energyPeak: peak};
}

export function ImuMotionSkia({
  samples,
  windowId,
}: {
  samples: ImuSample[];
  windowId: number;
}): React.JSX.Element {
  const {trail, ribbon, energyPeak} = useMemo(
    () => buildTrailAndRibbon(samples),
    [samples],
  );

  return (
    <View style={styles.wrap}>
      <Canvas style={styles.canvas}>
        <Path path={ribbon} style="fill" color="rgba(217,70,239,0.42)">
          <BlurMask blur={8} style="solid" />
        </Path>
        <Path
          path={trail}
          style="stroke"
          strokeWidth={2.5}
          strokeJoin="round"
          strokeCap="round"
          color="#00f5ff">
          <BlurMask blur={5} style="normal" />
        </Path>
      </Canvas>
      <View style={styles.metrics}>
        <Text style={styles.metricsText}>
          window #{windowId} · {samples.length} samples · peak ‖a‖≈{' '}
          {energyPeak.toFixed(0)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(124, 255, 212, 0.35)',
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  canvas: {
    width: W,
    height: H,
  },
  metrics: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.25)',
  },
  metricsText: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'Menlo',
    fontWeight: '600',
  },
});
