import type { ReactNode } from "react";

export function SectionHeader({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-muted-foreground">
        {children}
      </h3>
      {subtitle && (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
