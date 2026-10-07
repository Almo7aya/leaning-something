#include <algorithm>
#include <cstdint>
#include <iostream>
#include <vector>

// Single-threaded bookkeeping model: no GPU work or synchronization is performed.
struct Resource { int id; std::uint64_t last_use; };

void retire(std::vector<Resource>& retained, std::uint64_t completed) {
    std::erase_if(retained, [completed](const Resource& resource) {
        return resource.last_use <= completed;
    });
}

int main() {
    std::vector<Resource> retained{{1, 7}};
    const std::uint64_t submitted = 7;
    std::uint64_t completed = 6;
    retire(retained, completed);
    if (retained.size() != 1) return 1;
    std::cout << "submitted=" << submitted << " completed=" << completed
              << " retained=" << retained.size() << '\n';
    // A later submission reuses resource 1 before submission 7 completes.
    retained[0].last_use = 9;
    completed = 7;
    retire(retained, completed);
    if (retained.size() != 1) return 1;
    std::cout << "completed=7 retained=" << retained.size() << '\n';
    completed = 9;
    retire(retained, completed);
    if (!retained.empty()) return 1;
    std::cout << "completed=9 retained=" << retained.size() << '\n';
    retire(retained, completed); // Retiring an empty list is valid.
    if (!retained.empty()) return 1;
}
