import type { LucideIcon } from 'lucide-react';

/** Decorative interface icons share an outline, sizing and accessibility defaults. */
export default function AppIcon({ icon: Icon, size = 18, className = '' }: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" className={`app-icon ${className}`} />;
}
