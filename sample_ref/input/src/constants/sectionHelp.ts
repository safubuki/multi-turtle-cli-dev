/**
 * @file sectionHelp.ts
 * @author Turtle Village
 * @description セクションヘルプの表示内容を一元管理する定義。
 */

export type SectionHelpKey = 'app' | 'clips' | 'bgm' | 'narration' | 'caption' | 'preview';

export type SectionHelpVisualId =
  | 'app_step_clips'
  | 'app_step_bgm'
  | 'app_step_narration'
  | 'app_step_caption'
  | 'app_step_preview'
  | 'add_green_button'
  | 'add_yellow_button'
  | 'ai_add_button'
  | 'unlock_button'
  | 'lock_button_red'
  | 'eye_on_button'
  | 'eye_off_button'
  | 'move_up_button'
  | 'move_down_button'
  | 'delete_button'
  | 'edit_button'
  | 'settings_button'
  | 'save_button'
  | 'item_unlock_chip'
  | 'item_lock_chip'
  | 'trim_chip'
  | 'duration_chip'
  | 'start_chip'
  | 'delay_chip'
  | 'volume_chip'
  | 'mute_button'
  | 'reset_button'
  | 'scale_chip'
  | 'position_chip'
  | 'blackbar_toggle_chip'
  | 'size_chip'
  | 'blur_chip'
  | 'fade_in_chip'
  | 'fade_out_chip'
  | 'fade_in_checkbox'
  | 'fade_out_checkbox'
  | 'style_chip'
  | 'current_pin_chip'
  | 'stop_button'
  | 'play_button'
  | 'capture_button'
  | 'clear_button'
  | 'export_button'
  | 'download_button'
  | 'slider_demo';

export interface SectionHelpItem {
  title: string;
  description: string;
  visuals?: SectionHelpVisualId[];
  accordions?: {
    title: string;
    items: string[];
  }[];
}

export interface SectionHelpDefinition {
  title: string;
  subtitle: string;
  items: SectionHelpItem[];
}

export const SECTION_HELP_CONTENT: Record<SectionHelpKey, SectionHelpDefinition> = {
  app: {
    title: 'タートルビデオの使い方',
    subtitle: '',
    items: [
      {
        title: '概要',
        description:
          'タートルビデオは、旅行や出張などのちょっとした隙間時間にも、自宅で落ち着いて動画を作成したいときにも便利な動画編集ソフトです。\nレスポンシブデザインにより、スマホ・PCそれぞれに最適化された表示で編集できます。\nPWA（プログレッシブウェブアプリ）なので、スマホではアプリのような感覚で使え、AI機能を利用しなければオフラインでも利用できます。\nAI機能を活用すれば、より魅力的な動画に仕上げることができます。\nさらにオープンソース（GPLv3ライセンス）なので、AIであなた好みに改変して活用できます（※ライセンスの詳細は後述）。\nいつもあなたのそばに、タートルビデオを是非ご活用ください🐢',
      },
      {
        title: '主要な機能',
        description:
          '・動画・画像の追加、並び替え、トリミング/表示時間調整\n・BGMの追加と開始タイミング・音量・フェード調整\n・ナレーション（AI生成/音声追加）とタイミング調整\n・キャプションの追加、一括設定、個別設定\n・プレビュー確認、動画ファイル作成、ダウンロード\n・自動保存/手動保存と読み込み\n・スマホで縦方向にスワイプ中にスライダーへ触れても、操作方向とタッチ時間を判定し、誤操作と判断した場合は設定値を自動的に元へ戻します',
      },
      {
        title: '使い方（5ステップ）',
        description:
          '初めてでも、次の5ステップでかんたんに動画を作成できます。',
        visuals: ['app_step_clips', 'app_step_bgm', 'app_step_narration', 'app_step_caption', 'app_step_preview'],
      },
      {
        title: '動作確認機種',
        description:
          'スマホ: Pixel 6a（Android・Chrome）\nPC: Windows / CPU Ryzen 5 5500 / GPU RTX3060 12GB\n※動作確認は手持ちの機種でのみ実施しています。もし、動作しない場合はご了承ください。\n※iPhone / iPad の Safari は正式対応に向けて検証中です。入力・保存・ダウンロードはブラウザ仕様により表示や完了通知が一部異なる場合があります。',
      },
      {
        title: '注意事項',
        description: '長い編集や複雑な編集は、動作が不安定になることがあります。手動、自動保存を活用してください。',
      },
      {
        title: 'ライセンス',
        description:
          'タートルビデオは GNU General Public License v3.0（GPLv3）で公開されています。\n個人や社内で再頒布を伴わない場合は、自由に改変して利用可能です。ぜひAIなどを活用して、自分好みに改変して利用してみてください。\n改変版を外部に配布する場合は、ソースコード公開や同ライセンス継承など、GPLv3の条件に従う必要があります。\n詳細は README と LICENSE を確認してください。',
        accordions: [
          {
            title: '使用ライセンス一覧（本番依存 / 直接）',
            items: [
              '@tailwindcss/postcss (^4.1.18): MIT',
              'lucide-react (^0.563.0): ISC',
              'mp4-muxer (^5.2.2): MIT',
              'react (^19.2.4): MIT',
              'react-dom (^19.2.4): MIT',
              'zustand (^5.0.10): MIT',
            ],
          },
          {
            title: '使用ライセンス一覧（開発依存 / 直接）',
            items: [
              '@testing-library/jest-dom (^6.9.1): MIT',
              '@testing-library/react (^16.3.2): MIT',
              '@testing-library/user-event (^14.6.1): MIT',
              '@types/react (^19.2.10): MIT',
              '@types/react-dom (^19.2.3): MIT',
              '@typescript-eslint/eslint-plugin (^8.54.0): MIT',
              '@typescript-eslint/parser (^8.54.0): MIT',
              '@vitejs/plugin-react (^5.1.2): MIT',
              'autoprefixer (^10.4.23): MIT',
              'eslint (^9.39.2): MIT',
              'eslint-config-prettier (^10.1.8): MIT',
              'jsdom (^27.4.0): MIT',
              'postcss (^8.5.6): MIT',
              'prettier (^3.8.1): MIT',
              'sharp (^0.34.5): Apache-2.0',
              'tailwindcss (^4.1.18): MIT',
              'typescript (^5.9.3): Apache-2.0',
              'vite (^7.3.1): MIT',
              'vite-plugin-pwa (^1.2.0): MIT',
              'vitest (^4.0.18): MIT',
            ],
          },
          {
            title: '使用ライセンス一覧（間接依存を含む集計）',
            items: [
              '調査範囲: node_modules のユニークパッケージ 537 件',
              'MIT: 463件',
              'Apache-2.0: 21件',
              'ISC: 21件',
              'BSD-2-Clause: 11件',
              'BSD-3-Clause: 6件',
              'BlueOak-1.0.0: 4件',
              'MIT-0: 2件',
              'MPL-2.0: 2件',
              'Apache-2.0 AND LGPL-3.0-or-later: 1件',
              'Python-2.0: 1件',
              'CC-BY-4.0: 1件',
              '(AFL-2.1 OR BSD-3-Clause): 1件',
              'CC0-1.0: 1件',
              '0BSD: 1件',
              '(MIT OR CC0-1.0): 1件',
            ],
          },
        ],
      },
    ],
  },
  clips: {
    title: '動画・画像の使い方',
    subtitle: '素材の追加、並び替え、表示調整をこのセクションで行います。',
    items: [
      {
        title: '追加ボタン',
        description: '動画・画像ファイルを複数選択して一括追加できます。',
        visuals: ['add_green_button'],
      },
      {
        title: 'セクションの鍵アイコン',
        description: 'セクション全体をロックして誤操作を防止できます。',
        visuals: ['unlock_button', 'lock_button_red'],
      },
      {
        title: '並び替え・削除',
        description: '各クリップは上下移動と削除ができます。',
        visuals: ['move_up_button', 'move_down_button', 'delete_button'],
      },
      {
        title: '個別パネルの鍵',
        description: '各クリップだけを個別にロックできます。',
        visuals: ['item_unlock_chip', 'item_lock_chip'],
      },
      {
        title: '表示区間（動画：トリミング／画像：表示時間）',
        description:
          '動画は開始・終了位置を指定してトリミングできます。画像は表示時間を常時調整できます。どちらもスライダーで操作できます。',
        visuals: ['trim_chip', 'duration_chip', 'slider_demo'],
      },
      {
        title: '位置・サイズ調整',
        description:
          'この項目は折りたたみ表示です。開くと黒帯除去、拡大縮小、位置X/Yの調整ができます。黒帯除去は微細な上下の隙間を目立ちにくくする設定です。拡大縮小・位置の調整はスライダーで行え、くるくるアイコンでデフォルト値に戻せます。',
        visuals: ['blackbar_toggle_chip', 'scale_chip', 'position_chip', 'reset_button', 'slider_demo'],
      },
      {
        title: '音量・フェード設定',
        description:
          'この項目は折りたたみ表示です。開くとスピーカーでミュート切替、くるくるアイコンでデフォルト値に戻せます。動画・画像のフェードはチェックON時のみ有効で、秒数は0.5秒・1秒・2秒の3つから設定できます。',
        visuals: ['volume_chip', 'mute_button', 'reset_button', 'fade_in_checkbox', 'fade_out_checkbox', 'slider_demo'],
      },
    ],
  },
  bgm: {
    title: 'BGMの使い方',
    subtitle: 'BGMの追加、配置、音量、フェードを細かく調整できます。',
    items: [
      {
        title: '追加ボタン',
        description: 'BGMファイルを追加できます。',
        visuals: ['add_green_button'],
      },
      {
        title: 'セクションの鍵アイコン',
        description: 'BGM設定をロックして誤操作を防止できます。',
        visuals: ['unlock_button', 'lock_button_red'],
      },
      {
        title: 'パネル内の削除',
        description: 'BGMを削除する場合は、パネル内のゴミ箱ボタンを使います。',
        visuals: ['delete_button'],
      },
      {
        title: '開始位置・開始タイミング（遅延）',
        description: 'BGM内の開始位置と、動画タイムライン上の開始タイミング（遅延）を設定できます。',
        visuals: ['start_chip', 'delay_chip', 'slider_demo'],
      },
      {
        title: '音量調整',
        description: '音量を調整し、スピーカーアイコンでミュートON/OFF切替、くるくるアイコンでデフォルト値に戻せます。',
        visuals: ['volume_chip', 'mute_button', 'reset_button', 'slider_demo'],
      },
      {
        title: 'フェード設定',
        description:
          'チェックを入れるとフェードイン/フェードアウトが有効になり、秒数は0.5秒・1秒・2秒の3つから設定できます。',
        visuals: ['fade_in_checkbox', 'fade_out_checkbox', 'slider_demo'],
      },
    ],
  },
  narration: {
    title: 'ナレーションの使い方',
    subtitle: 'AIボタンと追加ボタンを使って、複数のナレーションを重ねて管理します。',
    items: [
      {
        title: 'AI / 追加ボタン',
        description:
          'AIで好みのナレーションを生成できます。あらかじめ用意した音声ファイルを追加することもでき、複数のナレーションを重ねて設定できます。',
        visuals: ['ai_add_button', 'add_green_button'],
      },
      {
        title: 'セクションの鍵アイコン',
        description: 'ナレーションの追加・削除・調整をロックできます。',
        visuals: ['unlock_button', 'lock_button_red'],
      },
      {
        title: '並び替え・編集・削除・保存',
        description:
          '各ナレーションを上下移動、編集、削除できます。保存ボタンを使うと、AIで生成したナレーションをパソコンやスマホに保存できます。対応ブラウザでは保存先ダイアログ、未対応ブラウザでは標準ダウンロードを利用します。',
        visuals: ['move_up_button', 'move_down_button', 'edit_button', 'delete_button', 'save_button'],
      },
      {
        title: '開始位置',
        description: '開始位置は数値入力・スライダーのほか、現在位置ボタンでプレビューの現在位置に設定できます。',
        visuals: ['start_chip', 'current_pin_chip', 'slider_demo'],
      },
      {
        title: 'トリミング設定（折りたたみ）',
        description:
          'トリミング開始/終了は「トリミング設定」を開いたときだけ表示されます。長いナレーションを複数に分割して、タイミングを調整したり、声質を合わせたいときに便利です。',
        visuals: ['trim_chip', 'duration_chip', 'slider_demo'],
      },
      {
        title: '音量調整',
        description: '音量は常時表示です。スライダーで調整し、スピーカーアイコンでミュートON/OFF切替、くるくるアイコンでデフォルト値に戻せます。',
        visuals: ['volume_chip', 'mute_button', 'reset_button', 'slider_demo'],
      },
    ],
  },
  caption: {
    title: 'キャプションの使い方',
    subtitle: '追加、表示ON/OFF、一括設定、個別設定をまとめて管理できます。',
    items: [
      {
        title: '追加ボタン',
        description: '入力したテキストをキャプションとして追加できます。',
        visuals: ['add_yellow_button'],
      },
      {
        title: '表示アイコン（目のマークのアイコン）',
        description:
          '表示アイコンをOFFに設定すると、キャプションを設定していてもすべてOFF表示になり、出力した動画にも表示されません。鍵アイコンで編集ロックを切り替えます。',
        visuals: ['eye_on_button', 'eye_off_button', 'unlock_button', 'lock_button_red'],
      },
      {
        title: 'スタイル・フェードの一括設定',
        description:
          'ここで全キャプション共通の設定をまとめて行えます。サイズ、字体、位置、ぼかしなどのスタイルに加えて、フェード（0.5秒・1秒・2秒）も一括で設定できます。',
        visuals: ['style_chip', 'size_chip', 'position_chip', 'blur_chip', 'fade_in_checkbox', 'fade_out_checkbox', 'slider_demo'],
      },
      {
        title: '各キャプションの操作',
        description:
          '上下移動、削除、編集を各行のボタンで行えます。鉛筆の編集ボタンでキャプション内容を編集できます。',
        visuals: ['move_up_button', 'move_down_button', 'edit_button', 'delete_button'],
      },
      {
        title: '個別設定（歯車マーク）',
        description:
          '歯車マークを押すと、キャプションごとの個別設定を開けます。サイズ、字体、位置、フェードを個別に調整でき、一括設定を使っていても個別設定で上書きできます。',
        visuals: ['settings_button', 'slider_demo'],
      },
      {
        title: '表示時間',
        description: '開始時間・終了時間はスライダーや数値で調整し、現在位置ボタンでプレビューの現在位置に設定できます。',
        visuals: ['start_chip', 'duration_chip', 'current_pin_chip', 'slider_demo'],
      },
    ],
  },
  preview: {
    title: 'プレビューの使い方',
    subtitle: '再生確認、書き出し、ダウンロードをこのセクションで行います。',
    items: [
      {
        title: '停止・再生・キャプチャ',
        description: '停止と再生でプレビュー操作ができ、キャプチャは現在の表示内容を画像として保存できます。',
        visuals: ['stop_button', 'play_button', 'capture_button'],
      },
      {
        title: '動画ファイルを作成',
        description: '動画ファイルを作成できます。作成中にタブを切り替えたり画面を非アクティブにすると、動画を正しく作成できません。',
        visuals: ['export_button'],
      },
      {
        title: '作成後のダウンロード',
        description: '作成完了後はダウンロードできます。対応ブラウザでは保存先ダイアログ、未対応ブラウザでは標準ダウンロードを利用します。停止/再生を押すと「動画ファイルを作成」ボタンに戻り、再作成も可能です。',
        visuals: ['download_button'],
      },
      {
        title: '一括クリア',
        description: '一括クリアで動画作成状態をクリアしてすべて初期状態に戻せます。',
        visuals: ['clear_button'],
      },
    ],
  },
};
