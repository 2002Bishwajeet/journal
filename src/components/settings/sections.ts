import type { ComponentType } from "react";
import { Monitor, Sparkles, Bot, Database, Keyboard, Info, type LucideIcon } from "lucide-react";
import AppearanceSection from "./sections/AppearanceSection";
import AISection from "./sections/AISection";
import AgentAccessSection from "./sections/AgentAccessSection";
import DataSection from "./sections/DataSection";
import ShortcutsSection from "./sections/ShortcutsSection";
import AboutSection from "./sections/AboutSection";

export type SettingsSectionId = "appearance" | "ai" | "agent-access" | "data" | "shortcuts" | "about";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  Component: ComponentType;
  /** Hidden on phones (e.g. keyboard shortcuts — phones have no keyboard). */
  desktopOnly?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
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
    id: "data",
    label: "Data & storage",
    description: "Where your data lives, import, and export",
    icon: Database,
    Component: DataSection,
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
];
