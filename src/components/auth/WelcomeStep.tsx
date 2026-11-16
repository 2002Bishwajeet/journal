import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WelcomeTrial } from "@/components/license/License";

/** Homebase's sign-up page (closed beta). The native app opens it in the in-app browser (#1188). */
export const HOMEBASE_SIGN_UP_URL = "https://homebase.id";

/** The sign-in form's Continue button, so the step reads as the same page (#1303). */
const pressable =
  "w-full h-11 text-sm font-medium rounded-lg shadow-sm hover:shadow transition-all duration-200 cursor-pointer";

/**
 * The sign-in page's first screen on a device no identity signed in on (#1282): what the app
 * is, why it needs a Homebase identity, the trial in a store build, and the two ways on.
 */
export function WelcomeStep({
  appName,
  logo,
  onHaveIdentity,
}: {
  appName: string;
  /** The phone-only logo the sign-in form's header starts with. */
  logo: ReactNode;
  onHaveIdentity: () => void;
}) {
  return (
    <>
      <div className="text-center space-y-4">
        {logo}
        <h2 className="text-2xl font-medium tracking-tight text-foreground">
          Welcome to {appName}
        </h2>
        <p className="text-muted-foreground text-sm">
          A notebook that works offline and syncs across your devices.
        </p>
        <p className="text-muted-foreground text-sm">
          Your notes live on your own Homebase, encrypted in transit.
        </p>
        <WelcomeTrial />
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <Button asChild className={pressable}>
            <a
              href={HOMEBASE_SIGN_UP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby="closed-beta"
            >
              Create your Homebase identity
            </a>
          </Button>
          <p id="closed-beta" className="text-center text-xs text-muted-foreground">
            Homebase sign-up is in closed beta
          </p>
        </div>
        <Button variant="outline" className={pressable} onClick={onHaveIdentity}>
          I have an identity
        </Button>
      </div>
    </>
  );
}
