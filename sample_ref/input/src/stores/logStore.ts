/**
 * @file logStore.ts
 * @author Turtle Village
 * @description アプリケーションの動作ログ、エラーログ、システムリソース情報を一元管理するZustandストア。
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ログレベル
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

// ログカテゴリ
export type LogCategory = 'MEDIA' | 'RENDER' | 'AUDIO' | 'SYSTEM' | 'GLOBAL';

// ログエントリ
export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    category: LogCategory;
    message: string;
    details?: Record<string, unknown>;
}

// ストレージキー
const LOG_STORAGE_KEY = 'turtle-video-logs';
const MAX_LOG_ENTRIES = 500;
const DUPLICATE_SUPPRESS_MS = 10000; // 同じ警告の抑制時間（10秒）

// ログID生成用カウンター
let logIdCounter = 0;

/**
 * sessionStorageからログを読み込み
 */
function loadLogsFromStorage(): LogEntry[] {
    try {
        const stored = sessionStorage.getItem(LOG_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch {
        // 読み込み失敗時は空配列
    }
    return [];
}

/**
 * sessionStorageにログを保存
 */
function saveLogsToStorage(entries: LogEntry[]): void {
    try {
        sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // 保存失敗時は何もしない
    }
}

/**
 * ログIDを生成
 */
function generateLogId(): string {
    logIdCounter++;
    return `log_${Date.now()}_${logIdCounter.toString().padStart(3, '0')}`;
}

/**
 * システムリソース情報を取得
 */
export interface SystemInfo {
    deviceMemory: number | null;      // デバイスメモリ（GB）
    hardwareConcurrency: number | null; // CPU論理コア数
    jsHeapUsed: number | null;        // JSヒープ使用量（MB）
    jsHeapTotal: number | null;       // JSヒープ総量（MB）
    jsHeapLimit: number | null;       // JSヒープ制限（MB）
    userAgent: string;
    platform: string;
    isMobile: boolean;
}

export function getSystemInfo(): SystemInfo {
    const nav = navigator as Navigator & {
        deviceMemory?: number;
    };

    // Chrome限定: performance.memory
    const perf = performance as Performance & {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    };

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    return {
        deviceMemory: nav.deviceMemory ?? null,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        jsHeapUsed: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1024 / 1024) : null,
        jsHeapTotal: perf.memory ? Math.round(perf.memory.totalJSHeapSize / 1024 / 1024) : null,
        jsHeapLimit: perf.memory ? Math.round(perf.memory.jsHeapSizeLimit / 1024 / 1024) : null,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        isMobile,
    };
}

// メモリ統計
export interface MemoryStats {
    currentHeapUsed: number | null;
    maxHeapUsed: number;
    maxHeapRecordedAt: string | null;
    monitoringStartedAt: string;
}

const MEMORY_STATS_KEY = 'turtle-video-memory-stats';

function loadMemoryStats(): MemoryStats {
    try {
        const stored = sessionStorage.getItem(MEMORY_STATS_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch {
        // 読み込み失敗
    }
    return {
        currentHeapUsed: null,
        maxHeapUsed: 0,
        maxHeapRecordedAt: null,
        monitoringStartedAt: new Date().toISOString(),
    };
}

function saveMemoryStats(stats: MemoryStats): void {
    try {
        sessionStorage.setItem(MEMORY_STATS_KEY, JSON.stringify(stats));
    } catch {
        // 保存失敗
    }
}

interface LogState {
    entries: LogEntry[];
    hasError: boolean;
    lastLogKey: string; // 重複抑制用
    lastLogTime: number; // 重複抑制用
    memoryStats: MemoryStats;

    // Actions
    log: (level: LogLevel, category: LogCategory, message: string, details?: Record<string, unknown>) => void;
    info: (category: LogCategory, message: string, details?: Record<string, unknown>) => void;
    warn: (category: LogCategory, message: string, details?: Record<string, unknown>) => void;
    error: (category: LogCategory, message: string, details?: Record<string, unknown>) => void;
    debug: (category: LogCategory, message: string, details?: Record<string, unknown>) => void;
    clearLogs: () => void;
    clearErrorFlag: () => void;
    exportLogs: () => string;
    getRecentErrors: () => LogEntry[];
    updateMemoryStats: () => void;
    clearMemoryStats: () => void;
}

export const useLogStore = create<LogState>()(
    devtools(
        (set, get) => ({
            entries: loadLogsFromStorage(),
            hasError: loadLogsFromStorage().some(e => e.level === 'ERROR'),
            lastLogKey: '',
            lastLogTime: 0,
            memoryStats: loadMemoryStats(),

            log: (level, category, message, details) => {
                const now = Date.now();
                const logKey = `${level}:${category}:${message}`;
                const { lastLogKey, lastLogTime, entries } = get();

                // 重複抑制: 同じログが短時間に連続する場合はスキップ
                if (logKey === lastLogKey && now - lastLogTime < DUPLICATE_SUPPRESS_MS) {
                    return;
                }

                const newEntry: LogEntry = {
                    id: generateLogId(),
                    timestamp: new Date().toISOString(),
                    level,
                    category,
                    message,
                    details,
                };

                // 最大件数を超えたら古いログを削除
                let newEntries = [...entries, newEntry];
                if (newEntries.length > MAX_LOG_ENTRIES) {
                    newEntries = newEntries.slice(newEntries.length - MAX_LOG_ENTRIES);
                }

                // ストレージに保存
                saveLogsToStorage(newEntries);

                set({
                    entries: newEntries,
                    hasError: level === 'ERROR' ? true : get().hasError,
                    lastLogKey: logKey,
                    lastLogTime: now,
                });
            },

            info: (category, message, details) => {
                get().log('INFO', category, message, details);
            },

            warn: (category, message, details) => {
                get().log('WARN', category, message, details);
            },

            error: (category, message, details) => {
                get().log('ERROR', category, message, details);
            },

            debug: (category, message, details) => {
                get().log('DEBUG', category, message, details);
            },

            clearLogs: () => {
                saveLogsToStorage([]);
                set({
                    entries: [],
                    hasError: false,
                    lastLogKey: '',
                    lastLogTime: 0,
                });
            },

            clearErrorFlag: () => {
                set({ hasError: false });
            },

            exportLogs: () => {
                const { entries, memoryStats } = get();
                const systemInfo = getSystemInfo();
                const exportData = {
                    exportedAt: new Date().toISOString(),
                    systemInfo: {
                        ...systemInfo,
                        deviceMemory_GB: systemInfo.deviceMemory,
                        jsHeapUsed_MB: systemInfo.jsHeapUsed,
                        jsHeapTotal_MB: systemInfo.jsHeapTotal,
                        jsHeapLimit_MB: systemInfo.jsHeapLimit,
                    },
                    memoryStats: {
                        currentHeapUsed_MB: memoryStats.currentHeapUsed,
                        maxHeapUsed_MB: memoryStats.maxHeapUsed,
                        maxHeapRecordedAt: memoryStats.maxHeapRecordedAt,
                        monitoringStartedAt: memoryStats.monitoringStartedAt,
                    },
                    logs: entries,
                };
                return JSON.stringify(exportData, null, 2);
            },

            getRecentErrors: () => {
                const { entries } = get();
                return entries.filter(e => e.level === 'ERROR').slice(-10);
            },

            updateMemoryStats: () => {
                const perf = performance as Performance & {
                    memory?: {
                        usedJSHeapSize: number;
                        totalJSHeapSize: number;
                        jsHeapSizeLimit: number;
                    };
                };

                if (!perf.memory) return;

                const currentHeap = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
                const { memoryStats } = get();

                const newStats: MemoryStats = {
                    ...memoryStats,
                    currentHeapUsed: currentHeap,
                };

                // 最大使用量を更新
                if (currentHeap > memoryStats.maxHeapUsed) {
                    newStats.maxHeapUsed = currentHeap;
                    newStats.maxHeapRecordedAt = new Date().toISOString();
                }

                saveMemoryStats(newStats);
                set({ memoryStats: newStats });
            },

            clearMemoryStats: () => {
                const newStats: MemoryStats = {
                    currentHeapUsed: null,
                    maxHeapUsed: 0,
                    maxHeapRecordedAt: null,
                    monitoringStartedAt: new Date().toISOString(),
                };
                saveMemoryStats(newStats);
                set({ memoryStats: newStats });
            },
        }),
        { name: 'log-store' }
    )
);

export default useLogStore;
