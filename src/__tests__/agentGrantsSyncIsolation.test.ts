/**
 * The agent-grants file (fileType 607) must never be pulled into note/folder/invite
 * sync — it isn't a note. Locks in InboxProcessor's fileType filter (#165).
 */
import { describe, it, expect, vi } from 'vitest';
import { fakeDotYouClient } from './fakes';
import {
    AGENT_GRANTS_FILE_TYPE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
    COLLABORATION_INVITE_FILE_TYPE,
} from '@/lib/homebase/config';

vi.mock('@homebase-id/js-lib/peer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/peer')>();
    return {
        ...actual,
        processInbox: vi.fn().mockResolvedValue({ totalItems: 0, poppedCount: 0, oldestItemTimestamp: 0 }),
    };
});

import { InboxProcessor } from '@/lib/homebase/InboxProcessor';

describe('InboxProcessor.processChanges — agent grants sync isolation', () => {
    it('never queries fileType 607 (agent grants)', async () => {
        const findChangesSince = vi
            .spyOn(InboxProcessor.prototype, 'findChangesSince')
            .mockResolvedValue([]);

        const processor = new InboxProcessor(fakeDotYouClient());
        await processor.processChanges();

        const queriedFileTypes = findChangesSince.mock.calls[0][0];
        expect(queriedFileTypes).not.toContain(AGENT_GRANTS_FILE_TYPE);

        findChangesSince.mockRestore();
    });

    it('fileType 607 is distinct from the existing note/folder/invite fileTypes', () => {
        expect(JOURNAL_FILE_TYPE).not.toBe(AGENT_GRANTS_FILE_TYPE);
        expect(FOLDER_FILE_TYPE).not.toBe(AGENT_GRANTS_FILE_TYPE);
        expect(COLLABORATION_INVITE_FILE_TYPE).not.toBe(AGENT_GRANTS_FILE_TYPE);
    });
});
