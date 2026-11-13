import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import SignOutConfirmDialog from "@/components/modals/SignOutConfirmDialog";
import { billingEnabled } from "@/lib/billing";
import { FEATURE_RELEASES } from "@/lib/featureReleases";
import { isNativeApp } from "@/lib/native";
import { setCanEdit } from "@/hooks/useCanEdit";

// The native app's license screens (#301) live in the private native/ module (`@premium`),
// loaded only when billingEnabled(): never on the web, nor in a build that sells nothing.
const Gate = lazy(() => import("@premium").then((m) => ({ default: m.LicenseGate })));
const Chip = lazy(() => import("@premium").then((m) => ({ default: m.TrialChip })));
const Section = lazy(() => import("@premium").then((m) => ({ default: m.LicenseSection })));
const Renew = lazy(() => import("@premium").then((m) => ({ default: m.RenewForUpdate })));
// Copies useEntitlement().canEdit into useCanEdit()'s store (#1176). A failed `@premium`
// load must not take the app down, so it renders nothing and editing stays on.
const Reporter = lazy(() =>
  import("@premium")
    .then((m) => ({
      default: function Reporter() {
        const { status, canEdit, isError = false } = m.useEntitlement();
        const answer = status === undefined ? undefined : canEdit;
        useEffect(() => setCanEdit(answer, isError), [answer, isError]);
        return null;
      },
    }))
    .catch(() => ({
      default: function Reporter() {
        // Fail open with an answer, so waiters (/today, Save a copy) don't wait forever.
        useEffect(() => setCanEdit(true), []);
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

/**
 * Over the signed-in app: the paywall, the Enter license key screen and the updates notice.
 * The paywall's Sign out asks first, as the sidebar's does: sign-out wipes unsynced changes.
 */
export function LicenseGate({ onSignOut, pendingTotal }: { onSignOut: () => void; pendingTotal: number }) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  if (!billingEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <Gate onSignOut={() => setConfirmSignOut(true)} />
      <SignOutConfirmDialog
        isOpen={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        onConfirm={onSignOut}
        pendingTotal={pendingTotal}
      />
    </Suspense>
  );
}

/** The sidebar footer's trial countdown. */
export function TrialChip() {
  if (!billingEnabled()) return null;
  return (
    <Suspense fallback={null}>
      <Chip />
    </Suspense>
  );
}

/** Settings → Purchase (listed only when billingEnabled(), see sections.ts). */
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
  if (!billingEnabled() || !FEATURE_RELEASES[feature]) return children;
  return (
    <Suspense fallback={null}>
      <Renew feature={feature}>{children}</Renew>
    </Suspense>
  );
}
