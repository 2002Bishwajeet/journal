import type { ComponentType } from "react";
import { Monitor, Sparkles, Database, Info, type LucideIcon } from "lucide-react";
import AppearanceSection from "./sections/AppearanceSection";
import AISection from "./sections/AISection";
import DataSection from "./sections/DataSection";
import AboutSection from "./sections/AboutSection";

export type SettingsSectionId = "appearance" | "ai" | "data" | "about";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  Component: ComponentType;
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
  // #168 Agent access goes here: { id: "agent-access", label: "Agent access", ... }
  {
    id: "data",
    label: "Data & storage",
    description: "Where your data lives, import, and export",
    icon: Database,
    Component: DataSection,
  },
  {
    id: "about",
    label: "About",
    description: "Version, privacy, and keyboard shortcuts",
    icon: Info,
    Component: AboutSection,
  },
];
