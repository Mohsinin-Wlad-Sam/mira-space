// All landing-page copy, links and imagery live here so the team can edit
// them without touching component code.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SiteImage {
  /** A picture served by this site (a still recorded from MIRA itself); when set, `src` is not used */
  local?: string
  /** Unsplash CDN id, e.g. "photo-1464802686167-b939a6910659" (not used any more: every picture is MIRA's own) */
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
  // Unsplash photographs (free licence; credited in the footer). Pictures recorded from MIRA itself live in
  // web/public/land/ and web/public/deck/: set `local` on an entry to use one instead.
  hero: { src: 'photo-1464802686167-b939a6910659', width: 5005, height: 3417, alt: 'The Milky Way glowing in blue and purple across a dense field of stars', author: 'Jeremy Thomas', page: 'https://unsplash.com/photos/E0AHdsENmDg' },
  survey: { src: 'photo-1446776811953-b23d57bd21aa', width: 4928, height: 3280, alt: 'A satellite in orbit above the clouds and oceans of Earth', author: 'NASA', page: 'https://unsplash.com/photos/yZygONrUBe8' },
  bands: { src: 'photo-1462332420958-a05d1e002413', width: 5200, height: 2500, alt: 'A colourful nebula of glowing gas and dust lit by young stars', author: 'NASA', page: 'https://unsplash.com/photos/-hI5dX2ObAs', position: '30% 50%' },
  motion: { src: 'photo-1504966981333-1ac8809be1ca', width: 4272, height: 2848, alt: 'Long-exposure star trails circling the sky above dark water', author: 'Reign Abarintos', page: 'https://unsplash.com/photos/-cKXtsJWU-I' },
  evidence: { src: 'photo-1727034393564-dc7b0275686d', width: 2951, height: 3934, alt: 'An observatory dome beneath a star-filled night sky', author: 'Ahmed Atef', page: 'https://unsplash.com/photos/b7lnMZqv1YE', position: '50% 70%' },
  stats: { src: 'photo-1451187580459-43490279c0fa', width: 4256, height: 2832, alt: 'Earth at night seen from orbit, with the glow of the horizon', author: 'NASA', page: 'https://unsplash.com/photos/Q1p7bh3SHj8' },
  galaxy: { src: 'photo-1543722530-d2c3201371e7', width: 5412, height: 3594, alt: 'The Andromeda Galaxy surrounded by a dense field of stars', author: 'Guillermo Ferla', page: 'https://unsplash.com/photos/Oze6U2m1oYU' },
  starfield: { src: 'photo-1475274047050-1d0c0975c63e', width: 5456, height: 3632, alt: 'A deep, dark sky scattered with countless faint stars', author: 'Paul Lichtblau', page: 'https://unsplash.com/photos/qVotvbsuM_c' },
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
  { label: 'Sky', href: '/#map' },
  { label: 'Lab', href: '/#learn' },
  { label: 'Evidence', href: '/#evidence' },
  { label: 'AI scout', href: '/#research' },
  { label: 'Take part', href: '/#take-part' },
  { label: 'Plans', href: '/#plan' },
  { label: 'Team', href: '/#team' },
  { label: 'Docs', href: '/docs/' },
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
  eyebrow: 'NASA Space Apps 2026',
  title: 'The sky is not still',
  sub: 'Point at any place · watch 27 years of NASA pictures · see what moved',
  cta: { label: 'Open the sky', href: viewer.sky } satisfies Cta,
  tour: { label: 'Watch the film · 30 s', href: '/film/mira_film_720.mp4' } satisfies Cta,
  image: images.hero as SiteImage,
}

export const features: Feature[] = [
  {
    id: 'map',
    align: 'left',
    eyebrow: 'The Sky',
    title: 'One time bar. 1999 to tonight.',
    body:
      'The whole sky as NASA’s SPHEREx sees it, with tonight’s planets where they are right now. Slide back ' +
      'through three NASA surveys.',
    cta: { label: 'Open the sky', href: viewer.sky },
    image: images.motion,
  },
  {
    id: 'learn',
    align: 'left',
    eyebrow: 'The Lab',
    title: 'Point at a star. Watch it move.',
    body:
      'Any place plays as a little film of real NASA pictures. Epsilon Indi B crossed this field in 27 years: ' +
      '4.70 arcseconds a year measured here, 4.68 in ESA’s Gaia.',
    cta: { label: 'Open this star', href: viewer.methane },
    image: images.survey,
  },
  {
    id: 'light',
    align: 'left',
    eyebrow: 'Its light',
    title: 'Methane. A brown dwarf.',
    body:
      'SPHEREx splits light into 102 colours. The gap at 3.3 µm is methane: this one is a brown dwarf, 12 ' +
      'light-years away.',
    cta: { label: 'Open its spectrum', href: '/explore/?target=eps-indi-b&tool=spectrum' },
    image: images.bands,
  },
  {
    id: 'evidence',
    align: 'right',
    eyebrow: 'Evidence',
    title: 'Measured, not claimed.',
    body:
      '17,604 motions confirmed on raw SPHEREx exposures. Tested blind, the detector found 92% of known ' +
      'movers and raised no false alarm.',
    cta: { label: 'How it was checked', href: '/docs/#accuracy' },
    image: images.evidence,
  },
  {
    id: 'research',
    align: 'right',
    eyebrow: 'Research preview',
    title: 'An AI scout for the whole sky.',
    body:
      'A network looked at every patch of sky three times. Of its 400 strongest new marks, 362 are fast-moving ' +
      'stars that Gaia or SIMBAD already list; 38 are open. Meta’s V-JEPA 2, fine-tuned, gives a second opinion.',
    cta: { label: 'How it was tested', href: '/docs/#worldmodel' },
    image: images.starfield,
  },
  {
    id: 'take-part',
    align: 'left',
    eyebrow: 'Take part',
    title: 'Help look at one.',
    body:
      '635 confirmed movers are in no reference database. Open one, compare its three pictures, say what ' +
      'you see. No account.',
    cta: { label: 'Look at one', href: viewer.takePart },
    image: images.galaxy,
  },
  {
    id: 'plan',
    align: 'left',
    eyebrow: 'Plans',
    title: 'Free for everyone. More for those who measure.',
    body:
      'Explorer is free. Researcher adds the fit, the files, lists of targets and the models. Mission runs ' +
      'the pipeline on an agency’s own survey.',
    cta: { label: 'See the plans', href: '/docs/#plans' },
    image: images.hero,
  },
]

/** Shown until (or if) the live census summary is unavailable. */
export const stats: { image: SiteImage; items: Stat[] } = {
  image: images.stats,
  items: [
    { value: 17604, suffix: '', label: 'Stars caught moving' },
    { value: 362, suffix: '', label: 'Of the AI scout’s 400 new finds, known to Gaia or SIMBAD' },
    { value: 635, suffix: '', label: 'Movers in no reference database' },
  ],
}

export const team: Feature = {
  id: 'team',
  align: 'left',
  eyebrow: 'Team Mohsinin Wlad Dario',
  title: 'Built for Planet X & SPHEREx',
  body:
    'Ben Guerir, Morocco. Mohammed Ouabdrrahmane, Ibn Zohr University · Hamza Ba-mohammed, College of Computing, ' +
    'UM6P Rabat · Hiba Nemry, SHBM, UM6P Benguerir · Aya Driouche, UEMF · Abdelmonaim Bounite, MBZUAI.',
  cta: { label: 'View the challenge', href: links.challenge },
  image: images.motion,
}

export const footerLinks: NavLink[] = [
  { label: 'Documentation', href: '/docs/' },
  { label: 'Film', href: '/film/mira_film_720.mp4' },
  { label: 'Deck', href: '/deck/' },
  { label: 'Universe (3D)', href: viewer.home },
  { label: 'Sky', href: viewer.sky },
  { label: 'The Lab', href: viewer.lab },
  { label: 'Catalogue', href: viewer.catalogue },
  { label: 'Challenge', href: links.challenge },
  { label: 'IRSA archive', href: links.irsa },
  { label: 'Tutorials', href: links.tutorials },
  { label: 'WiseView', href: links.wiseview },
  { label: 'GitHub', href: links.github },
]
