import { PROVIDER_LABELS, formatReasoningEffort } from '../config/agentMetadata'
import { useStore, type AgentProfile } from '../store/useStore'

interface AgentRuntimeMetaProps {
  agent: Pick<AgentProfile, 'provider' | 'model' | 'reasoningEffort'>
  compact?: boolean
}

export function AgentRuntimeMeta({ agent, compact = false }: AgentRuntimeMetaProps) {
  const providerCatalog = useStore((state) => state.providerCatalogs[agent.provider])
  const modelInfo = providerCatalog?.models.find((entry) => entry.id === agent.model)
  const showReasoning = (modelInfo?.supportedReasoningEfforts?.length ?? 0) > 0
  const baseTextClass = compact ? 'text-[11px]' : 'text-xs'
  const valueTextClass = compact ? 'text-slate-100' : 'text-slate-200'
  const topGridClass = showReasoning ? 'grid-cols-3' : 'grid-cols-2'

  return (
    <div className="min-w-0 space-y-2">
      <div className={`grid gap-2 ${topGridClass}`}>
        <div className="flex h-[96px] min-w-0 flex-col rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
          <p className={`${baseTextClass} uppercase tracking-wider text-slate-500`}>CLI</p>
          <p
            className={`mt-1 h-[48px] overflow-hidden break-words leading-5 ${valueTextClass}`}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            }}
          >
            {PROVIDER_LABELS[agent.provider]}
          </p>
        </div>
        <div className="flex h-[96px] min-w-0 flex-col rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
          <p className={`${baseTextClass} uppercase tracking-wider text-slate-500`}>Model</p>
          <p
            className={`mt-1 h-[48px] overflow-hidden break-words leading-5 ${valueTextClass}`}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            }}
          >
            {agent.model}
          </p>
        </div>
        {showReasoning && (
          <div className="flex h-[96px] min-w-0 flex-col rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
            <p className={`${baseTextClass} uppercase tracking-wider text-slate-500`}>Reasoning</p>
            <p className={`mt-1 h-[48px] break-words leading-5 ${valueTextClass}`}>
              {formatReasoningEffort(agent.reasoningEffort)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
