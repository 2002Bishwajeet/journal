import { useDotYouClientContext } from "../auth";
import { OdinImage, type OdinImageProps } from "../OdinImage/OdinImage";

export type ImageProps = Omit<OdinImageProps, 'dotYouClient'>;

export const Image = (props: ImageProps) => {
  const dotYouClient = useDotYouClientContext();

  return <OdinImage dotYouClient={dotYouClient} {...props} />;
};
