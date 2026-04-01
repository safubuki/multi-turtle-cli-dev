import { User } from 'lucide-react'
import { getBuiltInAgentIconSrc, type BuiltInAgentIconId } from '../config/iconAssets'

interface AgentAvatarProps {
  size?: number
  avatarPreset: BuiltInAgentIconId | null
  avatarCustomDataUrl: string | null
  alt: string
  className?: string
  fallbackClassName?: string
  iconClassName?: string
}

export function AgentAvatar({
  size = 40,
  avatarPreset,
  avatarCustomDataUrl,
  alt,
  className = '',
  fallbackClassName = '',
  iconClassName = ''
}: AgentAvatarProps) {
  const src = avatarCustomDataUrl || getBuiltInAgentIconSrc(avatarPreset)

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className={`flex h-full w-full items-center justify-center ${fallbackClassName}`.trim()}>
          <User size={Math.max(16, Math.round(size * 0.45))} className={iconClassName} />
        </div>
      )}
    </div>
  )
}
