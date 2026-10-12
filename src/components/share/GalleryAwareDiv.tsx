/**
 * react-markdown `div` override for the share page (#601). An image gallery
 * (`div[data-gallery]`, its images and row breaks laid out by rehypeGalleryRows)
 * gives each image its aspect ratio once it loads, as the editor does; any other
 * div renders as it is.
 */
import { useEffect, useRef, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { watchGalleryAspect } from '@/components/editor/nodes/galleryLayout';

function ShareGallery(props: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? watchGalleryAspect(ref.current) : undefined), []);
  return <div ref={ref} {...props} />;
}

export function GalleryAwareDiv({ node, ...rest }: ComponentProps<'div'> & ExtraProps) {
  // `node` is react-markdown's own extra prop, not a DOM attribute.
  void node;
  return 'data-gallery' in rest ? <ShareGallery {...rest} /> : <div {...rest} />;
}
