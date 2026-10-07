#include <iostream>
#include <memory>
#include <span>
#include <utility>
#include <vector>

struct Buffer {
    std::vector<int> values{10, 20, 30};
    ~Buffer() { std::cout << "buffer destroyed\n"; }
};

int main() {
    int counter = 3;
    int* pointer = &counter;
    int& alias = counter;
    *pointer = 4;
    alias = alias + 1;
    std::cout << "counter=" << counter << '\n';
    {
        auto owner = std::make_unique<Buffer>();
        std::span<const int> view(owner->values);
        auto next_owner = std::move(owner);
        if (owner || !next_owner || view.size() != 3 || view[1] != 20) return 1;
        std::cout << "borrow=" << view[1] << '\n';
        std::cout << "old owner empty=" << std::boolalpha << !owner << '\n';
        // Do not resize the vector or destroy next_owner while using view.
    }
    std::cout << "scope ended\n";
    return counter == 5 ? 0 : 1;
}
