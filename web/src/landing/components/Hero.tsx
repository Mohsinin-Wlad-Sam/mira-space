import { Link } from 'react-router-dom'
import BackgroundImage from './BackgroundImage'
import Button from './Button'
import { Scramble, SplitText } from './RevealText'
import { delay, splitDuration } from '../revealTiming'
import { useReveal } from '../useReveal'
import { tilesLabel, useSummary } from '../useSummary'
import { hero } from '../content'
import './Sections.css'

const TITLE_START = 250
const STAGGER = 90
const AFTER_TITLE = TITLE_START + splitDuration(hero.title, STAGGER) + 250

export default function Hero() {
  const [ref, visible] = useReveal<HTMLDivElement>(0.1)
  const summary = useSummary()

  return (
    <section className="panel panel--hero" aria-labelledby="hero-title">
      <div className="panel__backdrop">
        <div className="panel__media">
          <BackgroundImage image={hero.image} priority className="kenburns" />
        </div>
        <div className="panel__shade panel__shade--bottom" />
      </div>

      <div ref={ref} className={`panel__content panel__content--hero reveal-group ${visible ? 'is-visible' : ''}`}>
        <p className="eyebrow reveal-item" style={delay(0)}>
          <Scramble text={hero.eyebrow} start={visible} />
          {summary && (
            <span className="eyebrow__countdown">
              <span className="census-status__dot" aria-hidden="true" />
              {tilesLabel(summary)}
            </span>
          )}
        </p>
        <SplitText
          as="h1"
          id="hero-title"
          className="display hero-title"
          text={hero.title}
          delay={TITLE_START}
          stagger={STAGGER}
        />
        <p className="hero-sub reveal-item" style={delay(AFTER_TITLE)}>
          {hero.sub}
        </p>
        <div className="button-row reveal-item" style={delay(AFTER_TITLE + 120)}>
          <Button href={hero.cta.href}>{hero.cta.label}</Button>
          <Button href={hero.tour.href}>{hero.tour.label}</Button>
        </div>
      </div>

      <Link to="/#mission" className="scroll-cue" aria-label="Scroll to the mission section">
        <span />
      </Link>
    </section>
  )
}
