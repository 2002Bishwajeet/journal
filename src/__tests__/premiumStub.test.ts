import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { hasPremium, voiceNotes } from '@premium';
import {
  useEntitlement,
  voiceNotes as stubVoiceNotes,
  VoiceCapture,
  VoiceDraftOffer,
  VoiceNotesSection,
  VoiceReviewBar,
} from '@/lib/premiumStub';

describe('@premium', () => {
  it('is the stub unless the native/ submodule is checked out', () => {
    expect(hasPremium).toBe(existsSync('native/web/index.ts'));
  });

  it('has voice notes only with the native/ submodule', () => {
    expect(stubVoiceNotes).toBeNull();
    expect(voiceNotes === null).toBe(!existsSync('native/web/index.ts'));
  });

  it('draws no voice-note screens without the submodule', () => {
    expect(VoiceCapture()).toBeNull();
    expect(VoiceReviewBar({ noteId: 'n' })).toBeNull();
    expect(VoiceDraftOffer()).toBeNull();
    expect(VoiceNotesSection()).toBeNull();
  });
});

describe('premiumStub useEntitlement', () => {
  it('is always unlocked and can edit', async () => {
    const entitlement = useEntitlement();
    expect(entitlement).toMatchObject({ status: 'unlocked', canEdit: true });
    expect(entitlement.unlockedBy).toBeUndefined();
    await expect(entitlement.refresh()).resolves.toBeUndefined();
  });
});
