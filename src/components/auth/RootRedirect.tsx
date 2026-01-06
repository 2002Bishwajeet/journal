import { useFolders } from "@/hooks/useFolders";
import { SplashScreen } from "@/components/layout";

/**
 * RootRedirect - Renders at the root path "/"
 * 
 * On all devices (mobile, tablet, desktop), the layout shows the folder
 * sidebar when no folder is selected. This component just shows a loading
 * state while folders are being fetched. No auto-redirect is performed,
 * allowing users to select their preferred folder.
 */
export function RootRedirect() {
  const {
    get: { isLoading },
  } = useFolders();

  // Show loading while folders are being fetched
  // Once loaded, the layout will display the folder sidebar
  if (isLoading) {
    return <SplashScreen />;
  }

  // Return null - layout handles showing the folder sidebar
  return null;
}
