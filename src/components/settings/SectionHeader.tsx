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
      <h3 className="text-base leading-6 font-semibold">
        {children}
      </h3>
      {subtitle && (
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          {subtitle}
        </p>
      )}
    </div>
  );
}
