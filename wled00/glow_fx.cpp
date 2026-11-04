/*
 * Glow scripts as WLED effects.
 *
 * GLOW_SLOTS effect IDs are reserved at boot so that a script keeps the same
 * effect ID across reboots (presets, playlists and Home Assistant refer to effects by ID).
 * Compiled images live in /glow/<name>.glw (source in /glow/<name>.glow);
 * /glow/slots.json maps slot index -> script name.
 *
 * JSON API:
 *   info.glow  -> { slots: [{ id, fx, name, file, size, err }], budget }
 *   state.glow <- { reload: true } | { del: "name" }
 */
#include "wled.h"

#ifndef WLED_DISABLE_GLOW
#include "glow_vm.h"

#ifndef GLOW_SLOTS
  #define GLOW_SLOTS 16
#endif
#ifndef GLOW_BUDGET
  #define GLOW_BUDGET 100000    // VM instructions per segment per frame
#endif
#ifndef GLOW_FX_BASE
  #define GLOW_FX_BASE 230      // first effect ID used by Glow slots (stable across reboots and usermod changes)
#endif
#define GLOW_MAX_IMAGE 8192
#define GLOW_NAME_LEN 32

static const char _glow_dir[] PROGMEM = "/glow";
static const char _glow_slots[] PROGMEM = "/glow/slots.json";
static const char _glow_rsvd[] PROGMEM = "RSVD";

struct GlowSlot {
  uint8_t *bytes = nullptr;
  size_t size = 0;
  glow::Image img;
  char *modeData = nullptr;      // "<meta>\0", referenced by strip._modeData
  uint8_t fxId = 255;
  uint8_t generation = 0;        // bumped on reload; segments re-init when it changes
  uint8_t lastError = 0;
  char file[GLOW_NAME_LEN + 1] = "";
};

static GlowSlot glowSlots[GLOW_SLOTS];
static glow::VM *glowVM = nullptr;
static volatile bool glowReloadPending = false;
static char glowDeletePending[GLOW_NAME_LEN + 1] = "";

// ---------------- host bridge ----------------
#define PALETTE_SOLID_WRAP (paletteBlend == 1 || paletteBlend == 3)

class SegmentHost : public glow::Host {
public:
  bool twoD = false;
  uint32_t getPixel(int i) override {
    return twoD ? SEGMENT.getPixelColorXY(i % w, i / w) : SEGMENT.getPixelColor(i);
  }
  void setPixel(int i, uint32_t c) override {
    if (twoD) SEGMENT.setPixelColorXY(i % w, i / w, c); else SEGMENT.setPixelColor(i, c);
  }
  uint32_t palette(uint8_t i) override {
    return SEGMENT.color_from_palette(i, false, PALETTE_SOLID_WRAP, 0);
  }
};

static void glowFillError() {
  // dim red breathing to signal a script error without being alarming
  uint8_t v = 20 + (sin8_t(strip.now >> 4) >> 3);
  SEGMENT.fill(RGBW32(v, 0, 0, 0));
}

static void glowRun(unsigned slotIdx) {
  GlowSlot &s = glowSlots[slotIdx];
  if (!s.bytes || !glowVM) { SEGMENT.fill(SEGCOLOR(0)); return; }

  SegmentHost host;
  host.twoD = SEGMENT.is2D();
  host.w = host.twoD ? SEG_W : SEGLEN;
  host.h = host.twoD ? SEG_H : 1;
  host.len = host.w * host.h;
  host.controls[0] = SEGMENT.speed;   host.controls[1] = SEGMENT.intensity;
  host.controls[2] = SEGMENT.custom1; host.controls[3] = SEGMENT.custom2; host.controls[4] = SEGMENT.custom3;
  host.controls[5] = SEGMENT.check1;  host.controls[6] = SEGMENT.check2;  host.controls[7] = SEGMENT.check3;
  for (int k = 0; k < 3; k++) host.colors[k] = SEGCOLOR(k);
  if (s.img.flags & glow::Image::F_AUDIO) {
    um_data_t *um;
    if (UsermodManager::getUMData(&um, USERMOD_ID_AUDIOREACTIVE)) {
      float vol = *(float *)um->u_data[0];
      host.audioVol = vol < 0 ? 0 : vol > 255 ? 255 : (uint8_t)vol;
      host.audioBands = (uint8_t *)um->u_data[2];
      host.audioPeak = host.audioBeat = *(uint8_t *)um->u_data[3] != 0;
      host.audioFreq = *(float *)um->u_data[4];
    }
  }

  // (re)initialise when the effect starts or the script was reloaded
  if (SEGENV.call == 0 || SEGENV.aux0 != s.generation) {
    uint32_t arena = 0;
    if (!glowVM->measureArena(s.img, host, arena)) { s.lastError = glowVM->lastError; glowFillError(); return; }
    size_t need = glow::stateBaseSize(s.img) + arena;
    if (!SEGENV.allocateData(need)) { s.lastError = glow::E_MEMORY; glowFillError(); return; }
    memset(SEGENV.data, 0, need);
    SEGENV.step = strip.now;
    SEGENV.aux0 = s.generation;
    SEGMENT.fill(BLACK);
  }
  host.t = strip.now - SEGENV.step;

  uint32_t seed = hw_random() | 1;
  if (!glowVM->runFrame(s.img, host, SEGENV.data, SEGENV.dataSize(), seed, GLOW_BUDGET)) {
    s.lastError = glowVM->lastError;
    glowFillError();
  }
}

static void glowReserved() { SEGMENT.fill(SEGCOLOR(0)); }
template <unsigned N> static void glowMode() { glowRun(N); }
template <unsigned... I> struct GlowTable { static constexpr void (*fns[])() = { &glowMode<I>... }; };
template <unsigned... I> constexpr void (*GlowTable<I...>::fns[])();
static_assert(GLOW_SLOTS == 16, "update the trampoline table when changing GLOW_SLOTS");
using GlowFns = GlowTable<0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15>;

// ---------------- loading ----------------
static bool validName(const char *n) {
  size_t l = strlen(n);
  if (!l || l > GLOW_NAME_LEN) return false;
  for (size_t i = 0; i < l; i++) { char c = n[i]; if (!(isalnum(c) || c == '-' || c == '_')) return false; }
  return true;
}

static void glowUnload(GlowSlot &s) {
  if (s.fxId != 255) strip.setModeData(s.fxId, _glow_rsvd);
  free(s.bytes); s.bytes = nullptr; s.size = 0;
  free(s.modeData); s.modeData = nullptr;
  s.file[0] = 0; s.lastError = 0;
  s.generation++;
}

static bool glowLoadFile(GlowSlot &s, const char *name) {
  char path[64];
  snprintf_P(path, sizeof(path), PSTR("%s/%s.glw"), _glow_dir, name);
  File f = WLED_FS.open(path, "r");
  if (!f) return false;
  size_t sz = f.size();
  if (sz < 20 || sz > GLOW_MAX_IMAGE) { f.close(); DEBUG_PRINTF_P(PSTR("Glow: %s bad size %u\n"), path, sz); return false; }
  uint8_t *buf = (uint8_t *)malloc(sz);
  if (!buf) { f.close(); return false; }
  bool ok = f.read(buf, sz) == sz;
  f.close();
  glow::Image img;
  const char *err = ok ? img.load(buf, sz) : "read failed";
  if (err || img.kind != glow::K_EFFECT) {
    DEBUG_PRINTF_P(PSTR("Glow: %s rejected: %s\n"), path, err ? err : "not an effect");
    free(buf); return false;
  }
  char *md = (char *)malloc(img.metaLen + 1);
  if (!md) { free(buf); return false; }
  memcpy(md, img.meta, img.metaLen); md[img.metaLen] = 0;

  glowUnload(s);
  s.bytes = buf; s.size = sz; s.img = img; s.modeData = md;
  strlcpy(s.file, name, sizeof(s.file));
  if (s.fxId != 255) strip.setModeData(s.fxId, md);
  return true;
}

static void glowSaveSlots() {
  StaticJsonDocument<1024> doc;
  JsonObject o = doc.to<JsonObject>();
  for (int i = 0; i < GLOW_SLOTS; i++) if (glowSlots[i].file[0]) o[String(i)] = glowSlots[i].file;
  File f = WLED_FS.open(FPSTR(_glow_slots), "w");
  if (f) { serializeJson(doc, f); f.close(); }
}

// Load everything: keep slot assignments from slots.json, give new scripts free slots.
static void glowReloadAll() {
  if (!WLED_FS.exists(FPSTR(_glow_dir))) WLED_FS.mkdir(FPSTR(_glow_dir));

  char wanted[GLOW_SLOTS][GLOW_NAME_LEN + 1] = {};
  File f = WLED_FS.open(FPSTR(_glow_slots), "r");
  if (f) {
    StaticJsonDocument<1024> doc;
    if (!deserializeJson(doc, f)) {
      for (JsonPair kv : doc.as<JsonObject>()) {
        int i = atoi(kv.key().c_str());
        const char *n = kv.value() | "";
        if (i >= 0 && i < GLOW_SLOTS && validName(n)) strlcpy(wanted[i], n, sizeof(wanted[i]));
      }
    }
    f.close();
  }

  // discover images on the filesystem
  File dir = WLED_FS.open(FPSTR(_glow_dir));
  while (dir) {
    File e = dir.openNextFile();
    if (!e) break;
    String n = e.name();
    e.close();
    int slash = n.lastIndexOf('/'); if (slash >= 0) n = n.substring(slash + 1);
    if (!n.endsWith(F(".glw"))) continue;
    n.remove(n.length() - 4);
    if (!validName(n.c_str())) continue;
    bool known = false;
    for (int i = 0; i < GLOW_SLOTS; i++) if (!strcmp(wanted[i], n.c_str())) known = true;
    if (known) continue;
    for (int i = 0; i < GLOW_SLOTS; i++) if (!wanted[i][0]) { strlcpy(wanted[i], n.c_str(), sizeof(wanted[i])); break; }
  }
  dir.close();

  for (int i = 0; i < GLOW_SLOTS; i++) {
    if (!wanted[i][0] || !glowLoadFile(glowSlots[i], wanted[i])) glowUnload(glowSlots[i]);
  }
  glowSaveSlots();
}

static void glowDelete(const char *name) {
  if (!validName(name)) return;
  for (int i = 0; i < GLOW_SLOTS; i++) if (!strcmp(glowSlots[i].file, name)) glowUnload(glowSlots[i]);
  char path[64];
  snprintf_P(path, sizeof(path), PSTR("%s/%s.glw"), _glow_dir, name);  WLED_FS.remove(path);
  snprintf_P(path, sizeof(path), PSTR("%s/%s.glow"), _glow_dir, name); WLED_FS.remove(path);
  glowSaveSlots();
}

// ---------------- public hooks (fcn_declare.h) ----------------
void glowSetup() {
  if (!glowVM) glowVM = new glow::VM();
  // pad the effect list with reserved entries so Glow slots start at GLOW_FX_BASE;
  // appending (id >= list size) avoids taking holes upstream keeps for removed effects
  while (strip.getModeCount() < GLOW_FX_BASE) if (strip.addEffect(254, glowReserved, _glow_rsvd) == 255) break;
  for (int i = 0; i < GLOW_SLOTS; i++) glowSlots[i].fxId = strip.addEffect(254, GlowFns::fns[i], _glow_rsvd);
  glowReloadAll();
}

void glowLoop() {
  if (glowDeletePending[0]) { glowDelete(glowDeletePending); glowDeletePending[0] = 0; updateFSInfo(); }
  if (glowReloadPending) { glowReloadPending = false; glowReloadAll(); stateChanged = true; }
}

void glowRequestReload() { glowReloadPending = true; }

void glowSerializeInfo(JsonObject root) {
  JsonObject g = root.createNestedObject(F("glow"));
  g[F("v")] = 1;
  g[F("budget")] = GLOW_BUDGET;
  JsonArray arr = g.createNestedArray(F("slots"));
  for (int i = 0; i < GLOW_SLOTS; i++) {
    const GlowSlot &s = glowSlots[i];
    if (!s.bytes) continue;
    JsonObject o = arr.createNestedObject();
    o[F("id")] = i;
    o[F("fx")] = s.fxId;
    o[F("file")] = s.file;
    o[F("size")] = s.size;
    if (s.lastError) o[F("err")] = glow::errorText(s.lastError);
  }
}

void glowDeserializeState(JsonObject g) {
  if (g[F("reload")]) glowRequestReload();
  const char *del = g[F("del")] | "";
  if (del[0] && validName(del)) strlcpy(glowDeletePending, del, sizeof(glowDeletePending));
}

#else
void glowSetup() {}
void glowLoop() {}
void glowRequestReload() {}
void glowSerializeInfo(JsonObject) {}
void glowDeserializeState(JsonObject) {}
#endif
