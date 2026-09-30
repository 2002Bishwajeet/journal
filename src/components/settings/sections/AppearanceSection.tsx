import type { ReactNode } from "react";
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
import { Moon, Sun, Monitor, CheckCircle2, type LucideIcon } from "lucide-react";
import { SectionHeader } from "../SectionHeader";

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

const THEMES: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

/** `family` is the stack the editor uses for that choice (src/index.css). */
const FONTS: { id: EditorFont; label: string; family: string }[] = [
  { id: "sans", label: "Sans", family: "var(--font-sans)" },
  { id: "serif", label: "Serif", family: "var(--font-editor-serif)" },
  { id: "mono", label: "Mono", family: "var(--font-editor-mono)" },
];

/** `column` is how much of the preview's page the note column takes. */
const WIDTHS: { id: EditorWidth; label: string; column: string }[] = [
  { id: "narrow", label: "Narrow", column: "w-1/2" },
  { id: "default", label: "Default", column: "w-3/4" },
  { id: "full", label: "Full", column: "w-full" },
];

/**
 * One option of a radio group, drawn as a card: a preview of the choice above
 * its name. The native radio keeps arrow-key navigation and the label.
 */
function PreviewCard({
  name,
  value,
  label,
  icon: Icon,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  label: string;
  icon?: LucideIcon;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative block cursor-pointer overflow-hidden rounded-xl text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-6 has-[:focus-visible]:outline-ring",
        checked
          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
          : "ring-1 ring-border hover:ring-muted-foreground"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <div aria-hidden="true">{children}</div>
      <div
        className={cn(
          "flex items-center gap-2 border-t border-border/60 px-3 py-2.5 transition-colors",
          checked ? "bg-accent" : "bg-card"
        )}
      >
        {Icon && (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              checked ? "text-primary" : "text-muted-foreground"
            )}
          />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            checked ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        {checked && (
          <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
        )}
      </div>
    </label>
  );
}

/** A labelled row of preview cards inside the Editor group. */
function EditorOption({
  id,
  title,
  description,
  label,
  children,
}: {
  id: string;
  title: string;
  description: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h4 className="text-sm leading-5 font-medium">{title}</h4>
        <p id={`${id}-desc`} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={`${id}-desc`}
        className="grid grid-cols-3 gap-3 md:gap-4"
      >
        {children}
      </div>
    </div>
  );
}

export default function AppearanceSection() {
  const { theme, setTheme } = useThemePreference();
  const { font, setFont, width, setWidth } = useEditorAppearance();

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <SectionHeader>Theme</SectionHeader>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-3 md:gap-4"
        >
          {THEMES.map((t) => {
            const preview = THEME_PREVIEW[t.id];
            return (
              <PreviewCard
                key={t.id}
                name="theme"
                value={t.id}
                label={t.label}
                icon={t.icon}
                checked={theme === t.id}
                onSelect={() => setTheme(t.id)}
              >
                {/* Mini page: fake sidebar + content area */}
                <div className="flex h-20 gap-2 p-3" style={{ background: preview.bg }}>
                  <div
                    className="flex w-6 flex-col gap-1 rounded-sm p-1"
                    style={{ background: preview.accent }}
                  >
                    <div className="h-1 w-full rounded-full" style={{ background: preview.line }} />
                    <div className="h-1 w-3/4 rounded-full" style={{ background: preview.line }} />
                    <div className="h-1 w-full rounded-full" style={{ background: preview.line }} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="h-2 w-3/4 rounded-full" style={{ background: preview.fg, opacity: 0.2 }} />
                    <div className="h-1 w-full rounded-full" style={{ background: preview.fg, opacity: 0.08 }} />
                    <div className="h-1 w-5/6 rounded-full" style={{ background: preview.fg, opacity: 0.08 }} />
                    <div className="h-1 w-2/3 rounded-full" style={{ background: preview.fg, opacity: 0.08 }} />
                  </div>
                </div>
              </PreviewCard>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeader subtitle="How notes look while you write">
          Editor
        </SectionHeader>

        <div className="space-y-6">
          <EditorOption
            id="editor-font"
            title="Font"
            description="The typeface of your note text"
            label="Editor font"
          >
            {FONTS.map((f) => (
              <PreviewCard
                key={f.id}
                name="editor-font"
                value={f.id}
                label={f.label}
                checked={font === f.id}
                onSelect={() => setFont(f.id)}
              >
                {/* A specimen set in the font itself */}
                <div className="flex h-20 flex-col justify-center gap-2 bg-background px-3">
                  <span className="text-3xl leading-none" style={{ fontFamily: f.family }}>
                    Ag
                  </span>
                  <div className="h-1 w-5/6 rounded-full bg-foreground/10" />
                  <div className="h-1 w-3/5 rounded-full bg-foreground/10" />
                </div>
              </PreviewCard>
            ))}
          </EditorOption>

          <EditorOption
            id="editor-width"
            title="Width"
            description="How wide the note column is"
            label="Editor width"
          >
            {WIDTHS.map((w) => (
              <PreviewCard
                key={w.id}
                name="editor-width"
                value={w.id}
                label={w.label}
                checked={width === w.id}
                onSelect={() => setWidth(w.id)}
              >
                {/* A page with the note column at that width */}
                <div className="h-20 bg-background p-3">
                  <div className={cn("mx-auto flex h-full flex-col justify-center gap-1.5", w.column)}>
                    <div className="h-2 w-2/3 rounded-full bg-foreground/25" />
                    <div className="h-1 w-full rounded-full bg-foreground/10" />
                    <div className="h-1 w-full rounded-full bg-foreground/10" />
                    <div className="h-1 w-4/5 rounded-full bg-foreground/10" />
                  </div>
                </div>
              </PreviewCard>
            ))}
          </EditorOption>
        </div>
      </div>
    </div>
  );
}
