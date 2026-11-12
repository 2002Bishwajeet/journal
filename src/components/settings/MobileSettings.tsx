import { ChevronLeft, ChevronRight } from "lucide-react";
import { DialogTitle } from "@/components/ui/dialog";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useThemePreference } from "@/hooks/useThemePreference";
import { formatRelativeTime } from "@/lib/utils/index";
import type { SettingsSection, SettingsSectionId } from "./sections";

// Rows are grouped like iOS Settings. A section missing here still shows, in a last group.
const GROUPS: SettingsSectionId[][] = [
  ["account"],
  ["appearance", "ai", "notifications"],
  ["data"],
  ["agent-access"],
  ["about"],
];

// Diagnostics is a page under About ("Troubleshooting"), not a list row.
const NESTED: SettingsSectionId[] = ["diagnostics"];

// Phone labels where the desktop name is too technical for a daily list.
const PHONE_LABEL: Partial<Record<SettingsSectionId, string>> = { "agent-access": "Privacy & agents" };

const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

interface MobileSettingsProps {
  sections: SettingsSection[];
  /** The open section page, or null for the list. */
  page: SettingsSectionId | null;
  onPage: (page: SettingsSectionId | null) => void;
  onClose: () => void;
}

/** Phone Settings (#831): a grouped list that drills into one page per section. */
export default function MobileSettings({ sections, page, onPage, onClose }: MobileSettingsProps) {
  const { identity, pendingTotal, lastSyncedAt } = useAccountSettings();
  const { theme } = useThemePreference();
  const syncStatus = pendingTotal
    ? `${pendingTotal} ${pendingTotal === 1 ? "change" : "changes"} waiting`
    : lastSyncedAt
      ? `Synced ${formatRelativeTime(lastSyncedAt)}`
      : null;
  const hints: Partial<Record<SettingsSectionId, string | null>> = {
    appearance: THEME_LABEL[theme],
    about: `v${__APP_VERSION__}`,
  };
  const current = sections.find((s) => s.id === page);
  const labelOf = (s: SettingsSection) => PHONE_LABEL[s.id] ?? s.label;
  const grouped = new Set([...GROUPS.flat(), ...NESTED]);
  const groups = [
    ...GROUPS.map((ids) => sections.filter((s) => ids.includes(s.id))),
    sections.filter((s) => !grouped.has(s.id)),
  ].filter((g) => g.length > 0);
  const diagnostics = sections.find((s) => s.id === "diagnostics");

  return (
    <div className="flex h-dvh min-w-0 flex-col md:h-[min(640px,85dvh)]">
      {current ? (
        <>
          <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border/60 px-2 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              onClick={() => onPage(null)}
              className="flex min-h-11 items-center gap-0.5 justify-self-start rounded-md pl-1 pr-3 text-base text-primary active:opacity-60"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              Settings
            </button>
            {/* The dialog keeps its "Settings" name on every page. */}
            <DialogTitle className="sr-only">Settings</DialogTitle>
            <h2 className="text-base font-semibold">{labelOf(current)}</h2>
          </header>
          {/* key remounts the page so each drill-in slides in from the right. */}
          <div
            key={current.id}
            role="region"
            aria-label={labelOf(current)}
            className="min-h-0 flex-1 animate-in slide-in-from-right-8 fade-in-0 overflow-y-auto overscroll-contain px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5 duration-(--duration-push) ease-(--ease-standard) motion-reduce:animate-none"
          >
            <current.Component close={onClose} />
            {current.id === "about" && diagnostics && (
              <ul className="mt-6 overflow-hidden rounded-xl border bg-card">
                <li>
                  <button
                    type="button"
                    onClick={() => onPage("diagnostics")}
                    className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-foreground/5"
                  >
                    <diagnostics.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 text-base">Troubleshooting</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <header className="flex shrink-0 justify-end px-2 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-md px-3 text-base font-semibold text-primary active:opacity-60"
            >
              Done
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <DialogTitle className="pb-4 pt-1 text-3xl font-bold tracking-tight">Settings</DialogTitle>
            <div className="space-y-6">
              {groups.map((group) => (
                <ul key={group[0].id} className="overflow-hidden rounded-xl border bg-card">
                  {group.map((section) => {
                    const Icon = section.icon;
                    const hint = hints[section.id];
                    if (section.id === "account") {
                      return (
                        <li key={section.id}>
                          <button
                            type="button"
                            onClick={() => onPage(section.id)}
                            aria-label={identity ? `Account, ${identity}` : "Account"}
                            className="flex min-h-[68px] w-full items-center gap-3 px-4 text-left active:bg-foreground/5"
                          >
                            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold uppercase">
                              {identity?.[0] ?? "?"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-base">{identity ?? section.label}</span>
                              {syncStatus && <span className="block truncate text-sm text-muted-foreground">{syncStatus}</span>}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={section.id} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => onPage(section.id)}
                          aria-labelledby={`settings-row-${section.id}`}
                          aria-describedby={hint ? `settings-hint-${section.id}` : undefined}
                          className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-foreground/5"
                        >
                          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span id={`settings-row-${section.id}`} className="flex-1 text-base">{labelOf(section)}</span>
                          {hint && <span id={`settings-hint-${section.id}`} className="min-w-0 max-w-[45%] truncate text-sm text-muted-foreground">{hint}</span>}
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
