import { createContext } from "react";

/**
 * Author of the open note when it was shared with you (undefined for your own
 * notes). Its image payloads live on that drive, so they're fetched over peer.
 */
export const ImageOwnerContext = createContext<string | undefined>(undefined);
