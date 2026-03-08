import * as React from 'react'
import { cn } from '../../lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'neutral' | 'success' | 'danger'
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  const toneStyles =
    tone === 'success'
      ? 'bg-green-500/10 text-green-400'
      : tone === 'danger'
      ? 'bg-red-500/10 text-red-400'
      : 'bg-white/10 text-gray-300'

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
        toneStyles,
        className
      )}
      {...props}
    />
  )
}

