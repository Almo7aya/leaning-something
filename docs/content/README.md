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
