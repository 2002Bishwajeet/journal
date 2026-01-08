import { createContext } from 'react';

export interface OnlineContextType {
    isOnline: boolean;
}

export const OnlineContext = createContext<OnlineContextType>({
    isOnline: true,
});
