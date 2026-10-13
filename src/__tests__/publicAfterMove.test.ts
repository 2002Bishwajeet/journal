/**
 * #622: whether a note is public after it moves between folders. Into a shared folder
 * it becomes public, out of one into a private folder it becomes private, and between
 * two shared or two private folders it keeps its state.
 */
import { describe, it, expect } from 'vitest';
import { publicAfterMove } from '@/lib/share/sharedFolder';

const shared = { isPublic: true };
const priv = { isPublic: false };

describe('publicAfterMove', () => {
    it('should make a private note public when it moves into a shared folder', () => {
        expect(publicAfterMove(priv, shared, false)).toBe(true);
        expect(publicAfterMove(priv, shared, undefined)).toBe(true);
    });

    it('should make a public note private when it moves out of a shared folder into a private one', () => {
        expect(publicAfterMove(shared, priv, true)).toBe(false);
    });

    it('should keep a note that was individually public public across private folders', () => {
        expect(publicAfterMove(priv, priv, true)).toBe(true);
    });

    it('should keep a private note private across private folders', () => {
        expect(publicAfterMove(priv, priv, false)).toBe(false);
        expect(publicAfterMove(priv, priv, undefined)).toBe(false);
    });

    it('should leave a note unchanged between two shared folders', () => {
        expect(publicAfterMove(shared, shared, true)).toBe(true);
        expect(publicAfterMove(shared, shared, false)).toBe(false);
    });

    it('should treat a folder without the flag, or an unknown one, as private', () => {
        expect(publicAfterMove({}, shared, false)).toBe(true);
        expect(publicAfterMove(null, shared, false)).toBe(true);
        expect(publicAfterMove(shared, undefined, true)).toBe(false);
    });
});
