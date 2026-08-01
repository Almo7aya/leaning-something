# Learning KytyPS5

Unofficial learning material for the [KytyPS5](https://github.com/KytyPS5/KytyPS5)
PlayStation 5 emulator, written by reading the source tree at **v0.2.2**.

**Read it online → [almo7aya.dev/leaning-something](https://almo7aya.dev/leaning-something/)**

GitHub does not render `.html` in the web interface, so clicking a file here shows
you source. Use the link above.

---

## The three documents

| | Audience | Length |
|---|---|---|
| **[The Complete Book](https://almo7aya.dev/leaning-something/kytyps5-book.html)** | New to emulation — assumes nothing | 39 chapters, ~3–4 hours |
| **[Architecture Guide](https://almo7aya.dev/leaning-something/kytyps5-guide.html)** | Already comfortable with systems programming | 15 sections, ~45 minutes |
| **[Learning Path](https://almo7aya.dev/leaning-something/kytyps5-learning-path.html)** | Want to learn by doing | 7 levels, ~3 weeks part-time |

They overlap on purpose. The book is written to stand alone — you never need to
switch documents mid-topic.

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

- **Wave / EXEC-mask visualiser** — step an `if` through 64 shader lanes and watch
  the execution mask do the branching. The clearest way to see why GPU control flow
  has no structure to recover.
- **Tiling visualiser** — watch memory order walk a texture in linear vs tiled layout
- **PM4 packet decoder** — type a header dword, see the fields extracted
- **GPU descriptor decoder** — decode V# / T# / S# resource descriptors field by field
- **Calling convention comparison** — System V vs Microsoft x64, side by side
- **ELF → memory diagram**, **boot stepper**, **shader pipeline stepper**,
  **address-space map**, filterable nav and glossary

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
├─ kytyps5-book.html           the book
├─ kytyps5-guide.html          the guide
├─ kytyps5-learning-path.html  the workbook
└─ assets/                     screenshots (JPEG)
```

Each document is one HTML file with inline CSS and JavaScript — no build step, no
dependencies, no tracking. The only external files are the screenshots in `assets/`,
which are lazy-loaded. Light and dark themes follow your system preference.

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
