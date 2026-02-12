import {
    getRegistrationParams,
    finalizeAuthentication,
    createEccPair,
    saveEccKey,
    retrieveEccKey,
    throwAwayTheECCKey,
    saveIdentity,
    type YouAuthorizationParams,
    type TargetDriveAccessRequest,
} from '@homebase-id/js-lib/auth';
import { DrivePermissionType } from '@homebase-id/js-lib/core';
import {
    JOURNAL_APP_ID,
    JOURNAL_APP_NAME,
    JOURNAL_DRIVE,
    STORAGE_KEY_AUTH_TOKEN,
    STORAGE_KEY_SHARED_SECRET,
} from '@/lib/homebase/config';

// Drive request for Journal app
export const journalDriveRequest: TargetDriveAccessRequest = {
    ...JOURNAL_DRIVE,
    name: 'Journal Notes',
    description: 'Store your personal notes and thoughts',
    permissions: [
        DrivePermissionType.Read,
        DrivePermissionType.Write,
        DrivePermissionType.React,
        DrivePermissionType.Comment,
    ],
    allowAnonymousRead: true,
    allowSubscriptions: false,
};

/**
 * Extract domain from a URL or identity string.
 */
function getDomainFromUrl(url: string): string {
    let domain = url.replace(/^https?:\/\//, '');
    domain = domain.split('/')[0];
    return domain.toLowerCase().trim();
}

/**
 * Hook for YouAuth authorization flow.
 * Handles both initiating the OAuth flow and finalizing after callback.
 */
export function useYouAuthAuthorization() {
    /**
     * Generate authorization parameters for initiating OAuth flow.
     * Creates ECC key pair, persists private key, and returns params for auth URL.
     */
    const getAuthorizationParameters = async (
        returnUrl: string
    ): Promise<YouAuthorizationParams> => {
        const eccKey = await createEccPair();

        // Persist key for usage on finalize
        await saveEccKey(eccKey);

        const finalizeUrl = `${window.location.origin}/auth/finalize`;
        return getRegistrationParams(
            finalizeUrl,
            JOURNAL_APP_NAME,
            JOURNAL_APP_ID,
            undefined, // permissionKeys
            undefined, // circlePermissionKeys
            [journalDriveRequest],
            [journalDriveRequest], // circleDrives
            undefined, // circles
            eccKey.publicKey,
            window.location.host,
            `${JOURNAL_APP_NAME} PWA`, // clientFriendlyName
            returnUrl
        );
    };

    /**
     * Build the full auth URL with identity.
     */
    const getAuthUrl = (identity: string, params: YouAuthorizationParams): string => {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value) searchParams.set(key, String(value));
        }
        return `https://${identity}/api/owner/v1/youauth/authorize?${searchParams.toString()}`;
    };

    /**
     * Check if the given identity is a valid Homebase identity.
     */
    const checkIdentity = async (odinId: string): Promise<boolean> => {
        if (!odinId) return false;

        const strippedIdentity = getDomainFromUrl(odinId);

        const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]{2,25}(?::\d{1,5})?$/i;
        const isValid = domainRegex.test(strippedIdentity || '');
        if (!isValid) return false;

        try {
            const url = `https://${strippedIdentity}/api/guest/v1/auth/ident`;
            const response = await fetch(url);
            if (!response.ok) return false;

            const validation = await response.json();
            return validation?.odinId?.toLowerCase() === strippedIdentity;
        } catch (error) {
            console.debug('[checkIdentity] Error checking identity:', error);
            return false;
        }
    };

    /**
     * Complete the authorization flow after OAuth callback.
     * Performs key exchange, saves tokens, and cleans up.
     */
    const finalizeAuthorization = async (
        identity: string,
        publicKey: string,
        salt: string
    ): Promise<boolean> => {
        try {
            const privateKey = await retrieveEccKey();
            if (!privateKey) throw new Error('Failed to retrieve ECC key');

            const { clientAuthToken, sharedSecret } = await finalizeAuthentication(
                identity,
                privateKey,
                publicKey,
                salt
            );

            if (identity) saveIdentity(identity);
            localStorage.setItem(STORAGE_KEY_SHARED_SECRET, sharedSecret);
            localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, clientAuthToken);

            throwAwayTheECCKey();
            return true;
        } catch (error) {
            console.error('Auth finalization failed:', error);
            return false;
        }
    };

    return { getAuthorizationParameters, getAuthUrl, checkIdentity, finalizeAuthorization };
}

export default useYouAuthAuthorization;

