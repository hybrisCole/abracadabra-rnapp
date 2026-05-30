/**
 * Thin wrapper around react-native-haptic-feedback (iOS Taptic Engine). Guarded
 * so a missing native module (pre-`pod install`) no-ops instead of crashing.
 */
const OPTIONS = {enableVibrateFallback: true, ignoreAndroidSystemSettings: false};

type HapticKind = 'success' | 'error' | 'impact' | 'select';

const NAME: Record<HapticKind, string> = {
  success: 'notificationSuccess',
  error: 'notificationError',
  impact: 'impactHeavy',
  select: 'selection',
};

export function haptic(kind: HapticKind): void {
  try {
    const mod = require('react-native-haptic-feedback');
    const trigger = mod.trigger ?? mod.default?.trigger;
    trigger?.(NAME[kind], OPTIONS);
  } catch {
    // Native module unavailable — silently skip.
  }
}
