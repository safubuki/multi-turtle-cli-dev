/**
 * mediaStore のテスト
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMediaStore } from '../../stores/mediaStore';

describe('mediaStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useMediaStore.setState({
      mediaItems: [],
      totalDuration: 0,
      isClipsLocked: false,
    });
  });

  describe('addMediaItems', () => {
    it('should add media items from files', () => {
      const { addMediaItems } = useMediaStore.getState();
      const file = new File([''], 'test.mp4', { type: 'video/mp4' });
      
      addMediaItems([file]);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems).toHaveLength(1);
      expect(mediaItems[0].file).toBe(file);
      expect(mediaItems[0].type).toBe('video');
    });

    it('should add image files with default duration', () => {
      const { addMediaItems } = useMediaStore.getState();
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
      
      addMediaItems([file]);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].type).toBe('image');
      expect(mediaItems[0].duration).toBe(5); // default image duration
    });

    it('should handle same file added multiple times with unique IDs', () => {
      const { addMediaItems } = useMediaStore.getState();
      const file = new File(['test content'], 'same-file.mp4', { type: 'video/mp4' });
      
      // 同じファイルを2回追加
      addMediaItems([file]);
      addMediaItems([file]);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems).toHaveLength(2);
      // IDが異なること
      expect(mediaItems[0].id).not.toBe(mediaItems[1].id);
      // URLも異なること（createObjectURLは毎回新しいURLを生成）
      expect(mediaItems[0].url).not.toBe(mediaItems[1].url);
    });

    it('should handle files with same name added simultaneously', () => {
      const { addMediaItems } = useMediaStore.getState();
      const file1 = new File(['content1'], 'duplicate.mp4', { type: 'video/mp4' });
      const file2 = new File(['content2'], 'duplicate.mp4', { type: 'video/mp4' });
      
      // 同じ名前の2つのファイルを同時に追加
      addMediaItems([file1, file2]);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems).toHaveLength(2);
      // IDが異なること
      expect(mediaItems[0].id).not.toBe(mediaItems[1].id);
    });
  });

  describe('removeMediaItem', () => {
    it('should remove an item by id', () => {
      const { addMediaItems, removeMediaItem } = useMediaStore.getState();
      const file = new File([''], 'test.mp4', { type: 'video/mp4' });
      
      addMediaItems([file]);
      const { mediaItems: before } = useMediaStore.getState();
      const id = before[0].id;
      
      removeMediaItem(id);
      
      const { mediaItems: after } = useMediaStore.getState();
      expect(after).toHaveLength(0);
    });
  });

  describe('moveMediaItem', () => {
    it('should move item up', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', duration: 10 } as any,
          { id: 'b', duration: 10 } as any,
        ],
        totalDuration: 20,
      });
      
      const { moveMediaItem } = useMediaStore.getState();
      moveMediaItem(1, 'up');
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].id).toBe('b');
      expect(mediaItems[1].id).toBe('a');
    });

    it('should move item down', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', duration: 10 } as any,
          { id: 'b', duration: 10 } as any,
        ],
        totalDuration: 20,
      });
      
      const { moveMediaItem } = useMediaStore.getState();
      moveMediaItem(0, 'down');
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].id).toBe('b');
      expect(mediaItems[1].id).toBe('a');
    });

    it('should not move if at boundary', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', duration: 10 } as any,
          { id: 'b', duration: 10 } as any,
        ],
        totalDuration: 20,
      });
      
      const { moveMediaItem } = useMediaStore.getState();
      moveMediaItem(0, 'up'); // Can't move first item up
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].id).toBe('a');
    });
  });

  describe('toggleClipsLock', () => {
    it('should toggle clips lock state', () => {
      const { toggleClipsLock } = useMediaStore.getState();
      
      expect(useMediaStore.getState().isClipsLocked).toBe(false);
      
      toggleClipsLock();
      expect(useMediaStore.getState().isClipsLocked).toBe(true);
      
      toggleClipsLock();
      expect(useMediaStore.getState().isClipsLocked).toBe(false);
    });
  });

  describe('clearAllMedia', () => {
    it('should clear all media items', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', duration: 10, url: 'blob:test' } as any,
        ],
        totalDuration: 10,
        isClipsLocked: true,
      });
      
      const { clearAllMedia } = useMediaStore.getState();
      clearAllMedia();
      
      const state = useMediaStore.getState();
      expect(state.mediaItems).toHaveLength(0);
      expect(state.totalDuration).toBe(0);
      expect(state.isClipsLocked).toBe(false);
    });
  });

  describe('updateScale', () => {
    it('should update scale within valid range', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', scale: 1.0 } as any,
        ],
      });
      
      const { updateScale } = useMediaStore.getState();
      updateScale('a', 2.0);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].scale).toBe(2.0);
    });

    it('should clamp scale to valid range', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', scale: 1.0 } as any,
        ],
      });
      
      const { updateScale } = useMediaStore.getState();
      updateScale('a', 5.0); // max is 3.0
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].scale).toBe(3.0);
    });
  });

  describe('setVideoDuration', () => {
    it('should set video duration and trim values on first load', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 0, originalDuration: 0, trimStart: 0, trimEnd: 0 } as any,
        ],
        totalDuration: 0,
      });
      
      const { setVideoDuration } = useMediaStore.getState();
      setVideoDuration('a', 30);
      
      const { mediaItems, totalDuration } = useMediaStore.getState();
      expect(mediaItems[0].originalDuration).toBe(30);
      expect(mediaItems[0].trimStart).toBe(0);
      expect(mediaItems[0].trimEnd).toBe(30);
      expect(mediaItems[0].duration).toBe(30);
      expect(totalDuration).toBe(30);
    });

    it('should preserve trim values if already initialized', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 15, originalDuration: 30, trimStart: 5, trimEnd: 20 } as any,
        ],
        totalDuration: 15,
      });
      
      const { setVideoDuration } = useMediaStore.getState();
      setVideoDuration('a', 30);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].trimStart).toBe(5);
      expect(mediaItems[0].trimEnd).toBe(20);
      expect(mediaItems[0].duration).toBe(15);
    });

    it('should update totalDuration and keep order in video->image timeline', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'video-1', type: 'video', duration: 0, originalDuration: 0, trimStart: 0, trimEnd: 0 } as any,
          { id: 'image-1', type: 'image', duration: 5, originalDuration: 5, trimStart: 0, trimEnd: 5 } as any,
        ],
        totalDuration: 5,
      });

      const { setVideoDuration } = useMediaStore.getState();
      setVideoDuration('video-1', 12);

      const { mediaItems, totalDuration } = useMediaStore.getState();
      expect(mediaItems.map((item) => item.id)).toEqual(['video-1', 'image-1']);
      expect(mediaItems[0].duration).toBe(12);
      expect(mediaItems[1].duration).toBe(5);
      expect(totalDuration).toBe(17);
    });
  });

  describe('updateVideoTrim', () => {
    it('should update trim start and recalculate duration', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 30, originalDuration: 30, trimStart: 0, trimEnd: 30 } as any,
        ],
        totalDuration: 30,
      });
      
      const { updateVideoTrim } = useMediaStore.getState();
      updateVideoTrim('a', 'start', 5);
      
      const { mediaItems, totalDuration } = useMediaStore.getState();
      expect(mediaItems[0].trimStart).toBe(5);
      expect(mediaItems[0].trimEnd).toBe(30);
      expect(mediaItems[0].duration).toBe(25);
      expect(totalDuration).toBe(25);
    });

    it('should update trim end and recalculate duration', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 30, originalDuration: 30, trimStart: 0, trimEnd: 30 } as any,
        ],
        totalDuration: 30,
      });
      
      const { updateVideoTrim } = useMediaStore.getState();
      updateVideoTrim('a', 'end', 20);
      
      const { mediaItems, totalDuration } = useMediaStore.getState();
      expect(mediaItems[0].trimStart).toBe(0);
      expect(mediaItems[0].trimEnd).toBe(20);
      expect(mediaItems[0].duration).toBe(20);
      expect(totalDuration).toBe(20);
    });

    it('should not allow trim start to exceed trim end', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 20, originalDuration: 30, trimStart: 0, trimEnd: 20 } as any,
        ],
        totalDuration: 20,
      });
      
      const { updateVideoTrim } = useMediaStore.getState();
      updateVideoTrim('a', 'start', 25); // exceeds trimEnd of 20
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].trimStart).toBeLessThan(mediaItems[0].trimEnd);
    });

    it('should not affect other media items when updating one', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'video', duration: 30, originalDuration: 30, trimStart: 0, trimEnd: 30 } as any,
          { id: 'b', type: 'video', duration: 20, originalDuration: 20, trimStart: 0, trimEnd: 20 } as any,
        ],
        totalDuration: 50,
      });
      
      const { updateVideoTrim } = useMediaStore.getState();
      updateVideoTrim('a', 'end', 10);
      
      const { mediaItems, totalDuration } = useMediaStore.getState();
      // Item 'a' should be updated
      expect(mediaItems[0].trimEnd).toBe(10);
      expect(mediaItems[0].duration).toBe(10);
      // Item 'b' should remain unchanged
      expect(mediaItems[1].trimEnd).toBe(20);
      expect(mediaItems[1].duration).toBe(20);
      // Total duration should be updated
      expect(totalDuration).toBe(30);
    });
  });

  describe('updateImageDuration', () => {
    it('should update image duration', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'image', duration: 5 } as any,
        ],
        totalDuration: 5,
      });
      
      const { updateImageDuration } = useMediaStore.getState();
      updateImageDuration('a', 10);
      
      const { mediaItems, totalDuration } = useMediaStore.getState();
      expect(mediaItems[0].duration).toBe(10);
      expect(totalDuration).toBe(10);
    });

    it('should enforce minimum duration of 0.5 seconds', () => {
      useMediaStore.setState({
        mediaItems: [
          { id: 'a', type: 'image', duration: 5 } as any,
        ],
        totalDuration: 5,
      });
      
      const { updateImageDuration } = useMediaStore.getState();
      updateImageDuration('a', 0.1);
      
      const { mediaItems } = useMediaStore.getState();
      expect(mediaItems[0].duration).toBeGreaterThanOrEqual(0.5);
    });
  });
});
