/** What a shared folder's link card is drawn from (#644): a redraw is due when either changes. */
export interface FolderCardFrom {
    name: string;
    /** Public notes in the folder. */
    count: number;
}

/** The card a shared folder publishes in its plaintext header content. */
export interface FolderCard {
    cardImageKey: string;
    from: FolderCardFrom;
}

export function sameFolderCardFrom(a: FolderCardFrom | undefined, b: FolderCardFrom): boolean {
    return a?.name === b.name && a.count === b.count;
}

/** The card's second line. */
export const folderCardExcerpt = (count: number) => `${count} ${count === 1 ? 'note' : 'notes'}`;
