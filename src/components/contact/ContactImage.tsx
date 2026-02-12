import { useState } from "react";
import {
  CONTACT_PROFILE_IMAGE_KEY,
  ContactConfig,
} from "@homebase-id/js-lib/network";
import { ApiType, DotYouClient } from "@homebase-id/js-lib/core";
import { useContact } from "@/hooks/useContact";
import { FallbackImg } from "../ui/FallbackImg/FallbackImg";
import { Image } from "../ui/image";
import { Loader } from "lucide-react";
export const ContactImage = ({
  odinId,
  canSave,
  className,
}: {
  odinId: string | undefined | null;
  canSave: boolean;
  className?: string;
}) => {
  const [fullError, setFullError] = useState(false);

  const { data: contactData, isLoading } = useContact({
    odinId: odinId || undefined,
    canSave: canSave,
  }).fetch;

  const contactContent = contactData?.fileMetadata.appData.content;
  const nameData = contactData?.fileMetadata.appData.content.name;

  if (!odinId) return null;

  return (
    <div className={`relative aspect-square ${className || ""}`}>
      {fullError ? (
        <FallbackImg nameData={nameData} odinId={odinId} />
      ) : isLoading ? (
        <Loader className={`aspect-square`} />
      ) : contactData?.fileMetadata?.payloads?.some(
          (pyld) => pyld.key === CONTACT_PROFILE_IMAGE_KEY,
        ) ? (
        <Image
          fileId={contactData?.fileId}
          fileKey={CONTACT_PROFILE_IMAGE_KEY}
          targetDrive={ContactConfig.ContactTargetDrive}
          lastModified={contactData?.fileMetadata.updated}
          previewThumbnail={contactData?.fileMetadata.appData.previewThumbnail}
          fit="cover"
          className="h-full w-full"
        />
      ) : contactContent?.imageUrl ? (
        <img
          src={contactContent?.imageUrl}
          crossOrigin="anonymous"
          className="h-full w-full"
          onError={() => setFullError(true)}
        />
      ) : (
        <img
          src={`${new DotYouClient({ hostIdentity: odinId, api: ApiType.Guest }).getRoot()}/pub/image`}
          crossOrigin="anonymous"
          className="h-full w-full"
          onError={() => setFullError(true)}
        />
      )}
    </div>
  );
};
