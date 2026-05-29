import type {GestureSegment, ServerMovementType} from './gestureApi';

const PRECEDENCE: Record<ServerMovementType, number> = {
  wrist_rotation: 4,
  double_tap: 3,
  tap: 2,
  still: 1,
  silence: 1,
};

function rank(movement: ServerMovementType): number {
  return PRECEDENCE[movement] ?? 0;
}

function activeSegments(
  segments: GestureSegment[],
  startMs: number,
  endMs: number,
): GestureSegment[] {
  return segments.filter(
    s => s.start_ms < endMs && s.end_ms > startMs,
  );
}

function pickWinner(active: GestureSegment[]): GestureSegment {
  return active.reduce((best, segment) => {
    const bestRank = rank(best.movement_type);
    const segmentRank = rank(segment.movement_type);
    if (segmentRank > bestRank) {
      return segment;
    }
    if (segmentRank < bestRank) {
      return best;
    }
    return segment.confidence > best.confidence ? segment : best;
  });
}

function mergeLeadingTapIntoDoubleTap(
  segments: GestureSegment[],
): GestureSegment[] {
  const merged: GestureSegment[] = [];
  let index = 0;
  while (index < segments.length) {
    const current = segments[index];
    const next = segments[index + 1];
    if (
      next != null &&
      current.movement_type === 'tap' &&
      next.movement_type === 'double_tap' &&
      current.end_ms === next.start_ms
    ) {
      merged.push({
        ...next,
        start_ms: current.start_ms,
        duration_ms: next.end_ms - current.start_ms,
        confidence: Math.max(current.confidence, next.confidence),
      });
      index += 2;
      continue;
    }
    merged.push({...current});
    index += 1;
  }
  return merged;
}

/** Same rules as server: precedence timeline + leading tap → double_tap merge. */
export function resolveSegmentsByPrecedence(
  segments: GestureSegment[],
): GestureSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const boundaries = [
    ...new Set(segments.flatMap(s => [s.start_ms, s.end_ms])),
  ].sort((a, b) => a - b);

  const slices: GestureSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startMs = boundaries[i];
    const endMs = boundaries[i + 1];
    if (endMs <= startMs) {
      continue;
    }
    const active = activeSegments(segments, startMs, endMs);
    if (active.length === 0) {
      continue;
    }
    const winner = pickWinner(active);
    slices.push({
      movement_type: winner.movement_type,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: endMs - startMs,
      confidence: winner.confidence,
      window_count: winner.window_count ?? 0,
    });
  }

  const merged: GestureSegment[] = [];
  for (const piece of slices) {
    const prev = merged[merged.length - 1];
    if (prev != null && prev.movement_type === piece.movement_type) {
      prev.end_ms = piece.end_ms;
      prev.duration_ms = prev.end_ms - prev.start_ms;
      prev.confidence = Math.max(prev.confidence, piece.confidence);
    } else {
      merged.push({...piece});
    }
  }

  return mergeLeadingTapIntoDoubleTap(merged);
}
