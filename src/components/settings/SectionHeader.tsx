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
      <h3
        className="text-xl tracking-tight text-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {children}
      </h3>
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
