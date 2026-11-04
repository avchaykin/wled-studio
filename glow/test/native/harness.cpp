// Native test harness for the C++ Glow VM.
// Usage: harness <image.glw> <len> <frames> <seed> [w h]
// Prints one line per frame: pixels as 8-digit hex, space separated.
// Host setup must match hostFor() in glow/test/conformance.test.mjs.
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "../../../wled00/glow_vm.h"

struct TestHost : glow::Host {
  std::vector<uint32_t> px;
  uint32_t getPixel(int i) override { return px[i]; }
  void setPixel(int i, uint32_t c) override { px[i] = c; }
  uint32_t palette(uint8_t i) override { return ((uint32_t)i << 16) | ((uint32_t)(255 - i) << 8); }
};

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror("open"); return 2; }
  std::vector<uint8_t> img;
  int ch; while ((ch = fgetc(f)) != EOF) img.push_back((uint8_t)ch);
  fclose(f);
  glow::Image im;
  if (const char *e = im.load(img.data(), img.size())) { printf("LOAD %s\n", e); return 1; }

  TestHost h;
  h.len = atoi(argv[2]);
  int frames = atoi(argv[3]);
  uint32_t seed = strtoul(argv[4], nullptr, 10);
  h.w = argc > 6 ? atoi(argv[5]) : h.len;
  h.h = argc > 6 ? atoi(argv[6]) : 1;
  h.px.assign(h.len, 0);
  uint8_t ctl[8] = {128, 128, 128, 128, 128, 0, 0, 0};
  for (int k = 0; k < 8; k++) h.controls[k] = ctl[k];
  h.colors[0] = 0xff0000; h.colors[1] = 0x00ff00; h.colors[2] = 0x0000ff;
  static uint8_t bands[16]; for (auto &b : bands) b = 50;
  h.audioVol = 100; h.audioBands = bands;

  glow::VM vm;
  uint32_t arena = 0;
  if (!vm.measureArena(im, h, arena)) { printf("ERR %s\n", glow::errorText(vm.lastError)); return 1; }
  std::vector<uint8_t> state(glow::stateBaseSize(im) + arena, 0);
  for (int fr = 0; fr < frames; fr++) {
    h.t = fr * 25;
    if (!vm.runFrame(im, h, state.data(), state.size(), seed)) { printf("ERR %s %s\n", glow::errorText(vm.lastError), vm.lastDetail); return 1; }
    for (int i = 0; i < h.len; i++) printf(i ? " %08x" : "%08x", h.px[i]);
    printf("\n");
  }
  return 0;
}
