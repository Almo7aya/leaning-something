# Learning KytyPS5

Unofficial learning material for the [KytyPS5](https://github.com/KytyPS5/KytyPS5)
PlayStation 5 emulator. The source-specific material was last checked against
**`main` at commit `d2413fc2` (7 October 2026)**. The material is pinned to a commit,
not a release tag; the CMake project version at that commit is 0.3.0.

**Read it online → [almo7aya.dev/leaning-something](https://almo7aya.dev/leaning-something/)**

GitHub does not render `.html` in the web interface, so clicking a file here shows
you source. Use the link above.

---

## The platform

`docs/index.html` is the front door. **[Start here](docs/start.html)** defines one
core route: C++ essentials → machine behavior → emulation foundations → graphics
→ source walkthroughs → a verified first contribution. Existing topic URLs and IDs
remain stable; Previous/Next and home-page progress follow the core route.

Five beginner lessons (B1–B5) include complete C++20 programs, build commands,
expected output, boundary/error checks, exercises, hints and worked answers. They
need no emulator checkout or game. C1 adds a sixth runnable program for forwarding,
shared ownership and representation conversion.

The project topics retain their source explanations, animations and tools. C++ and
subsystem references are optional branches. The **[developer curriculum](docs/developer-curriculum.html)**
adds D1–D4: contribution gates, boot/draw source traces and three debugging labs.
The coverage map distinguishes introductions, guided traces and executable work;
completing the route does not imply mastery of every console behavior.

The sidebar can be hidden or shown, remembers that preference on desktop, and keeps
the active page highlighted and in view. Its scroll position is retained as you move
between pages in the same browser tab.

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

The original long-form documents remain alternate views and tools. The Start here
route defines prerequisites and learning order; the book and tour reuse generated
paragraphs from the owning topic pages:

| | Audience | Length |
|---|---|---|
| **[The Lab](https://almo7aya.dev/leaning-something/lab.html)** | Learn by experimenting — you drive it | 11 tools, open-ended |
| **[The Visual Atlas](https://almo7aya.dev/leaning-something/atlas.html)** | Learn by watching — animation-led | 19 animations, ~40 minutes |
| **[The Complete Book](https://almo7aya.dev/leaning-something/course.html)** | Project reference after basic C++ | 39 chapters; read alongside the core route |
| **[Architecture Guide](https://almo7aya.dev/leaning-something/tour.html)** | Already comfortable with systems programming | 15 sections, ~45 minutes |
| **[Learning Path](https://almo7aya.dev/leaning-something/path.html)** | Project practice after the readiness checks | 7 levels; game observations are optional integration work |

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

Part I introduces machine and emulation background; Parts II–VII walk selected
project paths with source excerpts. Start with B1–B5 if C++ is new. Reading-time
estimates are not mastery deadlines.

| Part | Chapters | Covers |
|---|---|---|
| I · Foundations | 1–8 | Emulation background; C++ basics come from B1–B5 |
| II · The skeleton | 9–12 | Layout, build, subsystems, boot sequence |
| III · Running guest code | 13–21 | ELF loading, relocation, NIDs, instruction patching, exceptions, memory, threads |
| IV · HLE libraries | 22–24 | How a console system call gets served, plus a worked example |
| V · Graphics | 25–33 | PM4, the command processor, registers, descriptors, tiling, the shader recompiler, Vulkan, coherency, presentation |
| VI · The rest | 34–36 | Audio/input/video, debugging, tests |
| VII · Reference | 37–39 | Reading order, glossary, further reading |

### Architecture Guide and Learning Path

The guide is a condensed tour: what the emulator does, a map of the codebase, boot, loader,
memory, kernel layer, HLE libraries, the three graphics layers, presentation, build and
tooling, a short reading checklist, and a glossary. The separate practice path has seven
levels against the real repository; progress is saved in browser local storage.
Use it after the beginner readiness checks, alongside the developer gates.

---

## Repository layout

```
docs/                          served by GitHub Pages
├─ index.html                  landing page and progress
├─ start.html                  core route, readiness questions and code-example guide
├─ b-*.html                    five beginner lessons with generated runnable listings
├─ content/                    canonical route/status metadata and authoring instructions
├─ t-*.html                    the topic pages (20 topics + C1–C11 + D2–D4 + glossary)
├─ developer-curriculum.html   D1: developer gates, coverage map and capstone
├─ labs/                       source-dependent developer fixtures
│  └─ beginner/                standalone C++20 fixtures; no emulator dependency
├─ lifetime / machine / system-explorer / browser-emulator / advanced-emulator .html   whole-system simulations
├─ loadlink / guest-run / host-run .html   step-by-step diagrams: load & link, the guest side, the host side
├─ playground.html             decode your own command buffers, modules and logs
├─ lab / atlas / course / tour / path / examples .html            the long-form documents
├─ kytyps5-*.html              redirects from the old file names
└─ assets/
   ├─ app.js, topics.js, search-index.js             the shell, the topic list and search
   ├─ viz.js / atlas.js / figs.js / figures.js       the animations
   ├─ lab.js                                          the eleven input-driven tools
   ├─ playground.js, system-explorer.js, browser-emulator.js, lifetime.js, machine.js
   └─ shot-*.jpg                                      emulator screenshots (lazy-loaded)
KytyPS5/                       a plain clone of the emulator (not tracked here) used to check the material
```

The committed website can be served directly and has no runtime dependencies or
tracking. Authoring uses dependency-free Node.js generators for shared prose,
navigation, example listings and search. Native labs need CMake and a C++20
toolchain; only the developer labs need emulator source. Animations follow the
host page's light/dark design tokens.

To add an animation anywhere, drop in `<figure data-viz="NAME"></figure>` and link
`assets/viz.css` + `assets/viz.js` (plus the `atlas.*` pair for the deeper set).
`viz.js` exposes `window.VIZ.register(name, fn)` so more can be added without touching it.

---

## Documentation checks

After editing an owning topic or `docs/content/learning.json`, regenerate derived
content, then run the read-only checks:

```text
node scripts/build-docs.cjs --write
node scripts/build-search-index.cjs --write
node scripts/build-docs.cjs
node scripts/check-docs.cjs
node scripts/check-doc-examples.cjs
node scripts/check-curriculum.cjs
node scripts/check-beginner.cjs
node scripts/build-search-index.cjs
```

These check shared excerpts, route/prerequisite ordering, local references, selected
examples and search headings. Source paths/symbols are checked when the optional
clone exists. They cannot establish the correctness of every explanatory claim.
See [authoring instructions](docs/content/README.md) for ownership of generated
regions and how to label runnable code, project excerpts and pseudocode.

For the standalone beginner programs:

```text
cmake -S docs/labs/beginner -B _Build/curriculum/beginner -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER=clang++
cmake --build _Build/curriculum/beginner
ctest --test-dir _Build/curriculum/beginner --output-on-failure
```

All six executable checks require successful exit and matching output, with
additional boundary conditions inside the fixtures. See [beginner setup](docs/labs/beginner/README.md).

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

Pinned to **`main` at `d2413fc2` (7 October 2026)**, CMake project version 0.3.0.
Use `git -C KytyPS5 rev-parse HEAD` to compare your checkout. The owning
lessons describe the current implementation; browser simulations remain bounded
teaching models, not the emulator itself.

## Caveats

- **Line references drift.** The checked commit is `d2413fc2`; treat a reference
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
