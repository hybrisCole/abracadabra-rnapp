/**
 * Abracadabra BLE recording transfer:
 * - ADAB0003 NOTIFY framed packets: magic 0xADAB LE, pkt byte, reserved, payload.
 * - RECORDING_PENDING (pkt 4): 4 B payload — window_id u16 LE, proto_ver u8 — sent when DT is accepted.
 * - META (pkt 1): window, sample count, total bytes, CRC-32 — after capture.
 * - CHUNK (pkt 2): window_id u16, byte offset u32, data_len u16, then packed bytes.
 * - COMMIT (pkt 3): window_id, total bytes, CRC-32; app accepts only after full CRC/decode.
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
  | {kind: 'recording_pending'; windowId: number}
  | {
    kind: 'transfer_started';
    windowId: number;
    samples: number;
    totalBytes: number;
    crcExpected: number;
    recvEpoch: number;
  }
  | {kind: 'transfer_progress'; windowId: number; filled: number; total: number}
  | {
    kind: 'transfer_complete';
    windowId: number;
    samples: number;
    totalBytes: number;
    crcExpected: number;
    payload: Uint8Array;
  }
  | {
    kind: 'notify_incomplete';
    windowId: number;
    samples: number;
    totalBytes: number;
    crcExpected: number;
    receivedBytes: number;
  }
  | {kind: 'error'; message: string};

/** IEEE CRC-32 over full packed payload (same loop as firmware crc32Ieee). */
/* eslint-disable no-bitwise -- CRC-32 is defined in terms of bitwise operations. */
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
/* eslint-enable no-bitwise */

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
const PK_CHUNK = 2;
const PK_COMMIT = 3;
/** Firmware sends this immediately after an accepted double-tap, just before IMU capture. */
const PK_RECORDING_PENDING = 4;
const RECORDING_PENDING_PAYLOAD_LEN = 4;

/** META framed payload after 4-byte header (matches firmware meta[16]). */
const META_PAYLOAD_LEN = 16;
const CHUNK_PAYLOAD_HEADER_LEN = 8;
const COMMIT_PAYLOAD_LEN = 12;

const MAX_PAYLOAD_BYTES = 24000;

type NotifyTransferState = {
  windowId: number;
  samples: number;
  totalBytes: number;
  crcExpected: number;
  payload: Uint8Array;
  receivedMask: Uint8Array;
  receivedBytes: number;
  nextLogBytes: number;
};

const SILENT_RESET_REASONS = new Set([
  'scan again',
  'effect cleanup',
  'Disconnected',
  'fallback pull starting',
  'fallback complete',
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

function logBlePull(tag: string, detail?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log('[BlePull]', tag, detail ?? '');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      value => {
        clearTimeout(t);
        resolve(value);
      },
      error => {
        clearTimeout(t);
        reject(error);
      },
    );
  });
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
  const startedAt = Date.now();

  logBlePull('start', {totalBytes});

  while (offset < totalBytes) {
    new DataView(ctrl.buffer).setUint32(0, offset, true);
    logBlePull('write offset', {offset});
    await withTimeout(
      device.writeCharacteristicWithResponseForService(
        ABRACADABRA_SERVICE_UUID,
        ABRACADABRA_PULL_CTRL_UUID,
        bytesToBase64(ctrl),
      ),
      8000,
      `GATT offset write at ${offset}`,
    );

    logBlePull('read slice', {offset});
    const ch = await withTimeout(
      device.readCharacteristicForService(
        ABRACADABRA_SERVICE_UUID,
        ABRACADABRA_PULL_DATA_UUID,
      ),
      8000,
      `GATT slice read at ${offset}`,
    );

    if (ch.value == null || ch.value === '') {
      throw new Error('GATT pull read returned empty');
    }

    const chunk = base64ToBytesLocal(ch.value);
    if (chunk.length === 0) {
      throw new Error('Peripheral returned zero-length slice (link lost or pull not ready)');
    }
    const remaining = totalBytes - offset;
    let bytesToCopy = chunk.length;
    if (chunk.length > remaining) {
      bytesToCopy = remaining;
    }
    if (__DEV__ && bytesToCopy !== chunk.length) {
      console.warn('[BlePull] trimming final slice', {
        offset,
        totalBytes,
        remaining,
        received: chunk.length,
      });
    }
    buf.set(chunk.subarray(0, bytesToCopy), offset);
    offset += bytesToCopy;
    logBlePull('progress', {
      filled: offset,
      totalBytes,
      chunkBytes: bytesToCopy,
      elapsedMs: Date.now() - startedAt,
    });
    onProgress?.(offset, totalBytes);
  }

  logBlePull('complete', {totalBytes, elapsedMs: Date.now() - startedAt});
  return buf;
}

/**
 * Parses NOTIFY frames from ADAB0003 (RECORDING_PENDING, META, etc.).
 */
export class RecordingAssembler {
  private recvEpoch = 0;
  private notifyTransfer: NotifyTransferState | null = null;

  reset(reason?: string): void {
    if (__DEV__ && reason != null && reason !== '') {
      if (!SILENT_RESET_REASONS.has(reason)) {
        console.warn('[RecordingAssembler]', reason);
      }
    }
    this.notifyTransfer = null;
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

    if (pktType === PK_RECORDING_PENDING) {
      if (packet.byteLength < 4 + RECORDING_PENDING_PAYLOAD_LEN) {
        return {kind: 'error', message: 'RECORDING_PENDING too short'};
      }
      const windowId = readU16Le(dv, 4);
      const proto = packet[6];
      if (proto !== 1) {
        return {
          kind: 'error',
          message: `RECORDING_PENDING unsupported proto ${proto}`,
        };
      }
      logBleRx('RECORDING_PENDING', {windowId});
      return {kind: 'recording_pending', windowId};
    }

    if (pktType === PK_META) {
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
      this.notifyTransfer = {
        windowId: win,
        samples,
        totalBytes,
        crcExpected,
        payload: new Uint8Array(totalBytes),
        receivedMask: new Uint8Array(totalBytes),
        receivedBytes: 0,
        nextLogBytes: Math.min(1024, totalBytes),
      };
      logBleRx('META ok (notify chunks)', {
        recvEpoch: this.recvEpoch,
        windowId: win,
        samples,
        totalBytes,
        crc: crcExpected.toString(16),
      });

      return {
        kind: 'transfer_started',
        windowId: win,
        samples,
        totalBytes,
        crcExpected,
        recvEpoch: this.recvEpoch,
      };
    }

    if (pktType === PK_CHUNK) {
      const transfer = this.notifyTransfer;
      if (transfer == null) {
        logBleRx('CHUNK without active transfer', {
          byteLength: packet.byteLength,
          headHex: hexPrefix(packet.subarray(0, Math.min(24, packet.byteLength))),
        });
        return {kind: 'idle'};
      }
      if (packet.byteLength < 4 + CHUNK_PAYLOAD_HEADER_LEN) {
        return {kind: 'error', message: 'CHUNK too short'};
      }
      const win = readU16Le(dv, 4);
      const offset = readU32Le(dv, 6);
      const dataLen = readU16Le(dv, 10);
      const dataStart = 4 + CHUNK_PAYLOAD_HEADER_LEN;
      const dataEnd = dataStart + dataLen;
      if (win !== transfer.windowId) {
        return {kind: 'error', message: 'CHUNK window mismatch'};
      }
      if (dataLen === 0 || dataEnd > packet.byteLength) {
        return {kind: 'error', message: 'CHUNK length mismatch'};
      }
      if (offset + dataLen > transfer.totalBytes) {
        return {kind: 'error', message: 'CHUNK offset out of range'};
      }

      transfer.payload.set(packet.subarray(dataStart, dataEnd), offset);
      for (let i = 0; i < dataLen; i++) {
        const at = offset + i;
        if (transfer.receivedMask[at] === 0) {
          transfer.receivedMask[at] = 1;
          transfer.receivedBytes += 1;
        }
      }
      if (
        transfer.receivedBytes >= transfer.nextLogBytes ||
        transfer.receivedBytes === transfer.totalBytes
      ) {
        logBleRx('CHUNK progress', {
          windowId: transfer.windowId,
          receivedBytes: transfer.receivedBytes,
          totalBytes: transfer.totalBytes,
          offset,
          dataLen,
        });
        transfer.nextLogBytes = Math.min(
          transfer.nextLogBytes + 1024,
          transfer.totalBytes,
        );
      }
      return {
        kind: 'transfer_progress',
        windowId: transfer.windowId,
        filled: transfer.receivedBytes,
        total: transfer.totalBytes,
      };
    }

    if (pktType === PK_COMMIT) {
      const transfer = this.notifyTransfer;
      if (transfer == null) {
        logBleRx('COMMIT without active transfer', {
          byteLength: packet.byteLength,
          headHex: hexPrefix(packet.subarray(0, Math.min(24, packet.byteLength))),
        });
        return {kind: 'idle'};
      }
      if (packet.byteLength < 4 + COMMIT_PAYLOAD_LEN) {
        return {kind: 'error', message: 'COMMIT too short'};
      }
      const win = readU16Le(dv, 4);
      const totalBytes = readU32Le(dv, 6);
      const crcExpected = readU32Le(dv, 10);
      const proto = packet[14];
      if (proto !== 1) {
        return {kind: 'error', message: `COMMIT unsupported proto ${proto}`};
      }
      if (
        win !== transfer.windowId ||
        totalBytes !== transfer.totalBytes ||
        crcExpected !== transfer.crcExpected
      ) {
        return {kind: 'error', message: 'COMMIT metadata mismatch'};
      }
      if (transfer.receivedBytes !== transfer.totalBytes) {
        logBleRx('COMMIT incomplete', {
          windowId: transfer.windowId,
          receivedBytes: transfer.receivedBytes,
          totalBytes: transfer.totalBytes,
        });
        const incomplete = {
          kind: 'notify_incomplete' as const,
          windowId: transfer.windowId,
          samples: transfer.samples,
          totalBytes: transfer.totalBytes,
          crcExpected: transfer.crcExpected,
          receivedBytes: transfer.receivedBytes,
        };
        this.notifyTransfer = null;
        return {
          ...incomplete,
        };
      }

      const payload = transfer.payload;
      this.notifyTransfer = null;
      logBleRx('COMMIT ok (notify chunks)', {
        windowId: win,
        totalBytes,
        crc: crcExpected.toString(16),
      });
      return {
        kind: 'transfer_complete',
        windowId: win,
        samples: transfer.samples,
        totalBytes,
        crcExpected,
        payload,
      };
    }

    return {kind: 'idle'};
  }
}

export async function finalizeRecordingPayload(
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
