/**
 * Cyberpunk BLE scanner UI — react-native-ble-plx + Skia
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Platform,
  StatusBar,
  StyleSheet,
  Vibration,
} from 'react-native';
import type {Device, Subscription} from 'react-native-ble-plx';
import {BleManager, State} from 'react-native-ble-plx';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Alert,
  AlertText,
  Badge,
  BadgeText,
  Box,
  Button,
  ButtonText,
  Divider,
  GluestackUIProvider,
  Heading,
  HStack,
  ScrollView,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import {config} from '@gluestack-ui/config';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';

import {
  ABRACADABRA_SERVICE_UUID,
  ABRACADABRA_STREAM_CHAR_UUID,
  finalizeRecordingFromPull,
  pullPackedPayloadFromPeripheral,
  RecordingAssembler,
  type DecodedRecording,
} from './bleRecordingProtocol';
import {RecordingTimelineCharts} from './RecordingTimelineCharts';

const TARGET_BLE_NAME = 'XA_Abracadabra';
const SCAN_DURATION_MS = 5000;

/** Wait before retrying BLE connect after an unexpected peripheral disconnect. */
const LINK_LOST_RETRY_DELAY_MS = 1800;
/** After this many disconnect-driven retries without staying linked, show Link Lost. */
const MAX_AUTO_RECONNECT_ROUNDS = 15;

/**
 * iOS: MultiplatformBleAdapter sets `name` from CBPeripheral.name (often "Arduino"
 * for mbed) and `localName` from advertisement CBAdvertisementDataLocalNameKey.
 * Prefer advertisement — merge across duplicate scan callbacks.
 */
type DeviceRow = {
  id: string;
  name: string | null;
  advLocalName: string | null;
  peripheralName: string | null;
  rssi: number | null;
};

type ScanOutcome = 'idle' | 'scanning' | 'found' | 'not-found';

type ConnPhase = 'off' | 'connecting' | 'linked' | 'error';

type OrbTone = 'seek' | 'linked' | 'warn' | 'stream';

function base64ToBytes(b64: string): Uint8Array {
  const atobFn = (globalThis as unknown as {atob: (s: string) => string}).atob;
  const binary = atobFn(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const formatRssi = (rssi: number | null) => (rssi == null ? '—' : `${rssi} dBm`);

const isTargetName = (name: string | null | undefined) => name === TARGET_BLE_NAME;

const isTargetDevice = (device: {
  localName?: string | null;
  name?: string | null;
}) => isTargetName(device.localName) || isTargetName(device.name);

function NeonBackdrop({variant}: {variant: ScanOutcome}): React.JSX.Element {
  const accent = variant === 'not-found' ? '#ff3864' : '#00f5ff';
  const secondary = variant === 'found' ? '#d946ef' : '#7c3aed';

  return (
    <Box pointerEvents="none" position="absolute" top={0} right={0} bottom={0} left={0}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={440} height={900}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(420, 900)}
            colors={['#030712', '#09051f', '#020617']}
          />
        </Rect>
        <Group opacity={0.65}>
          <Circle cx={86} cy={120} r={124} color={secondary}>
            <BlurMask blur={42} style="normal" />
          </Circle>
          <Circle cx={334} cy={214} r={148} color={accent}>
            <BlurMask blur={54} style="normal" />
          </Circle>
          <Circle cx={220} cy={640} r={180} color="#0ea5e9">
            <BlurMask blur={78} style="normal" />
          </Circle>
        </Group>
      </Canvas>
      <Box position="absolute" top={0} right={0} bottom={0} left={0} style={styles.gridOverlay} />
    </Box>
  );
}

function CyberOrb({
  pulse,
  resultAnim,
  glyph,
  tone,
  compact = false,
}: {
  pulse: Animated.Value;
  resultAnim: Animated.Value;
  glyph: string;
  tone: OrbTone;
  compact?: boolean;
}): React.JSX.Element {
  const isMissing = tone === 'warn';
  const isLinkedLike = tone === 'linked' || tone === 'stream';
  const glowColor =
    tone === 'warn'
      ? '#ff3864'
      : tone === 'stream'
        ? '#f0abfc'
        : isLinkedLike
          ? '#7cffd4'
          : '#00f5ff';
  const orbitColor = isMissing ? '#ff7a90' : '#d946ef';
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: compact ? [0.94, 1.06] : [0.94, 1.08],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48, 1],
  });
  const resultScale = resultAnim.interpolate({
    inputRange: [0, 1],
    outputRange: compact ? [0.85, 1] : [0.82, 1],
  });

  const cx = compact ? 68 : 108;
  const rGlowOuter = compact ? 58 : 92;
  const rGlowMid = compact ? 43 : 68;
  const rGlowInner = compact ? 21 : 34;
  const rDot = 6;
  const rStrokeInner = compact ? 36 : 58;

  return (
    <Box
      alignItems="center"
      justifyContent="center"
      height={compact ? 148 : 230}
      mb={compact ? -4 : undefined}>
      <Animated.View
        style={[
          compact ? styles.orbPulseCompact : styles.orbPulse,
          {
            borderColor: glowColor,
            shadowColor: glowColor,
            opacity,
            transform: [{scale}],
          },
        ]}
      />
      <Canvas style={compact ? styles.orbCanvasCompact : styles.orbCanvas}>
        <Circle cx={cx} cy={cx} r={rGlowOuter} color="rgba(0,245,255,0.10)" />
        <Circle cx={cx} cy={cx} r={rGlowMid} color="rgba(217,70,239,0.12)" />
        <Circle cx={cx} cy={cx} r={rGlowInner} color={glowColor}>
          <BlurMask blur={compact ? 12 : 18} style="normal" />
        </Circle>
        <Circle cx={cx} cy={cx} r={rDot} color="#f8fafc" />
        <Circle cx={cx} cy={cx} r={rGlowOuter} color="transparent" style="stroke" strokeWidth={2} />
        <Circle cx={cx} cy={cx} r={rStrokeInner} color={orbitColor} style="stroke" strokeWidth={1.5} />
      </Canvas>
      <Animated.Text
        style={[
          compact ? styles.orbGlyphCompact : styles.orbGlyph,
          isMissing && styles.orbGlyphWarning,
          (isLinkedLike || isMissing) && {
            opacity: resultAnim,
            transform: [{scale: resultScale}],
          },
        ]}>
        {glyph}
      </Animated.Text>
    </Box>
  );
}

function AbracadabraScreen(): React.JSX.Element {
  const managerRef = useRef<BleManager | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const resultAnim = useRef(new Animated.Value(0)).current;
  const feedbackOutcomeRef = useRef<ScanOutcome>('idle');

  const assemblerRef = useRef(new RecordingAssembler());
  const pullInFlightRef = useRef(false);
  const bleMonitorSubRef = useRef<Subscription | null>(null);
  const connectedDevRef = useRef<Device | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoReconnectRoundRef = useRef(0);

  const [linkSession, setLinkSession] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const [connPhase, setConnPhase] = useState<ConnPhase>('off');
  const [recvProgress, setRecvProgress] = useState<{
    filled: number;
    total: number;
  } | null>(null);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<DecodedRecording | null>(
    null,
  );

  const [targetDevice, setTargetDevice] = useState<DeviceRow | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bleState, setBleState] = useState<State>(State.Unknown);
  const [hasScanned, setHasScanned] = useState(false);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    const mgr = new BleManager();
    managerRef.current = mgr;

    const sub = mgr.onStateChange(state => {
      setBleState(state);
      if (__DEV__) {
        console.log('[BLE]', state);
      }
    }, true);

    return () => {
      sub.remove();
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      mgr.stopDeviceScan().catch(() => {});
      mgr.destroy();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1250,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1250,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const finishScan = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    const mgr = managerRef.current;
    if (mgr) {
      mgr.stopDeviceScan().catch(() => {});
    }
    setScanning(false);
    setHasScanned(true);
  }, []);

  const startScan = useCallback(() => {
    const mgr = managerRef.current;
    if (!mgr || scanning) {
      return;
    }

    setTargetDevice(null);
    setHasScanned(false);
    setConnPhase('off');
    setRecvProgress(null);
    setTransferNote(null);
    setLastRecording(null);
    assemblerRef.current.reset('scan again');
    autoReconnectRoundRef.current = 0;
    setReconnectAttempt(0);
    setLinkSession(0);
    if (reconnectTimerRef.current != null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setScanning(true);

    mgr.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error(error.message);
        return;
      }
      if (!device) {
        return;
      }
      if (!isTargetDevice(device)) {
        return;
      }
      setTargetDevice(prev => {
        const prior = prev?.id === device.id ? prev : null;
        const advLocalName =
          device.localName ?? prior?.advLocalName ?? null;
        const peripheralName =
          device.name ?? prior?.peripheralName ?? null;
        const name = advLocalName ?? peripheralName;
        return {
          id: device.id,
          advLocalName,
          peripheralName,
          name,
          rssi: device.rssi ?? prior?.rssi ?? null,
        };
      });
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      mgr.stopDeviceScan().catch(() => {});
      setScanning(false);
      setHasScanned(true);
    });

    scanTimerRef.current = setTimeout(() => {
      scanTimerRef.current = null;
      if (mgr) {
        mgr.stopDeviceScan().catch(() => {});
      }
      setScanning(false);
      setHasScanned(true);
    }, SCAN_DURATION_MS);
  }, [scanning]);

  useEffect(() => {
    if (!targetDevice || bleState !== State.PoweredOn) {
      if (reconnectTimerRef.current != null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnPhase('off');
      setRecvProgress(null);
      return () => {};
    }

    const mgr = managerRef.current;
    if (!mgr) {
      return () => {};
    }

    let cancelled = false;
    const assemblerForCleanup = assemblerRef.current;
    assemblerRef.current.reset();
    setConnPhase('connecting');
    setTransferNote(null);

    let monitorSub: Subscription | null = null;
    let disconnectSub: Subscription | null = null;

    // eslint-disable-next-line no-void -- async connect; cancellation via `cancelled`
    void (async () => {
      try {
        const dev = await mgr.connectToDevice(targetDevice.id, {
          timeout: 12000,
        });
        if (cancelled) {
          await dev.cancelConnection();
          return;
        }

        connectedDevRef.current = dev;

        if (Platform.OS === 'android') {
          try {
            await dev.requestMTU(247);
          } catch {
            /* MTU optional */
          }
        }

        await dev.discoverAllServicesAndCharacteristics();

        disconnectSub = dev.onDisconnected(() => {
          pullInFlightRef.current = false;
          assemblerRef.current.reset('Disconnected');
          connectedDevRef.current = null;
          bleMonitorSubRef.current?.remove();
          bleMonitorSubRef.current = null;
          setRecvProgress(null);

          disconnectSub?.remove();

          const nextRound = autoReconnectRoundRef.current + 1;
          if (nextRound > MAX_AUTO_RECONNECT_ROUNDS) {
            setConnPhase('error');
            return;
          }
          autoReconnectRoundRef.current = nextRound;
          setReconnectAttempt(nextRound);
          setConnPhase('connecting');

          if (reconnectTimerRef.current != null) {
            clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            setLinkSession(s => s + 1);
          }, LINK_LOST_RETRY_DELAY_MS);
        });

        monitorSub = dev.monitorCharacteristicForService(
          ABRACADABRA_SERVICE_UUID,
          ABRACADABRA_STREAM_CHAR_UUID,
          (error, characteristic) => {
            if (cancelled) {
              return;
            }
            if (error != null) {
              if (__DEV__) {
                console.warn('[BLE notify]', error.message);
              }
              return;
            }
            if (!characteristic?.value) {
              return;
            }
            const bytes = base64ToBytes(characteristic.value);
            const result = assemblerRef.current.feed(bytes);
            if (result.kind === 'pull_pending') {
              if (pullInFlightRef.current) {
                return;
              }
              const linkedDev = connectedDevRef.current;
              if (!linkedDev) {
                setTransferNote('Not connected');
                return;
              }
              pullInFlightRef.current = true;
              setRecvProgress({filled: 0, total: result.totalBytes});
              pullPackedPayloadFromPeripheral(
                linkedDev,
                result.totalBytes,
                (filled, total) => setRecvProgress({filled, total}),
              )
                .then(payload =>
                  finalizeRecordingFromPull(
                    result.windowId,
                    result.samples,
                    result.crcExpected,
                    payload,
                  ),
                )
                .then(fin => {
                  setRecvProgress(null);
                  if ('error' in fin) {
                    setTransferNote(fin.error);
                  } else {
                    setLastRecording(fin);
                    setTransferNote(null);
                    Vibration.vibrate([0, 30, 50, 90, 40, 120]);
                  }
                })
                .catch(e => {
                  setRecvProgress(null);
                  const msg = e instanceof Error ? e.message : String(e);
                  setTransferNote(msg);
                  if (__DEV__) {
                    console.warn('[BLE pull]', e);
                  }
                })
                .finally(() => {
                  pullInFlightRef.current = false;
                });
            } else if (result.kind === 'error') {
              setRecvProgress(null);
              setTransferNote(result.message);
              assemblerRef.current.reset();
            }
          },
        );

        bleMonitorSubRef.current = monitorSub;

        if (!cancelled) {
          autoReconnectRoundRef.current = 0;
          setReconnectAttempt(0);
          setConnPhase('linked');
        }
      } catch (e) {
        if (!cancelled && __DEV__) {
          console.warn('[BLE connect]', e);
        }
        if (!cancelled) {
          setConnPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current != null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      monitorSub?.remove();
      disconnectSub?.remove();
      bleMonitorSubRef.current = null;
      const d = connectedDevRef.current;
      connectedDevRef.current = null;
      assemblerForCleanup.reset('effect cleanup');
      if (d != null) {
        d.cancelConnection().catch(() => {});
      }
      setRecvProgress(null);
      setConnPhase('off');
    };
    // Re-run session only when peripheral id / radio / link generation changes (not DeviceRow churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDevice?.id, bleState, linkSession]);

  useEffect(() => {
    if (
      bleState === State.PoweredOn &&
      !scanning &&
      !hasScanned &&
      !targetDevice
    ) {
      startScan();
    }
  }, [bleState, hasScanned, scanning, startScan, targetDevice]);

  const scanOutcome: ScanOutcome = targetDevice
    ? 'found'
    : scanning
      ? 'scanning'
      : hasScanned
        ? 'not-found'
        : 'idle';

  useEffect(() => {
    resultAnim.setValue(0);
    const pulseBurst =
      scanOutcome === 'found' ||
      scanOutcome === 'not-found' ||
      lastRecording != null;
    if (pulseBurst) {
      Animated.spring(resultAnim, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }).start();
    }
  }, [resultAnim, scanOutcome, lastRecording]);

  useEffect(() => {
    if (feedbackOutcomeRef.current === scanOutcome) {
      return;
    }
    feedbackOutcomeRef.current = scanOutcome;

    if (scanOutcome === 'found') {
      Vibration.vibrate([0, 90, 50, 180]);
    } else if (scanOutcome === 'not-found') {
      Vibration.vibrate([0, 60, 90, 60]);
    }
  }, [scanOutcome]);

  let orbGlyph = 'FINDING';
  let orbTone: OrbTone = 'seek';
  if (scanOutcome === 'not-found') {
    orbGlyph = 'NO SIGNAL';
    orbTone = 'warn';
  } else if (scanOutcome === 'scanning') {
    orbGlyph = 'FINDING';
    orbTone = 'seek';
  } else if (targetDevice) {
    if (connPhase === 'connecting') {
      orbGlyph = 'PAIRING';
      orbTone = 'seek';
    } else if (connPhase === 'error') {
      orbGlyph = 'LINK DOWN';
      orbTone = 'warn';
    } else if (recvProgress != null) {
      orbGlyph = 'STREAM';
      orbTone = 'stream';
    } else if (connPhase === 'linked') {
      orbGlyph = 'LINKED';
      orbTone = 'linked';
    } else {
      orbGlyph = 'PAIRING';
      orbTone = 'seek';
    }
  }

  const recvPct =
    recvProgress != null && recvProgress.total > 0
      ? Math.round((100 * recvProgress.filled) / recvProgress.total)
      : null;

  const compactListeningHero =
    targetDevice != null &&
    connPhase === 'linked' &&
    recvProgress == null &&
    scanOutcome === 'found';

  const burstLabel =
    scanOutcome === 'not-found'
      ? 'Missing-device alert sent'
      : lastRecording != null
        ? `Recording #${lastRecording.windowId} verified`
        : recvProgress != null && recvPct != null
          ? `Receiving capture · ${recvPct}%`
          : connPhase === 'linked'
            ? 'GATT linked · awaiting double-tap recording'
          : connPhase === 'connecting'
            ? reconnectAttempt > 0
              ? `Reconnecting (${reconnectAttempt}/${MAX_AUTO_RECONNECT_ROUNDS})…`
              : 'Negotiating BLE session…'
              : connPhase === 'error'
                ? 'Session lost — scan again'
                : scanOutcome === 'found'
                  ? 'Wearable discovered'
                  : '';

  const titleMain =
    scanOutcome === 'not-found'
      ? 'Wearable Not Present'
      : scanOutcome === 'scanning'
        ? 'Finding Device'
        : !targetDevice && bleState === State.PoweredOn
          ? 'Preparing Scanner'
          : !targetDevice
            ? 'Bluetooth Not Ready'
            : connPhase === 'error'
              ? 'Link Lost'
              : recvProgress != null
                ? 'Receiving Recording'
                : connPhase === 'linked'
                  ? 'Linked · Listening'
                  : connPhase === 'connecting'
                    ? reconnectAttempt > 0
                      ? 'Reconnecting…'
                      : 'Connecting…'
                    : 'Wearable Found';

  const bodyMain =
    scanOutcome === 'not-found'
      ? 'No controller signature appeared in 5 seconds. Check the troubleshooting steps below, then retry.'
      : scanOutcome === 'scanning'
        ? 'Searching for the wearable automatically. Keep the phone nearby while the scanner listens for BLE advertisements.'
        : !targetDevice && bleState === State.PoweredOn
          ? 'Warming up the scanner and preparing to search for the wearable.'
          : !targetDevice
            ? 'Turn on Bluetooth permission/radio so the scanner can start.'
            : connPhase === 'error'
              ? 'The BLE session ended and automatic reconnect gave up after too many tries, or connect failed. Tap Scan Again. Incomplete transfers are discarded.'
              : recvProgress != null && recvPct != null
                ? `Binary framing validated live (${recvProgress.filled} / ${recvProgress.total} bytes). CRC will commit at end of transfer.`
                : connPhase === 'linked'
                  ? `${TARGET_BLE_NAME} is paired at ${formatRssi(targetDevice.rssi)}. Perform the accepted double-tap gesture; when capture completes, the phone pulls the recording over GATT (META notify + read slices).`
                  : connPhase === 'connecting'
                    ? reconnectAttempt > 0
                      ? `Link dropped — retrying automatically (${reconnectAttempt} of ${MAX_AUTO_RECONNECT_ROUNDS}). Stay near the wearable.`
                      : 'Discovering ADAB services and subscribing to the NOTIFY stream characteristic.'
                    : `${TARGET_BLE_NAME} visible at ${formatRssi(targetDevice.rssi)} — preparing secure link.`;

  return (
    <Box
      flex={1}
      bg="#020617"
      pt={insets.top}
      pl={insets.left}
      pr={insets.right}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <NeonBackdrop variant={scanOutcome} />
      <ScrollView
        flex={1}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>
        <VStack space="sm" px="$5" pt="$4" pb="$10">
          <VStack space="xs" mb="$3">
            <Text
              fontSize="$xs"
              fontWeight="$extrabold"
              letterSpacing="$xl"
              color="#67e8f9"
              textTransform="uppercase">
              Abracadabra link
            </Text>
            <Heading size="xl" color="$coolGray50" letterSpacing="$sm" lineHeight="$2xl">
              Xerces Aurora — Abracadabra
            </Heading>
            <Divider bg="rgba(34,211,238,0.25)" my="$2" />
          </VStack>

          <Box
            borderRadius="$3xl"
            borderWidth={1}
            borderColor="rgba(34,211,238,0.45)"
            bg="rgba(2,6,23,0.88)"
            px={compactListeningHero ? '$3' : '$5'}
            py={compactListeningHero ? '$3' : '$5'}
            sx={{
              shadowColor: '#00f5ff',
              shadowOffset: {width: 0, height: 10},
              shadowOpacity: 0.28,
              shadowRadius: 22,
              elevation: 10,
              _android: {elevation: 8},
            }}>
            <VStack space="md">
              <Box alignSelf="center">
                <CyberOrb
                  pulse={pulse}
                  resultAnim={resultAnim}
                  glyph={orbGlyph}
                  tone={orbTone}
                  compact={compactListeningHero}
                />
              </Box>
              <VStack space="sm">
                <Heading
                  size={compactListeningHero ? 'md' : 'xl'}
                  color="$coolGray50"
                  fontWeight="$extrabold">
                  {titleMain}
                </Heading>
                <Text
                  color="$coolGray300"
                  fontSize={compactListeningHero ? '$sm' : '$md'}
                  lineHeight={compactListeningHero ? '$sm' : '$lg'}>
                  {bodyMain}
                </Text>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.burstBadgeWrap,
                    compactListeningHero && styles.burstBadgeWrapCompact,
                    {
                      opacity: resultAnim,
                      transform: [
                        {
                          scale: resultAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.88, 1],
                          }),
                        },
                      ],
                    },
                  ]}>
                  <Badge
                    size="sm"
                    variant="outline"
                    action={
                      scanOutcome === 'not-found' || connPhase === 'error'
                        ? 'error'
                        : 'success'
                    }
                    borderColor={
                      scanOutcome === 'not-found' || connPhase === 'error'
                        ? 'rgba(253,164,175,0.65)'
                        : 'rgba(124,255,212,0.55)'
                    }
                    bg={
                      scanOutcome === 'not-found' || connPhase === 'error'
                        ? 'rgba(127,29,29,0.25)'
                        : 'rgba(20,184,166,0.14)'
                    }>
                    <BadgeText
                      color={
                        scanOutcome === 'not-found' || connPhase === 'error'
                          ? '#fecdd3'
                          : '#a7f3d0'
                      }
                      fontWeight="$bold"
                      fontSize={compactListeningHero ? 9 : 11}
                      letterSpacing="$md"
                      textTransform="uppercase">
                      {burstLabel}
                    </BadgeText>
                  </Badge>
                </Animated.View>
              </VStack>
            </VStack>
          </Box>

          {transferNote != null ? (
            <Alert
              action="error"
              variant="outline"
              mt="$4"
              borderRadius="$xl"
              borderColor="rgba(255,56,100,0.55)"
              bg="rgba(69,10,10,0.38)">
              <AlertText fontWeight="$bold" color="#fecdd3" textTransform="uppercase" fontSize="$xs">
                Transfer rolled back
              </AlertText>
              <AlertText mt="$2" color="#fda4af" fontFamily="Menlo" fontSize="$sm">
                {transferNote}
              </AlertText>
            </Alert>
          ) : null}

          {lastRecording != null ? (
            <Box
              mt="$4"
              p="$4"
              borderRadius="$2xl"
              borderWidth={1}
              borderColor="rgba(34,211,238,0.38)"
              bg="rgba(2,6,23,0.78)">
              <Heading
                size="sm"
                color="$coolGray50"
                fontWeight="$extrabold"
                letterSpacing="$lg"
                textTransform="uppercase">
                Recording timeline
              </Heading>
              <Text mt="$2" fontSize="$xs" color="$coolGray400" lineHeight="$sm">
                Downsampled curves vs capture order (sorted by MCU timestamp). Raw accelerometer and gyroscope axes plus ‖accel‖.
              </Text>
              <Box mt="$3">
                <RecordingTimelineCharts
                  samples={lastRecording.samples}
                  windowId={lastRecording.windowId}
                />
              </Box>
            </Box>
          ) : null}

          {!scanning && scanOutcome !== 'idle' ? (
            <HStack space="md" mt="$5" alignItems="stretch">
              <Button
                flex={1}
                size="lg"
                borderRadius="$2xl"
                bg="#00f5ff"
                onPress={startScan}
                isDisabled={scanning}
                opacity={scanning ? 0.45 : 1}>
                <ButtonText color="#020617" fontWeight="$extrabold" letterSpacing="$md" fontSize="$md">
                  {scanning ? 'Finding...' : 'Scan again'}
                </ButtonText>
              </Button>
              <Button
                w={100}
                size="lg"
                variant="outline"
                borderRadius="$2xl"
                borderColor="rgba(217,70,239,0.72)"
                bg="rgba(15,23,42,0.85)"
                onPress={finishScan}
                isDisabled={!scanning}
                opacity={!scanning ? 0.45 : 1}>
                <ButtonText color="#f0abfc" fontWeight="$extrabold" letterSpacing="$lg">
                  Stop
                </ButtonText>
              </Button>
            </HStack>
          ) : null}

          {scanOutcome === 'not-found' ? (
            <Box
              mt="$5"
              p="$4"
              borderRadius="$2xl"
              borderWidth={1}
              borderColor="rgba(255,56,100,0.5)"
              bg="rgba(69,10,10,0.34)">
              <Heading
                size="sm"
                color="$coolGray50"
                fontWeight="$extrabold"
                letterSpacing="$lg"
                textTransform="uppercase">
                Troubleshooting
              </Heading>
              <Text mt="$3" color="#fecdd3" fontSize="$sm" fontFamily="Menlo">
                01 · Confirm the XIAO is powered and flashed.
              </Text>
              <Text mt="$2" color="#fecdd3" fontSize="$sm" fontFamily="Menlo">
                02 · Serial should print BLE advertising as "{TARGET_BLE_NAME}".
              </Text>
              <Text mt="$2" color="#fecdd3" fontSize="$sm" fontFamily="Menlo">
                03 · Move the phone closer and avoid covering the antenna.
              </Text>
              <Text mt="$2" color="#fecdd3" fontSize="$sm" fontFamily="Menlo">
                04 · Toggle iPhone Bluetooth if CoreBluetooth cached old data.
              </Text>
            </Box>
          ) : null}
        </VStack>
      </ScrollView>
    </Box>
  );
}

const styles = StyleSheet.create({
  burstBadgeWrap: {
    alignSelf: 'flex-start',
    marginTop: 14,
  },
  burstBadgeWrapCompact: {
    marginTop: 10,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 36,
  },
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
  orbPulse: {
    position: 'absolute',
    width: 198,
    height: 198,
    borderRadius: 99,
    borderWidth: 2,
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 0},
  },
  orbPulseCompact: {
    position: 'absolute',
    width: 126,
    height: 126,
    borderRadius: 63,
    borderWidth: 2,
    shadowOpacity: 0.85,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 0},
  },
  orbCanvas: {
    width: 216,
    height: 216,
  },
  orbCanvasCompact: {
    width: 136,
    height: 136,
  },
  orbGlyph: {
    position: 'absolute',
    bottom: 24,
    color: '#a7f3d0',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  orbGlyphCompact: {
    position: 'absolute',
    bottom: 10,
    color: '#a7f3d0',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  orbGlyphWarning: {
    color: '#fecdd3',
  },
});

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <GluestackUIProvider config={config} colorMode="dark">
        <AbracadabraScreen />
      </GluestackUIProvider>
    </SafeAreaProvider>
  );
}