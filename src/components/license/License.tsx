import { lazy, Suspense, type ReactNode } from "react";
import { licenseEnabled } from "@/lib/billing";
import { FEATURE_RELEASES } from "@/lib/featureReleases";

// The native app's license screens (#301) live in the private native/ module (`@premium`),
// loaded only when licenseEnabled(): never on the web, nor in a build without a billing Worker.
const Gate = lazy(() => import("@premium").then((m) => ({ default: m.LicenseGate })));
const Chip = lazy(() => import("@premium").then((m) => ({ default: m.TrialChip })));
const Section = lazy(() => import("@premium").then((m) => ({ default: m.LicenseSection })));
const Renew = lazy(() => import("@premium").then((m) => ({ default: m.RenewForUpdate })));

/** Over the signed-in app: the paywall, the Enter license key screen and the updates notice. */
export function LicenseGate({ onSignOut }: { onSignOut: () => void }) {
  if (!licenseEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <Gate onSignOut={onSignOut} />
    </Suspense>
  );
}

/** The sidebar footer's trial countdown. */
export function TrialChip() {
  if (!licenseEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <Chip />
    </Suspense>
  );
}

/** Settings → License (listed only when licenseEnabled(), see sections.ts). */
export function LicenseSection({ close }: { close: () => void }) {
  return (
    <Suspense fallback={null}>
      <Section close={close} />
    </Suspense>
  );
}

/**
 * A feature listed in src/lib/featureReleases.ts. In the native app, a license whose year of
 * updates ended before the feature shipped sees "Renew to get this update" instead.
 */
export function RenewForUpdate({ feature, children }: { feature: string; children: ReactNode }) {
  if (!licenseEnabled() || !FEATURE_RELEASES[feature]) return children;
  return (
    <Suspense fallback={null}>
      <Renew feature={feature}>{children}</Renew>
    </Suspense>
  );
}
