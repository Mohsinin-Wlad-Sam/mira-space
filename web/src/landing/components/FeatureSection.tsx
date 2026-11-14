import BackgroundImage from './BackgroundImage'
import Button from './Button'
import { Scramble, SplitText } from './RevealText'
import { delay, splitDuration } from '../revealTiming'
import { useReveal } from '../useReveal'
import type { Feature } from '../content'
import './Sections.css'

const TITLE_START = 150
const STAGGER = 80

/** Full-bleed photo section with text on the left or right (SpaceX-style). */
export default function FeatureSection({ id, align, eyebrow, title, body, cta, image }: Feature) {
  const [ref, visible] = useReveal<HTMLDivElement>(0.25)
  const titleId = `${id}-title`
  const afterTitle = TITLE_START + splitDuration(title, STAGGER) + 200

  return (
    <section id={id} className={`panel panel--feature panel--${align}`} aria-labelledby={titleId}>
      <div className="panel__backdrop">
        <div className="panel__media">
          <BackgroundImage image={image} />
        </div>
        <div className={`panel__shade panel__shade--${align}`} />
      </div>

      <div ref={ref} className={`panel__content reveal-group ${visible ? 'is-visible' : ''}`}>
        {eyebrow && (
          <p className="eyebrow reveal-item" style={delay(0)}>
            <Scramble text={eyebrow} start={visible} />
          </p>
        )}
        <SplitText
          id={titleId}
          className="display feature-title"
          text={title}
          delay={TITLE_START}
          stagger={STAGGER}
        />
        <p className="feature-body reveal-item" style={delay(afterTitle)}>
          {body}
        </p>
        {cta && (
          <div className="reveal-item" style={delay(afterTitle + 140)}>
            {cta.to !== undefined ? (
              <Button to={cta.to}>{cta.label}</Button>
            ) : (
              <Button href={cta.href}>{cta.label}</Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
