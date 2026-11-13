import { Navigate } from "react-router-dom";
import { VoiceCapture } from "@/components/voice/VoiceNotes";
import { useThemePreference } from "@/hooks/useThemePreference";
import { isNativeApp } from "@/lib/native";

/** Records a voice note (#1250). Native only: the web goes home. */
export default function VoicePage() {
  // Outside JournalLayout, which applies the theme everywhere else.
  useThemePreference();
  if (!isNativeApp()) return <Navigate to="/" replace />;
  return <VoiceCapture />;
}
