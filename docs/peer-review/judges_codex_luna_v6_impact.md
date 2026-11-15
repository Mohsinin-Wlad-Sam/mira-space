## 1. IMPACT AND PITCH

The map-first pitch is clearer and more inviting than “a table of candidates.” The concrete promise is easy to grasp: click a dot, compare two survey images, see a measured path. But “opens it to everyone” and “only specialists can read” overstate the problem: the tool makes analysis easier; it does not establish that the data were previously inaccessible to the public. “Every point is a real star at its real distance” also needs qualification because some distances are estimates or provisional.

The volunteer comparison is a precedent, not evidence that MIRA has public impact. MIRA’s answers stay in browser storage until someone manually sends them through a GitHub issue link. That is a working prototype flow, but the team has not shown that answers are collected, reviewed, or used to validate candidates. Calling the objects “unknown” risks implying undiscovered worlds when the copy also says they are confirmed movers.

**Single highest impact change:** make the contribution loop real and demonstrate it: a simple submission path, a stated review process, and a visible example of how a submitted answer affects follow-up. Until then, pitch participation as a prototype.

External claims: NASA’s Backyard Worlds precedent is **VERIFIED** in the cited NASA reference; “about 6 billion people are online” is **VERIFIED** as an ITU statistic, but it does not establish MIRA’s audience or likely impact.

## 2. PRODUCT AND UX

The intro gives a lay visitor a useful first action—“Show me one”—and the object card explains the pictures and measured path. That’s a promising ten-second start. The first screen still has competing layers: 3D controls, display modes, filters, a timeline, live sky, and wavelength controls. A new visitor may not know which controls matter or whether they’re looking at a map of the sky or a physical model around the Sun.

Cards mix useful plain-language cues with specialist concepts: Gaia, parallax, spectral class, temperature, and distances that can be estimated or provisional. The answer prompt says to look for a dot inside a circle, but the card’s slider shows no post-2010 image; the dashed path and circle may look like evidence from a later observation when they are a motion prediction.

Tables are appropriately kept for deep analysis and the catalogue. The Lab’s source and exposure tables are dense, but the product brief already describes vectors on the image; make the image the obvious entry point and leave rows as supporting evidence.

**Best quick UX change:** add a short, visible legend beside the map explaining what a dot, orange marker, path, and dashed segment mean, then make “Show me one” the dominant first action.

## 3. TECHNICAL AND SCIENCE RISK

The clearest copy risk is calling the 1999→today card a sequence of “two real pictures” that “show it moving.” Only 2MASS and WISE images are loaded there; after 2010 the image dims while the circle follows an extrapolated measured path. The UI does disclose “No picture after 2010 here,” but the headline risks implying SPHEREx imagery is shown in that card. Say “compare two images; follow the measured path to today.”

Participation is fragile as an impact mechanism: answers are local until the user manually opens a GitHub issue, and the link is a personal report, not a collection or adjudication system. The map also states “too cold or too faint for visible light” when Gaia has no source; absence from Gaia alone does not distinguish those causes. Likewise, “some are cold worlds” should be framed as candidates or possibilities, not established identities.

Assistant risk: the server prompt says map distances are at each star’s distance and the assistant should base claims on page data, but map state only exposes distance notes for the selected object. Its tools can navigate and select, yet the returned context may not support broad claims about the full map. Keep answers tied to the selected card.

**External claim:** “SPHEREx re-images the whole sky every six months” is **UNSURE** from the inspected project files; verify against current mission documentation before using it as a pitch fact.

## Ranked changes (each under 45 minutes)

1. Replace “two pictures show it moving” with wording that distinguishes the two images from the predicted path to today.
2. Change Gaia absence explanations from “too cold or too faint” to “not listed in Gaia.”
3. Add a map legend for markers, colors, predicted paths, and image dates.
4. Label unnamed objects as “uncharacterized candidates,” not implied undiscovered worlds.
5. Describe answer buttons as a prototype and state clearly that submission opens a GitHub issue.
6. Remove the online-population figure as a proxy for MIRA’s audience; add a concrete pilot target or a plan to measure actual participation.