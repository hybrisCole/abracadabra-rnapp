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
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import type {Device, Subscription} from 'react-native-ble-plx';
import {BleManager, State} from 'react-native-ble-plx';
import {SafeAreaView} from 'react-native-safe-area-context';
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
import {ImuMotionSkia} from './ImuMotionSkia';

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
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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
      <View style={styles.gridOverlay} />
    </View>
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
    <View style={compact ? styles.orbFrameCompact : styles.orbFrame}>
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
    </View>
  );
}

function App(): React.JSX.Element {
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
    assemblerRef.current.reset();
    setConnPhase('connecting');
    setTransferNote(null);

    let monitorSub: Subscription | null = null;
    let disconnectSub: Subscription | null = null;

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
      assemblerRef.current.reset('effect cleanup');
      void d?.cancelConnection();
      setRecvProgress(null);
      setConnPhase('off');
    };
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
  }, [resultAnim, scanOutcome, lastRecording?.windowId]);

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
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <NeonBackdrop variant={scanOutcome} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}>
        <View style={styles.header}>
          <Text style={styles.kicker}>ABRACADABRA LINK</Text>
          <Text style={styles.title}>Xerces Aurora - Abracadabra</Text>
        </View>

        <View style={[styles.heroCard, compactListeningHero && styles.heroCardListening]}>
          <CyberOrb
            pulse={pulse}
            resultAnim={resultAnim}
            glyph={orbGlyph}
            tone={orbTone}
            compact={compactListeningHero}
          />
          <View style={styles.statusCopy}>
            <Text
              style={[styles.statusTitle, compactListeningHero && styles.statusTitleListening]}>
              {titleMain}
            </Text>
            <Text style={[styles.statusBody, compactListeningHero && styles.statusBodyListening]}>
              {bodyMain}
            </Text>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.resultBurst,
                compactListeningHero && styles.resultBurstListening,
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
              <Text
                style={[
                  styles.resultBurstText,
                  compactListeningHero && styles.resultBurstTextListening,
                  scanOutcome === 'not-found' && styles.resultBurstTextWarning,
                  connPhase === 'error' && styles.resultBurstTextWarning,
                ]}>
                {burstLabel}
              </Text>
            </Animated.View>
          </View>
        </View>

        {transferNote != null ? (
          <View style={styles.transferAlert}>
            <Text style={styles.transferAlertTitle}>Transfer rolled back</Text>
            <Text style={styles.transferAlertBody}>{transferNote}</Text>
          </View>
        ) : null}

        {lastRecording != null ? (
          <View style={styles.recordingCard}>
            <Text style={styles.panelTitle}>Motion signature</Text>
            <Text style={styles.recordingHint}>
              Trail ≈ integrated accel XY (wearable frame). Ribbon ≈ ‖accel‖ envelope over time.
            </Text>
            <ImuMotionSkia
              samples={lastRecording.samples}
              windowId={lastRecording.windowId}
            />
          </View>
        ) : null}

        <View
          style={[
            styles.actions,
            scanning && styles.actionsHidden,
            scanOutcome === 'idle' && styles.actionsHidden,
          ]}>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={startScan}
            disabled={scanning}
            style={[styles.primaryButton, scanning && styles.disabledButton]}>
            <Text style={styles.primaryButtonText}>
              {scanning ? 'Finding...' : 'Scan Again'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={finishScan}
            disabled={!scanning}
            style={[styles.secondaryButton, !scanning && styles.disabledButton]}>
            <Text style={styles.secondaryButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>

        {scanOutcome === 'not-found' ? (
          <View style={styles.troubleshootCard}>
            <Text style={styles.panelTitle}>Troubleshooting</Text>
            <Text style={styles.checkItem}>01 · Confirm the XIAO is powered and flashed.</Text>
            <Text style={styles.checkItem}>02 · Serial should print BLE advertising as "{TARGET_BLE_NAME}".</Text>
            <Text style={styles.checkItem}>03 · Move the phone closer and avoid covering the antenna.</Text>
            <Text style={styles.checkItem}>04 · Toggle iPhone Bluetooth if CoreBluetooth cached old data.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#020617',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
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
  header: {marginBottom: 14},
  kicker: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 6,
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  heroCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.42)',
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    padding: 20,
    shadowColor: '#00f5ff',
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 10},
  },
  heroCardListening: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
  },
  orbFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 230,
  },
  orbFrameCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 148,
    marginBottom: -4,
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
  statusCopy: {
    marginTop: 4,
  },
  statusTitle: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '900',
  },
  statusTitleListening: {
    fontSize: 20,
    lineHeight: 26,
  },
  statusBody: {
    marginTop: 8,
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22,
  },
  statusBodyListening: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  resultBurst: {
    alignSelf: 'flex-start',
    marginTop: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(124, 255, 212, 0.54)',
    backgroundColor: 'rgba(20, 184, 166, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resultBurstListening: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  resultBurstText: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  resultBurstTextListening: {
    fontSize: 9,
    letterSpacing: 0.6,
  },
  resultBurstTextWarning: {
    color: '#fecdd3',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  actionsHidden: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    overflow: 'hidden',
  },
  primaryButton: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#00f5ff',
    shadowColor: '#00f5ff',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
  },
  primaryButtonText: {
    color: '#020617',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    width: 92,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(217, 70, 239, 0.68)',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  secondaryButtonText: {
    color: '#f0abfc',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  disabledButton: {
    opacity: 0.45,
  },
  troubleshootCard: {
    marginTop: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 56, 100, 0.48)',
    backgroundColor: 'rgba(69, 10, 10, 0.34)',
    padding: 16,
  },
  panelTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  checkItem: {
    marginTop: 8,
    color: '#fecdd3',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Menlo',
  },
  transferAlert: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 56, 100, 0.5)',
    backgroundColor: 'rgba(69, 10, 10, 0.35)',
    padding: 14,
  },
  transferAlertTitle: {
    color: '#fecdd3',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  transferAlertBody: {
    marginTop: 6,
    color: '#fda4af',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Menlo',
  },
  recordingCard: {
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.38)',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    padding: 14,
  },
  recordingHint: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
});

export default App;
