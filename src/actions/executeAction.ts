import {Linking} from 'react-native';

import type {UnlockAction} from '../store/spell';

export type ActionResult = {ok: boolean; message: string};

/** Strip formatting for tel: while preserving a leading country code. */
function phoneForTelUri(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }
  return trimmed.replace(/\D/g, '');
}

/**
 * Perform the real-world effect for a matched spell. BLE is inbound-only, so
 * every effect runs on the phone:
 *  - open_url: deep link / website (YouTube, etc.) via Linking
 *  - sms:      opens the iOS Messages composer (user taps send — iOS cannot
 *              silently send an SMS)
 *  - http:     fetch to a webhook / smart-home endpoint (lights, vault, IFTTT,
 *              Home Assistant) — the universal "do anything physical" action
 *  - call:     opens the Phone app to dial a contact chosen in the Spellbook
 */
export async function executeAction(action: UnlockAction): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'open_url': {
        await Linking.openURL(action.url);
        return {ok: true, message: `Opened ${action.url}`};
      }
      case 'sms': {
        const query =
          action.body != null && action.body.length > 0
            ? `&body=${encodeURIComponent(action.body)}`
            : '';
        await Linking.openURL(`sms:${action.phone}${query}`);
        return {ok: true, message: `Messaging ${action.phone}`};
      }
      case 'http': {
        const response = await fetch(action.url, {
          method: action.method,
          headers: action.headers,
          body: action.method === 'POST' ? action.body : undefined,
        });
        if (!response.ok) {
          return {
            ok: false,
            message: `Endpoint returned ${response.status}`,
          };
        }
        return {ok: true, message: `Triggered ${action.url}`};
      }
      case 'call': {
        const tel = phoneForTelUri(action.phone);
        if (tel.length === 0) {
          return {ok: false, message: 'Spell has no phone number'};
        }
        const url = `tel:${tel}`;
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) {
          return {ok: false, message: 'Cannot open the Phone app'};
        }
        await Linking.openURL(url);
        const who = action.contactName ?? action.phone;
        return {ok: true, message: `Calling ${who}`};
      }
      default: {
        return {ok: false, message: 'Unknown action'};
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return {ok: false, message};
  }
}
