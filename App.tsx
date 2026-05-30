/**
 * Cyberpunk BLE scanner UI — react-native-ble-plx + Skia
 *
 * @format
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
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
  ABRACADABRA_SERVICE_UUID,
  ABRACADABRA_STREAM_CHAR_UUID,
  finalizeRecordingPayload,
  pullPackedPayloadFromPeripheral,
  RecordingAssembler,
  type DecodedRecording,
} from './bleRecordingProtocol';
import {BleLinkStatusBadge, type LinkBadgeStatus} from './BleLinkStatusBadge';
import {
  type AnalyzeRecordingResponse,
  gestureApi,
  type ClassifyRecordingResponse,
  type MovementType,
  type ModelStatusResponse,
  type PasswordMovementType,
  type SaveTrainingSampleResponse,
  analysisToPasswordSequence,
  type TrainingSamplesResponse,
} from './gestureApi';
import {NeonBackdrop} from './NeonBackdrop';
import {
  RecordingTimelineCharts,
  type CropSelection,
} from './RecordingTimelineCharts';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {DarkTheme, NavigationContainer} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import {useSessionStore} from './src/store/sessionStore';
import type {SessionFacts} from './src/store/selectors';
import {NeonTabBar} from './src/navigation/NeonTabBar';
import {VaultScreen} from './src/screens/VaultScreen';
import {SpellbookScreen} from './src/screens/SpellbookScreen';

const TARGET_BLE_NAME = 'XA_Abracadabra';
const SCAN_DURATION_MS = 5000;
const NOTIFY_STREAM_STALL_MS = 4500;

/** Decorative hero title (combining marks); VoiceOver uses accessibilityLabel below. */
const GLITCH_HERO_TITLE =
  'X̴̢̢̘̪̬̯̘̓̓͒́̏ę̵̛͙͇͕̎̿́͋̍͊͆r̵̨̡̡̗̩̜͎̬̞̒̿̋̂̀̏̉͋̈́͠ͅc̵̲͔̺̠̦̹̞̳̊̎̅̑͗̓͐͗ȩ̵̧̞̭̩͉͔͙̻̄́͑̉̆̎͜͝s̴͇̰̠͕͎̈̇̄̀͌̊ ̶̼̯͛Ą̷̟̘̱͔̼̯̯̓͐̓͗̅̐̉͊̕͠ú̸̱̭̝͎̘͇͇̮̂͌͜ȑ̵̢̨͚͈͔̟̽̉̀͜ͅo̸̢͈͚̗͍̪̟̯̭͓̅̍́̋r̴̢̢̨̳̪̗͎͔͗͆͝ͅä̵̢̙́ ̷̢̲̜̱̊̔̄́ͅ-̸̟̪̲̼̝̳̫̻̐̈́̂̈́́͐ ̶̮̼̆̊̓̓̽A̴̼̯̍́͒͒̀͆̔̕͘͝b̵̰͕͕̣̏̍͑̌̅̉͊̒ͅr̷̗͉͈̥̓̀̾̽̿̂̒̿̏ā̸̡̛̖̱͉͇̹̥̇̉̎̈́ͅc̵͔͑͆̍̉̌͊͝͝a̵̢͙̮͎̤̳̻̘̒̽͑̾̍ḓ̴̣͉̯̝̍͆͒a̴̫̰͇͍͕̳͗͌̾̊̈b̴̡̤̞̪̊̍̉͠r̷̡̻̼͉̹̱͇̦̞̟̅̇a̸̟̼͛̉̽̇͑ͅ';

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

type TrainingUploadState =
  | {status: 'idle'}
  | {status: 'saving'}
  | {status: 'saved'; response: SaveTrainingSampleResponse}
  | {status: 'error'; message: string};

type ModelPanelState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; message?: string}
  | {status: 'training'; message?: string}
  | {status: 'error'; message: string};

type CropClassificationState =
  | {status: 'idle'}
  | {status: 'classifying'}
  | {status: 'classified'; response: ClassifyRecordingResponse}
  | {status: 'error'; message: string};

type RecordingAnalysisState =
  | {status: 'idle'}
  | {status: 'analyzing'}
  | {status: 'analyzed'; response: AnalyzeRecordingResponse}
  | {status: 'error'; message: string};

type NotifyFallbackMeta = {
  windowId: number;
  samples: number;
  totalBytes: number;
  crcExpected: number;
  receivedBytes: number;
  reason: string;
};

const TRAINING_LABELS: {value: MovementType; label: string; helper: string}[] = [
  {value: 'tap', label: 'Tap', helper: 'single hit'},
  {value: 'double_tap', label: 'Double tap', helper: 'two hits'},
  {value: 'wrist_rotation', label: 'Wrist rotate', helper: 'twist'},
  {value: 'still', label: 'Still', helper: 'background'},
];

function formatGestureSequence(sequence: PasswordMovementType[]): string {
  return sequence.length > 0 ? sequence.join(' → ') : 'no gesture';
}

function sequencesMatch(
  detected: PasswordMovementType[],
  expected: PasswordMovementType[],
): boolean {
  return (
    detected.length === expected.length &&
    detected.every((movement, index) => movement === expected[index])
  );
}

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

function formatErrorDetail(error: unknown): string {
  if (error == null) {
    return 'Unknown error';
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const maybe = error as Record<string, unknown>;
  const details: string[] = [];
  for (const [key, value] of [
    ['reason', maybe.reason],
    ['errorCode', maybe.errorCode],
    ['attErrorCode', maybe.attErrorCode],
    ['iosErrorCode', maybe.iosErrorCode],
    ['androidErrorCode', maybe.androidErrorCode],
  ] as const) {
    if (value != null) {
      details.push(`${key}=${String(value)}`);
    }
  }

  return details.length > 0 ? `${message} (${details.join(', ')})` : message;
}

function isBleManagerDestroyedError(error: unknown): boolean {
  const maybe = error as Record<string, unknown>;
  return maybe.reason === 'BleManager was destroyed';
}

const isTargetName = (name: string | null | undefined) => name === TARGET_BLE_NAME;

const isTargetDevice = (device: {
  localName?: string | null;
  name?: string | null;
}) => isTargetName(device.localName) || isTargetName(device.name);

function AbracadabraScreen(): React.JSX.Element {
  const managerRef = useRef<BleManager | null>(null);
  const managerDestroyedRef = useRef(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const feedbackOutcomeRef = useRef<ScanOutcome>('idle');

  const assemblerRef = useRef(new RecordingAssembler());
  const transferInFlightRef = useRef(false);
  const notifyStreamWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const notifyFallbackMetaRef = useRef<NotifyFallbackMeta | null>(null);
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
  /** After notify chunks complete — CRC verify + unpack samples before timeline mounts. */
  const [processingCapture, setProcessingCapture] = useState(false);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<DecodedRecording | null>(
    null,
  );
  const [selectedCrop, setSelectedCrop] = useState<CropSelection | null>(null);
  const [selectedMovement, setSelectedMovement] = useState<MovementType>('tap');
  const [trainingUpload, setTrainingUpload] = useState<TrainingUploadState>({
    status: 'idle',
  });
  const [modelStatus, setModelStatus] = useState<ModelStatusResponse | null>(
    null,
  );
  const [trainingSamples, setTrainingSamples] =
    useState<TrainingSamplesResponse | null>(null);
  const [modelPanel, setModelPanel] = useState<ModelPanelState>({
    status: 'idle',
  });
  const [cropClassification, setCropClassification] =
    useState<CropClassificationState>({
      status: 'idle',
    });
  const [recordingAnalysis, setRecordingAnalysis] =
    useState<RecordingAnalysisState>({
      status: 'idle',
    });
  const [savedPasswordSequence, setSavedPasswordSequence] = useState<
    PasswordMovementType[]
  >([]);

  const [targetDevice, setTargetDevice] = useState<DeviceRow | null>(null);
  const [scanning, setScanning] = useState(false);
  const [bleState, setBleState] = useState<State>(State.Unknown);
  const [hasScanned, setHasScanned] = useState(false);

  const [showFreshConnected, setShowFreshConnected] = useState(false);
  const prevConnPhaseForBadgeRef = useRef<ConnPhase>('off');

  const insets = useSafeAreaInsets();

  const clearNotifyStreamWatchdog = useCallback(() => {
    if (notifyStreamWatchdogRef.current != null) {
      clearTimeout(notifyStreamWatchdogRef.current);
      notifyStreamWatchdogRef.current = null;
    }
  }, []);

  const recoverWithFallbackPull = useCallback(
    (meta: NotifyFallbackMeta) => {
      clearNotifyStreamWatchdog();
      notifyFallbackMetaRef.current = null;
      assemblerRef.current.reset('fallback pull starting');
      const linkedDev = connectedDevRef.current;
      if (!linkedDev) {
        setRecvProgress(null);
        setProcessingCapture(false);
        setTransferNote(
          `Notify stream ${meta.reason} ${meta.receivedBytes}/${meta.totalBytes}; not connected for fallback pull`,
        );
        transferInFlightRef.current = false;
        assemblerRef.current.reset(`notify ${meta.reason} and disconnected`);
        return;
      }

      console.log('[recording] fallback GATT pull starting', meta);
      setProcessingCapture(false);
      setTransferNote(null);
      setRecvProgress({filled: meta.receivedBytes, total: meta.totalBytes});

      pullPackedPayloadFromPeripheral(
        linkedDev,
        meta.totalBytes,
        (filled, total) => setRecvProgress({filled, total}),
      )
        .then(payload => {
          console.log('[recording] fallback GATT pull complete; finalizing', {
            windowId: meta.windowId,
            bytes: payload.byteLength,
          });
          setRecvProgress(null);
          setProcessingCapture(true);
          return finalizeRecordingPayload(
            meta.windowId,
            meta.samples,
            meta.crcExpected,
            payload,
          );
        })
        .then(fin => {
          setProcessingCapture(false);
          if ('error' in fin) {
            console.warn('[recording] fallback finalize failed', fin);
            setTransferNote(fin.error);
            setRecvProgress(null);
            setWearableCaptureArming(null);
            setConnPhase('linked');
            assemblerRef.current.reset('fallback finalize failed');
            transferInFlightRef.current = false;
          } else {
            console.log('[recording] fallback finalize complete', {
              windowId: fin.windowId,
              samples: fin.samples.length,
            });
            setSelectedCrop(null);
            setTrainingUpload({status: 'idle'});
            setCropClassification({status: 'idle'});
            setRecordingAnalysis({status: 'idle'});
            setLastRecording(fin);
            setTransferNote(null);
            transferInFlightRef.current = false;
            assemblerRef.current.reset('fallback complete');
            Vibration.vibrate([0, 30, 50, 90, 40, 120]);
          }
        })
        .catch(e => {
          setRecvProgress(null);
          setProcessingCapture(false);
          setWearableCaptureArming(null);
          setConnPhase('linked');
          assemblerRef.current.reset('fallback pull failed');
          const msg = e instanceof Error ? e.message : String(e);
          setTransferNote(msg);
          if (__DEV__) {
            console.warn('[BLE fallback pull]', formatErrorDetail(e), e);
          }
        })
        .finally(() => {
          console.log('[recording] fallback transfer settled');
          transferInFlightRef.current = false;
        });
    },
    [clearNotifyStreamWatchdog],
  );

  const armNotifyStreamWatchdog = useCallback(
    (meta: NotifyFallbackMeta) => {
      clearNotifyStreamWatchdog();
      notifyFallbackMetaRef.current = meta;
      notifyStreamWatchdogRef.current = setTimeout(() => {
        const latest = notifyFallbackMetaRef.current;
        if (latest == null) {
          return;
        }
        console.warn('[recording] notify stream watchdog fired', latest);
        recoverWithFallbackPull({
          ...latest,
          reason: 'stalled',
        });
      }, NOTIFY_STREAM_STALL_MS);
    },
    [clearNotifyStreamWatchdog, recoverWithFallbackPull],
  );

  useEffect(() => {
    const mgr = new BleManager();
    managerRef.current = mgr;
    managerDestroyedRef.current = false;

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
      mgr.stopDeviceScan().catch(error => {
        if (__DEV__ && !isBleManagerDestroyedError(error)) {
          console.warn('[BLE scan cleanup]', formatErrorDetail(error), error);
        }
      });
      managerDestroyedRef.current = true;
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
      mgr.stopDeviceScan().catch(error => {
        if (__DEV__) {
          console.warn('[BLE stop scan]', formatErrorDetail(error), error);
        }
      });
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
    clearNotifyStreamWatchdog();
    notifyFallbackMetaRef.current = null;
    transferInFlightRef.current = false;
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
        console.error('[BLE scan]', formatErrorDetail(error), error);
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
      mgr.stopDeviceScan().catch(stopError => {
        if (__DEV__) {
          console.warn(
            '[BLE scan found cleanup]',
            formatErrorDetail(stopError),
            stopError,
          );
        }
      });
      setScanning(false);
      setHasScanned(true);
    });

    scanTimerRef.current = setTimeout(() => {
      scanTimerRef.current = null;
      if (mgr) {
        mgr.stopDeviceScan().catch(error => {
          if (__DEV__) {
            console.warn('[BLE scan timeout cleanup]', formatErrorDetail(error), error);
          }
        });
      }
      setScanning(false);
      setHasScanned(true);
    }, SCAN_DURATION_MS);
  }, [clearNotifyStreamWatchdog, scanning]);

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
          if (!managerDestroyedRef.current) {
            dev.cancelConnection().catch(error => {
              if (__DEV__ && !isBleManagerDestroyedError(error)) {
                console.warn(
                  '[BLE cancelled connect cleanup]',
                  formatErrorDetail(error),
                  error,
                );
              }
            });
          }
          return;
        }

        connectedDevRef.current = dev;

        await dev.discoverAllServicesAndCharacteristics();

        disconnectSub = dev.onDisconnected(() => {
          clearNotifyStreamWatchdog();
          notifyFallbackMetaRef.current = null;
          transferInFlightRef.current = false;
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
                console.warn('[BLE notify]', formatErrorDetail(error), error);
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
            if (result.kind === 'transfer_started') {
              if (transferInFlightRef.current) {
                return;
              }
              transferInFlightRef.current = true;
              setWearableCaptureArming(null);
              setRecvProgress({filled: 0, total: result.totalBytes});
              console.log('[recording] notify stream started', {
                windowId: result.windowId,
                samples: result.samples,
                totalBytes: result.totalBytes,
              });
              armNotifyStreamWatchdog({
                windowId: result.windowId,
                samples: result.samples,
                totalBytes: result.totalBytes,
                crcExpected: result.crcExpected,
                receivedBytes: 0,
                reason: 'incomplete',
              });
              return;
            }
            if (result.kind === 'transfer_progress') {
              setRecvProgress({filled: result.filled, total: result.total});
              const prior = notifyFallbackMetaRef.current;
              if (prior != null && prior.windowId === result.windowId) {
                armNotifyStreamWatchdog({
                  ...prior,
                  receivedBytes: result.filled,
                  reason: 'incomplete',
                });
              }
              return;
            }
            if (result.kind === 'transfer_complete') {
              clearNotifyStreamWatchdog();
              notifyFallbackMetaRef.current = null;
              console.log('[recording] notify stream complete; finalizing', {
                windowId: result.windowId,
                samples: result.samples,
                totalBytes: result.totalBytes,
              });
              setRecvProgress(null);
              setProcessingCapture(true);
              /** Next macrotask so React can paint Processing before sync finalize runs. */
              setTimeout(() => {
                finalizeRecordingPayload(
                  result.windowId,
                  result.samples,
                  result.crcExpected,
                  result.payload,
                )
                .then(fin => {
                  setProcessingCapture(false);
                  if ('error' in fin) {
                    console.warn('[recording] notify finalize failed', fin);
                    setTransferNote(fin.error);
                    setRecvProgress(null);
                    setWearableCaptureArming(null);
                    setConnPhase('linked');
                    assemblerRef.current.reset('finalize failed');
                    transferInFlightRef.current = false;
                  } else {
                    console.log('[recording] notify finalize complete', {
                      windowId: fin.windowId,
                      samples: fin.samples.length,
                    });
                    setSelectedCrop(null);
                    setTrainingUpload({status: 'idle'});
                    setCropClassification({status: 'idle'});
                    setRecordingAnalysis({status: 'idle'});
                    setLastRecording(fin);
                    setTransferNote(null);
                    transferInFlightRef.current = false;
                    Vibration.vibrate([0, 30, 50, 90, 40, 120]);
                  }
                })
                .catch(e => {
                  setRecvProgress(null);
                  setProcessingCapture(false);
                  setWearableCaptureArming(null);
                  setConnPhase('linked');
                  assemblerRef.current.reset('notify stream failed');
                  const msg = e instanceof Error ? e.message : String(e);
                  setTransferNote(msg);
                  if (__DEV__) {
                    console.warn('[BLE notify stream]', formatErrorDetail(e), e);
                  }
                })
                .finally(() => {
                  console.log('[recording] notify finalize settled');
                  clearNotifyStreamWatchdog();
                  notifyFallbackMetaRef.current = null;
                  transferInFlightRef.current = false;
                });
              }, 0);
            } else if (result.kind === 'notify_incomplete') {
              console.warn('[recording] notify incomplete; evaluating fallback', {
                windowId: result.windowId,
                receivedBytes: result.receivedBytes,
                totalBytes: result.totalBytes,
              });
              recoverWithFallbackPull({
                windowId: result.windowId,
                samples: result.samples,
                totalBytes: result.totalBytes,
                crcExpected: result.crcExpected,
                receivedBytes: result.receivedBytes,
                reason: 'incomplete',
              });
            } else if (result.kind === 'error') {
              clearNotifyStreamWatchdog();
              notifyFallbackMetaRef.current = null;
              console.warn('[recording] transfer protocol error', result);
              setRecvProgress(null);
              setTransferNote(result.message);
              transferInFlightRef.current = false;
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
          console.warn('[BLE connect]', formatErrorDetail(e), e);
        }
        if (!cancelled) {
          setConnPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearNotifyStreamWatchdog();
      notifyFallbackMetaRef.current = null;
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
      if (d != null && !managerDestroyedRef.current) {
        d.cancelConnection().catch(error => {
          if (__DEV__ && !isBleManagerDestroyedError(error)) {
            console.warn('[BLE effect cleanup]', formatErrorDetail(error), error);
          }
        });
      }
      setRecvProgress(null);
      setWearableCaptureArming(null);
      setProcessingCapture(false);
      transferInFlightRef.current = false;
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
    if (processingCapture || recvProgress != null) {
      return 'processing';
    }
    if (wearableCaptureArming != null) {
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
      description = `Paired — RSSI ${formatRssi(targetDevice.rssi)}. Perform the accepted double-tap gesture; when capture completes, the phone receives notify chunks, validates CRC, and decodes the recording.`;
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

  const handleCropSelected = useCallback((selection: CropSelection): void => {
    setSelectedCrop(selection);
    setTrainingUpload({status: 'idle'});
    setCropClassification({status: 'idle'});
  }, []);

  const refreshModelInfo = useCallback(async (): Promise<void> => {
    setModelPanel({status: 'loading'});
    try {
      const [nextModelStatus, nextTrainingSamples] = await Promise.all([
        gestureApi.getModelStatus(),
        gestureApi.listTrainingSamples(),
      ]);
      if (__DEV__) {
        console.log('[ModelStatus] refreshed', {
          model: nextModelStatus,
          training: nextTrainingSamples,
        });
      }
      setModelStatus(nextModelStatus);
      setTrainingSamples(nextTrainingSamples);
      setModelPanel({status: 'ready'});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Model status refresh failed';
      if (__DEV__) {
        console.warn('[ModelStatus] refresh failed', formatErrorDetail(error), error);
      }
      setModelPanel({status: 'error', message});
    }
  }, []);

  const trainModel = useCallback(async (): Promise<void> => {
    setModelPanel({status: 'training', message: 'Training model...'});
    try {
      const response = await gestureApi.trainModel();
      if (__DEV__) {
        console.log('[ModelStatus] train requested', response);
      }
      setModelPanel({status: 'ready', message: response.message});
      await refreshModelInfo();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Model training request failed';
      if (__DEV__) {
        console.warn('[ModelStatus] train failed', formatErrorDetail(error), error);
      }
      setModelPanel({status: 'error', message});
    }
  }, [refreshModelInfo]);

  const uploadSelectedCrop = useCallback(async (): Promise<void> => {
    if (selectedCrop == null || selectedCrop.samplesInCrop < 10) {
      setTrainingUpload({
        status: 'error',
        message: 'Select a crop with at least 10 samples before uploading.',
      });
      return;
    }

    setTrainingUpload({status: 'saving'});
    try {
      const response = await gestureApi.saveTrainingSample({
        movement_type: selectedMovement,
        window_id: selectedCrop.windowId,
        samples: selectedCrop.samples,
      });
      if (__DEV__) {
        console.log('[TrainingUpload] saved', response);
      }
      setTrainingUpload({status: 'saved', response});
      refreshModelInfo().catch(error => {
        if (__DEV__) {
          console.warn(
            '[ModelStatus] post-upload refresh failed',
            formatErrorDetail(error),
            error,
          );
        }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Training upload failed';
      if (__DEV__) {
        console.warn('[TrainingUpload] failed', formatErrorDetail(error), error);
      }
      setTrainingUpload({status: 'error', message});
    }
  }, [refreshModelInfo, selectedCrop, selectedMovement]);

  const classifySelectedCrop = useCallback(async (): Promise<void> => {
    if (selectedCrop == null || selectedCrop.samplesInCrop < 10) {
      setCropClassification({
        status: 'error',
        message: 'Select a crop with at least 10 samples before classifying.',
      });
      return;
    }

    setCropClassification({status: 'classifying'});
    try {
      const response = await gestureApi.classifyRecording({
        window_id: selectedCrop.windowId,
        samples: selectedCrop.samples,
      });
      if (__DEV__) {
        console.log('[CropClassification] classified', response);
      }
      setCropClassification({status: 'classified', response});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Crop classification failed';
      if (__DEV__) {
        console.warn(
          '[CropClassification] failed',
          formatErrorDetail(error),
          error,
        );
      }
      setCropClassification({status: 'error', message});
    }
  }, [selectedCrop]);

  const analyzeLastRecording = useCallback(async (): Promise<void> => {
    if (lastRecording == null || lastRecording.samples.length < 10) {
      setRecordingAnalysis({
        status: 'error',
        message: 'Receive a recording with at least 10 samples before analyzing.',
      });
      return;
    }

    setRecordingAnalysis({status: 'analyzing'});
    try {
      const response = await gestureApi.analyzeRecording({
        window_id: lastRecording.windowId,
        samples: lastRecording.samples,
        include_still: true,
        min_confidence: 0.5,
      });
      if (__DEV__) {
        console.log('[RecordingAnalysis] analyzed', response);
      }
      setRecordingAnalysis({status: 'analyzed', response});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Recording analysis failed';
      if (__DEV__) {
        console.warn(
          '[RecordingAnalysis] failed',
          formatErrorDetail(error),
          error,
        );
      }
      setRecordingAnalysis({status: 'error', message});
    }
  }, [lastRecording]);

  const detectedPasswordSequence = useMemo(
    () =>
      recordingAnalysis.status === 'analyzed'
        ? analysisToPasswordSequence(recordingAnalysis.response)
        : [],
    [recordingAnalysis],
  );

  const passwordMatched =
    savedPasswordSequence.length > 0 &&
    sequencesMatch(detectedPasswordSequence, savedPasswordSequence);

  const saveAnalyzedSequenceAsPassword = useCallback((): void => {
    if (detectedPasswordSequence.length === 0) {
      return;
    }
    setSavedPasswordSequence(detectedPasswordSequence);
  }, [detectedPasswordSequence]);

  useEffect(() => {
    refreshModelInfo().catch(error => {
      if (__DEV__) {
        console.warn(
          '[ModelStatus] initial refresh failed',
          formatErrorDetail(error),
          error,
        );
      }
    });
  }, [refreshModelInfo]);

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

  // Publish live session into the shared store so the Vault game tab can derive
  // the same status and react to new recordings without owning the BLE radio.
  const publishFacts = useSessionStore(s => s.publishFacts);
  const publishRecording = useSessionStore(s => s.publishRecording);

  useEffect(() => {
    const facts: SessionFacts = {
      bleState,
      scanOutcome,
      scanning,
      hasTarget: targetDevice != null,
      connPhase,
      reconnectAttempt,
      recvActive: recvProgress != null,
      arming: wearableCaptureArming != null,
      processingCapture,
      showFreshConnected,
    };
    publishFacts(facts);
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
    publishFacts,
  ]);

  useEffect(() => {
    publishRecording(lastRecording);
  }, [lastRecording, publishRecording]);

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
            <Heading
              size="xl"
              color="$coolGray50"
              letterSpacing="$sm"
              lineHeight="$3xl"
              accessibilityRole="header"
              accessibilityLabel="Xerces Aurora — Abracadabra">
              {GLITCH_HERO_TITLE}
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
                  onCropSelected={handleCropSelected}
                />
              </Box>
              {selectedCrop != null ? (
                <Box
                  mt="$4"
                  p="$3"
                  borderRadius="$xl"
                  borderWidth={1}
                  borderColor="rgba(217,70,239,0.45)"
                  bg="rgba(88,28,135,0.22)">
                  <Text
                    color="#f9a8d4"
                    fontSize="$xs"
                    fontWeight="$extrabold"
                    letterSpacing="$lg"
                    textTransform="uppercase">
                    Selected crop
                  </Text>
                  <Text mt="$2" color="#e0f2fe" fontFamily="Menlo" fontSize="$sm">
                    {selectedCrop.cropStartMs}–{selectedCrop.cropEndMs} ms ·{' '}
                    {selectedCrop.durationMs} ms · {selectedCrop.samplesInCrop}{' '}
                    / {selectedCrop.samplesTotal} samples
                  </Text>
                  <Text mt="$1" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                    first {selectedCrop.tMsFirstInCrop ?? 'n/a'} ms · last{' '}
                    {selectedCrop.tMsLastInCrop ?? 'n/a'} ms
                  </Text>
                  <Text
                    mt="$4"
                    color="#f9a8d4"
                    fontSize="$xs"
                    fontWeight="$extrabold"
                    letterSpacing="$lg"
                    textTransform="uppercase">
                    Training label
                  </Text>
                  <Box
                    mt="$2"
                    flexDirection="row"
                    flexWrap="wrap"
                    gap="$2">
                    {TRAINING_LABELS.map(label => {
                      const active = selectedMovement === label.value;
                      const isStill = label.value === 'still';
                      return (
                        <Button
                          key={label.value}
                          size="sm"
                          variant="outline"
                          borderRadius="$full"
                          borderColor={
                            active
                              ? isStill
                                ? 'rgba(148,163,184,0.9)'
                                : 'rgba(34,211,238,0.95)'
                              : 'rgba(148,163,184,0.32)'
                          }
                          bg={
                            active
                              ? isStill
                                ? 'rgba(71,85,105,0.42)'
                                : 'rgba(8,145,178,0.32)'
                              : 'rgba(15,23,42,0.62)'
                          }
                          onPress={() => {
                            setSelectedMovement(label.value);
                            setTrainingUpload({status: 'idle'});
                            setCropClassification({status: 'idle'});
                          }}>
                          <ButtonText
                            color={
                              active
                                ? isStill
                                  ? '#cbd5e1'
                                  : '#67e8f9'
                                : '#94a3b8'
                            }
                            fontSize="$xs"
                            fontWeight="$extrabold"
                            textTransform="uppercase">
                            {label.label}
                          </ButtonText>
                        </Button>
                      );
                    })}
                  </Box>
                  <Text mt="$2" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                    {TRAINING_LABELS.find(
                      label => label.value === selectedMovement,
                    )?.helper ?? 'gesture'}{' '}
                    · still is training background, not a password gesture
                  </Text>
                  <HStack mt="$4" space="sm" alignItems="center">
                    <Button
                      flex={1}
                      size="sm"
                      borderRadius="$xl"
                      bg="#00f5ff"
                      isDisabled={
                        trainingUpload.status === 'saving' ||
                        selectedCrop.samplesInCrop < 10
                      }
                      opacity={
                        trainingUpload.status === 'saving' ||
                        selectedCrop.samplesInCrop < 10
                          ? 0.55
                          : 1
                      }
                      onPress={uploadSelectedCrop}>
                      <ButtonText
                        color="#020617"
                        fontWeight="$extrabold"
                        letterSpacing="$md"
                        fontSize="$xs"
                        textTransform="uppercase">
                        {trainingUpload.status === 'saving'
                          ? 'Uploading...'
                          : 'Upload crop'}
                      </ButtonText>
                    </Button>
                    <Button
                      flex={1}
                      size="sm"
                      variant="outline"
                      borderRadius="$xl"
                      borderColor="rgba(217,70,239,0.75)"
                      bg="rgba(15,23,42,0.72)"
                      isDisabled={
                        cropClassification.status === 'classifying' ||
                        selectedCrop.samplesInCrop < 10 ||
                        modelStatus?.status !== 'trained'
                      }
                      opacity={
                        cropClassification.status === 'classifying' ||
                        selectedCrop.samplesInCrop < 10 ||
                        modelStatus?.status !== 'trained'
                          ? 0.55
                          : 1
                      }
                      onPress={classifySelectedCrop}>
                      <ButtonText
                        color="#f0abfc"
                        fontWeight="$extrabold"
                        letterSpacing="$md"
                        fontSize="$xs"
                        textTransform="uppercase">
                        {cropClassification.status === 'classifying'
                          ? 'Classifying...'
                          : 'Classify crop'}
                      </ButtonText>
                    </Button>
                  </HStack>
                  {trainingUpload.status === 'saved' ? (
                    <Text
                      mt="$3"
                      color="#a7f3d0"
                      fontFamily="Menlo"
                      fontSize="$xs">
                      Saved {trainingUpload.response.movement_type} sample{' '}
                      {trainingUpload.response.sample_id} ·{' '}
                      {trainingUpload.response.sample_count} samples
                    </Text>
                  ) : null}
                  {trainingUpload.status === 'error' ? (
                    <Text
                      mt="$3"
                      color="#fecdd3"
                      fontFamily="Menlo"
                      fontSize="$xs">
                      {trainingUpload.message}
                    </Text>
                  ) : null}
                  {cropClassification.status === 'classified' ? (
                    <Box
                      mt="$4"
                      p="$3"
                      borderRadius="$lg"
                      borderWidth={1}
                      borderColor="rgba(34,211,238,0.42)"
                      bg="rgba(8,47,73,0.26)">
                      <Text
                        color="#67e8f9"
                        fontSize="$xs"
                        fontWeight="$extrabold"
                        letterSpacing="$lg"
                        textTransform="uppercase">
                        Prediction
                      </Text>
                      <Text
                        mt="$2"
                        color="#e0f2fe"
                        fontFamily="Menlo"
                        fontSize="$sm">
                        {cropClassification.response.predicted_movement} ·{' '}
                        {Math.round(cropClassification.response.confidence * 100)}
                        %
                      </Text>
                      <Box mt="$2" flexDirection="row" flexWrap="wrap" gap="$2">
                        {Object.entries(
                          cropClassification.response.all_probabilities,
                        )
                          .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                          .slice(0, 4)
                          .map(([movement, probability]) => (
                            <Text
                              key={movement}
                              color="#94a3b8"
                              fontFamily="Menlo"
                              fontSize="$xs">
                              {movement}:{' '}
                              {Math.round((probability ?? 0) * 100)}%
                            </Text>
                          ))}
                      </Box>
                    </Box>
                  ) : null}
                  {cropClassification.status === 'error' ? (
                    <Text
                      mt="$3"
                      color="#fecdd3"
                      fontFamily="Menlo"
                      fontSize="$xs">
                      {cropClassification.message}
                    </Text>
                  ) : null}
                </Box>
              ) : (
                <Text mt="$3" color="#94a3b8" fontSize="$sm" fontFamily="Menlo">
                  Move the crop sliders and tap Select crop to stage samples for
                  labeling.
                </Text>
              )}
              <Box
                mt="$4"
                p="$3"
                borderRadius="$xl"
                borderWidth={1}
                borderColor="rgba(34,211,238,0.28)"
                bg="rgba(8,47,73,0.18)">
                <HStack justifyContent="space-between" alignItems="center">
                  <Text
                    color="#67e8f9"
                    fontSize="$xs"
                    fontWeight="$extrabold"
                    letterSpacing="$lg"
                    textTransform="uppercase">
                    Full recording analysis
                  </Text>
                  <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                    {lastRecording.samples.length} samples
                  </Text>
                </HStack>
                <Button
                  mt="$3"
                  size="sm"
                  alignSelf="flex-start"
                  borderRadius="$xl"
                  bg="#d946ef"
                  isDisabled={
                    recordingAnalysis.status === 'analyzing' ||
                    modelStatus?.status !== 'trained'
                  }
                  opacity={
                    recordingAnalysis.status === 'analyzing' ||
                    modelStatus?.status !== 'trained'
                      ? 0.55
                      : 1
                  }
                  onPress={analyzeLastRecording}>
                  <ButtonText
                    color="#020617"
                    fontWeight="$extrabold"
                    letterSpacing="$md"
                    fontSize="$xs"
                    textTransform="uppercase">
                    {recordingAnalysis.status === 'analyzing'
                      ? 'Analyzing...'
                      : 'Analyze full recording'}
                  </ButtonText>
                </Button>
                {recordingAnalysis.status === 'analyzed' ? (
                  <Box mt="$4">
                    <Text
                      color="#e0f2fe"
                      fontFamily="Menlo"
                      fontSize="$sm">
                      Sequence: {formatGestureSequence(detectedPasswordSequence)}
                    </Text>
                    <Text mt="$1" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                      {recordingAnalysis.response.duration_ms} ms ·{' '}
                      {recordingAnalysis.response.sample_rate_hz.toFixed(1)} Hz ·{' '}
                      {(
                        recordingAnalysis.response.resolved_segments ??
                        recordingAnalysis.response.segments
                      ).length}{' '}
                      resolved segments ·{' '}
                      {recordingAnalysis.response.segments.length} raw
                    </Text>
                    <Box
                      mt="$3"
                      p="$3"
                      borderRadius="$lg"
                      borderWidth={1}
                      borderColor={
                        savedPasswordSequence.length === 0
                          ? 'rgba(148,163,184,0.3)'
                          : passwordMatched
                            ? 'rgba(16,185,129,0.55)'
                            : 'rgba(251,113,133,0.5)'
                      }
                      bg={
                        savedPasswordSequence.length === 0
                          ? 'rgba(15,23,42,0.55)'
                          : passwordMatched
                            ? 'rgba(6,78,59,0.22)'
                            : 'rgba(127,29,29,0.2)'
                      }>
                      <Text
                        color={
                          savedPasswordSequence.length === 0
                            ? '#94a3b8'
                            : passwordMatched
                              ? '#a7f3d0'
                              : '#fecdd3'
                        }
                        fontFamily="Menlo"
                        fontSize="$xs">
                        {savedPasswordSequence.length === 0
                          ? 'No password saved yet'
                          : passwordMatched
                            ? 'Password match'
                            : 'Password mismatch'}
                      </Text>
                      {savedPasswordSequence.length > 0 ? (
                        <Text
                          mt="$1"
                          color="#94a3b8"
                          fontFamily="Menlo"
                          fontSize="$xs">
                          Expected: {formatGestureSequence(savedPasswordSequence)}
                        </Text>
                      ) : null}
                      <HStack mt="$3" space="sm" alignItems="center">
                        <Button
                          flex={1}
                          size="sm"
                          borderRadius="$xl"
                          bg="#00f5ff"
                          isDisabled={detectedPasswordSequence.length === 0}
                          opacity={detectedPasswordSequence.length === 0 ? 0.55 : 1}
                          onPress={saveAnalyzedSequenceAsPassword}>
                          <ButtonText
                            color="#020617"
                            fontWeight="$extrabold"
                            letterSpacing="$md"
                            fontSize="$xs"
                            textTransform="uppercase">
                            Save as password
                          </ButtonText>
                        </Button>
                        <Button
                          flex={1}
                          size="sm"
                          variant="outline"
                          borderRadius="$xl"
                          borderColor="rgba(148,163,184,0.45)"
                          bg="rgba(15,23,42,0.72)"
                          isDisabled={savedPasswordSequence.length === 0}
                          opacity={savedPasswordSequence.length === 0 ? 0.55 : 1}
                          onPress={() => setSavedPasswordSequence([])}>
                          <ButtonText
                            color="#cbd5e1"
                            fontWeight="$extrabold"
                            letterSpacing="$md"
                            fontSize="$xs"
                            textTransform="uppercase">
                            Clear password
                          </ButtonText>
                        </Button>
                      </HStack>
                    </Box>
                    <Box mt="$3" gap="$2">
                      {(
                        recordingAnalysis.response.resolved_segments ??
                        recordingAnalysis.response.segments
                      ).map(segment => (
                        <HStack
                          key={`${segment.movement_type}-${segment.start_ms}-${segment.end_ms}`}
                          justifyContent="space-between"
                          alignItems="center"
                          py="$1">
                          <Text
                            color={
                              segment.movement_type === 'still'
                                ? '#94a3b8'
                                : '#f0abfc'
                            }
                            fontFamily="Menlo"
                            fontSize="$xs">
                            {segment.start_ms}–{segment.end_ms} ms ·{' '}
                            {segment.movement_type}
                          </Text>
                          <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                            {Math.round(segment.confidence * 100)}%
                          </Text>
                        </HStack>
                      ))}
                    </Box>
                  </Box>
                ) : null}
                {recordingAnalysis.status === 'error' ? (
                  <Text mt="$3" color="#fecdd3" fontFamily="Menlo" fontSize="$xs">
                    {recordingAnalysis.message}
                  </Text>
                ) : null}
              </Box>
            </Box>
          ) : null}

          <Box
            mt="$4"
            p="$4"
            borderRadius="$2xl"
            borderWidth={1}
            borderColor="rgba(148,163,184,0.24)"
            bg="rgba(15,23,42,0.64)">
            <HStack justifyContent="space-between" alignItems="center">
              <Heading
                size="xs"
                color="$coolGray50"
                fontWeight="$extrabold"
                letterSpacing="$lg"
                textTransform="uppercase">
                Model / Server
              </Heading>
              <Text color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                {modelPanel.status === 'error'
                  ? 'offline'
                  : modelPanel.status === 'idle' || modelPanel.status === 'loading'
                    ? 'checking'
                    : 'online'}
              </Text>
            </HStack>

            <HStack mt="$3" space="sm" flexWrap="wrap">
              <Box
                px="$3"
                py="$2"
                borderRadius="$lg"
                borderWidth={1}
                borderColor="rgba(34,211,238,0.28)"
                bg="rgba(8,47,73,0.28)">
                <Text
                  color="#67e8f9"
                  fontSize="$xs"
                  fontWeight="$extrabold"
                  textTransform="uppercase">
                  {modelStatus?.status === 'trained' ? 'Trained' : 'Not trained'}
                </Text>
              </Box>
              <Box
                px="$3"
                py="$2"
                borderRadius="$lg"
                borderWidth={1}
                borderColor="rgba(217,70,239,0.26)"
                bg="rgba(88,28,135,0.22)">
                <Text
                  color="#f0abfc"
                  fontSize="$xs"
                  fontWeight="$extrabold"
                  textTransform="uppercase">
                  {trainingSamples?.total_samples ?? 0} samples
                </Text>
              </Box>
            </HStack>

            <Box mt="$3" flexDirection="row" flexWrap="wrap" gap="$2">
              {TRAINING_LABELS.map(label => (
                <Text
                  key={label.value}
                  color={label.value === 'still' ? '#cbd5e1' : '#e0f2fe'}
                  fontFamily="Menlo"
                  fontSize="$xs">
                  {label.label}:{' '}
                  {trainingSamples?.sample_counts[label.value] ?? 0}
                </Text>
              ))}
            </Box>

            {modelStatus?.status === 'trained' ? (
              <Text mt="$2" color="#94a3b8" fontFamily="Menlo" fontSize="$xs">
                Labels: {modelStatus.movements.join(' · ')}
              </Text>
            ) : null}

            {modelPanel.status === 'ready' && modelPanel.message != null ? (
              <Text mt="$2" color="#a7f3d0" fontFamily="Menlo" fontSize="$xs">
                {modelPanel.message}
              </Text>
            ) : null}
            {modelPanel.status === 'error' ? (
              <Text mt="$2" color="#fecdd3" fontFamily="Menlo" fontSize="$xs">
                {modelPanel.message}
              </Text>
            ) : null}

            <HStack mt="$4" space="sm" alignItems="center">
              <Button
                flex={1}
                size="sm"
                variant="outline"
                borderRadius="$xl"
                borderColor="rgba(34,211,238,0.65)"
                bg="rgba(15,23,42,0.7)"
                isDisabled={
                  modelPanel.status === 'loading' ||
                  modelPanel.status === 'training'
                }
                opacity={
                  modelPanel.status === 'loading' ||
                  modelPanel.status === 'training'
                    ? 0.55
                    : 1
                }
                onPress={refreshModelInfo}>
                <ButtonText
                  color="#67e8f9"
                  fontWeight="$extrabold"
                  letterSpacing="$md"
                  fontSize="$xs"
                  textTransform="uppercase">
                  {modelPanel.status === 'loading' ? 'Refreshing...' : 'Refresh'}
                </ButtonText>
              </Button>
              <Button
                flex={1}
                size="sm"
                borderRadius="$xl"
                bg="#d946ef"
                isDisabled={
                  modelPanel.status === 'loading' ||
                  modelPanel.status === 'training' ||
                  (trainingSamples?.total_samples ?? 0) === 0
                }
                opacity={
                  modelPanel.status === 'loading' ||
                  modelPanel.status === 'training' ||
                  (trainingSamples?.total_samples ?? 0) === 0
                    ? 0.55
                    : 1
                }
                onPress={trainModel}>
                <ButtonText
                  color="#020617"
                  fontWeight="$extrabold"
                  letterSpacing="$md"
                  fontSize="$xs"
                  textTransform="uppercase">
                  {modelPanel.status === 'training'
                    ? 'Training...'
                    : 'Train model'}
                </ButtonText>
              </Button>
            </HStack>
          </Box>

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
  root: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 36,
  },
});

const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#020617',
    card: '#020617',
    border: 'transparent',
  },
};

const Tab = createBottomTabNavigator();

const renderNeonTabBar = (props: BottomTabBarProps) => <NeonTabBar {...props} />;

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <GluestackUIProvider config={config} colorMode="dark">
          <StatusBar barStyle="light-content" backgroundColor="#020617" />
          <NavigationContainer theme={NAV_THEME}>
            {/*
             * Training is the always-mounted BLE owner (lazy: false), so the
             * radio connects and recordings flow even while the Vault tab is on
             * top. The Vault is the default/main game screen.
             */}
            <Tab.Navigator
              initialRouteName="Vault"
              tabBar={renderNeonTabBar}
              screenOptions={{headerShown: false, lazy: false}}>
              <Tab.Screen
                name="Vault"
                component={VaultScreen}
                options={{title: 'Vault'}}
              />
              <Tab.Screen
                name="Training"
                component={AbracadabraScreen}
                options={{title: 'Training'}}
              />
              <Tab.Screen
                name="Spellbook"
                component={SpellbookScreen}
                options={{title: 'Spellbook'}}
              />
            </Tab.Navigator>
          </NavigationContainer>
        </GluestackUIProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}