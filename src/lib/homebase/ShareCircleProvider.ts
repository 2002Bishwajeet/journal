import type { DotYouClient } from '@homebase-id/js-lib/core';
import { stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { JOURNAL_APP_ID, JOURNAL_DRIVE } from './config';

/** The circle Journal owns for the people its notes are shared with: Read, Write, React, Comment. */
export const SHARE_CIRCLE_SLUG = 'journal-shares';
/** Its Read-only stand-in while the Journal drive belongs to another app (installed before odin-core #1901). */
export const READ_CIRCLE_SLUG = 'journal-read';

// DrivePermission flags: Read 1, Write 2, React 4, Comment 8
const ALL_PERMISSIONS = 15;
const READ_PERMISSION = 1;

export interface ShareCircle {
    circleId: string;
    /** False while the circle can only grant Read (the drive isn't Journal's). */
    canEdit: boolean;
}

export type EnrollStatus = 'added' | 'contactNotReviewed' | 'notAConnectedIdentity' | 'failed';

export interface EnrollResult {
    odinId: string;
    status: EnrollStatus;
}

interface CircleWithMembers {
    circle: { id: string; slug?: string; appId?: string | null };
    members?: string[];
    pendingMembers?: { odinId: string }[];
}

interface ProblemLike {
    response?: { status?: number; data?: { title?: string; errorCode?: string } };
}

const problem = (err: unknown) => (err as ProblemLike | null | undefined)?.response;

const membersOf = (entry: CircleWithMembers | undefined): string[] => [
    ...new Set([...(entry?.members ?? []), ...(entry?.pendingMembers ?? []).map((p) => p.odinId)]),
];

/**
 * Journal's own circle on the owner's identity (#730): its members get drive access to the
 * Journal drive, so recipients of a shared note need no step in the owner console. Uses the
 * V2 connections API, which takes the app token as a Bearer header.
 */
export class ShareCircleProvider {
    readonly #client: DotYouClient;
    #circle: Promise<ShareCircle> | undefined;

    constructor(dotYouClient: DotYouClient) {
        this.#client = dotYouClient;
    }

    #http() {
        return this.#client.createAxiosClient({
            headers: { Authorization: `Bearer ${this.#client.getHeaders().bx0900 ?? ''}` },
        });
    }

    #url(path: string) {
        return `${this.#client.getRoot()}/api/v2/connections/circles/${path}`;
    }

    async #create(slug: string, permission: number): Promise<string> {
        const { data } = await this.#http().post<string>(this.#url('create'), {
            name: slug === SHARE_CIRCLE_SLUG ? 'Journal shares' : 'Journal shares (read only)',
            slug,
            description: 'People you share Journal notes with',
            driveGrants: [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission } }],
            permissions: { keys: [] },
        });
        return data;
    }

    async #circles(): Promise<CircleWithMembers[]> {
        const { data } = await this.#http().get<CircleWithMembers[]>(this.#url('with-members'));
        return data ?? [];
    }

    async #add(circleId: string, odinIds: string[]): Promise<EnrollResult[]> {
        const results: EnrollResult[] = [];
        for (const odinId of odinIds) {
            try {
                await this.#http().post(this.#url('add'), { circleId, odinId });
                results.push({ odinId, status: 'added' });
            } catch (err) {
                const code = problem(err)?.data?.errorCode;
                if (code === 'contactNotReviewed' || code === 'notAConnectedIdentity') {
                    results.push({ odinId, status: code });
                } else {
                    console.error(`[ShareCircle] Could not add ${odinId}:`, err);
                    results.push({ odinId, status: 'failed' });
                }
            }
        }
        return results;
    }

    /** Moves everyone from the Read-only circle into the full one, then deletes it. */
    async #adoptReadCircle(circleId: string): Promise<void> {
        const readCircle = (await this.#circles()).find(
            (c) => c.circle.slug === READ_CIRCLE_SLUG && stringGuidsEqual(c.circle.appId ?? '', JOURNAL_APP_ID),
        );
        if (!readCircle) return;
        const results = await this.#add(circleId, membersOf(readCircle));
        // Keep it while anyone is left in it, so they don't lose Read; the next share retries
        if (results.some((r) => r.status !== 'added')) return;
        // The body is the bare id; the client's encryption serializes it as JSON
        await this.#http().post(this.#url('delete?removeMembers=true'), readCircle.circle.id);
    }

    async #ensure(): Promise<ShareCircle> {
        let circleId: string;
        try {
            circleId = await this.#create(SHARE_CIRCLE_SLUG, ALL_PERMISSIONS);
        } catch (err) {
            const response = problem(err);
            if (response?.status !== 403 || !response.data?.title?.includes('does not own')) throw err;
            return { circleId: await this.#create(READ_CIRCLE_SLUG, READ_PERMISSION), canEdit: false };
        }
        await this.#adoptReadCircle(circleId);
        return { circleId, canEdit: true };
    }

    /** Creates the circle, or finds it by slug; once per provider. */
    ensureShareCircle(): Promise<ShareCircle> {
        this.#circle ??= this.#ensure();
        return this.#circle;
    }

    /** Adds each person on their own, so one refusal doesn't hide the others. */
    async enroll(odinIds: string[]): Promise<EnrollResult[]> {
        const { circleId } = await this.ensureShareCircle();
        return this.#add(circleId, odinIds);
    }

    /** Removes each person; a failure is logged and the rest still go. */
    async unenroll(odinIds: string[]): Promise<void> {
        const { circleId } = await this.ensureShareCircle();
        for (const odinId of odinIds) {
            try {
                await this.#http().post(this.#url('revoke'), { circleId, odinId });
            } catch (err) {
                console.error(`[ShareCircle] Could not remove ${odinId}:`, err);
            }
        }
    }
}
