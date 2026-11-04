# Spikes (Phase 0)

The six risky technical questions from [technical-design.md §16](../technical-design.md#16-spikes-phase-0). Status as of 2 Nov 2026 (later the same day, after Rust and a model were installed).

| ID | Question | Status | Result |
|---|---|---|---|
| S-1 | Transparent, non-activating overlay on a Mac with hit-area click-through | **Mostly works** | [S-1](S-1.md). The cat stands on real windows. Focus stealing at launch needed a fix. Two displays and the local model work in the log. Real clicks on the cat, Spaces, fullscreen and watching it by eye are untested. |
| S-2 | Cost of 4 Hz window polling and occlusion-aware platforms | **Works** | [S-2](S-2.md). About 1.6 ms per window read. App CPU over time not measured. |
| S-3 | Idle and typing level with no permission | **Works** | [S-3](S-3.md). No prompt. Not tried with a typist. |
| S-4 | Small-model quality for intents through Ollama | **Borderline** | [S-4](S-4.md). `gemma3:1b` passed the strict mark in 1 of 3 runs. |
| S-5 | Embedded llama.cpp in Rust | **Not run** | Rust is installed now. Not decided yet. |
| S-6 | Camera and mic in-use detection | **Partly done** | [S-6](S-6.md). No prompt, correct "false". Not tried on a real call. |

Results for each spike get written as `S-x.md` in this folder when they are run.
