import type { ComponentType } from "react";
import { UserRound, Monitor, Sparkles, Bot, Bell, Shield, Database, Keyboard, KeyRound, Info, Activity, type LucideIcon } from "lucide-react";
import AccountSection from "./sections/AccountSection";
import AppearanceSection from "./sections/AppearanceSection";
import AISection from "./sections/AISection";
import AgentAccessSection from "./sections/AgentAccessSection";
import NotificationsSection from "./sections/NotificationsSection";
import SecuritySection from "./sections/SecuritySection";
import DataSection from "./sections/DataSection";
import ShortcutsSection from "./sections/ShortcutsSection";
import AboutSection from "./sections/AboutSection";
import DiagnosticsSection from "./sections/DiagnosticsSection";
import { LicenseSection } from "@/components/license/License";
import { licenseEnabled } from "@/lib/billing";

export type SettingsSectionId = "account" | "appearance" | "ai" | "agent-access" | "notifications" | "security" | "data" | "license" | "shortcuts" | "about" | "diagnostics";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** `close` shuts the Settings dialog, for a section that navigates away. */
  Component: ComponentType<{ close: () => void }>;
  /** Hidden on phones (e.g. keyboard shortcuts — phones have no keyboard). */
  desktopOnly?: boolean;
  /** Only in the native app (e.g. what widgets and the watch may show). */
  nativeOnly?: boolean;
  /** Listed only when this is false (e.g. License outside the native app). */
  hidden?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "account",
    label: "Account",
    description: "Identity, sync and sign out",
    icon: UserRound,
    Component: AccountSection,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and how your journal looks",
    icon: Monitor,
    Component: AppearanceSection,
  },
  {
    id: "ai",
    label: "AI",
    description: "On-device models, autocomplete, and grammar",
    icon: Sparkles,
    Component: AISection,
  },
  {
    id: "agent-access",
    label: "Agent access",
    description: "Choose what AI agents can read or edit",
    icon: Bot,
    Component: AgentAccessSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Notifications on this device",
    icon: Bell,
    Component: NotificationsSection,
  },
  {
    id: "security",
    label: "Security",
    description: "What shows outside the app",
    icon: Shield,
    Component: SecuritySection,
    nativeOnly: true,
  },
  {
    id: "data",
    label: "Data & storage",
    description: "Where your data lives, import, and export",
    icon: Database,
    Component: DataSection,
  },
  {
    id: "license",
    label: "License",
    description: "Your license key and updates",
    icon: KeyRound,
    Component: LicenseSection,
    hidden: !licenseEnabled(),
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Every shortcut in one place",
    icon: Keyboard,
    Component: ShortcutsSection,
    desktopOnly: true,
  },
  {
    id: "about",
    label: "About",
    description: "Version, privacy, and links",
    icon: Info,
    Component: AboutSection,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "Pending sync items, errors and a report to share",
    icon: Activity,
    Component: DiagnosticsSection,
  },
];
