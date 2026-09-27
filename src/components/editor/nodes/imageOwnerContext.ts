import { createContext } from "react";

/**
 * Identity that owns the open note. Image payloads live on the owner's drive, so
 * a note shared with you must fetch its images over peer from that identity.
 */
export const ImageOwnerContext = createContext<string | undefined>(undefined);
