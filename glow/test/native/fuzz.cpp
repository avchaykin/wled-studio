// Mutation fuzzer for the Glow image verifier: corrupt valid images and make sure
// loading + running never crashes (build with -fsanitize=address,undefined).
// usage: fuzz <seed-image.glw>... ; exits non-zero on sanitizer failure only.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "../../../wled00/glow_vm.h"

struct H : glow::Host {
  std::vector<uint32_t> px;
  uint32_t getPixel(int i) override { return (i >= 0 && i < (int)px.size()) ? px[i] : 0; }
  void setPixel(int i, uint32_t c) override { if (i >= 0 && i < (int)px.size()) px[i] = c; }
  uint32_t palette(uint8_t i) override { return i * 0x010101u; }
};

int main(int argc, char **argv) {
  uint32_t rng = 12345;
  auto rnd = [&]() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; };
  int loaded = 0, rejected = 0, ran = 0;
  for (int a = 1; a < argc; a++) {
    FILE *f = fopen(argv[a], "rb"); if (!f) continue;
    std::vector<uint8_t> seed; int ch; while ((ch = fgetc(f)) != EOF) seed.push_back(ch); fclose(f);
    for (int iter = 0; iter < 4000; iter++) {
      std::vector<uint8_t> img = seed;
      int muts = 1 + rnd() % 4;
      for (int m = 0; m < muts; m++) {
        size_t at = 20 + rnd() % (img.size() - 20);            // keep the header magic mostly intact
        switch (rnd() % 3) {
          case 0: img[at] = rnd(); break;                         // random byte
          case 1: img[at] ^= 1 << (rnd() % 8); break;             // bit flip
          default: img[at] = (uint8_t[]){0, 1, 0x7f, 0x80, 0xff, 35, 36}[rnd() % 7]; break; // edge values
        }
      }
      glow::Image im;
      if (im.load(img.data(), img.size())) { rejected++; continue; }
      loaded++;
      H h; h.len = 40; h.w = 40; h.h = 1; h.px.assign(40, 0);
      static uint8_t bands[16] = {}; h.audioBands = bands;
      glow::VM vm; uint32_t arena = 0;
      if (!vm.measureArena(im, h, arena)) continue;
      if (arena > 1 << 20) continue;
      std::vector<uint8_t> state(glow::stateBaseSize(im) + arena, 0);
      if (im.kind == glow::K_SHOW) {
        for (uint8_t e = 0; e < im.nEvents; e++) if (!vm.runEvent(im, h, im.event(e).fn, state.data(), state.size(), 7, 5000)) break;
      } else {
        for (int fr = 0; fr < 3; fr++) { h.t = fr * 25; if (!vm.runFrame(im, h, state.data(), state.size(), 7, 5000)) break; }
      }
      ran++;
    }
  }
  printf("loaded %d, rejected %d, ran %d\n", loaded, rejected, ran);
  return 0;
}
