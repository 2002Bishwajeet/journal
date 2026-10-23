/** A typed Homebase identity as a share stores it: no scheme or path, lowercased (#681). */
export function normalizeOdinId(input: string): string {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
}

/** A domain name, which is what a Homebase identity is. The server validates it again. */
export function isOdinId(odinId: string): boolean {
    return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(odinId);
}

/** Who gets the invite: the circles' members and the named identities, once each, never the owner. */
export function shareRecipients(circleMembers: string[], odinIds: string[], owner: string): string[] {
    return [...new Set([...circleMembers, ...odinIds])].filter((id) => !!id && id !== owner);
}
