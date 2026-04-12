import { Trash2, Wifi } from 'lucide-react'
import type { PaneState, SharedContextItem } from '../types'

interface SharedContextDockProps {
  sharedContext: SharedContextItem[]
  panes: PaneState[]
  onDelete: (contextId: string) => void
}

export function SharedContextDock({ sharedContext, panes, onDelete }: SharedContextDockProps) {
  if (sharedContext.length === 0) {
    return null
  }

  return (
    <section className="context-dock">
      <div className="panel-header context-dock-header">
        <Wifi size={16} />
        <h2>{'\u5171\u6709\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8'}</h2>
      </div>
      <div className="context-dock-note">
        <span>{`\u5168\u4f53 ${sharedContext.filter((item) => item.scope === 'global').length}`}</span>
        <span>{`\u500b\u5225 ${sharedContext.filter((item) => item.scope === 'direct').length}`}</span>
        <span>{'\u6b21\u56de\u306e\u5b9f\u884c1\u56de\u3060\u3051\u306b\u53cd\u6620'}</span>
      </div>
      <div className="context-dock-list">
        {sharedContext.map((item) => {
          const pendingPaneTitles = panes.filter((pane) => pane.attachedContextIds.includes(item.id)).map((pane) => pane.title)
          const consumedPaneTitles = panes.filter((pane) => item.consumedByPaneIds.includes(pane.id)).map((pane) => pane.title)
          const directTargets = item.targetPaneTitles.length > 0
            ? item.targetPaneTitles
            : panes.filter((pane) => item.targetPaneIds.includes(pane.id)).map((pane) => pane.title)

          return (
            <article key={item.id} className="context-dock-item">
              <div className="context-dock-item-head">
                <div>
                  <strong>{item.sourcePaneTitle}</strong>
                  <span className="context-dock-meta">
                    {item.contentLabel} / {item.scope === 'global' ? '\u5168\u4f53\u5171\u6709' : '\u500b\u5225\u5171\u6709'}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-button danger compact-icon-button"
                  onClick={() => onDelete(item.id)}
                  title={'\u5171\u6709\u3092\u524a\u9664'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <span>{item.summary}</span>
              <span className="context-dock-meta">{'\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9: '}{item.workspaceLabel}</span>
              <span className="context-dock-meta">
                {item.scope === 'global'
                  ? pendingPaneTitles.length > 0
                    ? '\u6b21\u56de\u4f7f\u7528\u4e88\u5b9a: ' + pendingPaneTitles.join(', ')
                    : '\u6b21\u56de\u4f7f\u7528\u4e88\u5b9a: \u307e\u3060\u3042\u308a\u307e\u305b\u3093'
                  : directTargets.length > 0
                    ? '\u500b\u5225\u5171\u6709\u5148: ' + directTargets.join(', ')
                    : '\u500b\u5225\u5171\u6709\u5148: \u306a\u3057'}
              </span>
              <span className="context-dock-meta">
                {consumedPaneTitles.length > 0
                  ? '\u4f7f\u7528\u6e08\u307f: ' + consumedPaneTitles.join(', ')
                  : '\u4f7f\u7528\u6e08\u307f: \u307e\u3060\u3042\u308a\u307e\u305b\u3093'}
              </span>
            </article>
          )
        })}
      </div>
    </section>
  )
}
