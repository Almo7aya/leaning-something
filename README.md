# Learning KytyPS5

Unofficial learning material for the [KytyPS5](https://github.com/KytyPS5/KytyPS5)
PlayStation 5 emulator. The source-specific material was last checked against
**`main` at commit `7492cb9` (7 October 2026)**. The material is pinned to a commit,
not a release tag; the CMake project version at that commit is 0.3.0.

**Read it online → [almo7aya.dev/leaning-something](https://almo7aya.dev/leaning-something/)**

GitHub does not render `.html` in the web interface, so clicking a file here shows
you source. Use the link above.

---

## The platform

`docs/index.html` is the front door. Every subject is one **topic page** carrying its
explanation, the animation for that idea, an interactive tool and a checkpoint against the
real source: 20 numbered topics in six parts (foundations, loading a game, memory, execution,
graphics, working on it), C++ and implementation appendices (C1–C11 plus a glossary), a set of whole-system
simulations (one full run, a browser micro-emulator, a system explorer, the machine running),
and the Playground. The **[developer curriculum](https://almo7aya.dev/leaning-something/developer-curriculum.html)**
adds D1–D4: a coverage map and contribution gates, ELF-to-entry and PM4-to-completion
source traces, and three reproducible native C++ debugging labs.

The developer track tests range coverage, last-use lifetime bookkeeping and an
explicitly fictional output contract. It includes expected failures, reference fixes,
negative/boundary cases and an evidence-record capstone. It does not claim exhaustive
emulator coverage or turn a passing fixture into game-compatibility evidence.

**[C11: Implementing ray tracing](https://almo7aya.dev/leaning-something/t-ray-tracing.html)**
traces the implemented full-float BVH32/BVH64 software intersection path: RDNA 2
encoding, node layouts, typed IR, SPIR-V helpers, BDA access and GPU fixtures. It also
covers reverse engineering, reference math and a clearly marked optional Vulkan
ray-query design. A16/D16 and incomplete NSA forms remain unsupported; source and
fixture coverage do not establish universal game or hardware conformance.
Run `node docs/labs/raytracing-reference.cjs` to check its 27 illustrative encoding,
address and geometry cases. These are not hardware or guest-conformance tests.

The five original long-form documents are still served while their content is ported into
topics, and were updated to the same commit:

| | Audience | Length |
|---|---|---|
| **[The Lab](https://almo7aya.dev/leaning-something/lab.html)** | Learn by experimenting — you drive it | 11 tools, open-ended |
| **[The Visual Atlas](https://almo7aya.dev/leaning-something/atlas.html)** | Learn by watching — animation-led | 19 animations, ~40 minutes |
| **[The Complete Book](https://almo7aya.dev/leaning-something/course.html)** | New to emulation — assumes nothing | 39 chapters, ~3–4 hours |
| **[Architecture Guide](https://almo7aya.dev/leaning-something/tour.html)** | Already comfortable with systems programming | 15 sections, ~45 minutes |
| **[Learning Path](https://almo7aya.dev/leaning-something/path.html)** | Want to learn by doing | 7 levels, ~3 weeks part-time |

The old `kytyps5-*.html` file names redirect to these.

### The Lab

Eleven tools, none of which play on their own. Every one takes your input and computes
an answer within its stated teaching model; source-backed checks remain necessary.

| Tool | What you drive |
|---|---|
| **cpustep** | Set six argument values, run the call, then switch the callee's ABI and watch every argument become wrong |
| **vaddr** | Type any guest address; get its band, its module, its page index and the four host pages it covers |
| **allocator** | Allocate direct / flexible / pooled memory until you exhaust the budget or fragment the space |
| **memflow** | Click bytes to write as the CPU, upload, then click again and watch the page fault |
| **regdecode** | Click individual bits of `CB_COLOR0_INFO` and friends and watch named fields change meaning |
| **tileaddr** | Pick a texel and layout; see the full offset derivation and how many cache lines a bilinear fetch touches |
| **wavelab** | A simplified RDNA-style lane model — step an `if` across 64 lanes and watch `EXEC` do the branching |
| **isa2spirv** | Compare selected encoding fields, schematic IR and SPIR-V fragments; add/multiply modifiers illustrate lowering without re-encoding the base word |
| **pm4build** | Append packets and run the buffer; draw without a render target and read the error you get |
| **timeline** | Submit work against a monotonic GPU timeline, then watch completed ticks release retained resources |
| **pipekey** | Toggle pipeline state and watch the packed key, the hash, and the cache multiply — using a teaching subset of the current key |

### The Visual Atlas

Animation-led rather than prose-led. Nineteen explainers grouped into six parts — CPU,
memory, startup, threads, GPU, presentation — each stepped by hand with Back/Next or
played on demand (they start paused; Play only auto-advances while the figure is on
screen). The explanation lives in the caption, which changes with every step.

### The Complete Book

Part I teaches the background before any emulator code appears; Parts II–VII walk every
layer of the emulator with real source excerpts.

| Part | Chapters | Covers |
|---|---|---|
| I · Foundations | 1–8 | Background, assuming no prior knowledge |
| II · The skeleton | 9–12 | Layout, build, subsystems, boot sequence |
| III · Running guest code | 13–21 | ELF loading, relocation, NIDs, instruction patching, exceptions, memory, threads |
| IV · HLE libraries | 22–24 | How a console system call gets served, plus a worked example |
| V · Graphics | 25–33 | PM4, the command processor, registers, descriptors, tiling, the shader recompiler, Vulkan, coherency, presentation |
| VI · The rest | 34–36 | Audio/input/video, debugging, tests |
| VII · Reference | 37–39 | Reading order, glossary, further reading |

### Architecture Guide and Learning Path

The guide is a condensed tour: what the emulator does, a map of the codebase, boot, loader,
memory, kernel layer, HLE libraries, the three graphics layers, presentation, build and
tooling, a short learning path, and a glossary. The path is seven levels with 32 tickable
tasks against the real repository; progress is saved in your browser's local storage.

---

## Repository layout

```
docs/                          served by GitHub Pages
├─ index.html                  landing page and progress
├─ t-*.html                    the topic pages (20 topics + C1–C11 + D2–D4 + glossary)
├─ developer-curriculum.html   D1: developer gates, coverage map and capstone
├─ labs/                       optional native C++ fixtures and isolated CMake build
├─ lifetime / machine / system-explorer / browser-emulator / advanced-emulator .html   whole-system simulations
├─ loadlink / guest-run / host-run .html   step-by-step diagrams: load & link, the guest side, the host side
├─ playground.html             decode your own command buffers, modules and logs
├─ lab / atlas / course / tour / path / examples .html            the long-form documents
├─ kytyps5-*.html              redirects from the old file names
└─ assets/
   ├─ app.js, topics.js, search-index.js, tutor.js   the shell, the topic list, search, the tutor
   ├─ viz.js / atlas.js / figs.js / figures.js       the animations
   ├─ lab.js                                          the eleven input-driven tools
   ├─ playground.js, system-explorer.js, browser-emulator.js, lifetime.js, machine.js
   └─ shot-*.jpg                                      emulator screenshots (lazy-loaded)
KytyPS5/                       a plain clone of the emulator (not tracked here) used to check the material
```

The website has no build step, no dependencies and no tracking. The optional native
labs need CMake, a C++20 toolchain and the emulator source checkout. The animations consume the host page's design
tokens, so they theme themselves — light and dark both follow your system preference.

To add an animation anywhere, drop in `<figure data-viz="NAME"></figure>` and link
`assets/viz.css` + `assets/viz.js` (plus the `atlas.*` pair for the deeper set).
`viz.js` exposes `window.VIZ.register(name, fn)` so more can be added without touching it.

---

## Documentation checks

Run `node scripts/check-docs.cjs`, `node scripts/check-doc-examples.cjs`,
`node scripts/check-curriculum.cjs` and `node scripts/build-search-index.cjs`.
These validate local references, selected examples, curriculum anchors and search
headings; source paths/symbols are checked when the optional clone exists. They
cannot establish the correctness of every explanatory claim.
The ray-tracing appendix has a separate Node.js fixture check:
`node docs/labs/raytracing-reference.cjs`.

For the optional native labs, from this repository root:

```text
cmake -S docs/labs -B _Build/curriculum -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER=clang++
cmake --build _Build/curriculum
ctest --test-dir _Build/curriculum --output-on-failure
```

See [the lab setup](docs/labs/README.md) for prerequisites and source-path overrides.
The teaching baseline has seven CTest checks, including three exact expected
failures and the real upstream LRU tests. After solving a fixture, update its
expected-failure test to expect success; see D4 for the red-to-green workflow.

## Upstream snapshot

Pinned to **`main` at `7492cb9` (7 October 2026)**, CMake project version 0.3.0.
Use `git -C KytyPS5 rev-parse HEAD` to compare your checkout. The owning
lessons describe the current implementation; browser simulations remain bounded
teaching models, not the emulator itself.

## Caveats

- **Line references drift.** The checked commit is `7492cb9`; treat a reference
  as "look for this function", not "go to this line". Most pages now cite a function
  or struct name instead of a line.
- **These are unofficial.** A reading of the source, not maintainer-authored
  documentation. Where a document and the code disagree, the code is right.
- **Outbound links need a connection.** The documents work offline; the
  further-reading links obviously do not.

## Credits

[KytyPS5](https://github.com/KytyPS5/KytyPS5) is GPL-2.0-only and based on a heavily
modified version of [InoriRus/Kyty](https://github.com/InoriRus/Kyty) (MIT), and
credits [shadPS4](https://github.com/shadps4-emu/shadPS4) as a reference for the
memory model and AVPlayer. Screenshots are from the KytyPS5 repository.

Not affiliated with Sony Interactive Entertainment. No games or system software are
distributed here.
