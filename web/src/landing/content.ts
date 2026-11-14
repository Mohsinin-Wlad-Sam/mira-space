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
// same-tab <a href>. /explore/ opens BLINK (the SPHEREx movie tool);
// ?target=<name> or ?ra=..&dec=..&fov=.. opens it on a position; #atlas opens
// the all-sky atlas, #tour its guided tour, #about the method page.
// ---------------------------------------------------------------------------
export const viewer = {
  home: '/explore/',
  barnard: '/explore/?target=barnard',
  methane: '/explore/?target=eps-indi-b',
  pulse: '/explore/?target=r-dra',
  atlas: '/explore/#atlas',
  tour: '/explore/#tour',
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
  { label: 'Blink', href: '/#mission' },
  { label: 'Spectra', href: '/#data' },
  { label: 'Motion', href: '/#how-it-works' },
  { label: 'Atlas', href: '/#lenses' },
  { label: 'Evidence', href: '/#evidence' },
  { label: 'Plan', href: '/#plan' },
  { label: 'Team', href: '/#team' },
]

// ---------------------------------------------------------------------------
// Page sections
// ---------------------------------------------------------------------------
export const hero = {
  /** Shown in the eyebrow until the live census numbers arrive. */
  eyebrow: 'NASA SPHEREx · every pass since 2025',
  title: 'Watch the sky move',
  sub: 'Any spot on the sky, as a movie · 102 infrared colors',
  cta: { label: 'Open Blink', href: viewer.home } satisfies Cta,
  tour: { label: 'See a brown dwarf move', href: viewer.methane } satisfies Cta,
  image: images.hero as SiteImage,
}

export const features: Feature[] = [
  {
    id: 'mission',
    align: 'left',
    eyebrow: 'The tool',
    title: 'Type a position. Get a movie.',
    body:
      'Enter any coordinates or a name. Mira finds every SPHEREx exposure that covers the spot, reads the pixels ' +
      'straight from NASA’s archive, lines them up on the sky and plays them in order. Whatever drifts between ' +
      'frames is moving: the way Pluto was found, now for a billion infrared sources.',
    cta: { label: 'Try Barnard’s Star', href: viewer.barnard },
    image: images.survey,
  },
  {
    id: 'data',
    align: 'right',
    eyebrow: 'The data',
    title: '102 colors, one spectrum',
    body:
      'SPHEREx looks through a filter whose color changes across each detector, so every exposure measures a ' +
      'different wavelength. Mira turns that into a spectrum on the fly for anything you click, and points out ' +
      'methane at 3.3 µm: the fingerprint of the coldest worlds.',
    cta: { label: 'See a methane world', href: viewer.methane },
    image: images.bands,
  },
  {
    id: 'how-it-works',
    align: 'left',
    eyebrow: 'Measured, not just shown',
    title: 'Motion, distance, change',
    body:
      'From SPHEREx frames alone, Mira measures how fast a source crosses the sky and, for the nearest ones, its ' +
      'parallax. Brightness is compared only at matching wavelengths, so real variability is never confused with ' +
      'color flicker. Stars too bright for the detector are followed by their halo.',
    cta: { label: 'Watch a star pulse', href: viewer.pulse },
    image: images.motion,
  },
  {
    id: 'lenses',
    align: 'right',
    eyebrow: 'The atlas',
    title: 'Sixteen years of change',
    body:
      'Behind the tool is a census: 40 billion WISE detections from 2010–2020 linked into objects, each measured ' +
      'again by SPHEREx. Light up what moved, what vanished and what is made of methane across the whole sky, ' +
      'fly among them in 3D, then blink any one of them.',
    cta: { label: 'Open the sky atlas', href: viewer.atlas },
    image: images.starfield,
  },
  {
    id: 'evidence',
    align: 'left',
    eyebrow: 'Our approach',
    title: 'Evidence before discovery',
    body:
      'Every frame carries NASA’s own quality flags, painted on the image. Gaia and WISE catalogues can be laid ' +
      'over each frame at its date. Every measurement links back to the exposure it came from, and every view ' +
      'has an address you can share or embed. A candidate is for a closer look, not a headline.',
    cta: { label: 'See the method', href: viewer.about },
    image: images.evidence,
  },
  {
    id: 'plan',
    align: 'right',
    eyebrow: 'Sustainability',
    title: 'Free to use, built to last',
    body:
      'Mira has no accounts and no backend: the browser talks to NASA’s archive directly, so serving the world ' +
      'costs a few dollars a month. Open source and free for everyone; sustained by research grants, observatory ' +
      'and classroom partnerships, and embeds for citizen-science projects.',
    cta: { label: 'Read the plan', href: links.plan },
    image: images.stats,
  },
]

/** Shown until (or if) the live census summary is unavailable. */
export const stats: { image: SiteImage; items: Stat[] } = {
  image: images.stats,
  items: [
    { value: 102, suffix: '', label: 'Infrared colors' },
    { value: 16, suffix: '', label: 'Years of sky, 2010–2026' },
    { value: 12288, suffix: '', label: 'Sky tiles in the census' },
  ],
}

export const team: Feature = {
  id: 'team',
  align: 'left',
  eyebrow: 'NASA Space Apps Challenge 2026',
  title: 'Built for Planet X & SPHEREx',
  body:
    'Mira is our answer to the Planet X and SPHEREx challenge: a public tool that turns SPHEREx’s raw exposures ' +
    'into movies, spectra and measurements anyone can make, backed by an open census of how the infrared sky ' +
    'has changed since 2010.',
  cta: { label: 'View the challenge', href: links.challenge },
  image: images.galaxy,
}

export const footerLinks: NavLink[] = [
  { label: 'Blink', href: viewer.home },
  { label: 'Sky atlas', href: viewer.atlas },
  { label: 'Challenge', href: links.challenge },
  { label: 'IRSA archive', href: links.irsa },
  { label: 'Tutorials', href: links.tutorials },
  { label: 'WiseView', href: links.wiseview },
  { label: 'GitHub', href: links.github },
]
