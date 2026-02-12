// Re-use potentially, but we need specific bucket logic or imports if needed

export function getNoteGroup(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();

    // Normalize dates to midnight for comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const noteDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (noteDate.getTime() === today.getTime()) {
        return 'Today';
    }

    if (noteDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    }

    // Last 7 days (formatted as Day Name, e.g., "Monday")
    const diffTime = today.getTime() - noteDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 7 && diffDays > 1) {
        return date.toLocaleDateString('en-US', { weekday: 'long' });
    }

    // Last Week (8-14 days ago) or maybe just group by "Last Week"
    // Requirement: "7 days to 1 week to 2 week then to last month then to which month"

    if (diffDays <= 14) {
        return 'Last Week';
    }

    if (diffDays <= 21) {
        return '2 Weeks Ago';
    }

    // Last Month (approx 30 days) - let's stick to Month Year logic for older stuff 
    // or specifically "Last Month" bucket if it was truly last month.

    // Simple logic: Group by Month Year
    const currentYear = now.getFullYear();
    const noteYear = date.getFullYear();

    if (currentYear === noteYear) {
        return date.toLocaleDateString('en-US', { month: 'long' });
    }

    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
