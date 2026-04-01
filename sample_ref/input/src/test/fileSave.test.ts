import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveClientFileSaveStrategy,
  saveBlobWithClientFileStrategy,
  saveObjectUrlWithClientFileStrategy,
} from '../utils/fileSave';

describe('fileSave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('showSaveFilePicker 対応時は file-picker 経路を選ぶ', () => {
    expect(resolveClientFileSaveStrategy({ supportsShowSaveFilePicker: true })).toBe('file-picker');
    expect(resolveClientFileSaveStrategy({ supportsShowSaveFilePicker: false })).toBe('anchor-download');
  });

  it('object URL は file-picker 非対応時に anchor download へフォールバックする', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchImpl = vi.fn();

    const result = await saveObjectUrlWithClientFileStrategy({
      sourceUrl: 'blob:test-source',
      descriptor: {
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        description: 'MP4 動画',
      },
      supportsShowSaveFilePicker: false,
      doc: document,
      fetchImpl,
    });

    expect(result.strategy).toBe('anchor-download');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('object URL は file-picker 対応時に blob 化して書き込む', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Blob(['video']), { status: 200 }));

    const result = await saveObjectUrlWithClientFileStrategy({
      sourceUrl: 'blob:test-source',
      descriptor: {
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        description: 'MP4 動画',
      },
      supportsShowSaveFilePicker: true,
      win: { showSaveFilePicker },
      fetchImpl,
    });

    expect(result.strategy).toBe('file-picker');
    expect(fetchImpl).toHaveBeenCalledWith('blob:test-source');
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'movie.mp4',
      types: [
        {
          description: 'MP4 動画',
          accept: {
            'video/mp4': ['.mp4'],
          },
        },
      ],
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('blob 保存は anchor download 時に一時 object URL を解放する', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:temp-save');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await saveBlobWithClientFileStrategy({
      blob: new Blob(['image']),
      descriptor: {
        filename: 'image.png',
        mimeType: 'image/png',
        description: 'PNG 画像',
      },
      supportsShowSaveFilePicker: false,
      doc: document,
    });

    expect(result.strategy).toBe('anchor-download');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-save');
  });
});
