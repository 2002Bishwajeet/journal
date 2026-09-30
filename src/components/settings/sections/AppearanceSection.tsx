import {
  useThemePreference,
  type ThemePreference,
} from "@/hooks/useThemePreference";
import {
  useEditorAppearance,
  type EditorFont,
  type EditorWidth,
} from "@/hooks/useEditorAppearance";
import { cn } from "@/lib/utils";
import { Moon, Sun, Monitor, CheckCircle2, Type, MoveHorizontal } from "lucide-react";
import { SectionHeader } from "../SectionHeader";
import { SettingsRow } from "../SettingsRow";

/**
 * Mini-preview colours, copied from the light (`:root`) and `.dark` tokens in
 * src/index.css. They are literals on purpose: each preview must show its own
 * theme regardless of the theme currently applied. Keep in sync with index.css.
 */
const THEME_PREVIEW = {
  light: { bg: "#FDFCF8", fg: "#2C2B29", line: "#E6E4DD", accent: "#F2F0E9" },
  dark: { bg: "#1C1B1A", fg: "#E6E4DD", line: "#3E3D3A", accent: "#2C2B29" },
  system: {
    bg: "linear-gradient(135deg, #FDFCF8 50%, #1C1B1A 50%)",
    fg: "#8A8780",
    line: "#E6E4DD",
    accent: "#F2F0E9",
  },
} as const;

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const FONTS: { id: EditorFont; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
];

const WIDTHS: { id: EditorWidth; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "default", label: "Default" },
  { id: "full", label: "Full" },
];

/** Segmented radio group; native radios keep arrow-key navigation and labels. */
function OptionGroup<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-lg border p-0.5"
    >
      {options.map((o) => (
        <label
          key={o.id}
          className={cn(
            "flex min-h-11 cursor-pointer items-center rounded-md px-3 text-xs font-medium transition-colors md:min-h-8 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
            value === o.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={value === o.id}
            onChange={() => onChange(o.id)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export default function AppearanceSection() {
  const { theme, setTheme } = useThemePreference();
  const { font, setFont, width, setWidth } = useEditorAppearance();

  return (
    <div className="space-y-10">
      {/* Theme Previews */}
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-3 gap-4"
      >
        {THEMES.map((t) => {
          const Icon = t.icon;
          const preview = THEME_PREVIEW[t.id];
          const isActive = theme === t.id;
          return (
            <label
              key={t.id}
              className={cn(
                "relative group cursor-pointer rounded-xl overflow-hidden transition-colors text-left has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-6 has-[:focus-visible]:outline-ring",
                isActive
                  ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border hover:ring-border/80 hover:shadow-md"
              )}
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={isActive}
                onChange={() => setTheme(t.id)}
                className="sr-only"
              />
              {/* Mini page preview */}
              <div
                className="h-28 p-3 flex flex-col gap-1.5"
                style={{ background: preview.bg }}
              >
                {/* Fake sidebar + content area */}
                <div className="flex gap-2 flex-1">
                  <div
                    className="w-6 rounded-sm flex flex-col gap-1 p-1"
                    style={{ background: preview.accent }}
                  >
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: preview.line }}
                    />
                    <div
                      className="h-1 w-3/4 rounded-full"
                      style={{ background: preview.line }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: preview.line }}
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <div
                      className="h-2 w-3/4 rounded-full"
                      style={{ background: preview.fg, opacity: 0.2 }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: preview.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-5/6 rounded-full"
                      style={{ background: preview.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-2/3 rounded-full"
                      style={{ background: preview.fg, opacity: 0.08 }}
                    />
                  </div>
                </div>
              </div>

              {/* Label area */}
              <div
                className={cn(
                  "px-3 py-2.5 flex items-center gap-2 border-t border-border/60 transition-colors",
                  isActive ? "bg-accent" : "bg-card"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    isActive ? "text-primary" : "text-muted-foreground"
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
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto" />
                )}
              </div>
            </label>
          );
        })}
      </div>

      <div className="space-y-4">
        <SectionHeader subtitle="How notes look while you write">
          Editor
        </SectionHeader>
        <div className="rounded-lg border">
          <SettingsRow
            id="editor-font"
            icon={Type}
            label="Font"
            description="The typeface of your note text"
            control={
              <OptionGroup
                name="editor-font"
                label="Editor font"
                options={FONTS}
                value={font}
                onChange={setFont}
              />
            }
          />
          <SettingsRow
            id="editor-width"
            icon={MoveHorizontal}
            label="Width"
            description="How wide the note column is"
            control={
              <OptionGroup
                name="editor-width"
                label="Editor width"
                options={WIDTHS}
                value={width}
                onChange={setWidth}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
