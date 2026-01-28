import type { Attribute } from '@homebase-id/js-lib/profile';
import { getInitialsOfNameAttribute, getTwoLettersFromDomain } from '@homebase-id/js-lib/helpers';
import { getOdinIdColor } from '@/helpers/colors/hostnameColors';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const getInitials = (
  domain: string | undefined,
  nameData?:
    | Attribute
    | {
        displayName?: string | undefined;
        givenName?: string | undefined;
        surname?: string | undefined;
      }
) => {
  if (nameData && 'id' in nameData) {
    return getInitialsOfNameAttribute(nameData);
  }

  if (nameData?.displayName) {
    return nameData.displayName
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('');
  }

  if (nameData?.givenName || nameData?.surname) {
    return ((nameData.givenName?.[0] ?? '') + (nameData.surname?.[0] ?? '') + '') as string;
  }

  return domain ? getTwoLettersFromDomain(domain) : '';
};

export const FallbackImg = ({
  odinId,
  nameData,
  className,
}: {
  odinId: string | undefined;
  nameData?:
    | Attribute
    | {
        displayName?: string | undefined;
        givenName?: string | undefined;
        surname?: string | undefined;
      };
  className?: string;
}) => {
  const backgroundColor = odinId ? getOdinIdColor(odinId).lightTheme : '#000000';
  const initials = getInitials(odinId, nameData);

  return (
    <Avatar className={className}>
      <AvatarFallback 
        style={{ backgroundColor, color: '#FFFFFF' }}
        className="text-white font-medium"
      >
        {initials.toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
};
