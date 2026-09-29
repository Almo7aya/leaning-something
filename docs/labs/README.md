# Developer labs

Read [the full lesson](../t-debugging-labs.html) or open it through the learning site.
These are intentional fixture bugs, not upstream bug reports. Alignment and
lifetime include real KytyPS5 headers; the output-contract API is fictional.

From the learning repository root, with CMake 3.20+, Ninja and C++20:

```text
cmake -S docs/labs -B _Build/curriculum -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER=clang++
cmake --build _Build/curriculum
ctest --test-dir _Build/curriculum --output-on-failure
```

The default source checkout is `KytyPS5/`. Override with
`-DKYTY_SOURCE_DIR="D:/path/to/KytyPS5"`. Windows needs installed MSVC/SDK libraries;
use an x64 developer shell if compiler discovery fails. This isolated build does
not configure the full emulator or require games, Qt or Vulkan.

Run `_Build/curriculum/developer_labs.exe <lab> <mode>` on Windows; omit `.exe`
elsewhere. Labs: `alignment`, `lifetime`, `contract`. Modes: `buggy`, `fixed`.
Buggy mode exits 1 with the lesson's exact expected failure. Fixed mode exits 0.
Bad CLI arguments exit 2. CTest has seven checks: three solutions, three exact
expected failures, and the real upstream `LruCacheTests.cpp`.

Solve the marked caller in `developer_labs.cpp`, rebuild and rerun that same
buggy command without weakening tests. Its expected-failure CTest entry will
then complain because the bug is gone: replace it with a success test if keeping
your solution. The baseline meta-tests deliberately check the teaching fixtures.

Verified on Windows x64, Clang 22.1.3, with source `2650478`: 7/7 baseline checks.
No full emulator, Vulkan or game runtime validation is implied. Keep source SHA,
commands, exit codes, before/after results and remaining limits in your report.

## Ray-tracing appendix fixtures

From the learning root, run `node docs/labs/raytracing-reference.cjs` for C11's
27 mathematical and encoding checks. These require Node.js only and are separate
from the seven native CTest cases above. The pointer layout is explicitly invented;
the geometry math uses JavaScript binary64. This is not a console BVH reader,
full RDNA decoder, hardware-precision oracle or emulator RT implementation.
