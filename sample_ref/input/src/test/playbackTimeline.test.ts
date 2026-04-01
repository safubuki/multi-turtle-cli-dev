/**
 * playbackTimeline.ts のテスト
 */
import { describe, it, expect } from 'vitest';
import type { MediaItem } from '../types';
import { findActiveTimelineItem, collectPlaybackBlockingVideos } from '../utils/playbackTimeline';

const createMockMediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: overrides.id ?? 'media-id',
  file: new File([''], 'test.mp4', { type: 'video/mp4' }),
  type: 'video',
  url: 'blob:test',
  volume: 1.0,
  isMuted: false,
  fadeIn: false,
  fadeOut: false,
  fadeInDuration: 1.0,
  fadeOutDuration: 1.0,
  duration: 10,
  originalDuration: 10,
  trimStart: 0,
  trimEnd: 10,
  scale: 1.0,
  positionX: 0,
  positionY: 0,
  isTransformOpen: false,
  isLocked: false,
  ...overrides,
});

describe('findActiveTimelineItem', () => {
  it('should prioritize unresolved first video at time 0 (video -> image case)', () => {
    const items = [
      createMockMediaItem({ id: 'v1', type: 'video', duration: 0 }),
      createMockMediaItem({ id: 'i1', type: 'image', duration: 5 }),
    ];

    const active = findActiveTimelineItem(items, 0, 5);
    expect(active?.id).toBe('v1');
    expect(active?.index).toBe(0);
    expect(active?.localTime).toBe(0);
  });

  it('should move to next timed item when time is past unresolved video head', () => {
    const items = [
      createMockMediaItem({ id: 'v1', type: 'video', duration: 0 }),
      createMockMediaItem({ id: 'i1', type: 'image', duration: 5 }),
    ];

    const active = findActiveTimelineItem(items, 1, 5);
    expect(active?.id).toBe('i1');
    expect(active?.index).toBe(1);
    expect(active?.localTime).toBe(1);
  });

  it('should return last item fallback when time exceeds total duration', () => {
    const items = [
      createMockMediaItem({ id: 'v1', type: 'video', duration: 4 }),
      createMockMediaItem({ id: 'i1', type: 'image', duration: 5 }),
    ];

    const active = findActiveTimelineItem(items, 9.2, 9);
    expect(active?.id).toBe('i1');
    expect(active?.index).toBe(1);
    expect(active?.localTime).toBeCloseTo(4.999, 3);
  });
});

describe('collectPlaybackBlockingVideos', () => {
  it('should collect unresolved videos that can affect current playback position', () => {
    const items = [
      createMockMediaItem({ id: 'v1', type: 'video', duration: 0 }),
      createMockMediaItem({ id: 'i1', type: 'image', duration: 5 }),
      createMockMediaItem({ id: 'v2', type: 'video', duration: 0 }),
    ];

    const atStart = collectPlaybackBlockingVideos(items, 0);
    expect(atStart.map((v) => v.id)).toEqual(['v1']);

    const afterImage = collectPlaybackBlockingVideos(items, 8);
    expect(afterImage.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('should ignore unresolved non-video items', () => {
    const items = [
      createMockMediaItem({ id: 'i1', type: 'image', duration: 0 }),
      createMockMediaItem({ id: 'v1', type: 'video', duration: 0 }),
    ];

    const blocking = collectPlaybackBlockingVideos(items, 0);
    expect(blocking.map((v) => v.id)).toEqual(['v1']);
  });
});

