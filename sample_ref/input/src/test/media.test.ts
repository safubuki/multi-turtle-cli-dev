/**
 * media.ts のテスト
 */

import { describe, it, expect } from 'vitest';
import {
  generateId,
  getMediaType,
  calculateTotalDuration,
  getActiveMediaItem,
  swapArrayItems,
  validateTrim,
  validateScale,
  validatePosition,
} from '../utils/media';
import type { MediaItem } from '../types';

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should generate string IDs', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs even when called rapidly', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    // 1000回呼び出して全て一意であること
    expect(ids.size).toBe(1000);
  });

  it('should contain timestamp and counter components', () => {
    const id = generateId();
    // ID形式: timestamp-counter-random
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe('getMediaType', () => {
  it('should detect video files', () => {
    const videoFile = new File([''], 'test.mp4', { type: 'video/mp4' });
    expect(getMediaType(videoFile)).toBe('video');
  });

  it('should detect image files', () => {
    const imageFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
    expect(getMediaType(imageFile)).toBe('image');
  });

  it('should detect audio files', () => {
    const audioFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    expect(getMediaType(audioFile)).toBe('audio');
  });

  it('should return null for unknown types', () => {
    const unknownFile = new File([''], 'test.txt', { type: 'text/plain' });
    expect(getMediaType(unknownFile)).toBeNull();
  });
});

// Helper to create mock MediaItem
const createMockMediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: generateId(),
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

describe('calculateTotalDuration', () => {
  it('should calculate total duration of all items', () => {
    const items = [
      createMockMediaItem({ duration: 10 }),
      createMockMediaItem({ duration: 20 }),
      createMockMediaItem({ duration: 30 }),
    ];
    expect(calculateTotalDuration(items)).toBe(60);
  });

  it('should return 0 for empty array', () => {
    expect(calculateTotalDuration([])).toBe(0);
  });

  it('should handle non-finite durations', () => {
    const items = [
      createMockMediaItem({ duration: 10 }),
      createMockMediaItem({ duration: Infinity }),
      createMockMediaItem({ duration: NaN }),
    ];
    expect(calculateTotalDuration(items)).toBe(10);
  });
});

describe('getActiveMediaItem', () => {
  it('should find the active item at given time', () => {
    const items = [
      createMockMediaItem({ id: 'a', duration: 10 }),
      createMockMediaItem({ id: 'b', duration: 10 }),
      createMockMediaItem({ id: 'c', duration: 10 }),
    ];

    const result1 = getActiveMediaItem(items, 5);
    expect(result1?.item.id).toBe('a');
    expect(result1?.index).toBe(0);
    expect(result1?.localTime).toBe(5);

    const result2 = getActiveMediaItem(items, 15);
    expect(result2?.item.id).toBe('b');
    expect(result2?.index).toBe(1);
    expect(result2?.localTime).toBe(5);
  });

  it('should return null for out of range time', () => {
    const items = [createMockMediaItem({ duration: 10 })];
    expect(getActiveMediaItem(items, 20)).toBeNull();
    expect(getActiveMediaItem(items, -5)).toBeNull();
  });

  it('should return null for empty array', () => {
    expect(getActiveMediaItem([], 5)).toBeNull();
  });
});

describe('swapArrayItems', () => {
  it('should swap two items', () => {
    const arr = ['a', 'b', 'c'];
    const result = swapArrayItems(arr, 0, 2);
    expect(result).toEqual(['c', 'b', 'a']);
  });

  it('should return original array for invalid indices', () => {
    const arr = ['a', 'b', 'c'];
    expect(swapArrayItems(arr, 0, -1)).toEqual(arr);
    expect(swapArrayItems(arr, 0, 5)).toEqual(arr);
  });
});

describe('validateTrim', () => {
  it('should validate trim values', () => {
    // validateTrim(start, end, maxDuration) -> { start, end, duration }
    const result = validateTrim(2, 8, 10);
    expect(result.start).toBe(2);
    expect(result.end).toBe(8);
    expect(result.duration).toBe(6);
  });

  it('should clamp start to valid range', () => {
    const result = validateTrim(-5, 8, 10);
    expect(result.start).toBeGreaterThanOrEqual(0);
    expect(result.end).toBe(8);
  });

  it('should not allow start to exceed end', () => {
    const result = validateTrim(9, 5, 10);
    expect(result.start).toBeLessThan(result.end);
  });

  it('should clamp end to maxDuration', () => {
    const result = validateTrim(2, 15, 10);
    expect(result.end).toBeLessThanOrEqual(10);
  });
});

describe('validateScale', () => {
  it('should clamp scale to min/max', () => {
    expect(validateScale(0.3)).toBe(0.5); // min is 0.5
    expect(validateScale(5)).toBe(3.0); // max is 3.0
    expect(validateScale(1.5)).toBe(1.5);
  });
});

describe('validatePosition', () => {
  it('should clamp position to valid range', () => {
    // default limit is 1280
    expect(validatePosition(2000)).toBeLessThanOrEqual(1280);
    expect(validatePosition(-2000)).toBeGreaterThanOrEqual(-1280);
    expect(validatePosition(100)).toBe(100);
  });

  it('should handle custom limits', () => {
    expect(validatePosition(2000, 1000)).toBe(1000);
    expect(validatePosition(-2000, 1000)).toBe(-1000);
  });
});
