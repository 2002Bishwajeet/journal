import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { licenseEnabled } from "@/lib/billing";
import { FEATURE_RELEASES } from "@/lib/featureReleases";
import { isNativeApp } from "@/lib/native";
import { setCanEdit } from "@/hooks/useCanEdit";

// The native app's license screens (#301) live in the private native/ module (`@premium`),
// loaded only when licenseEnabled(): never on the web, nor in a build without a billing Worker.
const Gate = lazy(() => import("@premium").then((m) => ({ default: m.LicenseGate })));
const Chip = lazy(() => import("@premium").then((m) => ({ default: m.TrialChip })));
const Section = lazy(() => import("@premium").then((m) => ({ default: m.LicenseSection })));
const Renew = lazy(() => import("@premium").then((m) => ({ default: m.RenewForUpdate })));
// Copies useEntitlement().canEdit into useCanEdit()'s store (#1176).
const Reporter = lazy(() =>
  import("@premium").then((m) => ({
    default: function Reporter() {
      const { status, canEdit } = m.useEntitlement();
      const answer = status === undefined ? undefined : canEdit;
      useEffect(() => setCanEdit(answer), [answer]);
      return null;
    },
  })),
);

/**
 * Gives useCanEdit() its answer. Only the native app loads `@premium`'s entitlement; the web,
 * and the native app until the entitlement loads, can edit.
 */
export function CanEditReporter() {
  if (!isNativeApp()) return null;
  return (
    <Suspense fallback={null}>
      <Reporter />
    </Suspense>
  );
}

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
