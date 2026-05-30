import {State} from 'react-native-ble-plx';

import type {LinkBadgeStatus} from '../../BleLinkStatusBadge';

export type ScanOutcome = 'idle' | 'scanning' | 'found' | 'not-found';
export type ConnPhase = 'off' | 'connecting' | 'linked' | 'error';

/**
 * Raw BLE/recording facts the status ladder is derived from. These are published
 * by the BLE owner component (see App.tsx) so any screen — Training or the Vault
 * game HUD — can derive the same status without owning the radio.
 */
export type SessionFacts = {
  bleState: State;
  scanOutcome: ScanOutcome;
  scanning: boolean;
  hasTarget: boolean;
  connPhase: ConnPhase;
  reconnectAttempt: number;
  recvActive: boolean;
  arming: boolean;
  processingCapture: boolean;
  showFreshConnected: boolean;
};

export const INITIAL_FACTS: SessionFacts = {
  bleState: State.Unknown,
  scanOutcome: 'idle',
  scanning: false,
  hasTarget: false,
  connPhase: 'off',
  reconnectAttempt: 0,
  recvActive: false,
  arming: false,
  processingCapture: false,
  showFreshConnected: false,
};

/**
 * Status state machine (ported from the original AbracadabraScreen useMemo ladder).
 * Pure function of facts so it can be unit-tested and shared by every screen.
 */
export function computeLinkStatus(f: SessionFacts): LinkBadgeStatus {
  if (f.bleState !== State.PoweredOn) {
    return 'disconnected';
  }
  if (f.scanOutcome === 'not-found' || f.connPhase === 'error') {
    return 'disconnected';
  }
  if (f.scanning) {
    return 'connecting';
  }
  if (!f.hasTarget) {
    return 'disconnected';
  }
  if (f.connPhase === 'connecting' && f.reconnectAttempt > 0) {
    return 'retry';
  }
  if (f.connPhase === 'connecting') {
    return 'connecting';
  }
  if (f.processingCapture || f.recvActive) {
    return 'processing';
  }
  if (f.arming) {
    return 'recording';
  }
  if (f.connPhase === 'linked') {
    return f.showFreshConnected ? 'connected' : 'linked';
  }
  return 'disconnected';
}

/**
 * The Vault HUD shows a superset of the link status: the live connection status,
 * plus the game-only "analyzing/unlocked/denied" outcomes layered on top.
 */
export type VaultStatus =
  | LinkBadgeStatus
  | 'analyzing'
  | 'unlocked'
  | 'denied';
