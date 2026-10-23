/**
 * The first odin-core release whose file ACLs admit named identities (odin-core PR
 * #1993, merged after v0.1.965). Its servers report the release tag at /api/v1/version.
 */
const FIRST_NAMED_IDENTITY_RELEASE = [0, 1, 966];

/**
 * Whether a server of this version honours a file's `odinIdList`. An older one stores the
 * list but then refuses every reader, and the owner can't tell (decision 8 on #678). A
 * version that isn't a release number is taken to be new enough: a branch build
 * reports "-.-.-", and the bleeding-edge demo servers report "0.0.0".
 */
export function supportsNamedIdentities(version: string): boolean {
    const match = /^"?v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
    if (!match) return true;
    const parts = match.slice(1).map(Number);
    if (parts.every((part) => part === 0)) return true;
    const differs = parts.findIndex((part, i) => part !== FIRST_NAMED_IDENTITY_RELEASE[i]);
    return differs === -1 || parts[differs] > FIRST_NAMED_IDENTITY_RELEASE[differs];
}

/** The odin-core version an identity's server reports (anonymous; no SDK helper reads it). */
export async function fetchServerVersion(identityRoot: string): Promise<string> {
    const response = await fetch(`${identityRoot}/api/v1/version`);
    if (!response.ok) throw new Error(`Version request failed: ${response.status}`);
    return response.text();
}
