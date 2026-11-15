# 13 · Business plan — MIRA, the moving sky opened to everyone

**In one sentence.** MIRA lets anyone with a browser see what moves in the sky NASA's SPHEREx is photographing, and
gives those who want to go deeper research-grade measurements from the same public archive, without telescope
time, software or a server; it is free to the public because serving it costs almost nothing, and it is paid for by
open-science and education grants and by institutions that want the same instruments, or the same verification
run, on their own data.

**Impact, before money.** The return on a public mission of about US$488 million [12] is measured in how many
people can use its data. Today that is a few thousand specialists. MIRA widens it in three steps, each with an
existing sign that the audience is there: the curious public (the map runs in a phone browser; the 6 billion
people online [13] bound the reach, they are not our audience); classrooms without a telescope (online-observatory memberships are already sold to schools,
section 1); and citizen scientists (150,000 volunteers helped NASA find about 3,000 brown dwarfs by spotting
moving dots in older images [1]). What we will count after launch: visitors who open an object's card, answers
sent on the 635 objects with no Gaia source and no SIMBAD entry and how many of those several visitors agree on, classrooms
that complete the "measure a star" exercise, and fields measured in the Lab. First pilot: one month, three
classrooms and an open call; target: 200 of the 635 objects looked at by at least five visitors. The take-part
flow is a prototype today: answers are recorded, with no account, by the same small optional process that serves
the assistant, and the card shows the tally; at scale it would move to a Zooniverse project.

**Positioning.** *MIRA turns public SPHEREx exposures into measured, shareable evidence about any source: an
instrument bench in the browser and a survey verified on raw NASA data.* Planet X — an unknown cold body near the
Sun, betrayed only by its motion — is the motivating problem; the instruments serve any star, brown dwarf or
variable source.

---

## 1. What exists today, and what people pay for

| What | Who uses it | What it costs the user | Source |
|---|---|---|---|
| **Science platforms of the archives** (NOIRLab Astro Data Lab, IRSA, ESASky): query services and hosted notebooks on survey data, tables up to 65 billion rows | professional astronomers who can code | free; funded by the agencies | [7] |
| **Telescope time on a robotic network** (Las Cumbres Observatory) | research groups, universities | US$450/hour on the 1-m network (+US$3,500 fee below 100 h/yr), US$250/hour on the 0.4-m | [8] |
| **Remote telescopes for individuals** (iTelescope) | advanced amateurs | plans from US$40 to US$490 per 28 days; hourly rates per telescope | [9] |
| **Online observatory memberships** (Slooh) | the public, schools, colleges | US$50 to US$500 a year; college courses from US$30 per student per year | [10] |
| **Citizen-science blinking** (WiseView / Backyard Worlds) | 150,000–200,000 volunteers | free; grant-funded | [1] |
| **Discovery from archives with cloud computing** (Asteroid Institute + Google Cloud: 27,500 new asteroid candidates from 5.4 billion archival observations) | — | philanthropy and cloud credits | [11] |

Two things follow. People and institutions do pay for *measurements of the sky* — hundreds of dollars per hour of
telescope time, tens to hundreds per year for access. And nobody pays for an archive browser: the platforms that
serve data are free and institutionally funded. MIRA therefore does not charge its users; it sells what
institutions already buy — capability on their own data, and time saved.

What is missing between these offers is what MIRA does: **measurement without code and without telescope time**.
The archives' platforms assume the user writes the analysis; the blinking tools show pictures and leave the
measuring to the eye; telescope time costs money and months. MIRA reads the raw exposures a mission has already
taken and returns calibrated numbers, plots and a verdict in under a minute.

## 2. The product

| Part | What it does | Why it is hard to copy |
|---|---|---|
| **The two maps (Sky and Space)** | The front door, for everyone. Sky: tonight's planets on the whole sky, the visitor's own horizon, three NASA surveys on one time bar with SPHEREx's picture filling in on the dates it was taken, any place played through time. Space: the Sun's neighbourhood in 3D with the planets moving on their orbits and every confirmed mover on a card with three real pictures. Both embed on another page with one line | The planets alone are easy to copy; the rest needs the verified catalogue, the exposure index (which dates each part of SPHEREx's survey) and the engine that reads NASA's exposures in the browser |
| **The Lab** | For any field: a table of what moved or changed (calibrated on the Gaia stars of that same field, compared with 2010 and 1999), position against time, a 0.75–5 µm spectrum, a brightness history, the depth reached, a time view the user steers, exports (CSV, FITS, Python) | SPHEREx never images a place twice at the same wavelength: the engine has to know the wavelength of every pixel, decode NASA's compressed flag tables and register 6″ pixels to a tenth of a pixel, in the browser. Validated against Astropy and Gaia. |
| **The verified catalogue** | 39.9 billion WISE detections → 1.56 million survey claims → 202,528 re-measured on raw SPHEREx exposures → 17,604 motions that pass (away from the Galactic plane 88% are known Gaia stars with the same motion, the rest to examine), 44 methane objects, 17 real brightness changes (blazars, a supernova, a young star) | Needs a cluster run and the engine above; refreshed after each data release |
| **The assistant** | Reads the page and operates the instruments in plain language | Bound to the instruments' own numbers; runs behind a small proxy on any OpenAI-compatible model |
| **Cases** | The user's measurements, notes, lists and exports, kept in their browser | — |

## 3. Why the economics work

| Cost | How it is avoided or bounded |
|---|---|
| Storing and serving the images (SPHEREx Level-2 is ~100 TB and growing) | Not ours: the pixels stay in NASA's public cloud bucket; the browser reads the few rows it needs with HTTP Range requests |
| Servers | None for the instruments. Static files: app (~4 MB), exposure index (192 MB), verified catalogue (3.5 MB) |
| The assistant | The only variable cost: one small proxy (40 MB of memory) and model usage, capped per address and per day |
| Heavy computing | One-off and offline, on a university cluster: the verification of 202,528 objects took about 50 minutes on three nodes. Re-indexing a new release takes a minute |
| Per-user cost | Effectively zero: no accounts, no database, no personal data |

**Running cost, lean scenario: under US$150 a year** (a domain and a small instance), plus model usage if the
assistant is enabled. What costs money is people: keeping the code working as NASA's formats evolve, and supporting
users. *The Astropy Problem* (Muna et al. 2016 [2]) documents how the software astronomers depend on went unfunded;
MIRA's design answer is to need little upkeep (no backend, formats read from the files, validation scripts), and
its funding answer is below.

## 4. Who pays, and for what

The public never pays and is never the product: no advertising, no tracking, no data sales. What is paid for is
work saved for institutions; the offers below are packaged as three plans (see “Plans” further down).

| | Offer | Buyer | Reference point for the price |
|---|---|---|---|
| **A. Grants** | The public site, new-release verification runs, training material | NASA ROSES open-science and citizen-science elements with a U.S. partner as lead [6]; European and regional programmes; foundations | comparable open-source elements have made awards of about US$100,000 [6] |
| **B. Verification as a service** | A survey team hands over a candidate list; MIRA returns each one re-measured on raw exposures with a verdict and evidence (the run behind our own catalogue) | brown-dwarf, variable-star and transient groups; citizen-science projects with backlogs | the researcher weeks it replaces, not telescope time: no telescope sold by the hour observes at 3–5 µm from the ground (a 1-m optical telescope costs US$250–450 per hour [8] and cannot do this), so the real alternative is a student writing and validating a pipeline against the same archive. The code is open, so a group with its own cluster can run it; what is offered is the run, its upkeep at each data release and the validation behind it |
| **C. The engine on other archives** | Adapting the zero-server cutout-and-measure engine to another archive that serves FITS over HTTP | archives and data centres with cloud-hosted surveys | integration and support contracts; each archive differs in format and access policy, so this is real engineering, priced per project |
| **D. The Lab for teaching** | A site licence with exercises in Arabic, French and English built on real NASA data, kiosk mode for planetariums, and the live Sky map (tonight's planets, the survey's progress) embedded on the institution's own page | universities, observatories, science centres in the region | Slooh's education tier: from US$30 per student per year [10] |

Order matters: A keeps the public site alive. B already exists (we ran it), but because the pipeline is open and
its users are research groups, we expect it to be paid for mostly as a work package inside a grant shared with the
group that needs it, not as a standalone invoice. C and D follow from requests. Revenue is optional for survival
(the burn is near zero) and buys speed.

**What we have not done yet.** No customer has been interviewed and no contract exists: demand for B–D is a
hypothesis. The first step after the hackathon is to offer the verification run, free, to two research groups and
one citizen-science project, and to measure hours saved and candidates confirmed.

### Plans: how the offers are packaged

The product has three depths, and the plans follow them. The first is the whole public site. The second is a set of
researcher tools that already exist in the Lab behind a switch (free while MIRA is a prototype). The third is work
done for an organisation on its own data.

| Plan | For | What it adds | Paid how |
|---|---|---|---|
| **Explorer** | everyone: the public, classrooms, volunteers | Both maps (live planets, the visitor's own sky, SPHEREx by date, what the sky is made of), the Lab with all its instruments, the catalogue, the assistant, links and embeds | Free. Kept alive by grants (offer A) |
| **Researcher** | research groups, advanced amateurs, university courses | Watchlists (a list of targets through the Lab's whole chain in one run, exported as a table), the sky world model (a network's forecast of a field and what it did not expect), bulk exports and the data files with support, workspaces shared across a group, exercises on real NASA data in Arabic, French and English (offer D) | A seat or a site licence; free for students and for volunteers who classify. Reference points: Slooh's education tier from US$30 per student per year [10]; remote-telescope plans from US$40 per 28 days [9] |
| **Mission** | agencies, mission teams, archives, science centres | Verification runs on the organisation's own candidate lists at each data release (offer B); the engine adapted to its archive (offer C); a world model trained on its survey, so that each new visit is compared with what the model expected and only the surprises reach a person; private deployment, kiosk mode, support | Per project, mostly as a work package inside a shared grant |

Two things make the tiers credible rather than a price list. First, the researcher tools are built and run today:
the watchlist measures a list in the browser, and the world model (trained in 24 minutes on one of our
university's GPUs on 2,400 real picture pairs, tested on 984 real fast-moving stars it had never seen: half of
them found, 79% of those moving 1 to 2 arcseconds a year, 0.3 false marks per field) runs in the visitor's
browser with no server. Second, nothing in the Explorer plan is held back to sell the others: the paid plans
sell runs, upkeep and adaptation, not access to NASA's data.

**Status.** No price has been tested with a customer. The switch in the Lab is a preview, not a paywall.

### Budget scenarios (annual, our own estimates)

| | Lean (no funding) | Funded (stage A) |
|---|---|---|
| Hosting, domain | US$150 | US$600 (own instance, monitoring, CDN headroom) |
| Compute for verification runs | donated cluster time | donated, or ~US$1,000 cloud credits |
| Assistant model usage | provider allowance, capped | budgeted and capped |
| People | volunteer team | 0.5 FTE maintainer + student stipends ≈ US$45,000 |
| Outreach, workshops, translation | — | US$10,000 |
| **Total** | **≈ US$150** | **≈ US$57,000** |

## 5. Staying useful: new data and the user's own data

- **New NASA data.** SPHEREx re-observes the whole sky every six months. One script rebuilds the exposure index
  after each release; every instrument then reads the new exposures, saved cases show a "new data" badge, and the
  verification run re-tests open claims. Each visit lengthens the baseline, so motions get better with time.
- **The user's own data.** Cases stay in the user's browser and travel as files (JSON, CSV, FITS, a Python
  snippet that reproduces the cutouts). A list of targets can be measured in one go. Nothing is uploaded, so there
  is no privacy cost and no storage cost.
- **Formats that change.** Header lengths, flag definitions and pipeline versions are read from each file;
  catalogue services have mirrors and fail in place; validation scripts flag breakage.

## 6. Why volunteers and evidence matter (from the economics of citizen science)

1. Volunteer effort is valuable and concentrated: in seven Zooniverse projects the top 10% of contributors did
   about 80% of the work, and most visitors contributed once (Sauermann & Franzoni 2015 [3]). Hence: results in
   under a minute without sign-up, and real tools (tables, exports, links, flags) for the dedicated few.
2. Most citizen-science effort never reaches a paper; what predicts publication is verifiable, standardised,
   accessible data (Theobald et al. 2015 [4]). Hence: every number traces to named NASA exposures, exports are
   standard formats, and each view has an address.

## 7. Reaching users

1. **Go where they are**: the Backyard Worlds / WiseView community (MIRA links to WiseView for every field and can
   be embedded in theirs), variable-star observers, brown-dwarf groups; a short research note on the method.
2. **Sharing is the growth loop**: every field is a URL, every table a file.
3. **Local roots**: the team is in Morocco and the UAE — Arabic and French interfaces, workshops with university
   astronomy clubs and observatories.
4. **Stay current**: being the fastest way to measure new SPHEREx data is the most durable reason to return.

**Indicators (aggregate, privacy-preserving):** fields measured per week; share of sessions that export or save a
case; candidate lists verified for partners; papers, notes and courses that cite MIRA; days from a NASA release to
its availability.

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| NASA changes file layouts, paths or cross-origin access | Medium | Layouts are read from headers; validation scripts flag breakage; the proxy can relay archive requests if CORS is ever withdrawn |
| Catalogue services unavailable | Medium, observed | Three mirrors, one retry, a clear message; the SPHEREx-only measurements do not depend on them |
| Over-claiming | Medium | Verdicts need 5σ against the field's own Gaia scatter; blends and saturated sources are not judged; rows are "confirmed motions", candidates stay candidates; limits are printed |
| The assistant states something false | Medium | It receives the page's numbers and is told to use only those; the panels remain the reference and the page says so |
| Maintainer loss | Medium | Small documented codebase, reproducible runs, permissive licence |
| No grant funding | Medium | Near-zero burn: the site stays online regardless |
| No paying demand for B–D | Unknown | Tested with free pilots before any investment |

## 9. Milestones

| When | Milestone |
|---|---|
| Month 1 | Public launch; re-index after every SPHEREx release; feedback channel |
| Month 3 | Verification pilot with two research groups and one citizen-science project; French and Arabic |
| Month 6 | Research note on the method and the verified catalogue; first teaching deployment |
| Month 12 | Grant submitted with a U.S. or European lead; second archive supported by the engine |
| Month 24 | Maintainer funded; yearly verification run and independent validation published |

## 10. Licence and governance

Code under MIT, documentation under CC BY 4.0, data products with their NASA/ESA attributions. *(The repository
does not yet contain a LICENSE file: the team must add one.)* The public site carries no advertising and collects
no personal data.

---

### References

1. NASA Science, *NASA volunteers double known population of brown dwarfs* (2026), and earlier Backyard Worlds:
   Planet 9 releases — volunteer numbers are reported between 150,000 and 200,000 depending on source and date.
2. D. Muna et al., *The Astropy Problem*, arXiv:1610.03159 (2016).
3. H. Sauermann & C. Franzoni, *Crowd science user contribution patterns and their implications*, PNAS 112, 679–684
   (2015), doi:10.1073/pnas.1408907112.
4. E. J. Theobald et al., *Global change and local solutions: Tapping the unrealized potential of citizen science
   for biodiversity research*, Biological Conservation 181, 236–244 (2015), doi:10.1016/j.biocon.2014.10.021.
5. (not used in this version)
6. NASA ROSES open-source science elements (F.7, F.9, F.14); award sizes vary by element and year and must be
   checked in the current solicitation.
7. NOIRLab Astro Data Lab, https://datalab.noirlab.edu — free accounts, hosted notebooks; R. Nikutta et al.,
   arXiv:2104.06527 (tables from 500,000 to 65 billion rows).
8. Las Cumbres Observatory, *Purchasing network time*, https://lco.global/sales/networktime/ (price list updated
   27 February 2024).
9. iTelescope.net membership plans, https://www.itelescope.net (one point = US$1; plans per 28 days).
10. Slooh pricing, https://slooh.com/pricing and https://education.slooh.com/pricing (figures differ between pages
    and dates; the range is quoted).
11. B612 Foundation, *Asteroid Institute and Google Cloud identify 27,500 new asteroids*, press release, 30 April
    2024 (candidates, pending confirmation; THOR algorithm on the ADAM platform).
12. NASA/JPL, SPHEREx press kit, quick facts: lifecycle cost of about US$488 million,
    https://www.jpl.nasa.gov/press-kits/spherex/quick-facts/
13. ITU, *Facts and Figures 2025* (17 November 2025): about 6 billion people online, 74% of the world,
    https://www.itu.int/en/mediacentre/Pages/PR-2025-11-17-facts-and-figures.aspx

*Prices and figures from other organisations were read from their public pages in November 2026 and may change;
where pages disagreed the range is given. Budgets and milestones are our own estimates.*
