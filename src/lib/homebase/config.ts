import type { TargetDrive } from "@homebase-id/js-lib/core";

// Homebase configuration constants
export const JOURNAL_APP_ID = import.meta.env.PROD ? 'c762ee784274473480919d8080d7a825' : '38e160f1f815438a89eabc3a261e9952 '
export const JOURNAL_APP_NAME = `Journal${import.meta.env.PROD ? '' : ' (Local Dev)'}`;

// Drive constants per spec
export const JOURNAL_FILE_TYPE = 605;
export const JOURNAL_DATA_TYPE = 706;

export const FOLDER_FILE_TYPE = 606;
export const FOLDER_DATA_TYPE = 707;

export const JOURNAL_DRIVE: TargetDrive = {
    alias: 'd5f411fa83fd4854a3bd7e974cc9bca9',
    type: '30743710039d4b97bbd352f343d1c9df',
};

export const MAIN_FOLDER_ID = '06cf9262-4eae-4276-b0d1-8ca3cf5be6f4';
export const COLLABORATIVE_FOLDER_ID = 'fc360190-4e23-b870-0ea4-ef233aad98ad'; // For shared/collaborative notes V2

// Payload keys
export const PAYLOAD_KEY_CONTENT = 'jrnl_txt'; // Yjs binary blob
export const PAYLOAD_KEY_IMAGE_PREFIX = 'jrnl_img';
export const PAYLOAD_KEY_LINK_PREVIEW_PREFIX = 'jrnl_lnk';

// Storage keys
export const STORAGE_KEY_IDENTITY = 'IDENTITY';
export const STORAGE_KEY_AUTH_TOKEN = 'BX0900';
export const STORAGE_KEY_SHARED_SECRET = 'APSS';
export const STORAGE_KEY_LAST_SYNC = 'LAST_SYNC';

