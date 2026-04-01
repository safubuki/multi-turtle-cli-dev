import * as fs from 'fs/promises'
import * as path from 'path'

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.ps1',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sql'
])

const MAX_FILES = 24
const MAX_FILE_CHARS = 12000
const MAX_TOTAL_CHARS = 64000

export interface LoadedInputContext {
  promptBlock: string
  resolvedPaths: string[]
  warnings: string[]
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

async function walkDirectory(
  directoryPath: string,
  accumulator: string[],
  warnings: string[]
): Promise<void> {
  if (accumulator.length >= MAX_FILES) {
    return
  }

  let entries
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    warnings.push(`${directoryPath}: ディレクトリを読めませんでした (${String(error)})`)
    return
  }

  for (const entry of entries) {
    if (accumulator.length >= MAX_FILES) {
      return
    }

    const absolutePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, accumulator, warnings)
      continue
    }

    if (entry.isFile() && isTextFile(absolutePath)) {
      accumulator.push(absolutePath)
    }
  }
}

async function collectTargetFiles(inputPaths: string[]): Promise<{ files: string[]; warnings: string[] }> {
  const resolvedFiles: string[] = []
  const warnings: string[] = []

  for (const rawPath of inputPaths) {
    const normalized = rawPath.trim()
    if (!normalized) {
      continue
    }

    const absolutePath = path.resolve(normalized)

    try {
      const stats = await fs.stat(absolutePath)
      if (stats.isDirectory()) {
        await walkDirectory(absolutePath, resolvedFiles, warnings)
      } else if (stats.isFile()) {
        if (isTextFile(absolutePath)) {
          resolvedFiles.push(absolutePath)
        } else {
          warnings.push(`${absolutePath}: テキストとして扱えないためスキップしました`)
        }
      }
    } catch (error) {
      warnings.push(`${absolutePath}: パスを解決できませんでした (${String(error)})`)
    }

    if (resolvedFiles.length >= MAX_FILES) {
      warnings.push(`参照ファイル数が ${MAX_FILES} 件を超えたため打ち切りました`)
      break
    }
  }

  return { files: [...new Set(resolvedFiles)].slice(0, MAX_FILES), warnings }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars)}\n... (truncated)`
}

export async function loadInputContext(inputPaths: string[]): Promise<LoadedInputContext> {
  const normalizedPaths = inputPaths.map((value) => value.trim()).filter(Boolean)
  if (normalizedPaths.length === 0) {
    return {
      promptBlock: '',
      resolvedPaths: [],
      warnings: []
    }
  }

  const { files, warnings } = await collectTargetFiles(normalizedPaths)
  if (files.length === 0) {
    return {
      promptBlock: '',
      resolvedPaths: [],
      warnings
    }
  }

  const sections: string[] = []
  let totalChars = 0

  for (const filePath of files) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      warnings.push(`参照コンテキストが ${MAX_TOTAL_CHARS} 文字を超えたため残りを省略しました`)
      break
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const truncated = truncateText(content, MAX_FILE_CHARS)
      totalChars += truncated.length
      sections.push(`### ${filePath}\n${truncated}`)
    } catch (error) {
      warnings.push(`${filePath}: ファイル読込に失敗しました (${String(error)})`)
    }
  }

  const promptBlock = sections.length > 0 ? `追加インプット:\n${sections.join('\n\n')}` : ''

  return {
    promptBlock,
    resolvedPaths: files,
    warnings
  }
}
