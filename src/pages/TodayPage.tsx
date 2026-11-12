import { useTodayRedirect } from '@/hooks/useTodayRedirect';

/** `/today`: opens today's note (the daily reminder's link). */
export default function TodayPage() {
    useTodayRedirect();
    return null;
}
