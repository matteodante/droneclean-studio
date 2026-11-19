import { DroneCleanLogo } from '@/studio/brand/droneclean-logo'

interface FreeCutLogoProps {
  variant?: 'full' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

// Kept as FreeCut's own logo entry point so the seven call sites stay untouched; the brand marks
// live in `src/studio/brand/droneclean-logo.tsx`.
export function FreeCutLogo({ variant = 'full', size = 'md', className }: FreeCutLogoProps) {
  return <DroneCleanLogo variant={variant} size={size} className={className} />
}
