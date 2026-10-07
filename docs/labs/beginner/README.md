# Beginner C++ fixtures

Start with [B1](../../b-first-program.html). These are standalone teaching programs,
not excerpts from KytyPS5. They require C++20, CMake 3.20+ and Ninja, with no emulator
checkout, graphics SDK or game. The separate developer labs in the parent folder
still require the KytyPS5 source headers.

Run from the learning repository root, in an x64 C++ developer environment on Windows:

```text
cmake -S docs/labs/beginner -B _Build/curriculum/beginner -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER=clang++
cmake --build _Build/curriculum/beginner
ctest --test-dir _Build/curriculum/beginner --output-on-failure
```

With this Ninja configuration, run a program directly as
`./_Build/curriculum/beginner/first_program.exe`
in PowerShell, or `./_Build/curriculum/beginner/first_program` on Linux/macOS.
For one check, add `-R '^beginner_bytes$'` to the CTest command.

| Fixture | Lesson and checked behavior |
|---|---|
| `first_program` | B1: functions, structs, array iteration and accumulated values |
| `bytes` | B2: little-endian read; last valid offset, truncation, empty input and huge offset |
| `ownership` | B3: pointer/reference aliasing, moved exclusive owner and destruction order |
| `machine` | B4: invented CPU trace, rejected out-of-range store and missing halt |
| `completion` | B5: incomplete work, later reuse, exact completion and empty retirement |
| `cpp_idioms` | C1: forwarding lvalue/rvalue arguments, shared ownership and bit_cast round trip |

Each executable contains explicit failure checks that remain enabled in Release.
CTest also requires exit status zero and compares the complete output with the
matching `.txt` file. Line endings are normalized; other output changes fail.

Exercise edits intentionally change behavior. Observe the old check fail, justify
the intended result, then update the check and output expectation together. Do not
update expectations just to hide an unexplained difference. Rebuild before rerunning.

The HTML source listings and expected-output boxes are generated from these files.
After an intentional edit, run `node scripts/build-docs.cjs --write` from the root.
No fixture establishes console conformance or game compatibility; the machine and
completion examples deliberately omit actual CPU/GPU execution and synchronization.
