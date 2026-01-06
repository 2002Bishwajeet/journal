import { createContext, useContext } from "react";
import { DotYouClient, ApiType } from "@homebase-id/js-lib/core";

export const DotYouClientContext = createContext<DotYouClient | null>(null);
export function useDotYouClientContext(): DotYouClient {
  const dotYouClient = useContext(DotYouClientContext);
  return (
    dotYouClient ||
    new DotYouClient({
      api: ApiType.Guest,
      hostIdentity: "",
    })
  );
}
