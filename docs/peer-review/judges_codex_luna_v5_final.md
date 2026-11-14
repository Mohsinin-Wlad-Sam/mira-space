### 1. TECHNICAL — NASA archive software engineer

The field detector has useful safeguards, but its labels still outrun some of its evidence. It caps the source list at 90 and requires a candidate to persist within 1.5 pixels between visits; faint or fast blended sources can disappear before classification. The “NEW” and “GONE” labels also need to say that they mean unmatched across the available catalogs and exposures, not newly formed or vanished objects. The UI does say “gone?” in one table, but that caution should be consistent.

The Lab is manually controllable, yet playback remains available, conflicting with the stated goal that nothing auto-plays. Motion and parallax fits can appear on a small number of epochs; the UI gives thresholds and caveats, but a plot should identify the fitted data and show units directly on its axes. Some rows depend on hover titles or explanatory text elsewhere, so marks are not always self-explanatory.

The assistant proxy keeps the key server-side and has request limits, but trusts `X-Forwarded-For` for rate limiting and does not validate tool-call names or arguments against an allowlist before returning them to the browser. This is not a direct server-side tool execution path—the browser dispatches tools—but spoofable client IPs weaken the limit, and unchecked model output makes the client-side instrument actions brittle. **UNSURE** whether the deployed proxy’s upstream configuration constrains forwarded headers.

### 2. SPACE SCIENCE — infrared astronomer

The “which sources moved, how fast, how far away, what their spectrum says” headline implies routine distance and physical classification. In the Lab, SPHEREx-only parallax is explicitly described as indicative or below 5σ, while catalogue parallax supplies some distances; a spectrum and methane-like dip do not by themselves identify an object as a cold brown dwarf. Qualify those claims in the README and submission. The claim that Planet X “will be found the way Pluto was” is also too definite; Pluto is a historical analogy, not evidence that this workflow can find a proposed distant planet.

The 364-field validation is presented with useful denominators, but “98%” applies only to 170 of 173 *cleanly measured* movers. The 4,665 stationary Gaia stars are not an independent set of randomly selected negatives, and the ~11,500 sources without Gaia motions cannot establish a false-positive rate; call 0.2% an observed flag fraction, not a general upper bound. In `validate_detector.mts`, failed fields and catalog-unavailable cases are excluded from those rates. State the selection and failures alongside the headline metrics.

The verification funnel is commendably candid about non-detections, unrelated sources and crowded fields. A referee will ask for the field/candidate selection function, reproducible inputs and outputs, uncertainty calibration, and an independent rerun of the raw-exposure confirmation—especially for the 907 without matching Gaia motion and the 41 red unnamed objects. **UNSURE** whether all reported funnel counts can be reproduced from the checked-in repository: the README says the exposure index and verified catalogue are not in git.

### 3. BUSINESS — programme manager

The plan is more coherent and honest: public access is free, grants are the core funding path, paid verification is an explicitly unvalidated offer, and the team admits that no customer interviews or contracts exist. The weakest point is sustainability through people: “near-zero burn” covers hosting, not the maintainer time required to keep archive formats, validation and support working. The plan acknowledges this, but its lean scenario still depends on donated labor and cluster access.

**First-slide sentence:** “MIRA turns public SPHEREx exposures into a shareable measurement of what moved in any field—and shows the evidence behind it.”

### Ranked changes for the next 12 hours

1. Rewrite the README and submission headline to qualify distance, spectra and identification as conditional measurements, not guaranteed outputs (under 1 hour).
2. Label “new” and “gone” as catalog-matching outcomes and add a short explanation of the 90-source cap and persistence requirement (under 1 hour).
3. Put axis labels and units on every Lab plot, and ensure each plotted mark has a visible legend or direct explanation (under 1 hour).
4. Revise the validation summary to report failed/unavailable fields and define 98% and 0.2% strictly for the tested subsets (under 1 hour).
5. Add a short reproducibility note naming the inputs, outputs and selection rules needed to rerun the verification funnel (under 1 hour).
6. Restrict proxy rate-limit identity to trusted proxy headers and validate assistant tool names and arguments before client dispatch (under 1 hour).

**Earlier concerns now resolved:** The product has a clearer purpose centered on finding and measuring motion, with Planet X framed as motivation; the business plan now names plausible funding routes and explicitly labels institutional demand as untested; the verification funnel excludes survey-level lists that did not survive raw-exposure checks; and the assistant is designed to operate the Lab and Catalogue rather than only explain them.
