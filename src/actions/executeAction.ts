import {Linking} from 'react-native';

import type {UnlockAction} from '../store/spell';

export type ActionResult = {ok: boolean; message: string};

/**
 * Perform the real-world effect for a matched spell. BLE is inbound-only, so
 * every effect runs on the phone:
 *  - open_url: deep link / website (YouTube, etc.) via Linking
 *  - sms:      opens the iOS Messages composer (user taps send — iOS cannot
 *              silently send an SMS)
 *  - http:     fetch to a webhook / smart-home endpoint (lights, vault, IFTTT,
 *              Home Assistant) — the universal "do anything physical" action
 *  - notify:   app-side message surfaced in the HUD
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
      case 'notify': {
        return {ok: true, message: action.title};
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
