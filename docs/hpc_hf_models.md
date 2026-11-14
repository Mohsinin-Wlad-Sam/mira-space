# HPC Hugging Face cache inventory (`~/.cache/huggingface/hub`, measured 2026-11-14 02:30 +04)

Nothing has been deleted. Restore tooling already exists in `~/hf_cache_restore/` (manifest 2026-11-12). Models are unmodified upstream weights, so any of them can be re-downloaded with `huggingface-cli download <repo>`.

| Size (GB) | Model repo | Use for SKYLENS | If space is needed |
|---|---|---|---|
| 65.5 | Qwen/Qwen3-32B | – | deletable (re-download) |
| 55.6 | Qwen/Qwen3.8-27B | – | deletable |
| 54.9 | google/gemma-3-27b-it | **F6 vetting notes (option A)** | keep one of Gemma-27B / Llama-70B-AWQ |
| 39.8 | hugging-quants/Meta-Llama-3.1-70B-Instruct-AWQ-INT4 | **F6 vetting notes (option B, preferred: fits 2× 32 GB GPUs)** | keep |
| 29.5 | Qwen/Qwen3-14B-Base | – | deletable |
| 24.5 | mistralai/Mistral-Nemo-Instruct-2407 | F5 text-to-SQL drafts (small, EU-origin) | keep if space allows |
| 19.3 | Qwen/Qwen3.5-9B | – | deletable |
| 16.4 | Qwen/Qwen3-8B | – | deletable |
| 16.4 | Qwen/Qwen3-8B-Base | – | deletable |
| 16.1 | meta-llama/Llama-3.1-8B-Instruct | F5/F6 fast fallback | keep |
| 3.2 | microsoft/deberta-v3-large | – | deletable |
| 0.1 | sentence-transformers/all-MiniLM-L6-v2 | F5 schema retrieval | keep |
| 0.0 | Qwen3-Embedding-8B, Qwen3-4B-Base, granite-4.1-30b, granite-4.1-30b-fp8, granite-4.1-8b-fp8, Llama-Guard-4-12B, GLM-5.3, datasets/ZBox008003/AFTraj | – | empty entries already (refs only) |
| **≈ 341** | **total** | | |

Deletion order if the census needs room (ask the owner first; these may be in use for the directed-research paper): Qwen3-32B → Qwen3.8-27B → Qwen3-14B-Base → Qwen3-8B(-Base) → Qwen3.5-9B → deberta → (≈ 220 GB freed).
Note: for SKYLENS's own AI features we prefer non-Chinese-origin models (Llama, Gemma, Mistral, Granite) because NASA's eligibility review covers Chinese-owned entities.
