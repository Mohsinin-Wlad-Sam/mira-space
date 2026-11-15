// All landing-page copy, links and imagery live here so the team can edit
// them without touching component code.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SiteImage {
  /** Unsplash CDN id, e.g. "photo-1464802686167-b939a6910659" */
  src: string
  alt: string
  author: string
  /** Unsplash photo page (for credits) */
  page: string
  /** Source dimensions in px (used to pick the right size when cropped) */
  width: number
  height: number
  /** CSS object-position, to keep the subject in frame when cropped */
  position?: string
}

/**
 * A call to action: `to` = in-app route, `href` = link. An `href` starting
 * with "/" (e.g. the sky viewer) opens in the same tab; others open a new tab.
 */
export type Cta = { label: string; to: string; href?: never } | { label: string; href: string; to?: never }

export type Align = 'left' | 'right'

export interface Feature {
  id: string
  align: Align
  eyebrow?: string
  title: string
  body: string
  cta?: Cta
  image: SiteImage
}

export interface NavLink {
  label: string
  href: string
}

export interface Stat {
  value: number
  suffix: string
  label: string
  /** Decimal places shown (default 0). */
  decimals?: number
}

// ---------------------------------------------------------------------------
// The app is a separate page (not a React route), so links to it are plain
// same-tab <a href>. /explore/ opens the map; #lab the Lab (the instruments);
// ?target=<name> or ?ra=..&dec=..&fov=.. opens it on a field; #catalogue opens
// the verified catalogue, #cases the saved measurements, #about the method page.
// ---------------------------------------------------------------------------
export const viewer = {
  home: '/explore/',
  lab: '/explore/#lab',
  coldWorld: '/explore/#universe=6275-47643',
  sky: '/explore/#sky',
  takePart: '/explore/#take-part',
  barnard: '/explore/?target=barnard',
  methane: '/explore/?target=eps-indi-b',
  luhman: '/explore/?target=Luhman%2016',
  catalogue: '/explore/#catalogue',
  about: '/explore/#about',
} as const

// ---------------------------------------------------------------------------
// Links (from the challenge "Resources" tab)
// ---------------------------------------------------------------------------
export const links = {
  challenge: 'https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/',
  irsa: 'https://irsa.ipac.caltech.edu/Missions/spherex.html',
  tutorials: 'https://caltech-ipac.github.io/irsa-tutorials/spherex/',
  wiseview: 'http://byw.tools/wiseview',
  gaia: 'https://archive.stsci.edu/missions-and-data/gaia',
  github: 'https://github.com/Mohsinin-Wlad-Sam/assrar-dawla',
  plan: 'https://github.com/Mohsinin-Wlad-Sam/assrar-dawla/blob/main/docs/13_business_plan.md',
} as const

// ---------------------------------------------------------------------------
// Imagery — Unsplash (free licence), served from images.unsplash.com with
// on-the-fly resizing. All photos are high-resolution at source (≥ 4000 px on
// the long edge). To swap a photo, change `src` (the photo-… id), `width`,
// `height`, `page` and `author`.
// ---------------------------------------------------------------------------
const UNSPLASH = 'https://images.unsplash.com/'
const REF = '?utm_source=mira_spaceapps&utm_medium=referral'
const QUALITY = 85
// Capped at 2560: dense starfields compress poorly (3840w hero ≈ 2.6 MB).
const WIDTHS = [640, 960, 1280, 1600, 1920, 2560] as const

export function unsplashSrc(id: string, width: number): string {
  return `${UNSPLASH}${id}?auto=format&fit=crop&w=${width}&q=${QUALITY}`
}

export function unsplashSrcSet(id: string): string {
  return WIDTHS.map((w) => `${unsplashSrc(id, w)} ${w}w`).join(', ')
}

/**
 * `sizes` for a full-viewport `object-fit: cover` photo (the fixed section
 * backdrops). When the viewport is narrower (in aspect) than the photo, the
 * photo is scaled by height, so its drawn width is 100vh × aspect, not 100vw.
 */
export function coverSizes(image: SiteImage): string {
  const aspect = (image.width / image.height).toFixed(3)
  return `(max-aspect-ratio: ${image.width}/${image.height}) calc(${aspect} * 100vh), 100vw`
}

export const images = {
  hero: {
    src: 'photo-1464802686167-b939a6910659',
    width: 5005,
    height: 3417,
    alt: 'The Milky Way glowing in blue and purple across a dense field of stars',
    author: 'Jeremy Thomas',
    page: 'https://unsplash.com/photos/E0AHdsENmDg',
  },
  survey: {
    src: 'photo-1446776811953-b23d57bd21aa',
    width: 4928,
    height: 3280,
    alt: 'A satellite in orbit above the clouds and oceans of Earth',
    author: 'NASA',
    page: 'https://unsplash.com/photos/yZygONrUBe8',
  },
  bands: {
    src: 'photo-1462332420958-a05d1e002413',
    width: 5200,
    height: 2500,
    alt: 'A colourful nebula of glowing gas and dust lit by young stars',
    author: 'NASA',
    page: 'https://unsplash.com/photos/-hI5dX2ObAs',
    position: '30% 50%',
  },
  motion: {
    src: 'photo-1504966981333-1ac8809be1ca',
    width: 4272,
    height: 2848,
    alt: 'Long-exposure star trails circling the sky above dark water',
    author: 'Reign Abarintos',
    page: 'https://unsplash.com/photos/-cKXtsJWU-I',
  },
  evidence: {
    src: 'photo-1727034393564-dc7b0275686d',
    width: 2951,
    height: 3934,
    alt: 'An observatory dome beneath a star-filled night sky',
    author: 'Ahmed Atef',
    page: 'https://unsplash.com/photos/b7lnMZqv1YE',
    position: '50% 70%',
  },
  stats: {
    src: 'photo-1451187580459-43490279c0fa',
    width: 4256,
    height: 2832,
    alt: 'Earth at night seen from orbit, with the glow of the horizon',
    author: 'NASA',
    page: 'https://unsplash.com/photos/Q1p7bh3SHj8',
  },
  galaxy: {
    src: 'photo-1543722530-d2c3201371e7',
    width: 5412,
    height: 3594,
    alt: 'The Andromeda Galaxy surrounded by a dense field of stars',
    author: 'Guillermo Ferla',
    page: 'https://unsplash.com/photos/Oze6U2m1oYU',
  },
  starfield: {
    src: 'photo-1475274047050-1d0c0975c63e',
    width: 5456,
    height: 3632,
    alt: 'A deep, dark sky scattered with countless faint stars',
    author: 'Paul Lichtblau',
    page: 'https://unsplash.com/photos/qVotvbsuM_c',
  },
} satisfies Record<string, SiteImage>

// One credit per photographer (links to their first photo used here).
export const imageCredits = Object.values(images as Record<string, SiteImage>)
  .filter((img, i, all) => all.findIndex((o) => o.author === img.author) === i)
  .map((img) => ({ author: img.author, href: img.page + REF }))

export const unsplashHome = 'https://unsplash.com/' + REF

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
export const navLinks: NavLink[] = [
  { label: 'See it move', href: '/#map' },
  { label: 'Take part', href: '/#take-part' },
  { label: 'Classrooms', href: '/#learn' },
  { label: 'Researchers', href: '/#research' },
  { label: 'Evidence', href: '/#evidence' },
  { label: 'Plan', href: '/#plan' },
  { label: 'Team', href: '/#team' },
]

// ---------------------------------------------------------------------------
// Page sections. Figures quoted here and their sources:
//   150,000 volunteers, about 3,000 brown dwarfs: NASA, "Citizen Scientists Help Create 3D Map of Cosmic
//     Neighborhood", 13 Jan 2021 (Backyard Worlds: Planet 9)
//   US$488 million: SPHEREx lifecycle cost, NASA/JPL press kit
//   12,329 / 92% / 5,757 / 17,600: our own results (see the Method page of the app)
// ---------------------------------------------------------------------------
export const hero = {
  /** Shown in the eyebrow until the live census numbers arrive. */
  eyebrow: 'NASA SPHEREx · open to everyone, in your browser',
  title: 'The sky is not still',
  sub: 'Tonight’s planets, live · 27 years of NASA’s sky on one slider · real stars caught changing place',
  cta: { label: 'Open the sky', href: viewer.sky } satisfies Cta,
  tour: { label: 'Fly around the Sun', href: viewer.home } satisfies Cta,
  image: images.hero as SiteImage,
}

export const features: Feature[] = [
  {
    id: 'map',
    align: 'left',
    eyebrow: 'For everyone',
    title: 'Planets move in days. Stars move in decades. See both.',
    body:
      'NASA’s newest sky survey, SPHEREx, is photographing the whole sky in 102 infrared colours. Its images are ' +
      'public, but each is a 65-megabyte scientific file made for specialists’ software. Mira turns them into two ' +
      'maps anyone can use. On the Sky, the Sun, the Moon and the planets stand where they are right now; one tap ' +
      'shades what is below your own horizon and tells you which planets are up tonight. Slide back in time and ' +
      'three NASA surveys follow one another from 1999, the last of them, SPHEREx, filling in on the very dates ' +
      'it was taken. In Space, every point is a real star at its distance from the Sun, and the orange ones were ' +
      'caught changing place: click one and three real NASA pictures show it move. No install, no account, and it ' +
      'works on a phone.',
    cta: { label: 'Open the sky', href: viewer.sky },
    image: images.motion,
  },
  {
    id: 'take-part',
    align: 'right',
    eyebrow: 'Take part',
    title: 'Help look at the ones in no reference database',
    body:
      'The coldest objects near the Sun give off almost no visible light. They are found because they move. In ' +
      'NASA’s Backyard Worlds project, 150,000 volunteers looking for moving dots in older images have helped find ' +
      'about 3,000 brown dwarfs. Mira tries the same idea on its own catalogue, as a prototype: 635 confirmed ' +
      'movers have no Gaia source and no entry in SIMBAD, astronomy’s reference database. Open one, compare its ' +
      'three pictures, and say what you see. No account, and nothing about you is kept.',
    cta: { label: 'Look at one', href: viewer.takePart },
    image: images.galaxy,
  },
  {
    id: 'learn',
    align: 'left',
    eyebrow: 'For classrooms',
    title: 'A telescope for every classroom',
    body:
      'A school needs no telescope and no dark sky. Students pick a star, measure how fast it crosses the sky on ' +
      'NASA’s own images, and compare their number with the Gaia space observatory’s: for the brown dwarf Epsilon ' +
      'Indi B the Lab finds 4.70 arcseconds a year, Gaia 4.68. It is free, it runs in a browser, and an assistant ' +
      'explains each result in plain words.',
    cta: { label: 'Measure a star', href: viewer.methane },
    image: images.survey,
  },
  {
    id: 'research',
    align: 'right',
    eyebrow: 'For researchers and agencies',
    title: 'Instruments, not screenshots',
    body:
      'Behind the maps is a working Lab: a motion detector, an astrometer, a spectrograph, a photometer and ' +
      'detection limits, reading SPHEREx exposures straight from NASA’s archive for any field of the sky, on a ' +
      'laptop: no cluster, no install. Tested ' +
      'blind on 459 fields, the detector found 92% of known moving stars and raised no false alarm among 5,757 ' +
      'still ones. For a mission team or a science centre, the Sky map plays the survey as it really advanced, ' +
      'from the index of its 1.6 million public exposures, and any view can be put on another page with one line.',
    cta: { label: 'Open the Lab', href: viewer.lab },
    image: images.bands,
  },
  {
    id: 'evidence',
    align: 'left',
    eyebrow: 'Our approach',
    title: 'Verified, not just claimed',
    body:
      'Sixteen years of WISE data gave 1.56 million claims of motion or change. We re-measured more than 200,000 ' +
      'of them on raw SPHEREx exposures. About 17,600 motions pass; away from the crowded Milky Way, nearly nine ' +
      'in ten are stars Gaia knows with the same motion. The lists that did not survive are gone, and every ' +
      'number on the site leads back to the images behind it.',
    cta: { label: 'See the method', href: viewer.about },
    image: images.evidence,
  },
  {
    id: 'plan',
    align: 'right',
    eyebrow: 'Sustainability',
    title: 'Free for everyone, built to last',
    body:
      'SPHEREx cost about US$488 million of public money; Mira makes its images something the public can look ' +
      'at. The browser reads NASA’s archive directly, so serving it costs a few dollars a month. Free and open; ' +
      'sustained by research and education grants and by work for archives and universities that want the same ' +
      'instruments on their own data.',
    cta: { label: 'Read the plan', href: links.plan },
    image: images.stats,
  },
]

/** Shown until (or if) the live census summary is unavailable. */
export const stats: { image: SiteImage; items: Stat[] } = {
  image: images.stats,
  items: [
    { value: 12329, suffix: '', label: 'Moving stars on the map, each confirmed on SPHEREx images' },
    { value: 150000, suffix: '', label: 'Volunteers in NASA’s Backyard Worlds: the precedent we follow' },
    { value: 635, suffix: '', label: 'Confirmed movers with no Gaia source and no SIMBAD entry, waiting for a first look' },
  ],
}

export const team: Feature = {
  id: 'team',
  align: 'left',
  eyebrow: 'NASA Space Apps Challenge 2026',
  title: 'Built for Planet X & SPHEREx',
  body:
    'Mira is our answer to the Planet X and SPHEREx challenge: a public tool that shows SPHEREx images of any ' +
    'place over time so that moving objects are easy to spot, two maps that make the sky and what was found in it visible to ' +
    'everyone, and a survey of sixteen years of infrared sky checked, claim by claim, on NASA’s raw exposures.',
  cta: { label: 'View the challenge', href: links.challenge },
  image: images.starfield,
}

export const footerLinks: NavLink[] = [
  { label: 'Space (3D)', href: viewer.home },
  { label: 'Sky', href: viewer.sky },
  { label: 'The Lab', href: viewer.lab },
  { label: 'Catalogue', href: viewer.catalogue },
  { label: 'Challenge', href: links.challenge },
  { label: 'IRSA archive', href: links.irsa },
  { label: 'Tutorials', href: links.tutorials },
  { label: 'WiseView', href: links.wiseview },
  { label: 'GitHub', href: links.github },
]
