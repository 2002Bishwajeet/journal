/**
 * react-markdown `div` override for the share page (#601, #602). An image gallery
 * (`div[data-gallery]`, its images and row breaks laid out by rehypeGalleryRows)
 * gives each image its aspect ratio once it loads, as the editor does; a carousel
 * also gets its previous / next buttons, dots and arrow keys. Any other div renders
 * as it is.
 */
import { useEffect, useRef, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { createCarouselNav, watchGalleryAspect } from '@/components/editor/nodes/galleryLayout';

function ShareGallery(props: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? watchGalleryAspect(ref.current) : undefined), []);
  return <div ref={ref} {...props} />;
}

function ShareCarousel(props: ComponentProps<'div'>) {
  const block = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const holder = slot.current;
    if (!block.current || !scroller.current || !holder) return;
    const made = createCarouselNav(scroller.current, block.current);
    holder.replaceChildren(made.nav);
    const stopAspect = watchGalleryAspect(scroller.current);
    return () => {
      made.destroy();
      stopAspect();
      holder.replaceChildren();
    };
  }, []);
  return (
    <div ref={block} className="gallery-block" tabIndex={0} role="group" aria-roledescription="carousel" aria-label="Image gallery">
      <div ref={scroller} {...props} />
      {/* Empty and React-owned: the nav is built imperatively and lives only in here. */}
      <div ref={slot} />
    </div>
  );
}

export function GalleryAwareDiv({ node, ...rest }: ComponentProps<'div'> & ExtraProps) {
  // `node` is react-markdown's own extra prop, not a DOM attribute.
  void node;
  if (!('data-gallery' in rest)) return <div {...rest} />;
  return (rest as Record<string, unknown>)['data-gallery'] === 'carousel' ? <ShareCarousel {...rest} /> : <ShareGallery {...rest} />;
}
