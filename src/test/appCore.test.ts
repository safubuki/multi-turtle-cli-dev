import { describe, expect, it } from 'vitest'
import { getProviderIssueSummary } from '../lib/appCore'

describe('getProviderIssueSummary', () => {
  it('CreateProcessWithLogonW failed: 1056 を Codex sandbox 失敗として要約する', () => {
    const summary = getProviderIssueSummary('codex', 'windows sandbox: CreateProcessWithLogonW failed: 1056', 'balanced')

    expect(summary).not.toBeNull()
    expect(summary?.status).toBe('attention')
    expect(summary?.statusText).toBe('Codex の sandbox 起動に失敗しました')
    expect(summary?.displayMessage).toContain('CreateProcessWithLogonW failed: 1056')
  })

  it('Format-Hex -Count の互換性エラーを要約する', () => {
    const summary = getProviderIssueSummary('copilot', "Format-Hex : パラメーター名 'Count' に一致するパラメーターが見つかりません。")

    expect(summary).not.toBeNull()
    expect(summary?.status).toBe('attention')
    expect(summary?.statusText).toBe('PowerShell 互換性を確認してください')
    expect(summary?.displayMessage).toContain('Windows PowerShell 5.1')
  })
})