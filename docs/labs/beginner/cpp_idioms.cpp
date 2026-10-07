#include <bit>
#include <cstdint>
#include <iostream>
#include <memory>
#include <utility>

const char* category(int&) { return "lvalue"; }
const char* category(int&&) { return "rvalue"; }

template<class T>
const char* forward_category(T&& value) {
    return category(std::forward<T>(value));
}

int main() {
    int number = 7;
    std::cout << forward_category(number) << '\n';
    std::cout << forward_category(7) << '\n';
    auto first = std::make_shared<int>(number);
    auto second = first;
    first.reset();
    if (!second || *second != 7) return 1;
    std::cout << "shared value=" << *second << '\n';
    static_assert(sizeof(float) == sizeof(std::uint32_t));
    const float value = 1.0f;
    const auto bits = std::bit_cast<std::uint32_t>(value);
    if (std::bit_cast<float>(bits) != value) return 1;
    std::cout << "bit pattern round trip preserved\n";
}
