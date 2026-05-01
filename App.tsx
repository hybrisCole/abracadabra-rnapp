/**
 * Cyberpunk BLE scanner UI — react-native-ble-plx + Skia
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
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

const TARGET_BLE_NAME = 'XA_Abracadabra';
const SCAN_DURATION_MS = 5000;

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
  status,
  pulse,
  resultAnim,
}: {
  status: ScanOutcome;
  pulse: Animated.Value;
  resultAnim: Animated.Value;
}): React.JSX.Element {
  const isFound = status === 'found';
  const isMissing = status === 'not-found';
  const glowColor = isMissing ? '#ff3864' : isFound ? '#7cffd4' : '#00f5ff';
  const orbitColor = isMissing ? '#ff7a90' : '#d946ef';
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.08],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48, 1],
  });
  const resultScale = resultAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });

  return (
    <View style={styles.orbFrame}>
      <Animated.View
        style={[
          styles.orbPulse,
          {
            borderColor: glowColor,
            shadowColor: glowColor,
            opacity,
            transform: [{scale}],
          },
        ]}
      />
      <Canvas style={styles.orbCanvas}>
        <Circle cx={108} cy={108} r={92} color="rgba(0,245,255,0.10)" />
        <Circle cx={108} cy={108} r={68} color="rgba(217,70,239,0.12)" />
        <Circle cx={108} cy={108} r={34} color={glowColor}>
          <BlurMask blur={18} style="normal" />
        </Circle>
        <Circle cx={108} cy={108} r={6} color="#f8fafc" />
        <Circle cx={108} cy={108} r={92} color="transparent" style="stroke" strokeWidth={2} />
        <Circle cx={108} cy={108} r={58} color={orbitColor} style="stroke" strokeWidth={1.5} />
      </Canvas>
      <Animated.Text
        style={[
          styles.orbGlyph,
          isMissing && styles.orbGlyphWarning,
          (isFound || isMissing) && {
            opacity: resultAnim,
            transform: [{scale: resultScale}],
          },
        ]}>
        {isFound ? 'ONLINE' : isMissing ? 'NO SIGNAL' : 'FINDING'}
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
    if (scanOutcome === 'found' || scanOutcome === 'not-found') {
      Animated.spring(resultAnim, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }).start();
    }
  }, [resultAnim, scanOutcome]);

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
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <NeonBackdrop variant={scanOutcome} />
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.kicker}>ABRACADABRA LINK</Text>
          <Text style={styles.title}>Neon BLE Scanner</Text>
          <Text style={styles.sub}>
            Target: <Text style={styles.inlineCode}>{TARGET_BLE_NAME}</Text> · CoreBluetooth:{' '}
            {bleState}
          </Text>
        </View>

        <View style={styles.heroCard}>
          <CyberOrb status={scanOutcome} pulse={pulse} resultAnim={resultAnim} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>
              {targetDevice
                ? 'Wearable Found'
                : scanOutcome === 'not-found'
                  ? 'Wearable Not Present'
                  : scanning
                    ? 'Finding Device'
                    : bleState === State.PoweredOn
                      ? 'Preparing Scanner'
                      : 'Bluetooth Not Ready'}
            </Text>
            <Text style={styles.statusBody}>
              {targetDevice
                ? `${TARGET_BLE_NAME} responded at ${formatRssi(targetDevice.rssi)}. The controller is advertising and ready for the connect/discover step.`
                : scanOutcome === 'not-found'
                  ? 'No controller signature appeared in 5 seconds. Check the troubleshooting steps below, then retry.'
                  : scanning
                    ? 'Searching for the wearable automatically. Keep the phone nearby while the scanner listens for BLE advertisements.'
                    : bleState === State.PoweredOn
                      ? 'Warming up the scanner and preparing to search for the wearable.'
                      : 'Turn on Bluetooth permission/radio so the scanner can start.'}
            </Text>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.resultBurst,
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
                  scanOutcome === 'not-found' && styles.resultBurstTextWarning,
                ]}>
                {scanOutcome === 'found'
                  ? 'Haptic confirmation sent'
                  : scanOutcome === 'not-found'
                    ? 'Missing-device alert sent'
                    : ''}
              </Text>
            </Animated.View>
          </View>
        </View>

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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#020617',
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
  shell: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  header: {marginBottom: 18},
  kicker: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 8,
    color: '#f8fafc',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
  },
  sub: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
  },
  inlineCode: {
    color: '#22d3ee',
    fontFamily: 'Menlo',
    fontWeight: '700',
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
  orbFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 230,
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
  orbCanvas: {
    width: 216,
    height: 216,
  },
  orbGlyph: {
    position: 'absolute',
    bottom: 24,
    color: '#a7f3d0',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
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
  statusBody: {
    marginTop: 8,
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22,
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
  resultBurstText: {
    color: '#a7f3d0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
});

export default App;
