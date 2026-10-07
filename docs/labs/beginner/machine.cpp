#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <span>

// Invented instruction set. These are not x86, RDNA, ELF or PM4 encodings.
enum class Op { set, add, store, halt };
struct Instruction { Op op; std::uint32_t operand; };
struct Cpu {
    std::size_t pc = 0;
    std::uint32_t accumulator = 0;
    std::array<std::uint32_t, 4> memory{};
};

bool run(std::span<const Instruction> program, Cpu& cpu) {
    while (cpu.pc < program.size()) {
        const Instruction instruction = program[cpu.pc];
        ++cpu.pc;
        switch (instruction.op) {
        case Op::set: cpu.accumulator = instruction.operand; break;
        case Op::add: cpu.accumulator += instruction.operand; break;
        case Op::store:
            if (instruction.operand >= cpu.memory.size()) return false;
            cpu.memory[instruction.operand] = cpu.accumulator;
            break;
        case Op::halt: return true;
        default: return false;
        }
    }
    return false; // Reaching the end without halt is an error in this model.
}

int main() {
    const std::array program{Instruction{Op::set, 7}, Instruction{Op::add, 5},
                            Instruction{Op::store, 2}, Instruction{Op::halt, 0}};
    Cpu cpu;
    if (!run(program, cpu) || cpu.memory[2] != 12 || cpu.pc != 4) return 1;
    std::cout << "pc=" << cpu.pc << " accumulator=" << cpu.accumulator
              << " memory[2]=" << cpu.memory[2] << '\n';
    const std::array bad{Instruction{Op::store, 4}, Instruction{Op::halt, 0}};
    Cpu invalid;
    if (run(bad, invalid) || invalid.memory != std::array<std::uint32_t, 4>{}) return 1;
    Cpu missing_halt;
    if (run(std::span<const Instruction>{program}.first(3), missing_halt)) return 1;
    std::cout << "out-of-range store and missing halt rejected\n";
}
