# 07 · Super-Intelligence (SI/AI) tool usage log

NASA Space Apps requires each submission to describe how SI tools were used. Keep this log current during the build; it becomes the submission's SI statement.

| When | Tool | Used for | Human verification |
|---|---|---|---|
| 2026-11-14 | Claude Code (Anthropic, Opus 5.5) | Challenge/rules analysis, literature search (arXiv API), data-access benchmarking, feasibility scripts, PoC range reader, drafting docs | Every arXiv ID was checked against the arXiv API; every data number was measured by scripts in `scripts/` |
| 2026-11-14 | K2 Horizon 375B (IFM/MBZUAI, via opencode) | Critical peer review of concept v0.1 | Fact-checked; several errors rejected (see `peer-review/00_synthesis.md`) |
| 2026-11-14 | Antigravity CLI | Critical peer review of concept v0.1 | Fact-checked; wrong arXiv IDs and wrong band claims rejected |
| 2026-11-14 | Codex CLI (gpt-6-luna), Antigravity, K2 Horizon | Independent ideation of broader concepts + critique (`docs/ideation/`) | Proposals fact-checked; PoCs (`scripts/poc/lens_poc.py`, `decade_lens_poc.py`) run on real data before adoption |
| 2026-11-14 | Claude Code (Anthropic, Opus 5.5) | Census pipeline, web app, flipbook/light-curve/AI scripts, HPC orchestration, debugging | Every pipeline stage validated on real data (known proper motions, light curves, spectra); bugs found by checks are documented in commit history |
| 2026-11-14 | SKYLENS's own model (PyTorch autoencoder, trained by us on 3 M SPHEREx spectra, 1 GPU, 88 s) | Spectral fingerprints for "twins" and "Unusual" lens | Twins of ε Indi B verified to be methane dwarfs; anomaly score made S/N-independent after inspection |

| 2026-11-14 | Antigravity CLI (Argon) and Codex CLI (gpt-6-luna) | "Council" code review of the web app for scientific accuracy, UX and challenge fit (`docs/peer-review/council_*.md`) | Each finding checked against the code before acting; fixes listed in commit 14faeae |
| 2026-11-14 | Claude Code (Anthropic, Opus 5.5) | AI physics ensemble, 3D Space, live NASA data layers, in-browser SPHEREx flipbook, Lab, candidate search | Planet/Moon/spacecraft positions checked against JPL Horizons; star positions against Gaia/Hipparcos; candidate selection checked by its recovery of 125 known brown dwarfs |

Gemini CLI not used (team preference: Antigravity instead). Volcano Engine/Doubao: allowed by the team as reviewers on 2026-11-14; any use will be recorded here.
