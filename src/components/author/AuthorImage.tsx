import { useState, useSyncExternalStore } from 'react';
import { ApiType, DotYouClient } from '@homebase-id/js-lib/core';
import { FallbackImg } from '../ui/FallbackImg/FallbackImg';
import { ContactImage } from '../contact/ContactImage';
import { useIsConnected } from '@/hooks/connections/useIsConnected';
import { useDotYouClientContext } from '@/components/auth';
import { getProxiedImageUrl } from '@/lib/utils/imageProxy';


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
  if (!odinId || odinId === ownIdentity) return <OwnerImage {...props} />;

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

// /proxy-image/ exists only in the service worker. Without one the request gets the SPA's index.html.
const subscribeToController = (onChange: () => void) => {
  navigator.serviceWorker?.addEventListener('controllerchange', onChange);
  return () => navigator.serviceWorker?.removeEventListener('controllerchange', onChange);
};
const hasController = () => !!navigator.serviceWorker?.controller;

/**
 * The signed-in identity's photo: its public image through the service worker's proxy (a
 * direct load breaks the CSP's img-src), one request it caches, with our initials until it
 * loads, and for good on a page no service worker controls (a hard reload, dev). Not
 * ContactImage: a contact lookup of ourselves goes over peer, six profile reads in a row,
 * before the photo can start. Not the profile drive: the app has no permission on it.
 */
export const OwnerImage = ({ className, size }: ImageProps) => {
  const odinId = useDotYouClientContext().getHostIdentity();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const controlled = useSyncExternalStore(subscribeToController, hasController);

  return (
    <div className={`relative aspect-square ${getSizeClassname(size)} overflow-hidden rounded-full ${className ?? ''}`}>
      {/* size-full: the fallback is 40px by default, wider than the sidebar's circles */}
      {status !== 'loaded' && <FallbackImg odinId={odinId} className="size-full" />}
      {controlled && status !== 'failed' && (
        <img
          src={getProxiedImageUrl(`${new DotYouClient({ hostIdentity: odinId, api: ApiType.Guest }).getRoot()}/pub/image`)}
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
