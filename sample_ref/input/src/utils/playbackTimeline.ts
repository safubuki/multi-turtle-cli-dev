/**
 * @file playbackTimeline.ts
 * @description プレビュー再生のタイムライン判定ロジック
 */
import type { MediaItem } from '../types';

const EPSILON = 0.001;

const normalizeDuration = (duration: number): number => {
  if (!Number.isFinite(duration)) return 0;
  return Math.max(0, duration);
};

export interface ActiveTimelineItem {
  id: string;
  index: number;
  localTime: number;
}

/**
 * 指定時刻でアクティブなメディアを返す。
 * 動画メタデータ待機中（duration=0）の先頭動画は、time=0 で優先する。
 */
export function findActiveTimelineItem(
  items: MediaItem[],
  time: number,
  totalDuration: number
): ActiveTimelineItem | null {
  let t = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemDuration = normalizeDuration(item.duration);

    if (itemDuration <= 0) {
      if (item.type === 'video' && Math.abs(time - t) < EPSILON) {
        return { id: item.id, index: i, localTime: 0 };
      }
      continue;
    }

    if (time >= t && time < t + itemDuration) {
      return { id: item.id, index: i, localTime: time - t };
    }

    t += itemDuration;
  }

  if (items.length > 0 && time >= totalDuration) {
    const lastIndex = items.length - 1;
    const lastItem = items[lastIndex];
    const lastDuration = normalizeDuration(lastItem.duration);
    return {
      id: lastItem.id,
      index: lastIndex,
      localTime: lastDuration > 0 ? Math.max(0, lastDuration - EPSILON) : 0,
    };
  }

  return null;
}

/**
 * 再生開始時に、duration未確定のため待機が必要な動画を抽出する。
 */
export function collectPlaybackBlockingVideos(items: MediaItem[], fromTime: number): MediaItem[] {
  const blocking: MediaItem[] = [];
  let acc = 0;

  for (const item of items) {
    const duration = normalizeDuration(item.duration);
    const isBlockingVideo = item.type === 'video' && duration <= 0 && fromTime >= acc - EPSILON;

    if (isBlockingVideo) {
      blocking.push(item);
    }

    if (duration > 0) {
      if (fromTime < acc + duration) break;
      acc += duration;
    } else if (fromTime < acc) {
      break;
    }
  }

  return blocking;
}

