/**
 * captionStore のテスト
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCaptionStore } from '../../stores/captionStore';
import type { CaptionSettings } from '../../types';

describe('captionStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useCaptionStore.setState({
      captions: [],
      settings: {
        enabled: true,
        fontSize: 'medium',
        fontStyle: 'gothic',
        fontColor: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 2,
        position: 'bottom',
        blur: 0,
        bulkFadeIn: false,
        bulkFadeOut: false,
        bulkFadeInDuration: 0.5,
        bulkFadeOutDuration: 0.5,
      },
      isLocked: false,
    });
  });

  describe('settings property', () => {
    it('should have settings property accessible', () => {
      const { settings } = useCaptionStore.getState();
      expect(settings).toBeDefined();
      expect(settings.fontSize).toBe('medium');
      expect(settings.fontColor).toBe('#FFFFFF');
    });

    it('should update settings when setFontSize is called', () => {
      const { setFontSize } = useCaptionStore.getState();
      
      setFontSize('large');
      
      const { settings } = useCaptionStore.getState();
      expect(settings.fontSize).toBe('large');
    });

    it('should update settings when setFontSize is called with xlarge', () => {
      const { setFontSize } = useCaptionStore.getState();
      
      setFontSize('xlarge');
      
      const { settings } = useCaptionStore.getState();
      expect(settings.fontSize).toBe('xlarge');
    });

    it('should update settings when setFontColor is called', () => {
      const { setFontColor } = useCaptionStore.getState();
      
      setFontColor('#FF0000');
      
      const { settings } = useCaptionStore.getState();
      expect(settings.fontColor).toBe('#FF0000');
    });

    it('should update settings when setBulkFadeIn is called', () => {
      const { setBulkFadeIn } = useCaptionStore.getState();
      
      setBulkFadeIn(true);
      
      const { settings } = useCaptionStore.getState();
      expect(settings.bulkFadeIn).toBe(true);
    });

    it('should update settings when setBlur is called', () => {
      const { setBlur } = useCaptionStore.getState();
      
      setBlur(2.5);
      
      const { settings } = useCaptionStore.getState();
      expect(settings.blur).toBe(2.5);
    });

    it('should default blur to 0', () => {
      const { settings } = useCaptionStore.getState();
      expect(settings.blur).toBe(0);
    });
  });

  describe('restoreFromSave', () => {
    it('should restore captions and settings from saved data', () => {
      const savedCaptions = [
        {
          id: 'cap1',
          text: 'Test caption',
          startTime: 0,
          endTime: 5,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
        },
      ];

      const savedSettings: CaptionSettings = {
        enabled: false,
        fontSize: 'large',
        fontStyle: 'mincho',
        fontColor: '#00FF00',
        strokeColor: '#FF0000',
        strokeWidth: 4,
        position: 'top',
        blur: 1.5,
        bulkFadeIn: true,
        bulkFadeOut: true,
        bulkFadeInDuration: 1.0,
        bulkFadeOutDuration: 2.0,
      };

      const { restoreFromSave } = useCaptionStore.getState();
      
      restoreFromSave(savedCaptions, savedSettings, true);
      
      const { captions, settings, isLocked } = useCaptionStore.getState();
      
      // Verify captions were restored
      expect(captions).toHaveLength(1);
      expect(captions[0].text).toBe('Test caption');
      
      // Verify settings were restored
      expect(settings.enabled).toBe(false);
      expect(settings.fontSize).toBe('large');
      expect(settings.fontStyle).toBe('mincho');
      expect(settings.fontColor).toBe('#00FF00');
      expect(settings.strokeColor).toBe('#FF0000');
      expect(settings.strokeWidth).toBe(4);
      expect(settings.position).toBe('top');
      expect(settings.blur).toBe(1.5);
      expect(settings.bulkFadeIn).toBe(true);
      expect(settings.bulkFadeOut).toBe(true);
      expect(settings.bulkFadeInDuration).toBe(1.0);
      expect(settings.bulkFadeOutDuration).toBe(2.0);
      
      // Verify lock state was restored
      expect(isLocked).toBe(true);
    });
  });

  describe('settings consistency', () => {
    it('should maintain settings changes across multiple updates', () => {
      const { setFontSize, setFontColor, setPosition } = useCaptionStore.getState();
      
      // Make multiple changes
      setFontSize('large');
      setFontColor('#FF0000');
      setPosition('top');
      
      // Verify all changes persist
      const { settings } = useCaptionStore.getState();
      expect(settings.fontSize).toBe('large');
      expect(settings.fontColor).toBe('#FF0000');
      expect(settings.position).toBe('top');
    });
  });

  describe('individual caption settings (override)', () => {
    it('should restore captions with individual override settings', () => {
      const savedCaptions = [
        {
          id: 'cap1',
          text: 'Caption with overrides',
          startTime: 0,
          endTime: 5,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
          // Individual override settings
          overridePosition: 'top' as const,
          overrideFontStyle: 'mincho' as const,
          overrideFontSize: 'large' as const,
          overrideFadeIn: 'on' as const,
          overrideFadeOut: 'on' as const,
          overrideFadeInDuration: 1.5,
          overrideFadeOutDuration: 2.0,
        },
        {
          id: 'cap2',
          text: 'Caption without overrides',
          startTime: 5,
          endTime: 10,
          fadeIn: true,
          fadeOut: true,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
          // No override settings (should use global settings)
        },
      ];

      const savedSettings: CaptionSettings = {
        enabled: true,
        fontSize: 'medium',
        fontStyle: 'gothic',
        fontColor: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 2,
        position: 'bottom',
        blur: 0,
        bulkFadeIn: false,
        bulkFadeOut: false,
        bulkFadeInDuration: 0.5,
        bulkFadeOutDuration: 0.5,
      };

      const { restoreFromSave } = useCaptionStore.getState();
      
      restoreFromSave(savedCaptions, savedSettings, false);
      
      const { captions } = useCaptionStore.getState();
      
      // Verify first caption has individual overrides preserved
      expect(captions).toHaveLength(2);
      expect(captions[0].id).toBe('cap1');
      expect(captions[0].overridePosition).toBe('top');
      expect(captions[0].overrideFontStyle).toBe('mincho');
      expect(captions[0].overrideFontSize).toBe('large');
      expect(captions[0].overrideFadeIn).toBe('on');
      expect(captions[0].overrideFadeOut).toBe('on');
      expect(captions[0].overrideFadeInDuration).toBe(1.5);
      expect(captions[0].overrideFadeOutDuration).toBe(2.0);
      
      // Verify second caption has no overrides (uses global settings)
      expect(captions[1].id).toBe('cap2');
      expect(captions[1].overridePosition).toBeUndefined();
      expect(captions[1].overrideFontStyle).toBeUndefined();
      expect(captions[1].overrideFontSize).toBeUndefined();
      expect(captions[1].overrideFadeIn).toBeUndefined();
      expect(captions[1].overrideFadeOut).toBeUndefined();
      expect(captions[1].overrideFadeInDuration).toBeUndefined();
      expect(captions[1].overrideFadeOutDuration).toBeUndefined();
    });

    it('should preserve individual overrides when updating caption', () => {
      const { addCaption, updateCaption } = useCaptionStore.getState();
      
      // Add a caption
      addCaption('Test caption', 0, 5);
      
      const { captions: captions1 } = useCaptionStore.getState();
      const captionId = captions1[0].id;
      
      // Set individual overrides
      updateCaption(captionId, {
        overridePosition: 'top',
        overrideFontSize: 'large',
        overrideFadeIn: 'on',
        overrideFadeInDuration: 1.5,
      });
      
      // Verify overrides are preserved
      const { captions: captions2 } = useCaptionStore.getState();
      expect(captions2[0].overridePosition).toBe('top');
      expect(captions2[0].overrideFontSize).toBe('large');
      expect(captions2[0].overrideFadeIn).toBe('on');
      expect(captions2[0].overrideFadeInDuration).toBe(1.5);
      
      // Update other properties, overrides should still be preserved
      updateCaption(captionId, {
        text: 'Updated text',
      });
      
      const { captions: captions3 } = useCaptionStore.getState();
      expect(captions3[0].text).toBe('Updated text');
      expect(captions3[0].overridePosition).toBe('top');
      expect(captions3[0].overrideFontSize).toBe('large');
      expect(captions3[0].overrideFadeIn).toBe('on');
      expect(captions3[0].overrideFadeInDuration).toBe(1.5);
    });
  });
});
