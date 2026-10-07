# Authoring the learning site

The served output is static HTML. No runtime framework, package installation or
server-side rendering is required. Node.js scripts regenerate derived content.

## Sources of truth

- `learning.json` owns the core route, topic IDs, sidebar groups, prerequisites,
  source revision and the short ray-tracing support summary. The generator derives
  core step numbers and page eyebrows from route position; `n` retains the reference
  code. Keep sidebar topics in core-route order, with C++ and subsystem lessons beside their
  prerequisites. Advanced research, visual tools and the glossary follow the core.
  Existing IDs and URLs
  are retained so stored progress and incoming links survive reordering.
- Individual `t-*.html` pages own their explanations. A paragraph marked
  `data-shared="excerpt-123"` is also used elsewhere. Edit that owning paragraph;
  keep its key stable. Keys are scoped to the source page.
- Regions such as `<!-- shared:t-hle.html:excerpt-123 --> ... <!-- /shared -->`
  are generated copies. Do not edit their bodies. A missing owner fails generation.
  Fragment-only links in a copy are rewritten to the owning lesson's anchor.
- `docs/labs/beginner/*.cpp` and matching `.txt` files own the runnable listings
  and checked expected output. `code:` and `output:` regions embed those files.
- `prerequisites:` and `project:` regions derive from the manifest. The book and
  tour retain their own chapter structure, figures, unique prose and stable anchors.
  Shared prose generation does not imply every paragraph in those views is shared.

## Update and verify

From the learning repository root:

```text
node scripts/build-docs.cjs --write
node scripts/build-search-index.cjs --write
node scripts/build-docs.cjs
node scripts/check-docs.cjs
node scripts/check-doc-examples.cjs
node scripts/build-artifact-data.cjs
node scripts/check-artifacts.cjs
node scripts/check-observatory.cjs
node scripts/check-curriculum.cjs
node scripts/check-beginner.cjs
node scripts/build-search-index.cjs
```

The commands without `--write` are read-only and fail on stale generated regions
or broken contracts. Compile/run changed beginner fixtures using their CMake
instructions. If source-dependent developer labs change, run their separate build.

For an upstream refresh, read the changed implementation and tests before updating
the manifest revision. The curriculum validator compares that revision with the
optional emulator checkout. A source symbol still existing does not prove its
semantics are unchanged. Review unique long-form prose and conceptual models too.

## Teaching contract

Beginner lessons state prerequisites, explain new notation before using it, show a
complete runnable program, specify commands and expected output, and provide an
exercise with hints and a worked answer. Connect the result to one named project
boundary. Introduce difficult implementation detail after a short first-pass model.

Label source excerpts and schematic sequences. Preserve omitted-code markers;
never imply an excerpt is a standalone program. Prefer named external lessons to
chapter numbers that can drift. Keep claims about fixtures, static source reading,
device execution and game behavior distinct.

## Optional visual tools

Each tool provides a related lesson, an explicit model boundary, a prepared
experiment and a worked explanation. Keep these pages usable at desktop widths;
do not change their desktop instruments to accommodate a mobile layout.

`assets/artifact-parsers.js` owns the pure readers used by both the Playground and
`scripts/check-artifacts.cjs`. Invalid or unsupported input must produce a visible
explanation, never an invented decode or a silently truncated address. Parsing
structure is separate from validating execution or Vulkan compatibility.

`assets/artifact-data.js` is generated from the pinned KytyPS5 opcode tables,
descriptor-format enums and vendored SPIR-V grammar. Regenerate it with
`node scripts/build-artifact-data.cjs --write` when updating the source snapshot.
Set `KYTY_SOURCE_DIR` for an alternate checkout at the manifest revision. Without
the optional source checkout the table comparison is skipped; parser regressions
still use the committed data. Keep tests for actual boundary failures alongside
any parser changes. Text inspection is bounded to 2 MiB, word streams to 16,384
words, and ELF files to 64 MiB; larger artifacts need offline tools.

`assets/visual-tools.js` supplies expansion, diagram zoom, copied results and
exercise preparation. Simulator shortcuts belong to the focused game display.
Keep modeled timings, instruction sets and cache events labeled as simulations.

Run Observatory connects these boundaries in one deterministic executable fixture.
`assets/observatory-engine.js` is the pure model; `assets/observatory.js` renders
recorded snapshots and owns playback, inspectors and local file controls. Guest
instruction bytes produce writes, packet headers go through the shared reader,
and the lowered shader operations feed the software rasterizer. The bytecode,
services, scheduler, costs and cache capacity are teaching choices. The ELF
fixture deliberately uses `e_machine = NONE`; never describe it as a PS5 binary.
Replay imports regenerate and compare the evidence at the pinned source revision.
Keep the 2 MiB import bound and reject mismatches without loading executable data.
Run `node scripts/check-observatory.cjs` after changing the model. These checks
cover visibility failures, safe lifetime boundaries, cache capacity, pixel changes
and replay integrity; they do not validate native execution.

For browser regression checks, serve `docs/`, install Playwright separately, then
run `node scripts/check-visual-tools.cjs`. `PLAYWRIGHT_MODULE` can name an existing
Playwright module, `BROWSER_EXECUTABLE` a browser executable, and `DOCS_URL` the
server URL (default `http://127.0.0.1:8765`). The suite checks desktop widths
1280/1440/1920 in both themes, exercises controls and writes screenshots under
`_Build/curriculum/browser/visual-tools/`. Inspect these images as well as the
assertions; browser checks do not prove native emulator behavior.

Run `node scripts/check-observatory-browser.cjs` with the same environment for the
new tool's seven inspectors, breakpoints, watchpoints, comparison, binary exports,
replay imports and shared view links. Its screenshots and report are written to
`_Build/curriculum/browser/observatory/`.
