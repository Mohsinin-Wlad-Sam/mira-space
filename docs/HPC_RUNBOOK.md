# HPC runbook — 16-Year Infrared Sky Census (for the session operating on the MBZUAI student HPC)

Read `docs/09_resources_and_flagships.md` first. **Never write credentials into files.** Never touch `~/research/` or existing conda envs.

## 0. Layout
- Code: `~/skylens` (synced copy of this repo; `rsync` from the laptop, or `git pull` once the HPC has repo access).
- Python: `~/skylens/.venv` (layered on `~/.miniconda3` base, `--system-site-packages`; adds only `astropy`, `astropy-healpix`, ~60 MB).
- Outputs: `~/skylens/census_out/tile_<N>.parquet` + `tile_<N>.qa.json` (+ `.err.txt` on failure), `run_log_shard<i>.jsonl`.
- Nodes: `ssh gpu-01` / `gpu-03` / `gpu-04` from the login node (direct, no SLURM). **gpu-02 was fully busy, so don't use it.** Check `nvidia-smi` and `uptime` first; use ≤ 8 GPUs in total and leave cores for other users (workers ≤ 96 per node, `nice -n 10` is built in).

## 1. Status (2026-11-14 03:35 +04) — census-0.5 validated, all-sky run launched
- Validation (tiles 10226/7945/11391): WISE 0855 / Barnard / ε Indi B motions pass (Δμ 0.10/0.17/0.07″/yr); methane lens ranks WISE 0855 and ε Indi B #2 among 3–5 significant isolated candidates per tile; W2 calibration scatter 6.6–9.4 %; false-flag rate 0.2 % (flags are post-processable from stored columns); 63–78 s/tile; 4–15 MB/tile (~75 GB all-sky).

### Earlier status (02:45)
- `census.tile_job` runs end-to-end on gpu-01: tile 10226 in **67 s** (WISE read 22 s / link 28 s / cube read 10 s / photometry 6 s), peak RAM ≈ few GB, output 16 MB.
- Verified: WISE 0855 blind-recovered as a fast mover, μ = (−8.22, +0.69) ± 0.03″/yr (lit. −8.12, +0.67); SPHEREx synth-W2 828 µJy at S/N 21.6; decade ratio 0.87 (no change, correct); no ghost "vanished" entry.
- Bandwidth from gpu-01: SPHEREx 1.2 Gbit/s, WISE 0.57 Gbit/s at 96 streams.

## 2. Fix log (all done in census-0.3…0.5; acceptance tests in §3 PASS on 2026-11-14 03:35)
1. **Error calibration**: flux errors are underestimated (faint 50–200 µJy objects trigger 1,958 false "brightened" flags in tile 10226). Fix: per tile, scale `sx_*` and spectrum errors by the robust std (1.4826·MAD) of `decade_z_w2` over objects with `w2_late_uJy < 150` (expected change ≈ 0).
2. **Blend groups**: WISE resolves pairs the 12.9″ cube does not, so the ridge solve splits flux arbitrarily and fakes "vanished" (637 of 5,505 objects at 200–1000 µJy). Fix: friends-of-friends of fitted objects at 1.5 cube px; evaluate decade change on group sums (SPHEREx group flux vs Σ WISE fluxes); set `blend_n`, and allow vanished/brightened only for groups whose dominant member has > 80% of the WISE flux.
3. **PSF width**: `estimate_sigma` falls back to 0.9 px in every band (isolation radius of 4 px is too strict in dense fields). Fix: choose the 150 brightest fitted objects without a neighbour brighter than 10% of them within 3 px.
4. **Noise-aware lens indices**: replace the `eps` floors with S/N-aware forms, e.g. `idx_methane_y = log10(F_win / max(F_CH4, 2σ_CH4))`, and require S/N(F_win) > 10. WISE 0855 currently ranks 446/12,978 and should land in the top few.
5. Add columns `sx_w1_err`, `sx_w2_err`, `blend_n`, `edge_dist_px`, `nhits_med` (read NHITS for ~6 representative channels only, to keep the cube read at ~110 MB).

## 3. Acceptance tests (run on the validation queue; all must pass)
```bash
cd ~/skylens && .venv/bin/python -m census.run_many --priority validation --workers 12 --out ~/skylens/census_out
```
| Test | Pass criterion |
|---|---|
| WISE 0855 (tile 10226) | reliable fast mover, μ within 0.3″/yr of (−8.12, +0.67); top-10 in `idx_methane_y` among S/N>10 objects |
| Barnard (7945), ε Indi B (11391) | reliable movers; μ within 3σ of Gaia; ε Indi B top-5 in `idx_methane` |
| False flags | after fixes: vanished + brightened ≤ 0.1% of S/N>20 objects in high-latitude tiles; every flagged object inspected visually for 3 tiles |
| Calibration | `cal_w2` scatter (p84−p16)/2 ≤ 15% for W2 > 1 mJy stars |
| Runtime | ≤ 120 s/tile wall, ≤ 6 GB RAM/worker |

## 3b. Live run log (2026-11-14)
- 02:20 census-0.5 launched: gpu-01 shard 0/3, gpu-03 shard 2/3, gpu-04 shard 1/3 (48 workers each, CPU only, 0 GPUs). ~4,500 tiles/h total.
- 02:50 hot-fix: S3 retry/backoff; a faulty "short read" check (my bug) failed 36 tiles for ~10 min, fixed live.
- 03:05 census-0.6 deployed live: NaN coverage no longer becomes zero flux (exact-zero channels 2% -> 0%), noise from real pixels only.
- **Final pass (after the three shards finish)**: on gpu-01
  `.venv/bin/python -m census.run_many --priority allsky --workers 64 --shard 0/1 --redo-older-than census-0.6 --budget-gb 180`
  reruns failed tiles and every tile written by census < 0.6.
- GPU budget (8 total): user's own vLLM servers on gpu-04 were stopped at the user's request (GPUs 0,4-7 free there); census uses none.

- 05:00 gpu-04 went offline (No route to host); its shard moved to gpu-02 CPUs. run_many no longer dies on tile timeouts; tiles written atomically; gpu-03 chained to help shard 0 in reverse.
- 05:25 AI: autoencoder trained on gpu-01 GPU 6 (1 GPU); 10.4 M spectra encoded; twins + unusual feed exported.

### After the census completes (in order)
1. Final pass (gpu-01): `run_many --priority allsky --workers 64 --shard 0/1 --redo-older-than census-0.6`
2. `python -m census.export_web` (or let web/sync_data.sh do it)
3. `python -m census.flipbook_batch --top 150 --parallel 4 --workers 16` and `python -m census.lightcurves --top 150`
4. `CUDA_VISIBLE_DEVICES=<idle> python -m census.ai_spectra encode && ... twins`

## 4. All-sky launch (after §3 passes)
```bash
# on gpu-01, gpu-03, gpu-04 (one shard each), inside tmux so it survives disconnects
tmux new -s census
cd ~/skylens && .venv/bin/python -m census.run_many --priority allsky --workers 64 --shard 0/3 --budget-gb 180 --out ~/skylens/census_out
```
- The queue is validation tiles first, then a random sky order, so any partial result is a uniform sky sample.
- Resume: rerun the same command; finished tiles are skipped.
- Monitor: `tail -f ~/skylens/census_out/run_log_shard*.jsonl`, `ls ~/skylens/census_out/*.err.txt | wc -l`, `du -sh ~/skylens/census_out`.
- Budget: stop at 180 GB of outputs (quota 1 TB shared with the HF cache ≈ 341 GB and other data). If space runs out, see `docs/hpc_hf_models.md` and **ask the owner before deleting anything**.

## 5. After the census (overnight stages B–F, see docs/09 §4)
Cross-match labels → train classifier/embedding on GPUs (`CUDA_VISIBLE_DEVICES` restricted to idle GPUs) → L2 refinement of the top ~5k candidates → LLM vetting notes (Llama-3.1-70B-AWQ on 2 GPUs, facts-only prompts) → export tiled Parquet + HiPS → sync to laptop/CDN.
