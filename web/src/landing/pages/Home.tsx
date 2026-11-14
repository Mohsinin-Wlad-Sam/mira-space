import Hero from '../components/Hero'
import FeatureSection from '../components/FeatureSection'
import StatsBand from '../components/StatsBand'
import { features, team } from '../content'
import { useScrollBlend } from '../useScrollBlend'

export default function Home() {
  useScrollBlend()

  return (
    <>
      <Hero />
      {features.map((f) => (
        <FeatureSection key={f.id} {...f} />
      ))}
      <StatsBand />
      <FeatureSection {...team} />
    </>
  )
}
