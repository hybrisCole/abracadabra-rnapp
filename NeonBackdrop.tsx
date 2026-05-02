/**
 * Skia neon blobs: phase 0→1 from rAF (no Reanimated).
 *
 * @format
 */

import React, {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {StyleSheet, useWindowDimensions} from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Rect,
  useCanvasRef,
  vec,
} from '@shopify/react-native-skia';
import {Box} from '@gluestack-ui/themed';

export type NeonBackdropVariant = 'idle' | 'scanning' | 'found' | 'not-found';

const TAU = Math.PI * 2;

/**
 * Full loop duration — calm lava speed (motion uses integer harmonics so loop is seamless).
 */
const LOOP_MS = 14_000;

/** Target ~50 fps updates — enough smoothness without hammering reconciliation. */
const MIN_FRAME_MS = 1000 / 50;

/** Design reference (original fixed canvas). */
const DW = 440;
const DH = 900;

/**
 * Lava drift using only sin(p·k + φ) with integer k and p = progress01·2π.
 * Then sin(2πk + φ) = sin(φ): end pose matches start — no visible restart.
 */
function blobLayout(progress01: number, W: number, H: number) {
  const scale = Math.min(W, H);
  const p = progress01 * TAU;

  const b1Cx =
    (86 / DW) * W +
    scale * 0.09 * Math.sin(p * 1 + 0.55) +
    scale * 0.046 * Math.sin(p * 2 + 2.1) +
    scale * 0.024 * Math.sin(p * 3 + 1.05);
  const b1Cy =
    (120 / DH) * H +
    scale * 0.11 * Math.sin(p * 1 + 0.2) +
    scale * 0.056 * Math.sin(p * 2 + 4.2) +
    scale * 0.028 * Math.sin(p * 4 + 2.33);
  const b1R =
    (124 / DW) * W +
    scale * 0.035 * Math.sin(p * 1 + 1.1) +
    scale * 0.018 * Math.sin(p * 3 + 0.61);

  const b2Cx =
    (334 / DW) * W +
    scale * 0.082 * Math.sin(p * 1 + 3.7) +
    scale * 0.048 * Math.sin(p * 2 + 0.9) +
    scale * 0.026 * Math.sin(p * 5 + 1.77);
  const b2Cy =
    (214 / DH) * H +
    scale * 0.11 * Math.sin(p * 1 + 2.4) +
    scale * 0.054 * Math.sin(p * 3 + 5.1) +
    scale * 0.03 * Math.sin(p * 2 + 0.95);
  const b2R =
    (148 / DW) * W +
    scale * 0.038 * Math.sin(p * 2 + 2.8) +
    scale * 0.022 * Math.sin(p * 4 + 1.12);

  const b3Cx =
    (220 / DW) * W +
    scale * 0.072 * Math.sin(p * 1 + 1.8) +
    scale * 0.056 * Math.sin(p * 2 + 3.3) +
    scale * 0.032 * Math.sin(p * 3 + 5.01);
  const b3Cy =
    (640 / DH) * H +
    scale * 0.088 * Math.sin(p * 1 + 5.5) +
    scale * 0.062 * Math.sin(p * 2 + 0.4) +
    scale * 0.034 * Math.sin(p * 4 + 2.88);
  const b3R =
    (180 / DW) * W +
    scale * 0.04 * Math.sin(p * 1 + 4.4) +
    scale * 0.024 * Math.sin(p * 3 + 0.73);

  return {
    b1: {cx: b1Cx, cy: b1Cy, r: b1R},
    b2: {cx: b2Cx, cy: b2Cy, r: b2R},
    b3: {cx: b3Cx, cy: b3Cy, r: b3R},
  };
}

export function NeonBackdrop({
  variant,
}: {
  variant: NeonBackdropVariant;
}): React.JSX.Element {
  const {width: W, height: H} = useWindowDimensions();
  const accent = variant === 'not-found' ? '#ff3864' : '#00f5ff';
  const secondary = variant === 'found' ? '#d946ef' : '#7c3aed';

  const canvasRef = useCanvasRef();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let raf = 0;
    const t0 = Date.now();
    let lastEmit = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = Date.now();
      if (now - lastEmit < MIN_FRAME_MS) {
        return;
      }
      lastEmit = now;
      const p = ((now - t0) % LOOP_MS) / LOOP_MS;
      setPhase(p);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const blobs = useMemo(() => blobLayout(phase, W, H), [phase, W, H]);

  /* Ensure native Skia view repaints when JS-driven props change (no Reanimated frame hook). */
  useLayoutEffect(() => {
    canvasRef.current?.redraw();
  }, [blobs, canvasRef]);

  return (
    <Box pointerEvents="none" position="absolute" top={0} right={0} bottom={0} left={0}>
      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={W} height={H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(W * 0.96, H)}
            colors={['#030712', '#09051f', '#020617']}
          />
        </Rect>
        <Group opacity={0.65}>
          <Circle cx={blobs.b1.cx} cy={blobs.b1.cy} r={blobs.b1.r} color={secondary}>
            <BlurMask blur={42} style="normal" />
          </Circle>
          <Circle cx={blobs.b2.cx} cy={blobs.b2.cy} r={blobs.b2.r} color={accent}>
            <BlurMask blur={54} style="normal" />
          </Circle>
          <Circle cx={blobs.b3.cx} cy={blobs.b3.cy} r={blobs.b3.r} color="#0ea5e9">
            <BlurMask blur={78} style="normal" />
          </Circle>
        </Group>
      </Canvas>
      <Box
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        left={0}
        style={styles.gridOverlay}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  gridOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.16,
    backgroundColor: 'transparent',
    borderColor: '#00f5ff',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
