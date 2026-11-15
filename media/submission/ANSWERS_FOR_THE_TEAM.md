# Answers to the three checks before submitting

Written 16 Nov 2026, 02:40 (+04), from the repository and the data files as they are on `main`.

## 1. Blind test: which numbers are final?

**Both sets describe the same, final run. Use: 459 control fields, 199 of 216 known movers found (92%), no false
alarm among 5,757 still stars.**

| Number | What it is |
|---|---|
| 459 | Control fields: 240 on known Gaia movers (0.15 to 2.5″ a year) and 219 empty fields at high latitude |
| 216 | Of the 240 movers, those that could be measured cleanly (the other 24 are blended, saturated or at the edge, and are not judged) |
| 199 | Of the 216, found blind, with the star removed from the Gaia list first: 92% |
| 5,757 | Stars that Gaia says are still; none was flagged (false alarms below 0.05% at 95% confidence) |
| 5,951 | **Not final.** An older count of the still stars that was left on the docs page. It was corrected to 5,757 on 15 Nov (`web/docs/index.html`, Accuracy) |

The submission pack, the README, the product brief and the docs page now all say 5,757. Source:
`web/public/data/verified/detector_validation.json`, summarised in `docs/15_product_brief.md`.

## 2. The scout: is 393 / 7 final?

**Yes. 393 of the 400 strongest marks are known fast-moving stars; 7 are not confirmed; none is a new object.**
The figure rose during the day because two more checks were added, each on the marks the one before had left
open. Nothing was recounted or revised downward.

| Step | Marks settled | Running total |
|---|---|---|
| Gaia DR3, tight search (30″, motion of at least 0.25″ a year) | 276 | 276 |
| SIMBAD, for the 124 that Gaia's tight search did not settle | 86 more | 362 |
| The Lab's own measurement of the last 38, with its wider Gaia lookup | 31 more | **393** |
| Not confirmed | | **7** |

Source: `web/public/data/wm/scout.json` (`gaia_check`: 276, 86, 31, `known_fast_movers` 393, `open` 7). No page or
document on `main` still says 362 or 38.

## 3. Why is the film under AI transparency?

**It stays there, for a shorter list of reasons.** The cut that is submitted no longer contains an artist's rendering:
its opening is recorded from the site's own 3D map of the stars and says "Live capture" on screen. What is still made
with AI in the film: its narration is a synthetic voice, named on the closing card; the forecast picture shown in the
Lab's Sky model panel is drawn by the team's network, and the panel says so; and the page that plays the film was
written with an AI coding assistant, like the rest of the code.

The team's AI statement in `media/submission/README.md` says the same. If the film is changed again, these must still
be true of the file that is submitted: the narration is named as synthetic, and the music credited is the music
actually used.
