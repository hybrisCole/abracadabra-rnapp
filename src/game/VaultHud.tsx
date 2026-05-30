import React, {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {StyleSheet, useWindowDimensions} from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  useCanvasRef,
  vec,
} from '@shopify/react-native-skia';
import {Box, Text, VStack} from '@gluestack-ui/themed';

import type {VaultStatus} from '../store/selectors';

const TAU = Math.PI * 2;
const DEFAULT_TARGET_FPS = 40;

type HudTheme = {core: string; ring: string; glow: string; spin: number; pulse: number};

const THEME: Record<VaultStatus, HudTheme> = {
  disconnected: {core: '#94a3b8', ring: '#64748b', glow: '#334155', spin: 0.05, pulse: 0.3},
  connecting: {core: '#67e8f9', ring: '#22d3ee', glow: '#0891b2', spin: 0.4, pulse: 0.7},
  retry: {core: '#fde047', ring: '#fbbf24', glow: '#ca8a04', spin: 0.4, pulse: 0.8},
  connected: {core: '#6ee7b7', ring: '#34d399', glow: '#059669', spin: 0.15, pulse: 0.5},
  linked: {core: '#99f6e4', ring: '#5eead4', glow: '#14b8a6', spin: 0.12, pulse: 0.45},
  recording: {core: '#f0abfc', ring: '#e879f9', glow: '#a21caf', spin: 0.9, pulse: 1},
  processing: {core: '#7dd3fc', ring: '#38bdf8', glow: '#0284c7', spin: 1.1, pulse: 0.9},
  analyzing: {core: '#c4b5fd', ring: '#8b5cf6', glow: '#6d28d9', spin: 1.4, pulse: 1},
  unlocked: {core: '#86efac', ring: '#22c55e', glow: '#16a34a', spin: 0.25, pulse: 0.6},
  denied: {core: '#fda4af', ring: '#ff3864', glow: '#9f1239', spin: 0.6, pulse: 1},
};

const LABEL: Record<VaultStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  linked: 'Ready',
  recording: 'Recording',
  processing: 'Processing',
  retry: 'Reconnecting',
  analyzing: 'Reading gesture',
  unlocked: 'Unlocked',
  denied: 'Denied',
};

/**
 * Skia reactor core for the Vault game screen. Color, spin, and pulse react to
 * the live VaultStatus. Self-animates via requestAnimationFrame (matches the
 * NeonBackdrop approach — no Reanimated dependency).
 */
export function VaultHud({
  status,
  message,
  active = true,
  targetFps = DEFAULT_TARGET_FPS,
}: {
  status: VaultStatus;
  message?: string | null;
  /** When false, freeze animation (tab not focused). */
  active?: boolean;
  targetFps?: number;
}): React.JSX.Element {
  const {width} = useWindowDimensions();
  const size = Math.min(width * 0.82, 360);
  const cx = size / 2;
  const cy = size / 2;
  const theme = THEME[status];

  const canvasRef = useCanvasRef();
  const [phase, setPhase] = useState(0);
  const minFrameMs = 1000 / Math.max(1, targetFps);

  useEffect(() => {
    if (!active) {
      return;
    }
    let raf = 0;
    const t0 = Date.now();
    let lastEmit = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      if (now - lastEmit < minFrameMs) {
        return;
      }
      lastEmit = now;
      setPhase((now - t0) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, minFrameMs]);

  const frame = useMemo(() => {
    const pulse = (Math.sin(phase * TAU * theme.pulse) + 1) / 2; // 0..1
    const rotation = (phase * theme.spin) % 1;
    const coreR = size * 0.16 * (0.92 + pulse * 0.16);
    const glowR = size * 0.34 * (0.9 + pulse * 0.18);
    const ringR = size * 0.36;
    const innerRingR = size * 0.27;
    return {pulse, rotation, coreR, glowR, ringR, innerRingR};
  }, [phase, size, theme.pulse, theme.spin]);

  useLayoutEffect(() => {
    canvasRef.current?.redraw();
  }, [frame, canvasRef, theme, status, active]);

  return (
    <VStack alignItems="center" justifyContent="center">
      <Box width={size} height={size}>
        <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
          {/* outer glow */}
          <Circle cx={cx} cy={cy} r={frame.glowR} color={theme.glow} opacity={0.45}>
            <BlurMask blur={36} style="normal" />
          </Circle>
          {/* rotating outer ring */}
          <Group
            origin={vec(cx, cy)}
            transform={[{rotate: frame.rotation * TAU}]}>
            <Circle
              cx={cx}
              cy={cy}
              r={frame.ringR}
              color={theme.ring}
              style="stroke"
              strokeWidth={2.5}
              opacity={0.8}
            />
            <Circle cx={cx} cy={cy - frame.ringR} r={4} color={theme.core} />
          </Group>
          {/* counter-rotating inner ring */}
          <Group
            origin={vec(cx, cy)}
            transform={[{rotate: -frame.rotation * TAU * 1.6}]}>
            <Circle
              cx={cx}
              cy={cy}
              r={frame.innerRingR}
              color={theme.ring}
              style="stroke"
              strokeWidth={1.5}
              opacity={0.5}
            />
          </Group>
          {/* core */}
          <Circle cx={cx} cy={cy} r={frame.coreR} color={theme.core}>
            <BlurMask blur={14} style="solid" />
          </Circle>
        </Canvas>

        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          left={0}
          alignItems="center"
          justifyContent="center">
          <Text
            color="#e0f2fe"
            fontWeight="$extrabold"
            fontSize="$lg"
            letterSpacing="$xl"
            textTransform="uppercase"
            textAlign="center">
            {LABEL[status]}
          </Text>
        </Box>
      </Box>

      {message != null ? (
        <Text
          mt="$4"
          color="#94a3b8"
          fontFamily="Menlo"
          fontSize="$sm"
          textAlign="center"
          px="$6">
          {message}
        </Text>
      ) : null}
    </VStack>
  );
}
