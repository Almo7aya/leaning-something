// Teaching fixtures, not claims of bugs in upstream KytyPS5.
// The first two labs call the actual upstream headers; the third API is fictional.
#include "common/alignment.h"
#include "common/lruCache.h"

#include <cstdint>
#include <iostream>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace {
constexpr uint64_t PageSize = 0x4000; // 16384 bytes; a guest-page example.
struct Range { uint64_t begin; uint64_t end; };

std::optional<Range> Cover(uint64_t address, uint64_t size, bool fixed) {
    if (size == 0) return Range{address, address}; // Empty means no pages.
    constexpr auto max = std::numeric_limits<uint64_t>::max();
    if (size > max - address) return std::nullopt;
    const auto end = address + size;
    const auto remainder = end % PageSize;
    if (remainder != 0 && PageSize - remainder > max - end) return std::nullopt;
    const auto begin = Common::AlignDown(address, PageSize);
    if (fixed) return Range{begin, Common::AlignUp(end, PageSize)};
    // EXERCISE A: alignment of size loses the offset within the first page.
    return Range{begin, begin + Common::AlignUp(size, PageSize)};
}

bool Alignment(bool fixed) {
    struct Case { const char* name; uint64_t address; uint64_t size; uint64_t begin; uint64_t end; };
    const Case cases[] = {
        {"cross-page", 0x3FFC, 8, 0, 0x8000},
        {"exact-end", 0x3FFC, 4, 0, 0x4000},
        {"aligned", 0x4000, 0x4000, 0x4000, 0x8000},
        {"one-byte", 0x4001, 1, 0x4000, 0x8000},
        {"empty", 0x4001, 0, 0x4001, 0x4001},
    };
    for (const auto& c : cases) {
        const auto got = Cover(c.address, c.size, fixed);
        if (!got || got->begin != c.begin || got->end != c.end) {
            std::cout << "FAIL [alignment] " << c.name << ": expected [" << c.begin << ',' << c.end
                      << "), got [" << (got ? std::to_string(got->begin) : "invalid") << ','
                      << (got ? std::to_string(got->end) : "invalid") << ")\n";
            return false;
        }
    }
    constexpr auto max = std::numeric_limits<uint64_t>::max();
    if (Cover(max - 3, 8, fixed) || Cover(max - 3, 1, fixed)) {
        std::cout << "FAIL [alignment] overflow: must reject addition and rounding overflow\n";
        return false;
    }
    std::cout << "PASS [alignment] 7 cases\n";
    return true;
}

std::string Join(const std::vector<std::string>& values) {
    std::string result;
    for (const auto& value : values) {
        if (!result.empty()) result += ',';
        result += value;
    }
    return result;
}

bool Lifetime(bool fixed) {
    Common::LeastRecentlyUsedCache<std::string, uint64_t> cache;
    const auto a = cache.Insert("A", 2);
    (void)cache.Insert("B", 3);
    const uint64_t completed_tick = 4;
    const uint64_t last_use_tick = 6;
    // EXERCISE B: tag a use with the submission that uses it, not completed work.
    cache.Touch(a, fixed ? last_use_tick : completed_tick);
    auto candidates = [&](uint64_t cutoff) {
        std::vector<std::string> values;
        cache.ForEachItemBelow(cutoff, [&](const std::string& value) { values.push_back(value); });
        return Join(values);
    };
    if (const auto got = candidates(4); got != "B") {
        std::cout << "FAIL [lifetime] cutoff-4: expected B, got " << got << '\n';
        return false;
    }
    cache.Touch(a, 5); // Older use must not move the retirement point backwards.
    cache.Touch(a, 6); // Equal use is a no-op.
    if (candidates(5) != "B" || candidates(6) != "B,A" || candidates(1) != "") {
        std::cout << "FAIL [lifetime] boundary: old/equal touches or inclusive cutoff\n";
        return false;
    }
    cache.Free(a);
    if (candidates(6) != "B") {
        std::cout << "FAIL [lifetime] free: retired A still enumerated\n";
        return false;
    }
    std::cout << "PASS [lifetime] 5 observations\n";
    return true;
}

// FICTIONAL API: trusted local C++ objects, not arbitrary guest pointers or a real NID.
struct Request { uint32_t size; uint32_t flags; };
struct Status { uint32_t state; uint32_t capacity; };
static_assert(sizeof(Request) == 8 && sizeof(Status) == 8);
constexpr int Invalid = -1;

int QueryStatus(const Request* request, Status* output, bool fixed) {
    if (!request || !output) return Invalid;
    // EXERCISE C: error returns promise not to mutate the caller's output.
    if (!fixed) *output = {};
    if (request->size != sizeof(Request) || request->flags != 0) return Invalid;
    *output = Status{3, 16}; // This fixture's explicit contract, not a Sony API value.
    return 0;
}

bool Contract(bool fixed) {
    const Request valid{sizeof(Request), 0};
    Status output{0xAAAAAAAA, 0xBBBBBBBB};
    if (QueryStatus(&valid, &output, fixed) != 0 || output.state != 3 || output.capacity != 16) {
        std::cout << "FAIL [contract] success: wrong status or output\n";
        return false;
    }
    const Request invalid[] = {{0, 0}, {sizeof(Request), 1}};
    const char* names[] = {"invalid-size", "invalid-flags"};
    for (int i = 0; i < 2; ++i) {
        output = {0xAAAAAAAA, 0xBBBBBBBB};
        if (QueryStatus(&invalid[i], &output, fixed) != Invalid) {
            std::cout << "FAIL [contract] " << names[i] << ": wrong return code\n";
            return false;
        }
        if (output.state != 0xAAAAAAAA || output.capacity != 0xBBBBBBBB) {
            std::cout << "FAIL [contract] " << names[i] << ": output changed on error\n";
            return false;
        }
    }
    output = {0xAAAAAAAA, 0xBBBBBBBB};
    if (QueryStatus(nullptr, &output, fixed) != Invalid ||
        output.state != 0xAAAAAAAA || output.capacity != 0xBBBBBBBB ||
        QueryStatus(&valid, nullptr, fixed) != Invalid) {
        std::cout << "FAIL [contract] null: wrong result or output mutation\n";
        return false;
    }
    std::cout << "PASS [contract] 5 cases\n";
    return true;
}
} // namespace

int main(int argc, char** argv) {
    if (argc != 3 || (std::string(argv[2]) != "buggy" && std::string(argv[2]) != "fixed")) {
        std::cerr << "Usage: developer_labs alignment|lifetime|contract buggy|fixed\n";
        return 2;
    }
    const bool fixed = std::string(argv[2]) == "fixed";
    const std::string lab = argv[1];
    if (lab == "alignment") return Alignment(fixed) ? 0 : 1;
    if (lab == "lifetime") return Lifetime(fixed) ? 0 : 1;
    if (lab == "contract") return Contract(fixed) ? 0 : 1;
    std::cerr << "Unknown lab: " << lab << '\n';
    return 2;
}
