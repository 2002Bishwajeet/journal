import { createContext } from 'react';

/** The owner's saved state of a shared note's html and react blocks (#410), as JSON text per block id. */
export const LiveBlockStatesContext = createContext<Record<string, string>>({});
