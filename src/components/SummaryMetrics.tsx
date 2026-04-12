import { Activity, Bot, CheckCircle2, XCircle } from 'lucide-react'

export interface SummaryMetricsValue {
  running: number
  completed: number
  attention: number
  error: number
  stalled: number
}

interface SummaryMetricsProps {
  metrics: SummaryMetricsValue
}

export function SummaryMetrics({ metrics }: SummaryMetricsProps) {
  return (
    <section className="summary-grid compact">
      <article className="metric-card compact">
        <header>
          <Activity size={16} />
          <span>{'\u5b9f\u884c\u4e2d'}</span>
        </header>
        <strong>{metrics.running}</strong>
        <p>{'\u5b9f\u884c\u4e2d\u306e\u30bf\u30b9\u30af'}</p>
      </article>
      <article className="metric-card compact">
        <header>
          <CheckCircle2 size={16} />
          <span>{'\u5b8c\u4e86'}</span>
        </header>
        <strong>{metrics.completed}</strong>
        <p>{'\u6b63\u5e38\u306b\u7d42\u4e86\u3057\u305f\u30bf\u30b9\u30af'}</p>
      </article>
      <article className="metric-card compact">
        <header>
          <Bot size={16} />
          <span>{'\u78ba\u8a8d\u5f85\u3061'}</span>
        </header>
        <strong>{metrics.attention}</strong>
        <p>{'\u5165\u529b\u3084\u5224\u65ad\u304c\u5fc5\u8981\u306a\u30bf\u30b9\u30af'}</p>
      </article>
      <article className="metric-card compact">
        <header>
          <XCircle size={16} />
          <span>{'\u505c\u6ede / \u30a8\u30e9\u30fc'}</span>
        </header>
        <strong>{metrics.error + metrics.stalled}</strong>
        <p>{'\u5931\u6557\u307e\u305f\u306f\u505c\u6ede\u3092\u691c\u51fa\u3057\u305f\u30bf\u30b9\u30af'}</p>
      </article>
    </section>
  )
}
