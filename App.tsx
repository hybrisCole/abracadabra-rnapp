/**
 * Cyberpunk BLE scanner UI — react-native-ble-plx + Skia
 *
 * @format
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {BleLinkStatusBadge, type LinkBadgeStatus} from './BleLinkStatusBadge';
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

function AbracadabraScreen(): React.JSX.Element {
  const managerRef = useRef<BleManager | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
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
  /** Firmware NOTIFY RECORDING_PENDING — onboard capture not finished yet. */
  const [wearableCaptureArming, setWearableCaptureArming] = useState<{
    windowId: number;
  } | null>(null);
  /** After GATT pull completes — CRC verify + unpack samples before timeline mounts. */
  const [processingCapture, setProcessingCapture] = useState(false);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<DecodedRecording | null>(
    null,
  );

  const [targetDevice, setTargetDevice] = useState<DeviceRow | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bleState, setBleState] = useState<State>(State.Unknown);
  const [hasScanned, setHasScanned] = useState(false);

  const [showFreshConnected, setShowFreshConnected] = useState(false);
  const prevConnPhaseForBadgeRef = useRef<ConnPhase>('off');

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
    setWearableCaptureArming(null);
    setProcessingCapture(false);
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
      setWearableCaptureArming(null);
      setProcessingCapture(false);
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
          setWearableCaptureArming(null);
          setProcessingCapture(false);

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
            if (result.kind === 'recording_pending') {
              setWearableCaptureArming({windowId: result.windowId});
              Vibration.vibrate([0, 45]);
              return;
            }
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
              setWearableCaptureArming(null);
              setRecvProgress({filled: 0, total: result.totalBytes});
              pullPackedPayloadFromPeripheral(
                linkedDev,
                result.totalBytes,
                (filled, total) => setRecvProgress({filled, total}),
              )
                .then(payload => {
                  setRecvProgress(null);
                  setProcessingCapture(true);
                  return finalizeRecordingFromPull(
                    result.windowId,
                    result.samples,
                    result.crcExpected,
                    payload,
                  );
                })
                .then(fin => {
                  setProcessingCapture(false);
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
                  setProcessingCapture(false);
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
      setWearableCaptureArming(null);
      setProcessingCapture(false);
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

  const recvPct =
    recvProgress != null && recvProgress.total > 0
      ? Math.round((100 * recvProgress.filled) / recvProgress.total)
      : null;

  useEffect(() => {
    const prev = prevConnPhaseForBadgeRef.current;
    prevConnPhaseForBadgeRef.current = connPhase;
    if (connPhase !== 'linked') {
      setShowFreshConnected(false);
      return;
    }
    if (prev === 'linked') {
      return;
    }
    setShowFreshConnected(true);
    const t = setTimeout(() => setShowFreshConnected(false), 2200);
    return () => clearTimeout(t);
  }, [connPhase]);

  const linkBadgeStatus = useMemo((): LinkBadgeStatus => {
    if (bleState !== State.PoweredOn) {
      return 'disconnected';
    }
    if (scanOutcome === 'not-found' || connPhase === 'error') {
      return 'disconnected';
    }
    if (scanning) {
      return 'connecting';
    }
    if (!targetDevice) {
      return 'disconnected';
    }
    if (connPhase === 'connecting' && reconnectAttempt > 0) {
      return 'retry';
    }
    if (connPhase === 'connecting') {
      return 'connecting';
    }
    if (processingCapture) {
      return 'processing';
    }
    if (recvProgress != null || wearableCaptureArming != null) {
      return 'recording';
    }
    if (connPhase === 'linked') {
      return showFreshConnected ? 'connected' : 'linked';
    }
    return 'disconnected';
  }, [
    bleState,
    scanOutcome,
    scanning,
    targetDevice,
    connPhase,
    reconnectAttempt,
    recvProgress,
    wearableCaptureArming,
    processingCapture,
    showFreshConnected,
  ]);

  const linkDetail = useMemo(() => {
    const title = TARGET_BLE_NAME;
    let description = '';
    if (scanOutcome === 'not-found') {
      description =
        'No controller signature appeared in 5 seconds. Check troubleshooting below, then retry.';
    } else if (scanOutcome === 'scanning') {
      description =
        'Searching for the wearable automatically. Keep the phone nearby while the scanner listens for BLE advertisements.';
    } else if (!targetDevice && bleState === State.PoweredOn) {
      description =
        'Warming up the scanner and preparing to search for the wearable.';
    } else if (!targetDevice) {
      description =
        'Turn on Bluetooth permission/radio so the scanner can start.';
    } else if (connPhase === 'error') {
      description =
        'The BLE session ended and automatic reconnect gave up after too many tries, or connect failed. Tap Scan Again. Incomplete transfers are discarded.';
    } else if (recvProgress != null && recvPct != null) {
      description = `Binary framing validated live (${recvProgress.filled} / ${recvProgress.total} bytes). CRC commits at end of transfer.`;
    } else if (processingCapture && connPhase === 'linked') {
      description =
        'Transfer finished. Verifying the checksum and unpacking samples into the timeline — almost there.';
    } else if (wearableCaptureArming != null && connPhase === 'linked') {
      description = `Gesture accepted — RSSI ${formatRssi(targetDevice.rssi)}. The wearable waits briefly before sampling so tap motion does not dominate the trace. Stay steady until transfer begins.`;
    } else if (connPhase === 'linked') {
      description = `Paired — RSSI ${formatRssi(targetDevice.rssi)}. Perform the accepted double-tap gesture; when capture completes, the phone pulls the recording over GATT (META notify + read slices).`;
    } else if (connPhase === 'connecting') {
      description =
        reconnectAttempt > 0
          ? `Link dropped — retrying automatically (${reconnectAttempt} of ${MAX_AUTO_RECONNECT_ROUNDS}). Stay near the wearable.`
          : 'Discovering ADAB services and subscribing to the NOTIFY stream characteristic.';
    } else {
      description = `Seen in scan — RSSI ${formatRssi(targetDevice.rssi)}. Preparing secure link.`;
    }
    return {title, description};
  }, [
    scanOutcome,
    targetDevice,
    bleState,
    connPhase,
    recvProgress,
    recvPct,
    wearableCaptureArming,
    processingCapture,
    reconnectAttempt,
  ]);

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

          <Box width="100%">
            <BleLinkStatusBadge
              status={linkBadgeStatus}
              pulse={pulse}
              detailTitle={linkDetail.title}
              detailDescription={linkDetail.description}
            />
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