import { useState } from 'react';
import { GetTargetDriveFromProfileId, BuiltInProfiles } from '@homebase-id/js-lib/profile';
import {Image} from "../ui/image";
import { ApiType, DotYouClient } from '@homebase-id/js-lib/core';
import { FallbackImg } from '../ui/FallbackImg/FallbackImg';
import { useSiteData } from '@/hooks/siteData/useSiteData';
import { ContactImage } from '../contact/ContactImage';
import { useIsConnected } from '@/hooks/connections/useIsConnected';
import { useDotYouClientContext } from '@/components/auth';


interface ImageProps {
  className?: string;
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'custom';
}

interface ConnectionImageProps extends ImageProps {
  odinId?: string;
  excludeLink?: boolean;
}

const getSizeClassname = (size: ImageProps['size']) => {
  switch (size) {
    case 'xxs':
      return 'h-[1.5rem] w-[1.5rem]';
    case 'xs':
      return 'h-[2rem] w-[2rem]';
    case 'sm':
      return 'h-[3rem] w-[3rem]';
    case 'md':
      return 'h-[5rem] w-[5rem]';
    default:
      return '';
  }
};

export const AuthorImage = ({ odinId, ...props }: ConnectionImageProps) => {
  // The app runs on its own domain, so `window.location.hostname` is never the signed-in identity
  const ownIdentity = useDotYouClientContext().getHostIdentity();
  if (!odinId || odinId === window.location.hostname) return <OwnerImage {...props} />;
  if (odinId === ownIdentity) return <OwnPublicImage odinId={odinId} {...props} />;

  if (props.excludeLink) {
    return <ConnectionImage odinId={odinId} {...props} />;
  }

  const host = new DotYouClient({ hostIdentity: odinId, api: ApiType.Guest }).getRoot();
  return (
    <a href={host}>
      <ConnectionImage odinId={odinId} {...props} />
    </a>
  );
};

export const OwnerImage = ({ className, size }: ImageProps) => {
  const { owner } = useSiteData().data ?? {};
  const targetDrive = GetTargetDriveFromProfileId(BuiltInProfiles.StandardProfileId);

  return owner?.profileImageFileId ? (
    <Image
      fileId={owner?.profileImageFileId}
      fileKey={owner?.profileImageFileKey}
      previewThumbnail={owner?.profileImagePreviewThumbnail}
      lastModified={owner?.profileImageLastModified}
      targetDrive={targetDrive}
      className={`${getSizeClassname(size)} overflow-hidden rounded-full ${className ?? ''}`}
      fit="cover"
      alt={'You'}
      title={'You'}
    />
  ) : (
    <FallbackImg
      odinId={window.location.hostname}
      className={`${getSizeClassname(size)} overflow-hidden rounded-full ${className ?? ''}`}
    />
  );
};

/**
 * The signed-in identity's photo: its public image, one request the browser caches, with
 * our initials until it loads. Not ContactImage: a contact lookup of ourselves goes over
 * peer, six profile reads in a row, before the photo can start. Not OwnerImage: the app
 * can't read the profile drive, so that shows initials only.
 */
const OwnPublicImage = ({ odinId, className, size }: ConnectionImageProps & { odinId: string }) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  return (
    <div className={`relative aspect-square ${getSizeClassname(size)} overflow-hidden rounded-full ${className ?? ''}`}>
      {status !== 'loaded' && <FallbackImg odinId={odinId} />}
      {status !== 'failed' && (
        <img
          src={`${new DotYouClient({ hostIdentity: odinId, api: ApiType.Guest }).getRoot()}/pub/image`}
          crossOrigin="anonymous"
          alt=""
          className={status === 'loaded' ? 'h-full w-full object-cover' : 'hidden'}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
    </div>
  );
};

export const ConnectionImage = (props: ConnectionImageProps) => {
  const isConnected = useIsConnected(props.odinId || undefined).data;

  return (
    <ContactImage
      {...props}
      odinId={props.odinId}
      className={`${getSizeClassname(props.size)} overflow-hidden rounded-full ${props.className ?? ''}`}
      canSave={!!isConnected}
    />
  );
};
