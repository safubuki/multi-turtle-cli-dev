import { useEffect } from 'react';

/**
 * 画面の向きを縦方向に固定するためのフック
 * Screen Orientation APIを使用し、可能な場合のみロックを試みる。
 * PCや非対応ブラウザでは何もしない（エラーは抑制される）。
 * タブレット（768px以上）では向き固定を行わず、自由な回転を許可する。
 * 
 * @param orientation 固定したい向き ('portrait', 'landscape', etc.)
 */
export const useOrientationLock = (orientation: 'portrait' | 'landscape' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary' = 'portrait') => {
    useEffect(() => {
        const lockOrientation = async () => {
            // タブレット・PC（768px以上）では向き固定をスキップ
            // タブレットは横画面での使用が想定されるため、ロックしない
            if (window.innerWidth >= 768) {
                return;
            }

            // Screen Orientation APIのサポート確認
            // TypeScript定義が不足している場合があるため any キャストを使用
            const screenOrientation = (screen as any).orientation;

            if (typeof screen !== 'undefined' && screenOrientation && typeof screenOrientation.lock === 'function') {
                try {
                    await screenOrientation.lock(orientation);
                    // console.debug(`Screen orientation locked to ${orientation}`);
                } catch (e) {
                    // ロック失敗は想定内（PCブラウザ、対応していない環境など）
                    // ユーザー体験を損なわないよう、エラーはコンソールに出さずに無視する
                    // console.debug('Screen orientation lock failed (expected on some devices/browsers):', e);
                }
            }
        };

        lockOrientation();

        // クリーンアップ時のアンロックは意図的に行わない
        // （ユーザーがアプリを離れても、アプリに戻ったときは固定されたままであることが望ましいため）
    }, [orientation]);
};
