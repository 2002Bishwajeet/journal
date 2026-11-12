import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { routeOpenedNotifications } from '@/lib/native/macNotifications';

/** macOS app: opens the screen of a notification the user clicks or opens with "Open" (#1123). */
export function useOpenedNotifications(): void {
    const navigate = useNavigate();
    useEffect(() => routeOpenedNotifications(navigate), [navigate]);
}
