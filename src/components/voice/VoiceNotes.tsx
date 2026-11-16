import { lazy, Suspense } from "react";
import { isNativeApp } from "@/lib/native";

// Voice notes (#1250) live in the private native/ module (`@premium`), loaded only in the native
// app: the web has no capture screen, no microphone prompt and none of this code.
const Capture = lazy(() => import("@premium").then((m) => ({ default: m.VoiceCapture })));
const ReviewBar = lazy(() => import("@premium").then((m) => ({ default: m.VoiceReviewBar })));
const DraftOffer = lazy(() => import("@premium").then((m) => ({ default: m.VoiceDraftOffer })));
const Section = lazy(() => import("@premium").then((m) => ({ default: m.VoiceNotesSection })));

/** The /voice capture screen. */
export function VoiceCapture() {
  if (!isNativeApp()) return null;
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <Capture />
    </Suspense>
  );
}

/** Keep / Re-format / Use transcript on a voice note this device recorded. */
export function VoiceReviewBar({ noteId }: { noteId: string }) {
  if (!isNativeApp()) return null;
  return (
    <Suspense fallback={null}>
      <ReviewBar noteId={noteId} />
    </Suspense>
  );
}

/** "Finish your voice note" when a recording was cut off (the app was killed). */
export function VoiceDraftOffer() {
  if (!isNativeApp()) return null;
  return (
    <Suspense fallback={null}>
      <DraftOffer />
    </Suspense>
  );
}

/** Settings → Voice notes (listed only in the native app, see sections.ts). */
export function VoiceNotesSection() {
  return (
    <Suspense fallback={null}>
      <Section />
    </Suspense>
  );
}
