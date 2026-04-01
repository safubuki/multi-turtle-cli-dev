type SaveFilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: SaveFilePickerAcceptType[];
};

type FileSystemWritableFileStreamLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

type WindowWithSavePickerLike = {
  showSaveFilePicker?: unknown;
};

export type ClientFileSaveStrategy = 'file-picker' | 'anchor-download';

export interface ClientFileSaveDescriptor {
  filename: string;
  mimeType: string;
  description: string;
}

interface ClientFileSaveBaseOptions {
  descriptor: ClientFileSaveDescriptor;
  supportsShowSaveFilePicker: boolean;
  win?: WindowWithSavePickerLike;
  doc?: Document;
  fetchImpl?: typeof fetch;
}

interface SaveBlobOptions extends ClientFileSaveBaseOptions {
  blob: Blob;
}

interface SaveObjectUrlOptions extends ClientFileSaveBaseOptions {
  sourceUrl: string;
}

function getDefaultWindowWithSavePicker(): WindowWithSavePickerLike | undefined {
  return typeof window !== 'undefined' ? (window as unknown as WindowWithSavePickerLike) : undefined;
}

function buildSaveFilePickerTypes(descriptor: ClientFileSaveDescriptor): SaveFilePickerAcceptType[] | undefined {
  const dotIndex = descriptor.filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= descriptor.filename.length - 1) {
    return undefined;
  }

  return [
    {
      description: descriptor.description,
      accept: {
        [descriptor.mimeType]: [descriptor.filename.slice(dotIndex)],
      },
    },
  ];
}

async function writeBlobWithPicker(
  blob: Blob,
  descriptor: ClientFileSaveDescriptor,
  win: WindowWithSavePickerLike,
): Promise<void> {
  if (typeof win.showSaveFilePicker !== 'function') {
    throw new Error('showSaveFilePicker is unavailable');
  }

  const showSaveFilePicker = win.showSaveFilePicker as (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike>;
  const fileHandle = await showSaveFilePicker({
    suggestedName: descriptor.filename,
    types: buildSaveFilePickerTypes(descriptor),
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function triggerAnchorDownload(doc: Document, href: string, filename: string): void {
  const anchor = doc.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function resolveClientFileSaveStrategy(input: {
  supportsShowSaveFilePicker: boolean;
}): ClientFileSaveStrategy {
  return input.supportsShowSaveFilePicker ? 'file-picker' : 'anchor-download';
}

export async function saveBlobWithClientFileStrategy(
  options: SaveBlobOptions,
): Promise<{ strategy: ClientFileSaveStrategy }> {
  const saveWindow = options.win ?? getDefaultWindowWithSavePicker();
  const strategy = resolveClientFileSaveStrategy({
    supportsShowSaveFilePicker:
      options.supportsShowSaveFilePicker &&
      typeof saveWindow?.showSaveFilePicker === 'function',
  });

  if (strategy === 'file-picker') {
    await writeBlobWithPicker(options.blob, options.descriptor, saveWindow ?? {});
    return { strategy };
  }

  const tempUrl = URL.createObjectURL(options.blob);
  try {
    triggerAnchorDownload(options.doc ?? document, tempUrl, options.descriptor.filename);
  } finally {
    URL.revokeObjectURL(tempUrl);
  }

  return { strategy };
}

export async function saveObjectUrlWithClientFileStrategy(
  options: SaveObjectUrlOptions,
): Promise<{ strategy: ClientFileSaveStrategy }> {
  const saveWindow = options.win ?? getDefaultWindowWithSavePicker();
  const strategy = resolveClientFileSaveStrategy({
    supportsShowSaveFilePicker:
      options.supportsShowSaveFilePicker &&
      typeof saveWindow?.showSaveFilePicker === 'function',
  });

  if (strategy === 'file-picker') {
    const response = await (options.fetchImpl ?? fetch)(options.sourceUrl);
    if (!response.ok) {
      throw new Error(`download source unavailable: ${response.status}`);
    }
    const blob = await response.blob();
    await writeBlobWithPicker(blob, options.descriptor, saveWindow ?? {});
    return { strategy };
  }

  triggerAnchorDownload(options.doc ?? document, options.sourceUrl, options.descriptor.filename);
  return { strategy };
}
