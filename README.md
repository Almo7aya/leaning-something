# KytyPS5 documentation

Unofficial learning material for the KytyPS5 codebase, written by reading the source
tree at **v0.2.2**. Three self-contained HTML documents, plus the screenshots used by
the repository README.

Each document is a single file with no external assets — no CSS, no JavaScript, no
images to fetch. Clone or download the repository and open the file in any browser.
Both light and dark themes are supported and follow your system preference.

> GitHub does not render `.html` files in the web interface. Clicking a link below
> shows you the source. To read a document, download it (or clone the repo) and open
> it locally.

---

## Which one do I want?

| If you… | Read |
|---|---|
| are new to emulation and want the whole picture in one place | [The Complete Book](#the-complete-book) |
| already know systems programming and want a fast architectural tour | [Architecture Guide](#architecture-guide) |
| want to actually learn the codebase by working through it | [Learning Path](#learning-path) |

They overlap on purpose. The book is written to stand alone, so you never need to
switch documents mid-topic.

---

## The Complete Book

**[`kytyps5-book.html`](kytyps5-book.html)** — 315 KB · 39 chapters · ~3–4 hours to read through

The full treatment, assuming no prior knowledge of emulation. Part I teaches the
background before any KytyPS5 code appears; the rest walks every layer of the
emulator with real source excerpts throughout (~120 code blocks).

**Contents**

| Part | Chapters | Covers |
|---|---|---|
| I · Foundations | 1–8 | What an emulator is; the PS5 as hardware; why there is no CPU emulator; x86-64 calling conventions; virtual memory; ELF and dynamic linking; how a GPU actually draws; Vulkan and SPIR-V |
| II · The skeleton | 9–12 | Repository layout, build system, the subsystem framework, the boot sequence |
| III · Running guest code | 13–21 | SELF/ELF format, memory mapping, relocation and NIDs, instruction patching, import thunks, the exception handler, memory management, threads and TLS, event queues and files |
| IV · HLE libraries | 22–24 | Anatomy of an HLE module, a tour of all 58 files, and a worked example of implementing a missing function |
| V · Graphics | 25–33 | AGC and PM4, the command processor, hardware registers, sharps and SRTs, tiling, the shader recompiler, the Vulkan renderer, memory coherency, presentation |
| VI · The rest | 34–36 | Audio/input/video, debugging and tooling, tests |
| VII · Reference | 37–39 | A reading order for the source, a glossary, and collected further reading |

**Interactive pieces**

- **PM4 packet decoder** — type a header dword, see the type/count/opcode fields
  extracted the way `pm4.cpp` does it
- **Sharp decoder** — decode V# / T# / S# GPU resource descriptors field by field,
  using the bit layouts from `shaderBindings.h`
- **Calling convention comparison** — change the argument count and watch System V
  and Microsoft x64 diverge
- **Boot sequence stepper** — 11 steps, each with why it happens where it does
- **Shader pipeline stepper** — the 11 recompiler stages
- **Address space map** — click a band for detail
- Filterable chapter nav and glossary

**Further reading** is linked in context throughout (15 "Learn more" boxes) and
collected in chapter 39 — AMD's RDNA 2 ISA guide, the SPIR-V spec, Fabian Giesen's
graphics pipeline series, Eli Bendersky on GOT/PLT, the fail0verflow PS4 talk, and
others.

---

## Architecture Guide

**[`kytyps5-guide.html`](kytyps5-guide.html)** — 127 KB · 15 sections · ~45 minutes

A condensed tour for readers who already have the systems background. Same subject,
much less scaffolding. Useful as a refresher or as an orientation document before
diving into a specific subsystem.

Covers: what the emulator actually does, a map of the codebase, the boot sequence,
the loader, memory, the kernel layer, the HLE libraries, the three graphics layers,
presentation, build and tooling, a short learning path, and a glossary.

Includes the PM4 decoder, boot stepper, shader pipeline stepper and address-space
map, and a chart of lines of code per subsystem.

---

## Learning Path

**[`kytyps5-learning-path.html`](kytyps5-learning-path.html)** — 56 KB · 7 levels · ~3 weeks part-time

A workbook rather than a document. Seven levels with 32 tickable tasks, ordered so
each level ends with a capability you did not have before. Progress is saved in your
browser's local storage.

| Level | Focus | Ends with |
|---|---|---|
| 0 | Build and a log you can grep | You can re-run and observe |
| 1 | `main.cpp` → `emulator.cpp` | Add a config flag end to end |
| 2 | One HLE function | **Implement a missing system call** |
| 3 | The loader | Diagnose "game won't boot" |
| 4 | One draw, packet → `vkCmdDraw` | Debug a wrong or missing draw |
| 5 | One shader compiled | Debug a wrong-pixels bug |
| 6 | CPU/GPU coherency | Work on texture corruption |

Each level has an ordered reading list with file and line references, concrete
exercises against this repository, and self-check questions with revealable answers.

Three appendices you will keep returning to: a symptom → flag → file **debugging
playbook**, a **command cheat sheet** (including where each dump lands — `_Shaders/`,
`_Buffers/`, `_Textures/`), and the **reading conventions** used in the codebase.

---

## Caveats

- **Line references drift.** Every file and line reference points at the tree as of
  `v0.2.2`. The prose stays accurate much longer than the line numbers do — treat a
  reference as "look for this function", not "go to this line".
- **These are unofficial.** They are a reading of the source, not maintainer-authored
  documentation. Where a document and the code disagree, the code is right.
- **Outbound links need a connection.** The documents themselves work offline; the
  further-reading links obviously do not.

## Screenshots

[`screenshots/`](screenshots/) holds the images used by the repository README. Not
related to the documents above.
