import {create} from 'zustand';

import type {DecodedRecording} from '../../bleRecordingProtocol';
import {
  computeLinkStatus,
  INITIAL_FACTS,
  type SessionFacts,
  type VaultStatus,
} from './selectors';

/**
 * Live session store. The BLE owner component publishes raw facts + the latest
 * recording here; the Vault game screen reads derived status and reacts to new
 * recordings. This is the single source of truth for the cross-screen state
 * machine (the imperative BLE plumbing still lives in the BLE owner component).
 */
type SessionStore = {
  facts: SessionFacts;
  /** Latest decoded recording from the wearable (full samples for analysis). */
  lastRecording: DecodedRecording | null;
  /** Increments each time a NEW recording arrives — the Vault watches this. */
  recordingNonce: number;

  /** Game outcome overlay; null means "show live link status". */
  vaultResult: 'unlocked' | 'denied' | null;
  /** True while the Vault is running its own analysis of a fresh recording. */
  vaultAnalyzing: boolean;
  /** Human-readable line shown under the HUD after a result. */
  vaultMessage: string | null;
  /** Name of the spell that matched (for the unlocked banner). */
  vaultMatchedSpell: string | null;

  publishFacts: (facts: SessionFacts) => void;
  publishRecording: (recording: DecodedRecording | null) => void;
  setVaultAnalyzing: (analyzing: boolean) => void;
  setVaultResult: (
    result: 'unlocked' | 'denied' | null,
    detail?: {message?: string | null; matchedSpell?: string | null},
  ) => void;
  clearVaultResult: () => void;
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  facts: INITIAL_FACTS,
  lastRecording: null,
  recordingNonce: 0,
  vaultResult: null,
  vaultAnalyzing: false,
  vaultMessage: null,
  vaultMatchedSpell: null,

  publishFacts: facts => set({facts}),

  publishRecording: recording =>
    set(state => ({
      lastRecording: recording,
      recordingNonce:
        recording != null && recording !== state.lastRecording
          ? state.recordingNonce + 1
          : state.recordingNonce,
    })),

  setVaultAnalyzing: vaultAnalyzing => set({vaultAnalyzing}),

  setVaultResult: (vaultResult, detail) =>
    set({
      vaultResult,
      vaultAnalyzing: false,
      vaultMessage: detail?.message ?? get().vaultMessage,
      vaultMatchedSpell: detail?.matchedSpell ?? null,
    }),

  clearVaultResult: () =>
    set({vaultResult: null, vaultMessage: null, vaultMatchedSpell: null}),
}));

/** Derived Vault HUD status: result overlay > analyzing > live link status. */
export function selectVaultStatus(s: SessionStore): VaultStatus {
  if (s.vaultResult != null) {
    return s.vaultResult;
  }
  if (s.vaultAnalyzing) {
    return 'analyzing';
  }
  return computeLinkStatus(s.facts);
}
