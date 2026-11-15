import { coverSizes, unsplashSrc, unsplashSrcSet, type SiteImage } from '../content'

interface BackgroundImageProps {
  image: SiteImage
  /** Load eagerly with high fetch priority (use for the first screen only). */
  priority?: boolean
  className?: string
}

/** Full-bleed, responsive background photo (object-fit: cover). */
export default function BackgroundImage({ image, priority = false, className = '' }: BackgroundImageProps) {
  // a still recorded from MIRA itself: one file, served by this site
  if (image.local)
    return (
      <img
        className={`bg-image ${className}`.trim()}
        src={image.local}
        alt={image.alt}
        style={image.position ? { objectPosition: image.position } : undefined}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
    )
  return (
    <img
      className={`bg-image ${className}`.trim()}
      src={unsplashSrc(image.src, 1920)}
      srcSet={unsplashSrcSet(image.src)}
      sizes={coverSizes(image)}
      alt={image.alt}
      style={image.position ? { objectPosition: image.position } : undefined}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  )
}
