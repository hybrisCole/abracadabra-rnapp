import type {DecodedRecording, ImuSample} from './bleRecordingProtocol';
import {
  MIN_GESTURE_CONFIDENCE,
  filterSegmentsByConfidence,
  resolveSegmentsByPrecedence,
  segmentMeetsConfidence,
} from './segmentResolve';

export {MIN_GESTURE_CONFIDENCE};

export const GESTURE_API_BASE_URL =
  'https://abracadabragestureprocessing-production.up.railway.app';

const DEFAULT_TIMEOUT_MS = 15000;

export type MovementType = 'tap' | 'double_tap' | 'still' | 'wrist_rotation';
export type ServerMovementType = MovementType | 'silence';
export type PasswordMovementType = Exclude<MovementType, 'still'>;

export type RecordingWindowRequest = {
  window_id?: number;
  recording_id?: string;
  samples: ImuSample[];
  sample_rate_hz?: number;
};

export type LabeledRecordingWindowRequest = RecordingWindowRequest & {
  movement_type: ServerMovementType;
};

export type AnalyzeRecordingRequest = RecordingWindowRequest & {
  window_size_ms?: number;
  overlap_ms?: number;
  min_confidence?: number;
  min_segment_windows?: number;
  include_still?: boolean;
};

export type ExpectedGestureRequest = {
  movement_type: ServerMovementType;
  min_start_ms?: number;
  max_start_ms?: number;
  max_gap_ms?: number;
};

export type VerifyGesturePasswordRequest = AnalyzeRecordingRequest & {
  expected_sequence: ExpectedGestureRequest[];
};

export type ApiHealthResponse = {
  status: string;
  service: string;
  environment: string;
  port: string;
};

export type TrainModelResponse = {
  message: string;
  status: 'processing' | string;
};

export type ModelStatusResponse =
  | {
      status: 'not_trained';
      message: string;
    }
  | {
      status: 'trained';
      model_type: 'RandomForest' | string;
      movements: ServerMovementType[];
      num_movements: number;
      cross_validation?: {
        scores: number[];
        mean_accuracy: number;
        std_accuracy: number;
      };
    };

export type TrainingSampleSummary = {
  sample_id: string;
  movement_type: ServerMovementType;
  sample_count?: number;
  sample_rate_hz?: number;
  duration_ms?: number;
  created_at?: string;
};

export type TrainingSamplesResponse = {
  movements: ServerMovementType[];
  sample_counts: Partial<Record<ServerMovementType, number>>;
  total_samples: number;
  samples: TrainingSampleSummary[];
};

export type SaveTrainingSampleResponse = {
  message: string;
  sample_id: string;
  movement_type: ServerMovementType;
  path: string;
  sample_count: number;
  sample_rate_hz: number;
  duration_ms: number;
};

export type ClassifyRecordingResponse = {
  recording_id: string;
  window_id: number | null;
  sample_count: number;
  sample_rate_hz: number;
  duration_ms: number;
  predicted_movement: ServerMovementType;
  confidence: number;
  all_probabilities: Partial<Record<ServerMovementType, number>>;
};

export type GestureSegment = {
  movement_type: ServerMovementType;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  confidence: number;
  window_count: number;
};

export type RawWindowPredictions = {
  predictions: ServerMovementType[];
  smoothed_predictions: ServerMovementType[];
  confidences: number[];
  center_ms: number[];
  start_ms: number[];
  end_ms: number[];
};

export type AnalyzeRecordingResponse = {
  recording_id: string;
  window_id: number | null;
  sample_count: number;
  sample_rate_hz: number;
  duration_ms: number;
  counts: Partial<Record<ServerMovementType, number>>;
  resolved_counts?: Partial<Record<ServerMovementType, number>>;
  segments: GestureSegment[];
  resolved_segments?: GestureSegment[];
  sequence?: PasswordMovementType[];
  raw_window_predictions: RawWindowPredictions;
  window_params: {
    window_size_ms: number;
    overlap_ms: number;
    sample_rate_hz: number;
    min_confidence: number;
    min_segment_windows: number;
    include_still: boolean;
  };
};

export type VerifyGesturePasswordResponse = {
  matched: boolean;
  expected_sequence: ServerMovementType[];
  detected_sequence: ServerMovementType[];
  analysis: AnalyzeRecordingResponse;
};

export class GestureApiError extends Error {
  status?: number;
  detail?: unknown;

  constructor(message: string, status?: number, detail?: unknown) {
    super(message);
    this.name = 'GestureApiError';
    this.status = status;
    this.detail = detail;
  }
}

type JsonRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

function urlFor(path: string): string {
  return `${GESTURE_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const detail = data && typeof data === 'object' ? data : undefined;
    const serverMessage =
      detail &&
      'detail' in detail &&
      typeof (detail as {detail?: unknown}).detail === 'string'
        ? (detail as {detail: string}).detail
        : response.statusText;
    throw new GestureApiError(serverMessage, response.status, detail);
  }

  return data as T;
}

async function requestJson<T>(
  path: string,
  {method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS}: JsonRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlFor(path), {
      method,
      headers: body === undefined ? undefined : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseJsonResponse<T>(response);
  } catch (error) {
    if (error instanceof GestureApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GestureApiError('Gesture API request timed out');
    }
    const message = error instanceof Error ? error.message : 'Gesture API request failed';
    throw new GestureApiError(message);
  } finally {
    clearTimeout(timeout);
  }
}

export function recordingToRequest(
  recording: DecodedRecording,
  options: Omit<RecordingWindowRequest, 'window_id' | 'samples'> = {},
): RecordingWindowRequest {
  return {
    window_id: recording.windowId,
    samples: recording.samples,
    ...options,
  };
}

export function samplesToRequest(
  windowId: number,
  samples: ImuSample[],
  options: Omit<RecordingWindowRequest, 'window_id' | 'samples'> = {},
): RecordingWindowRequest {
  return {
    window_id: windowId,
    samples,
    ...options,
  };
}

export function filterPasswordMovements(
  movements: ServerMovementType[],
): PasswordMovementType[] {
  return movements.filter(
    (movement): movement is PasswordMovementType =>
      movement !== 'still' && movement !== 'silence',
  );
}

export function segmentsToPasswordSequence(
  segments: GestureSegment[],
  minConfidence: number = MIN_GESTURE_CONFIDENCE,
): PasswordMovementType[] {
  return filterPasswordMovements(
    segments
      .filter(segment => segmentMeetsConfidence(segment, minConfidence))
      .map(segment => segment.movement_type),
  );
}

export function normalizeAnalyzeRecordingResponse(
  response: AnalyzeRecordingResponse,
): AnalyzeRecordingResponse {
  const resolved_segments = filterSegmentsByConfidence(
    response.resolved_segments != null && response.resolved_segments.length > 0
      ? response.resolved_segments
      : resolveSegmentsByPrecedence(response.segments),
  );
  const sequence = segmentsToPasswordSequence(resolved_segments);

  return {
    ...response,
    resolved_segments,
    sequence,
  };
}

/** Prefer server-resolved sequence; fall back to client-side precedence resolve. */
export function analysisToPasswordSequence(
  analysis: Pick<
    AnalyzeRecordingResponse,
    'sequence' | 'resolved_segments' | 'segments'
  >,
): PasswordMovementType[] {
  if (analysis.sequence != null) {
    return filterPasswordMovements(analysis.sequence);
  }
  if (analysis.resolved_segments != null && analysis.resolved_segments.length > 0) {
    return segmentsToPasswordSequence(analysis.resolved_segments);
  }
  return segmentsToPasswordSequence(
    resolveSegmentsByPrecedence(analysis.segments),
  );
}

export const gestureApi = {
  health: () => requestJson<ApiHealthResponse>('/health'),

  getModelStatus: () => requestJson<ModelStatusResponse>('/api/model-status'),

  trainModel: () =>
    requestJson<TrainModelResponse>('/api/train', {
      method: 'POST',
      timeoutMs: 30000,
    }),

  listTrainingSamples: () =>
    requestJson<TrainingSamplesResponse>('/api/training-samples'),

  saveTrainingSample: (payload: LabeledRecordingWindowRequest) =>
    requestJson<SaveTrainingSampleResponse>('/api/training-samples', {
      method: 'POST',
      body: payload,
    }),

  classifyRecording: (payload: RecordingWindowRequest) =>
    requestJson<ClassifyRecordingResponse>('/api/recordings/classify', {
      method: 'POST',
      body: payload,
    }),

  analyzeRecording: async (payload: AnalyzeRecordingRequest) => {
    const response = await requestJson<AnalyzeRecordingResponse>(
      '/api/recordings/analyze',
      {
        method: 'POST',
        body: payload,
        timeoutMs: 30000,
      },
    );
    return normalizeAnalyzeRecordingResponse(response);
  },

  verifyGesturePassword: (payload: VerifyGesturePasswordRequest) =>
    requestJson<VerifyGesturePasswordResponse>('/api/gesture-passwords/verify', {
      method: 'POST',
      body: payload,
      timeoutMs: 30000,
    }),
};
