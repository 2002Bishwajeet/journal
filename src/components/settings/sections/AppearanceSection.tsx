import { useThemePreference } from "@/hooks/useThemePreference";
import { cn } from "@/lib/utils";
import { Moon, Sun, Monitor, CheckCircle2 } from "lucide-react";

export default function AppearanceSection() {
  const { theme, setTheme } = useThemePreference();

  const themes = [
    {
      id: "light",
      label: "Light",
      icon: Sun,
      bg: "#FDFCF8",
      fg: "#2C2B29",
      line: "#E6E4DD",
      accent: "#F2F0E9",
    },
    {
      id: "dark",
      label: "Dark",
      icon: Moon,
      bg: "#1C1B1A",
      fg: "#E6E4DD",
      line: "#3E3D3A",
      accent: "#2C2B29",
    },
    {
      id: "system",
      label: "System",
      icon: Monitor,
      bg: "linear-gradient(135deg, #FDFCF8 50%, #1C1B1A 50%)",
      fg: "#8A8780",
      line: "#E6E4DD",
      accent: "#F2F0E9",
    },
  ] as const;

  return (
    <div className="space-y-10">
      {/* Theme Previews */}
      <div className="grid grid-cols-3 gap-4">
        {themes.map((t) => {
          const Icon = t.icon;
          const isActive = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "relative group rounded-xl overflow-hidden transition-colors text-left",
                isActive
                  ? "ring-2 ring-[#B8860B] ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border hover:ring-border/80 hover:shadow-md"
              )}
            >
              {/* Mini page preview */}
              <div
                className="h-28 p-3 flex flex-col gap-1.5"
                style={{ background: t.bg }}
              >
                {/* Fake sidebar + content area */}
                <div className="flex gap-2 flex-1">
                  <div
                    className="w-6 rounded-sm flex flex-col gap-1 p-1"
                    style={{ background: t.accent }}
                  >
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.line }}
                    />
                    <div
                      className="h-1 w-3/4 rounded-full"
                      style={{ background: t.line }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.line }}
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <div
                      className="h-2 w-3/4 rounded-full"
                      style={{ background: t.fg, opacity: 0.2 }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-5/6 rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-2/3 rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                  </div>
                </div>
              </div>

              {/* Label area */}
              <div
                className={cn(
                  "px-3 py-2.5 flex items-center gap-2 border-t transition-colors",
                  isActive
                    ? "bg-[#B8860B]/5 border-[#B8860B]/20"
                    : "bg-card border-border/60"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    isActive ? "text-[#B8860B]" : "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {t.label}
                </span>
                {isActive && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#B8860B] ml-auto" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
