#include <array>
#include <iostream>

struct Frame {
    int width;
    int height;
};

int pixel_count(Frame frame) {
    return frame.width * frame.height;
}

int main() {
    const std::array<Frame, 2> frames{{{4, 3}, {2, 2}}};
    int total = 0;
    for (Frame frame : frames) {
        const int pixels = pixel_count(frame);
        std::cout << "pixels=" << pixels << '\n';
        total = total + pixels;
    }
    std::cout << "total=" << total << '\n';
    if (total != 16) {
        return 1;
    }
    return 0;
}
