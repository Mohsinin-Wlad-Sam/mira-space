# 13 · Business plan — MIRA as free public infrastructure

**In one sentence.** MIRA is free, open infrastructure that turns NASA's SPHEREx archive into something anyone can
search for moving and changing objects; because the browser reads NASA's data directly, it costs almost nothing to
run, so it can be sustained by modest grants and partnerships instead of by charging its users.

This plan is written for the Space Apps judging criteria (impact, validity, relevance) rather than for investors:
MIRA is a public good, and the plan's job is to show that it can stay alive, grow, and stay free.

---

## 1. The problem and who has it

SPHEREx re-images the whole sky every six months in 102 infrared bands. The challenge statement says it plainly:
*"There will be too much data for any one person or even computer code to completely comprehend."* Three groups
need a way in, and none has a good one today.

| Who | What they need | What they have now |
|---|---|---|
| **Citizen scientists** — the Backyard Worlds: Planet 9 community (reported at 150,000–200,000 volunteers, more than 3,000 brown dwarfs found [1]) | Blink any spot, see what moves, report it | WiseView: excellent, but WISE only (2 bands, data ends 2024). Nothing comparable for SPHEREx. |
| **Researchers** — brown dwarfs, variable stars, Solar System bodies, transients | A quick look at every SPHEREx epoch of a target, with flags and a spectrum, before committing to a full analysis | IRSA's tools (powerful, expert-oriented, one product at a time) or writing their own cutout code |
| **Educators, planetariums, science communicators** | A live, honest demonstration of how discoveries are made | Static images and pre-rendered videos |

A fourth, indirect customer is **the mission and the archive themselves** (SPHEREx, NASA/IPAC IRSA): public
engagement and archival science are part of how missions are evaluated, and archival use multiplies the scientific
return of data that has already been paid for.

## 2. What MIRA offers each of them

- **Blink** — a position in, a sky-registered movie out, in about 15 seconds, with spectra, light curves and motions
  measured on the fly and NASA's quality flags on every frame.
- **Links and embeds** — every view has an address; any project can embed it in an `<iframe>`. This is what lets
  MIRA plug into existing communities (a Zooniverse Talk thread, a class page, a paper's supplementary link)
  instead of asking them to move.
- **The atlas and the census** — 16 years of WISE linked to SPHEREx, with candidate lists (moving, methane,
  vanished, brightened, unusual), as starting points for volunteers.
- **Exports** — CSV spectra, PNG, WebM: results leave the tool and enter reports and papers.

## 3. Why the economics work: near-zero marginal cost

The architecture is the business model.

| Cost item | How MIRA avoids or bounds it |
|---|---|
| **Storing and serving the images** (SPHEREx Level-2 is ~100 TB and growing) | Not ours. The pixels stay in NASA's public cloud bucket (AWS Open Data); the user's browser reads them directly with HTTP Range requests. MIRA pays neither storage nor transfer for them. |
| **Servers** | None. The site is static files: the app (~1 MB), the exposure index (213 MB, ~56 MB compressed; a visit touches one ~15 kB file) and the census feeds (~0.7 GB). |
| **Hosting** | Free tiers of static hosts cover it (GitHub Pages, Cloudflare Pages); a US$5/month instance is enough if we want our own server. |
| **Heavy computing** | One-off and offline: the census ran once on a university GPU cluster. Re-indexing a new SPHEREx release takes about one minute on one CPU node. |
| **Per-user cost** | Effectively zero: no accounts, no database, no API keys, no personal data to protect. |

**Running cost, year 1 (lean scenario): under US$150** — a domain name and, optionally, a small instance.
What does cost money is *people*: keeping the code working as NASA's formats evolve, and supporting users.
That is where funding goes.

This matters because of a well-documented failure mode. *The Astropy Problem* (Muna et al. 2016, 154 authors [2])
describes how the software most astronomers depend on was "effectively unfunded" and maintained in spare time.
MIRA's design answer is to need as little upkeep as possible (no backend, a small codebase, one re-index script,
an automated validation run), and its funding answer is below.

## 4. Why it should be free: the public-good argument

Scientific data tools are close to a textbook public good: one person's use does not reduce another's, and the
benefits (discoveries, trained people, public trust in science) cannot be captured by a paywall without
destroying most of them. Two results from the economics-of-science literature shape the plan.

1. **Volunteer effort is valuable and highly concentrated.** Sauermann & Franzoni (2015, *PNAS* [3]) studied seven
   Zooniverse projects: volunteers gave on the order of 129,000 hours in each project's first six months, valued at
   over US$1.5 million at undergraduate wages, with the top 10% of contributors doing about 80% of the work and most
   visitors contributing once. Consequences for MIRA:
   - *No sign-up, results in seconds* — the one-time visitor must get something immediately;
   - *power tools for the few* — keyboard control, exports, shareable links, flags, catalogue overlays — because
     the dedicated minority produces most of the science.
2. **Most citizen-science effort never reaches a paper.** Theobald et al. (2015, *Biological Conservation* [4])
   reviewed 388 biodiversity projects involving some 1.3 million volunteers, whose in-kind contribution they value
   in the billions of dollars a year, and found that only 12% of projects demonstrably fed peer-reviewed articles;
   what predicted publication was verifiable, standardised, publicly accessible data. Consequence for MIRA: every
   number is traceable to a named NASA exposure, exportable, and reproducible from a URL.

**A back-of-envelope social return.** If MIRA sustains 2,000 active volunteers contributing five hours a year,
that is 10,000 hours; at the 2025 U.S. replacement value of a volunteer hour (US$36.14 [5]) it is roughly
US$360,000 a year of research effort mobilised, for an operating cost of a few hundred dollars and a maintenance
cost of a fraction of one salary. The leverage, not revenue, is the return on investment — and it is the figure
funders of open science look for.

## 5. Funding model: grants first, services second, never the users

**Principle.** Individuals never pay and are never the product: no advertising, no tracking, no data sales.

| Stage | Horizon | Sources | Use of funds |
|---|---|---|---|
| **0 — Launch** | now → 6 months | Team time; university hosting and compute (already used for the census); hackathon recognition | Keep the site up; index each SPHEREx release; gather users and feedback |
| **1 — Grants** | 6 → 24 months | NASA ROSES open-science and citizen-science elements (e.g. the Citizen Science Seed Funding Program; Support for Open-Source Tools, Frameworks and Libraries, whose awards run 3–5 years; comparable open-source elements have made awards of about US$100,000 [6]) **with a U.S. partner institution as lead**; IAU Office of Astronomy for Development project grants; national programmes in Morocco and the UAE; open-source foundations (NumFOCUS small development grants, Sloan-type programmes) | 0.5 FTE maintainer; a volunteer-reporting workflow; Arabic and French interfaces; classroom material |
| **2 — Services** | 18 months → | (a) **Deployments for other surveys**: the same engine applies to any archive that serves FITS over HTTP Range (Euclid, Rubin, Roman, NEO Surveyor) — support and integration contracts with observatories and data centres. (b) **Planetarium and museum editions**: kiosk mode, curated guided stories, offline bundles, under institutional sponsorship. (c) **Workshops** for teachers and outreach networks. | Second developer; outreach lead; partnerships |

Stage 2 is an *open-core services* model: the software stays open source (MIT) and the public site stays free;
institutions pay for adaptation, support and guarantees — the model used by most sustainable scientific open-source
projects. Revenue is optional for survival (the burn rate is near zero) and is used only to go faster.

### Budget scenarios (annual)

| | Lean (no funding) | Funded (stage 1) |
|---|---|---|
| Hosting, domain | US$150 | US$600 (own instance, monitoring, CDN headroom) |
| Compute for the census refresh | donated cluster time | donated, or ~US$1,000 cloud credits |
| People | volunteer team | 0.5 FTE maintainer + student stipends ≈ US$45,000 |
| Outreach, workshops, translation | — | US$10,000 |
| **Total** | **≈ US$150** | **≈ US$57,000** |

## 6. Reaching users

1. **Go where they are.** Announce to the Backyard Worlds and WiseView community and on Zooniverse Talk, with
   ready-made links for their current candidates; MIRA links out to WiseView on every target and is embeddable in
   theirs. Variable-star observers through the AAVSO; professionals through Astrobites, AAS/IAU meetings and a
   short research note.
2. **Make sharing the growth loop.** Every interesting view is a URL. A volunteer who posts "look at this" brings
   the next one; Sauermann & Franzoni's skew says a few such people matter more than broad advertising.
3. **Local roots.** The team is in Morocco and the UAE: French and Arabic interfaces, workshops with university
   astronomy clubs and observatories (Oukaïmeden), and school activities built on the five challenge targets.
4. **Stay current.** SPHEREx releases data weekly; the header shows the date of the newest exposure indexed. Being
   the fastest way to look at new data is the most durable reason to come back.

**Indicators we will track (privacy-preserving, aggregate only):** positions blinked per week; share of sessions
that export or share; returning-visitor share; candidates reported to follow-up projects; papers, notes and
classroom uses that cite MIRA; time from a NASA release to its availability in MIRA.

## 7. Landscape

| Tool | Strength | What MIRA adds |
|---|---|---|
| WiseView (Backyard Worlds) | The standard blink tool; a huge trained community | SPHEREx: 102 bands, spectra, 2025–2026 epochs; sky-registered frames; NASA flags |
| IRSA SPHEREx tools | Authoritative, complete, forced photometry | Seconds instead of minutes; no expertise needed; time-ordered movie; motion |
| Aladin Lite / ESASky | All-sky context across wavelengths | Time: individual exposures rather than co-added maps |

MIRA complements all three and links to each. Its hard-to-copy assets are the wavelength-aware engine (it knows
each exposure saw a different colour), the no-server architecture, and the 16-year census.

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| NASA changes file layouts, paths or cross-origin access | Medium | Parsers read layouts from headers rather than assuming them; an automated validation run flags breakage; a 40-line optional proxy restores access if CORS is ever withdrawn |
| Catalogue services (CDS mirrors) unavailable | Medium, already observed | Three mirrors tried in turn; overlays degrade gracefully; the core movie does not depend on them |
| Maintainer loss ("bus factor") | Medium | Small documented codebase, reproducible build, validation script, permissive licence |
| No grant funding | Medium | Near-zero burn: the site stays online regardless |
| Misread results (a volunteer claims a "discovery") | Medium | Flags on every frame, blend warnings, stated limits, the word *candidate* throughout |
| Eligibility constraints of specific funders | Certain for some | Partner-led proposals; diversify across agencies and foundations |

## 9. Milestones

| When | Milestone |
|---|---|
| Month 1 | Public launch; scheduled re-index after every SPHEREx release; feedback channel |
| Month 3 | Candidate report form (exportable to Zooniverse/TNS formats); French and Arabic; mobile polish |
| Month 6 | First partner embed (a citizen-science project or an observatory outreach page); research note describing the method and validation |
| Month 12 | First grant submitted with a U.S. or European lead; classroom pack; second survey supported by the engine |
| Month 24 | Maintainer funded; yearly independent validation published |

## 10. Licence and governance

Code under MIT, documentation under CC BY 4.0, data products with their NASA/ESA attributions. Decisions are made
in the open repository; the public site carries no advertising and collects no personal data.

---

### References

1. NASA Science, *NASA volunteers double known population of brown dwarfs* (2026), and earlier Backyard Worlds:
   Planet 9 releases — volunteer numbers are reported between 150,000 and 200,000 depending on the source and date.
2. D. Muna et al., *The Astropy Problem*, arXiv:1610.03159 (2016).
3. H. Sauermann & C. Franzoni, *Crowd science user contribution patterns and their implications*, PNAS 112, 679–684
   (2015), doi:10.1073/pnas.1408907112. Hours and valuation as reported in the paper's summaries.
4. E. J. Theobald et al., *Global change and local solutions: Tapping the unrealized potential of citizen science
   for biodiversity research*, Biological Conservation 181, 236–244 (2015), doi:10.1016/j.biocon.2014.10.021.
   Published summaries quote the in-kind value differently (US$1.5–2.5 billion a year); we cite the order of magnitude.
5. Independent Sector & Do Good Institute, *Value of Volunteer Time* (2025 estimate, released April 2026): US$36.14/hour.
6. NASA ROSES open-source science elements (F.7, F.9, F.14); award sizes vary by element and year and must be
   checked in the current solicitation.

*Market and award figures above were checked against public sources in November 2026; where sources disagreed the
range is given. Projections (volunteer numbers, budgets) are our own estimates and are labelled as such.*
