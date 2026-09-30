import { CircleX, Info, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CALLOUT_ICON_CLASSES, type CalloutVariant } from './calloutVariants';

const ICONS: Record<CalloutVariant, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  tip: Lightbulb,
  error: CircleX,
};

/** The lucide icon for a callout variant, shared by the editor and share page. */
export function CalloutIcon({ variant, className }: { variant: CalloutVariant; className?: string }) {
  const Icon = ICONS[variant];
  return <Icon aria-hidden className={cn('size-4 shrink-0', CALLOUT_ICON_CLASSES[variant], className)} />;
}
