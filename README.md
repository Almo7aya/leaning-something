# Learning KytyPS5

Unofficial learning material for the [KytyPS5](https://github.com/KytyPS5/KytyPS5)
PlayStation 5 emulator, written by reading the source tree at **v0.2.2**.

**Read it online → [almo7aya.dev/leaning-something](https://almo7aya.dev/leaning-something/)**

GitHub does not render `.html` in the web interface, so clicking a file here shows
you source. Use the link above.

---

## The four documents

| | Audience | Length |
|---|---|---|
| **[The Visual Atlas](https://almo7aya.dev/leaning-something/kytyps5-atlas.html)** | Learn by watching — animation-led | 19 animations, ~40 minutes |
| **[The Complete Book](https://almo7aya.dev/leaning-something/kytyps5-book.html)** | New to emulation — assumes nothing | 39 chapters, ~3–4 hours |
| **[Architecture Guide](https://almo7aya.dev/leaning-something/kytyps5-guide.html)** | Already comfortable with systems programming | 15 sections, ~45 minutes |
| **[Learning Path](https://almo7aya.dev/leaning-something/kytyps5-learning-path.html)** | Want to learn by doing | 7 levels, ~3 weeks part-time |

They overlap on purpose. The atlas is the fastest way in if you prefer watching to
reading; the book is written to stand alone, so you never need to switch mid-topic.

### The Visual Atlas

Animation-led rather than prose-led. Nineteen explainers grouped into six parts — CPU,
memory, startup, threads, GPU, presentation — each auto-playing while on screen and
steppable by hand. The explanation lives in the caption, which changes with every step.

Twelve of the nineteen are specific to this document and go deeper than the shared set:
interpreter cost vs native execution, the calling-convention mismatch with a wrong-ABI
demonstration, the `fs:[0]` byte-level rewrite, the exception handler's four branches,
address bands filling with real allocations, 16 KB pages over 4 KB pages, ELF segments
being mapped and patched and protected, NIDs resolving into GOT slots, a PM4 stream
being consumed while the register file fills, 57 queues with one blocked submission,
the pointer chase from user data to a bound Vulkan image, and the flip model.

### The Complete Book

Part I teaches the background before any emulator code appears: what an emulator is,
the PS5 as hardware, x86-64 calling conventions, virtual memory, ELF and dynamic
linking, how a GPU actually draws, and Vulkan/SPIR-V. Parts II–VII then walk every
layer of the emulator with real source excerpts (~120 code blocks).

| Part | Chapters | Covers |
|---|---|---|
| I · Foundations | 1–8 | Background, assuming no prior knowledge |
| II · The skeleton | 9–12 | Layout, build, subsystems, boot sequence |
| III · Running guest code | 13–21 | ELF loading, relocation, NIDs, instruction patching, exceptions, memory, threads |
| IV · HLE libraries | 22–24 | How a console system call gets served, plus a worked example |
| V · Graphics | 25–33 | PM4, the command processor, registers, descriptors, tiling, the shader recompiler, Vulkan, coherency, presentation |
| VI · The rest | 34–36 | Audio/input/video, debugging, tests |
| VII · Reference | 37–39 | Reading order, glossary, further reading |

**Interactive pieces**

- **PM4 packet decoder** — type a header dword, see the fields extracted
- **GPU descriptor decoder** — decode V# / T# / S# resource descriptors field by field
- **Calling convention comparison** — System V vs Microsoft x64, side by side
- **ELF → memory diagram**, **boot stepper**, **shader pipeline stepper**,
  **address-space map**, filterable nav and glossary

## Animated explainers

Nineteen animations in total: seven shared ones in `docs/assets/viz.js` used across all
four documents, plus twelve deeper ones in `docs/assets/atlas.js` used by the atlas.
Each is placed wherever the concept comes up. Each auto-plays while on screen, pauses when scrolled
away, and can be stepped manually. All respect `prefers-reduced-motion`.

| Animation | Explains | Appears in |
|---|---|---|
| **pipeline** | Game code → AGC builders → PM4 buffer → command processor → registers → draw → screen. Eight numbered stages with a token travelling the path. | book ch 3, guide §01, path L4 |
| **gotplt** | How a console call reaches emulator code: the PLT jumps through a GOT slot, and the loader rewrites just that one pointer. The core HLE trick. | book ch 15, guide §04, path L2 |
| **coherency** | Page faults as a notification channel — CPU writes, pages go dirty, upload, write-protect, fault, re-upload. | book ch 32, guide §05, path L6 |
| **wave** | An `if` executing across 64 shader lanes, with the EXEC mask doing the branching. The clearest way to see why GPU control flow leaves no structure to recover. | book ch 7, guide §09, path L5 |
| **tiling** | Memory order walking an 8×8 patch in linear vs tiled layout, showing why a 2×2 neighbourhood lands in one cache line. | book ch 29, guide §08 |
| **threads** | Which of the three threads runs what, over the life of the process. | book ch 12, guide §03, path L1 |
| **shaderflow** | The five forms shader code passes through: machine words → instructions → CFG → IR → SPIR-V. | book ch 30, guide §09, path L5 |

The twelve atlas-only animations are listed, with what each explains, in the atlas's own
[closing index](https://almo7aya.dev/leaning-something/kytyps5-atlas.html#index).

Verified by rendering every widget in headless Chrome in both light and dark themes
and stepping through all of its stages.

**Further reading** is linked in context (15 boxes) and collected in chapter 39 —
AMD's RDNA 2 ISA guide, the SPIR-V spec, Fabian Giesen's graphics pipeline series,
Eli Bendersky on GOT/PLT, the fail0verflow PS4 talk, and others.

### Architecture Guide

A condensed tour: what the emulator does, a map of the codebase, boot, loader,
memory, kernel layer, HLE libraries, the three graphics layers, presentation,
build and tooling, a short learning path, and a glossary.

### Learning Path

Seven levels with 32 tickable tasks against the real repository. Progress is saved
in your browser's local storage.

| Level | Focus | Ends with |
|---|---|---|
| 0 | Build and a log you can grep | You can re-run and observe |
| 1 | `main.cpp` → `emulator.cpp` | Add a config flag end to end |
| 2 | One HLE function | **Implement a missing system call** |
| 3 | The loader | Diagnose "game won't boot" |
| 4 | One draw, packet → `vkCmdDraw` | Debug a wrong or missing draw |
| 5 | One shader compiled | Debug a wrong-pixels bug |
| 6 | CPU/GPU coherency | Work on texture corruption |

Each level has an ordered reading list with file references, concrete exercises, and
self-check questions with revealable answers. Three appendices: a symptom → flag →
file **debugging playbook**, a **command cheat sheet**, and the codebase's **reading
conventions**.

---

## Repository layout

```
docs/                          served by GitHub Pages
├─ index.html                  landing page
├─ kytyps5-atlas.html          the visual atlas (19 animations)
├─ kytyps5-book.html           the book
├─ kytyps5-guide.html          the guide
├─ kytyps5-learning-path.html  the workbook
└─ assets/
   ├─ viz.css / viz.js         the seven shared animations
   ├─ atlas.css / atlas.js     twelve deeper animations for the atlas
   └─ shot-*.jpg               emulator screenshots (lazy-loaded)
```

No build step, no dependencies, no tracking. Each document carries its own inline CSS
and page JavaScript; the shared pieces are the two `viz.*` files and the screenshots.
The animations consume the host page's design tokens, so they theme themselves — light
and dark both follow your system preference.

To add an animation anywhere, drop in `<figure data-viz="NAME"></figure>` and link
`assets/viz.css` + `assets/viz.js` (plus the `atlas.*` pair for the deeper set).
`viz.js` exposes `window.VIZ.register(name, fn)` so more can be added without touching it.

---

## Caveats

- **Line references drift.** Everything points at KytyPS5 `v0.2.2`. The prose stays
  accurate far longer than the line numbers — treat a reference as "look for this
  function", not "go to this line".
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


