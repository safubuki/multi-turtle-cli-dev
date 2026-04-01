/**
 * @file MediaResourceLoader.tsx
 * @author Turtle Village
 * @description Hidden media elements loader for preview/export
 */
import React, { memo, useMemo } from 'react';
import type { MediaResourceLoaderProps, MediaItem } from '../../types';

interface MediaItemResourceProps {
  item: MediaItem;
  hiddenStyle: React.CSSProperties;
  onRefAssign: (id: string, el: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null) => void;
  onElementLoaded: (id: string, el: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => void;
  onSeeked: () => void;
  onVideoLoadedData: () => void;
  onError: (e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => void;
}

const MediaItemResource = memo<MediaItemResourceProps>(
  ({ item, hiddenStyle, onRefAssign, onElementLoaded, onSeeked, onVideoLoadedData, onError }) => {
    if (item.type === 'video') {
      return (
        <video
          ref={(el) => onRefAssign(item.id, el)}
          src={item.url}
          onLoadedMetadata={(e) => onElementLoaded(item.id, e.currentTarget)}
          onLoadedData={onVideoLoadedData}
          onSeeked={onSeeked}
          onError={onError}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          style={hiddenStyle}
        />
      );
    }

    return (
      <img
        ref={(el) => onRefAssign(item.id, el)}
        src={item.url}
        alt="resource"
        onLoad={(e) => onElementLoaded(item.id, e.currentTarget)}
        style={hiddenStyle}
      />
    );
  },
  (prev, next) => prev.item.id === next.item.id && prev.item.url === next.item.url
);

MediaItemResource.displayName = 'MediaItemResource';

const MediaResourceLoader = memo<MediaResourceLoaderProps>(
  ({ mediaItems, bgm, narrations, onElementLoaded, onRefAssign, onSeeked, onVideoLoadedData }) => {
    const hiddenStyle: React.CSSProperties = useMemo(() => ({
      position: 'fixed',
      top: 0,
      left: 0,
      width: '320px',
      height: '240px',
      opacity: 0.001,
      pointerEvents: 'none',
      zIndex: -100,
      visibility: 'visible',
    }), []);

    const audioStyle: React.CSSProperties = useMemo(() => ({
      ...hiddenStyle,
      width: '1px',
      height: '1px',
    }), [hiddenStyle]);

    const handleError = useMemo(
      () => (e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => {
        const el = e.currentTarget;
        if (!el) return;

        console.warn('Resource error, retrying:', (el as HTMLMediaElement).error);
        setTimeout(() => {
          try {
            el.load();
          } catch {
            // ignore
          }
        }, 1000);
      },
      []
    );

    return (
      <div style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden' }}>
        {mediaItems.map((item) => (
          <MediaItemResource
            key={item.id}
            item={item}
            hiddenStyle={hiddenStyle}
            onRefAssign={onRefAssign}
            onElementLoaded={onElementLoaded}
            onSeeked={onSeeked}
            onVideoLoadedData={onVideoLoadedData}
            onError={handleError}
          />
        ))}

        {bgm && (
          <audio
            ref={(el) => onRefAssign('bgm', el)}
            src={bgm.url}
            onLoadedMetadata={(e) => onElementLoaded('bgm', e.currentTarget)}
            onError={handleError}
            preload="auto"
            crossOrigin="anonymous"
            style={audioStyle}
          />
        )}

        {narrations.map((clip) => {
          if (!clip.url) return null;
          const trackId = `narration:${clip.id}`;
          return (
            <audio
              key={clip.id}
              ref={(el) => onRefAssign(trackId, el)}
              src={clip.url}
              onLoadedMetadata={(e) => onElementLoaded(trackId, e.currentTarget)}
              onError={handleError}
              preload="auto"
              crossOrigin="anonymous"
              style={audioStyle}
            />
          );
        })}
      </div>
    );
  },
  (prev, next) => {
    const prevIds = prev.mediaItems.map((m) => `${m.id}:${m.url}`).join(',');
    const nextIds = next.mediaItems.map((m) => `${m.id}:${m.url}`).join(',');
    const itemsChanged = prevIds !== nextIds;
    const bgmChanged = prev.bgm?.url !== next.bgm?.url;
    const prevNarrations = prev.narrations.map((n) => `${n.id}:${n.url}`).join(',');
    const nextNarrations = next.narrations.map((n) => `${n.id}:${n.url}`).join(',');
    const narrationChanged = prevNarrations !== nextNarrations;
    return !itemsChanged && !bgmChanged && !narrationChanged;
  }
);

MediaResourceLoader.displayName = 'MediaResourceLoader';

export default MediaResourceLoader;
