import { Grid2x2, LayoutPanelTop, Plus, SplitSquareHorizontal } from 'lucide-react'
import type { SummaryMetricsValue } from './SummaryMetrics'

type StageLayoutMode = 'quad' | 'triple' | 'focus'

interface StageToolbarProps {
  layout: StageLayoutMode
  metrics: SummaryMetricsValue
  onAddPane: () => void
  onCloseAllPaneAccordions: () => void
  onLayoutChange: (layout: StageLayoutMode) => void
}

export function StageToolbar({
  layout,
  metrics,
  onAddPane,
  onCloseAllPaneAccordions,
  onLayoutChange
}: StageToolbarProps) {
  return (
    <div className="stage-toolbar">
      <div className="toolbar-group">
        <button type="button" className="primary-button" onClick={onAddPane}>
          <Plus size={16} />
          {'\u30da\u30a4\u30f3\u8ffd\u52a0'}
        </button>
        <button type="button" className="secondary-button" onClick={onCloseAllPaneAccordions}>
          {'\u898b\u305f\u76ee\u30ad\u30ec\u30a4'}
        </button>
        <button
          type="button"
          className={layout === 'quad' ? 'switch-button active' : 'switch-button'}
          onClick={() => onLayoutChange('quad')}
        >
          <Grid2x2 size={15} />
          2x2
        </button>
        <button
          type="button"
          className={layout === 'triple' ? 'switch-button active' : 'switch-button'}
          onClick={() => onLayoutChange('triple')}
        >
          <SplitSquareHorizontal size={15} />
          {'3\u5217'}
        </button>
        <button
          type="button"
          className={layout === 'focus' ? 'switch-button active' : 'switch-button'}
          onClick={() => onLayoutChange('focus')}
        >
          <LayoutPanelTop size={15} />
          Focus
        </button>
      </div>

      <div className="toolbar-status-strip" aria-label="pane-status-summary">
        <span className="toolbar-status-chip running">実行中 {metrics.running}</span>
        <span className="toolbar-status-chip completed">完了 {metrics.completed}</span>
        <span className="toolbar-status-chip attention">確認待ち {metrics.attention}</span>
        <span className="toolbar-status-chip issue">停滞 / エラー {metrics.error + metrics.stalled}</span>
      </div>
    </div>
  )
}
