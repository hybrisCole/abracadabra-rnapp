/**
 * Abracadabra BLE recording transfer:
 * - META notify on ADAB0003 (small, reliable): window, sample count, total bytes, CRC-32.
 * - Payload: central writes uint32 LE offset to ADAB0004, reads slice from ADAB0005 (GATT pull).
 */

import type {Device} from 'react-native-ble-plx';

export const ABRACADABRA_SERVICE_UUID =
  'ADAB0001-0000-1000-8000-00805F9B34FB';
export const ABRACADABRA_STREAM_CHAR_UUID =
  'ADAB0003-0000-1000-8000-00805F9B34FB';
export const ABRACADABRA_PULL_CTRL_UUID =
  'ADAB0004-0000-1000-8000-00805F9B34FB';
export const ABRACADABRA_PULL_DATA_UUID =
  'ADAB0005-0000-1000-8000-00805F9B34FB';

const FRAME_MAGIC = 0xadab;

export const BLE_PACKED_SAMPLE_BYTES = 14;

export type ImuSample = {
  t_ms: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export type DecodedRecording = {
  windowId: number;
  samples: ImuSample[];
};

export type FeedResult =
  | {kind: 'idle'}
  | {
      kind: 'pull_pending';
      windowId: number;
      samples: number;
      totalBytes: number;
      crcExpected: number;
      recvEpoch: number;
    }
  | {kind: 'error'; message: string};

/** IEEE CRC-32 over full packed payload (same loop as firmware crc32Ieee). */
export function crc32Ieee(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & (crc & 1 ? 0xffffffff : 0));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readU16Le(d: DataView, o: number): number {
  return d.getUint16(o, true);
}

function readU32Le(d: DataView, o: number): number {
  return d.getUint32(o, true);
}

export function parsePackedSamples(buffer: Uint8Array): ImuSample[] {
  const stride = BLE_PACKED_SAMPLE_BYTES;
  if (buffer.byteLength % stride !== 0) {
    return [];
  }
  const n = buffer.byteLength / stride;
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const out: ImuSample[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    out.push({
      t_ms: dv.getUint16(o, true),
      ax: dv.getInt16(o + 2, true),
      ay: dv.getInt16(o + 4, true),
      az: dv.getInt16(o + 6, true),
      gx: dv.getInt16(o + 8, true),
      gy: dv.getInt16(o + 10, true),
      gz: dv.getInt16(o + 12, true),
    });
  }
  return out;
}

const PK_META = 1;

/** META framed payload after 4-byte header (matches firmware meta[16]). */
const META_PAYLOAD_LEN = 16;

const MAX_PAYLOAD_BYTES = 24000;

const SILENT_RESET_REASONS = new Set([
  'scan again',
  'effect cleanup',
  'Disconnected',
]);

function hexPrefix(u8: Uint8Array, maxBytes = 14): string {
  const n = Math.min(maxBytes, u8.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(u8[i].toString(16).padStart(2, '0'));
  }
  let s = parts.join(' ');
  if (u8.byteLength > n) {
    s += ' …';
  }
  return s;
}

function logBleRx(tag: string, detail?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[BleRx]', tag, detail ?? '');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  const btoaFn = (globalThis as unknown as {btoa: (s: string) => string}).btoa;
  return btoaFn(bin);
}

function base64ToBytesLocal(b64: string): Uint8Array {
  const atobFn = (globalThis as unknown as {atob: (s: string) => string}).atob;
  const binary = atobFn(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Download packed recording bytes via GATT write-offset + read-slice (flow-controlled).
 */
export async function pullPackedPayloadFromPeripheral(
  device: Device,
  totalBytes: number,
  onProgress?: (filled: number, total: number) => void,
): Promise<Uint8Array> {
  const buf = new Uint8Array(totalBytes);
  let offset = 0;
  const ctrl = new Uint8Array(4);

  while (offset < totalBytes) {
    new DataView(ctrl.buffer).setUint32(0, offset, true);
    await device.writeCharacteristicWithResponseForService(
      ABRACADABRA_SERVICE_UUID,
      ABRACADABRA_PULL_CTRL_UUID,
      bytesToBase64(ctrl),
    );

    const ch = await device.readCharacteristicForService(
      ABRACADABRA_SERVICE_UUID,
      ABRACADABRA_PULL_DATA_UUID,
    );

    if (ch.value == null || ch.value === '') {
      throw new Error('GATT pull read returned empty');
    }

    const chunk = base64ToBytesLocal(ch.value);
    if (chunk.length === 0) {
      throw new Error('Peripheral returned zero-length slice (link lost or pull not ready)');
    }
    if (offset + chunk.length > totalBytes) {
      throw new Error('Pull slice overflow');
    }
    buf.set(chunk, offset);
    offset += chunk.length;
    onProgress?.(offset, totalBytes);
  }

  return buf;
}

/**
 * Parses META notify only (legacy stray packets ignored).
 */
export class RecordingAssembler {
  private recvEpoch = 0;

  reset(reason?: string): void {
    if (__DEV__ && reason != null && reason !== '') {
      if (!SILENT_RESET_REASONS.has(reason)) {
        console.warn('[RecordingAssembler]', reason);
      }
    }
  }

  feed(packet: Uint8Array): FeedResult {
    if (packet.byteLength < 4) {
      return {kind: 'idle'};
    }
    const dv = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const magic = readU16Le(dv, 0);
    if (magic !== FRAME_MAGIC) {
      this.reset('bad magic');
      return {kind: 'error', message: 'Bad frame magic'};
    }
    const pktType = packet[2];

    if (pktType !== PK_META) {
      return {kind: 'idle'};
    }

    logBleRx('frame', {
      pktType,
      byteLength: packet.byteLength,
      headHex: hexPrefix(packet.subarray(0, Math.min(24, packet.byteLength))),
    });

    if (packet.byteLength < 4 + META_PAYLOAD_LEN) {
      return {kind: 'error', message: 'META too short'};
    }
    const win = readU16Le(dv, 4);
    const samples = readU16Le(dv, 6);
    const totalBytes = readU32Le(dv, 8);
    const proto = packet[12];
    const crcExpected = readU32Le(dv, 16);

    if (proto !== 1) {
      return {kind: 'error', message: `Unsupported proto ${proto}`};
    }
    const expectedFromSamples = samples * BLE_PACKED_SAMPLE_BYTES;
    if (totalBytes !== expectedFromSamples) {
      return {kind: 'error', message: 'META totalBytes mismatch'};
    }
    if (totalBytes === 0 || totalBytes > MAX_PAYLOAD_BYTES) {
      return {kind: 'error', message: 'META invalid size'};
    }

    this.recvEpoch += 1;
    logBleRx('META ok (pull)', {
      recvEpoch: this.recvEpoch,
      windowId: win,
      samples,
      totalBytes,
      crc: crcExpected.toString(16),
    });

    return {
      kind: 'pull_pending',
      windowId: win,
      samples,
      totalBytes,
      crcExpected,
      recvEpoch: this.recvEpoch,
    };
  }
}

export async function finalizeRecordingFromPull(
  windowId: number,
  samples: number,
  crcExpected: number,
  payload: Uint8Array,
): Promise<DecodedRecording | {error: string}> {
  if (payload.byteLength !== samples * BLE_PACKED_SAMPLE_BYTES) {
    return {error: 'Recording size mismatch'};
  }
  const crcGot = crc32Ieee(payload);
  if (crcGot !== crcExpected) {
    return {error: 'CRC mismatch'};
  }
  const parsed = parsePackedSamples(payload);
  if (parsed.length !== samples) {
    return {error: 'Sample parse mismatch'};
  }
  return {windowId, samples: parsed};
}
