#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <optional>
#include <span>

// Teaching format: four little-endian bytes, not an ELF or PM4 parser.
std::optional<std::uint32_t> read_u32(std::span<const std::uint8_t> bytes,
                                     std::size_t offset) {
    if (offset > bytes.size() || bytes.size() - offset < 4) {
        return std::nullopt;
    }
    std::uint32_t value = 0;
    for (std::size_t i = 0; i < 4; ++i) {
        value |= std::uint32_t{bytes[offset + i]} << (8 * i);
    }
    return value;
}

int main() {
    const std::array<std::uint8_t, 5> bytes{0x78, 0x56, 0x34, 0x12, 0xff};
    const auto value = read_u32(bytes, 0);
    if (!value || *value != 0x12345678u) return 1;
    std::cout << "word=0x" << std::hex << *value << '\n';
    std::cout << "field=0x" << ((*value >> 8) & 0xffu) << '\n';
    const auto last = read_u32(bytes, 1);
    if (!last || *last != 0xff123456u) return 1;
    if (read_u32(bytes, 2) || read_u32(bytes, bytes.size()) ||
        read_u32(bytes, std::numeric_limits<std::size_t>::max()) ||
        read_u32({}, 0)) return 1;
    std::cout << "last valid offset=1\n";
    std::cout << "truncated, end, huge and empty reads rejected\n";
}
