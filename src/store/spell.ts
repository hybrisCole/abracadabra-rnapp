import type {PasswordMovementType} from '../../gestureApi';

/**
 * What happens in the real world when a gesture combination is recognized.
 * BLE is inbound-only (the wearable never receives commands), so every action
 * is performed by the phone — via iOS URL schemes or network requests.
 */
export type UnlockAction =
  | {type: 'open_url'; url: string}
  | {type: 'sms'; phone: string; body?: string}
  | {
      type: 'http';
      method: 'GET' | 'POST';
      url: string;
      headers?: Record<string, string>;
      body?: string;
    }
  | {type: 'notify'; title: string; body?: string};

/** A saved combination → action mapping (the "spellbook" entry). */
export type Spell = {
  id: string;
  name: string;
  sequence: PasswordMovementType[];
  action: UnlockAction;
  enabled: boolean;
  createdAt: number;
};

export function describeAction(action: UnlockAction): string {
  switch (action.type) {
    case 'open_url':
      return `Open ${action.url}`;
    case 'sms':
      return `SMS to ${action.phone}`;
    case 'http':
      return `${action.method} ${action.url}`;
    case 'notify':
      return `Notify: ${action.title}`;
    default:
      return 'Unknown action';
  }
}

export function formatSequence(sequence: PasswordMovementType[]): string {
  return sequence.length > 0 ? sequence.join(' → ') : 'no gesture';
}

export function sequencesMatch(
  a: PasswordMovementType[],
  b: PasswordMovementType[],
): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/**
 * Find the first enabled spell whose sequence exactly matches the detected one.
 * Returns null on no match (→ "denied").
 */
export function matchSpell(
  spells: Spell[],
  detected: PasswordMovementType[],
): Spell | null {
  if (detected.length === 0) {
    return null;
  }
  return (
    spells.find(s => s.enabled && sequencesMatch(s.sequence, detected)) ?? null
  );
}
