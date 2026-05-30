import {create} from 'zustand';
import {createJSONStorage, persist, type StateStorage} from 'zustand/middleware';

import type {PasswordMovementType} from '../../gestureApi';
import type {Spell, UnlockAction} from './spell';

/**
 * Persistent storage backed by MMKV. MMKV is a native module; if it is not yet
 * linked (e.g. before `pod install`), we degrade gracefully to an in-memory map
 * so the JS bundle still runs — spells just won't survive a restart until the
 * native module is available.
 */
function createSpellStorage(): StateStorage {
  try {
    // Require lazily so a missing native module can't crash module init.
    const {createMMKV} = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const mmkv = createMMKV({id: 'abracadabra-spellbook'});
    return {
      getItem: name => mmkv.getString(name) ?? null,
      setItem: (name, value) => mmkv.set(name, value),
      removeItem: name => {
        mmkv.remove(name);
      },
    };
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[spellbook] MMKV unavailable; spells will not persist this session',
        error,
      );
    }
    const memory = new Map<string, string>();
    return {
      getItem: name => memory.get(name) ?? null,
      setItem: (name, value) => {
        memory.set(name, value);
      },
      removeItem: name => {
        memory.delete(name);
      },
    };
  }
}

type SpellbookStore = {
  spells: Spell[];
  addSpell: (input: {
    name: string;
    sequence: PasswordMovementType[];
    action: UnlockAction;
  }) => void;
  updateSpell: (id: string, patch: Partial<Omit<Spell, 'id'>>) => void;
  removeSpell: (id: string) => void;
  toggleSpell: (id: string) => void;
};

function makeId(): string {
  return `spell_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export const useSpellbookStore = create<SpellbookStore>()(
  persist(
    set => ({
      spells: [],

      addSpell: input =>
        set(state => ({
          spells: [
            ...state.spells,
            {
              id: makeId(),
              name: input.name,
              sequence: input.sequence,
              action: input.action,
              enabled: true,
              createdAt: Date.now(),
            },
          ],
        })),

      updateSpell: (id, patch) =>
        set(state => ({
          spells: state.spells.map(s => (s.id === id ? {...s, ...patch} : s)),
        })),

      removeSpell: id =>
        set(state => ({spells: state.spells.filter(s => s.id !== id)})),

      toggleSpell: id =>
        set(state => ({
          spells: state.spells.map(s =>
            s.id === id ? {...s, enabled: !s.enabled} : s,
          ),
        })),
    }),
    {
      name: 'abracadabra-spellbook-v1',
      storage: createJSONStorage(createSpellStorage),
    },
  ),
);
