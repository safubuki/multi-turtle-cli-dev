import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { RunImageAttachment } from './types.js'
import { APP_ROOT } from './util.js'

const PROMPT_IMAGE_DIR = path.join(APP_ROOT, '.multi-turtle-runtime', 'prompt-images')
const MAX_PROMPT_IMAGE_BYTES = 15 * 1024 * 1024
const STAGED_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg'
}

function sanitizeFileName(value: string, fallbackBase = 'image'): string {
  const trimmed = value.trim().replace(/[/\\]+/g, '-')
  const parsed = path.parse(trimmed || fallbackBase)
  const safeBase = (parsed.name || fallbackBase).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallbackBase
  const safeExt = parsed.ext.replace(/[^a-zA-Z0-9.]+/g, '')
  return `${safeBase}${safeExt}`
}

function getExtensionForImage(fileName: string, mimeType: string): string {
  const sanitized = sanitizeFileName(fileName)
  const parsed = path.parse(sanitized)
  if (parsed.ext) {
    return parsed.ext.toLowerCase()
  }

  return MIME_EXTENSION_MAP[mimeType.toLowerCase()] ?? '.png'
}

async function ensurePromptImageDir(): Promise<void> {
  await fs.mkdir(PROMPT_IMAGE_DIR, { recursive: true })
}

async function cleanupOldPromptImages(): Promise<void> {
  if (!existsSync(PROMPT_IMAGE_DIR)) {
    return
  }

  const now = Date.now()
  const entries = await fs.readdir(PROMPT_IMAGE_DIR, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) {
      return
    }

    const candidatePath = path.join(PROMPT_IMAGE_DIR, entry.name)
    try {
      const stats = await fs.stat(candidatePath)
      if (now - stats.mtimeMs > STAGED_IMAGE_TTL_MS) {
        await fs.rm(candidatePath, { force: true })
      }
    } catch {
      // Ignore cleanup races.
    }
  }))
}

export function assertPromptImagePath(localPath: string): string {
  const resolvedRoot = path.resolve(PROMPT_IMAGE_DIR)
  const resolvedPath = path.resolve(localPath)
  const normalizedRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot
  const normalizedPath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath

  if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return resolvedPath
  }

  throw new Error(`Prompt image path is outside the runtime directory: ${localPath}`)
}

export async function removePromptImages(localPaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(localPaths.map((entry) => entry.trim()).filter(Boolean))]
  await Promise.all(uniquePaths.map(async (localPath) => {
    const resolvedPath = assertPromptImagePath(localPath)
    await fs.rm(resolvedPath, { force: true })
  }))
}

export async function stagePromptImage(params: {
  fileName: string
  mimeType: string
  contentBase64: string
}): Promise<RunImageAttachment> {
  const fileName = params.fileName.trim() || 'image.png'
  const mimeType = params.mimeType.trim().toLowerCase()
  if (!mimeType.startsWith('image/')) {
    throw new Error('画像ファイルのみ添付できます。')
  }

  const buffer = Buffer.from(params.contentBase64.trim(), 'base64')
  if (!buffer.length) {
    throw new Error('画像データが空です。')
  }

  if (buffer.byteLength > MAX_PROMPT_IMAGE_BYTES) {
    throw new Error('画像サイズが大きすぎます。15MB 以下の画像を使用してください。')
  }

  await ensurePromptImageDir()
  void cleanupOldPromptImages()

  const safeName = sanitizeFileName(fileName)
  const ext = getExtensionForImage(safeName, mimeType)
  const finalName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.parse(safeName).name}${ext}`
  const finalPath = path.join(PROMPT_IMAGE_DIR, finalName)
  await fs.writeFile(finalPath, buffer)

  return {
    fileName: safeName,
    mimeType,
    size: buffer.byteLength,
    localPath: finalPath
  }
}
