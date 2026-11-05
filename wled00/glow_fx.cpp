/*
 * Glow scripts as WLED effects.
 *
 * GLOW_SLOTS effect IDs are reserved at boot so that a script keeps the same
 * effect ID across reboots (presets, playlists and Home Assistant refer to effects by ID).
 * Compiled images live in /glow/<name>.glw (source in /glow/<name>.glow);
 * /glow/slots.json maps slot index -> script name.
 *
 * Show scripts (kind show) are not effects: one can run at a time, driven by events
 * (start/stop, every, at, button, beat) from glowLoop().
 *
 * JSON API:
 *   info.glow  -> { slots: [{ id, fx, file, size, err }], shows: [names], budget }
 *   state.glow <- { reload: true } | { del: "name" } | { show: "name" | "" }
 *   state.glow -> { show: "name" } while a show runs (so presets can start shows)
 */
#include "wled.h"

#ifndef WLED_DISABLE_GLOW
#include "glow_vm.h"

#ifndef GLOW_SLOTS
  #define GLOW_SLOTS 16
#endif
#ifndef GLOW_BUDGET
  #define GLOW_BUDGET 60000     // loop iterations + calls + built-in calls per segment per frame
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

// ---------------- shows ----------------
#define GLOW_MAX_SHOWS 16
static char glowShowNames[GLOW_MAX_SHOWS][GLOW_NAME_LEN + 1];
static uint8_t glowShowCount = 0;

static int glowFileKind(const char *name) {
  char path[64];
  snprintf_P(path, sizeof(path), PSTR("%s/%s.glw"), _glow_dir, name);
  File f = WLED_FS.open(path, "r");
  if (!f) return -1;
  uint8_t hdr[6] = {};
  f.read(hdr, sizeof(hdr)); f.close();
  return hdr[0] == 'G' && hdr[1] == 'L' && hdr[2] == 'W' ? hdr[5] : -1;
}
static void glowAddShowName(const char *n) {
  if (glowShowCount < GLOW_MAX_SHOWS) strlcpy(glowShowNames[glowShowCount++], n, GLOW_NAME_LEN + 1);
}

struct GlowShow {
  uint8_t *bytes = nullptr; size_t size = 0;
  glow::Image img;
  uint8_t *state = nullptr; size_t stateSize = 0;
  char file[GLOW_NAME_LEN + 1] = "";
  uint32_t next[64];          // next due time per EVERY event
  uint16_t lastMinute = 0xffff;
  bool lastPeak = false;
  uint8_t lastError = 0;
};
static GlowShow glowShow;
static char glowShowPending[GLOW_NAME_LEN + 1] = "";
static bool glowShowStopPending = false;

// case-insensitive name match: exact first, then prefix
static int glowFindName(const char *want, int wlen, int count, void (*nameAt)(int, char *, size_t)) {
  char buf[48];
  for (int pass = 0; pass < 2; pass++)
    for (int i = 0; i < count; i++) {
      nameAt(i, buf, sizeof(buf));
      int l = strlen(buf);
      if (!l || !strcmp_P(buf, PSTR("RSVD"))) continue;
      if ((pass == 0 ? l == wlen : l >= wlen) && !strncasecmp(buf, want, wlen)) return i;
    }
  return -1;
}
static void glowEffectName(int i, char *buf, size_t n) {
  strncpy_P(buf, strip.getModeData(i), n - 1); buf[n - 1] = 0;
  char *at = strchr(buf, '@'); if (at) *at = 0;
}
static int glowPaletteCount = 0;
static void glowPaletteName(int i, char *buf, size_t n) {
  // walk the PROGMEM JSON array of palette names: ["Default","* Random Cycle",...]
  const char *p = JSON_palette_names; int idx = -1; buf[0] = 0;
  for (char c; (c = pgm_read_byte(p)); p++) {
    if (c != '"') continue;
    idx++;
    size_t k = 0;
    for (p++; (c = pgm_read_byte(p)) && c != '"'; p++) if (idx == i && k < n - 1) buf[k++] = c;
    if (idx == i) { buf[k] = 0; return; }
    if (!c) break;
  }
}
static int glowCountPalettes() {
  if (!glowPaletteCount) { char b[48]; for (int i = 0; i < 255; i++) { glowPaletteName(i, b, sizeof(b)); if (!b[0]) { glowPaletteCount = i; break; } } }
  return glowPaletteCount;
}

static void glowApply(JsonDocument &doc) { deserializeState(doc.as<JsonObject>(), CALL_MODE_DIRECT_CHANGE); }

class ShowHost : public glow::Host {
public:
  uint32_t getPixel(int) override { return 0; }
  void setPixel(int, uint32_t) override {}
  uint32_t palette(uint8_t) override { return 0; }  // no segment context in shows
  bool show(uint8_t id, const glow::Value *a, uint8_t argc, const glow::Image &img, glow::Value &out) override {
    using namespace glow;
    auto isNum = [&](int k) { return a[k].tag == T_NUM || a[k].tag == T_BOOL; };
    auto num = [&](int k) { return isNum(k) ? a[k].f : 0.0f; };
    auto clampi = [](float v, int lo, int hi) { return !(v >= lo) ? lo : v > hi ? hi : (int)v; };
    out.tag = T_NUM; out.f = 0;
    StaticJsonDocument<1024> doc;
    int segId = argc ? clampi(num(0), 0, strip.getMaxSegments() - 1) : 0;
    auto seg = [&]() { JsonObject s = doc.createNestedArray("seg").createNestedObject(); s["id"] = segId; out.f = segId; return s; };
    // name-or-number argument: string -> lookup, -1 -> "~" (next), number -> id
    auto pick = [&](JsonObject s, const char *key, int count, void (*nameAt)(int, char *, size_t)) -> bool {
      if (a[1].tag == T_STR) {
        const char *str; int l = img.str((uint8_t)a[1].u, &str);
        int idx = l > 0 ? glowFindName(str, l, count, nameAt) : -1;
        if (idx < 0) return true;                // unknown name: ignore (shows keep running)
        s[key] = idx; return true;
      }
      if (!isNum(1)) return false;
      if (num(1) < 0) s[key] = "~"; else s[key] = clampi(num(1), 0, 255);
      return true;
    };
    switch (id) {
      case N_SEG: out.f = segId; return true;
      case N_SEG_EFFECT: { JsonObject s = seg(); if (!pick(s, "fx", strip.getModeCount(), glowEffectName)) return false; break; }
      case N_SEG_PALETTE: { JsonObject s = seg(); if (!pick(s, "pal", glowCountPalettes(), glowPaletteName)) return false; break; }
      case N_SEG_COLORS: {
        JsonObject s = seg(); JsonArray col = s.createNestedArray("col");
        for (int k = 1; k < argc; k++) {
          if (a[k].tag != T_COLOR) return false;
          uint32_t c = a[k].u; JsonArray e = col.createNestedArray();
          e.add((c >> 16) & 255); e.add((c >> 8) & 255); e.add(c & 255); e.add((c >> 24) & 255);
        }
        break;
      }
      case N_SEG_SPEED: if (!isNum(1)) return false; seg()["sx"] = clampi(num(1), 0, 255); break;
      case N_SEG_INTENSITY: if (!isNum(1)) return false; seg()["ix"] = clampi(num(1), 0, 255); break;
      case N_SEG_BRI: if (!isNum(1)) return false; seg()["bri"] = clampi(num(1), 0, 255); break;
      case N_SEG_ON: if (!isNum(1)) return false; seg()["on"] = num(1) != 0; break;
      case N_SPLIT: {
        int n = clampi(num(0), 1, strip.getMaxSegments());
        int total = strip.getLengthTotal();
        if (n > total) n = total;
        JsonArray segs = doc.createNestedArray("seg");
        for (int k = 0; k < n; k++) { JsonObject s = segs.createNestedObject(); s["id"] = k; s["start"] = total * k / n; s["stop"] = total * (k + 1) / n; s["on"] = true; }
        for (int k = n; k < strip.getMaxSegments(); k++) { JsonObject s = segs.createNestedObject(); s["id"] = k; s["stop"] = 0; }
        out.f = n;
        break;
      }
      case N_PRESET: {
        if (a[0].tag == T_STR) {
          const char *str; int l = img.str((uint8_t)a[0].u, &str);
          String nm;
          for (int p = 1; p < 251 && l > 0; p++) if (getPresetName(p, nm) && (int)nm.length() == l && !strncasecmp(nm.c_str(), str, l)) { doc["ps"] = p; break; }
          if (!doc.containsKey("ps")) return true;  // unknown preset: ignore
        } else if (num(0) < 0) doc["ps"] = "1~250~";  // next preset
        else doc["ps"] = clampi(num(0), 1, 250);
        break;
      }
      case N_POWER: doc["on"] = num(0) != 0; break;
      case N_BRIGHTNESS: {
        doc["bri"] = clampi(num(0), 0, 255);
        if (argc > 1) doc["tt"] = clampi(num(1) / 100, 0, 65535);
        break;
      }
      case N_HOUR: out.f = hour(localTime); return true;
      case N_MINUTE: out.f = minute(localTime); return true;
      case N_SEGCOUNT: out.f = strip.getActiveSegmentsNum(); return true;
      default: return false;
    }
    glowApply(doc);
    return true;
  }
};

static void glowShowRun(uint8_t type, uint32_t arg, bool matchArg) {
  GlowShow &s = glowShow;
  if (!s.bytes || !glowVM) return;
  ShowHost host;
  for (uint8_t i = 0; i < s.img.nEvents; i++) {
    glow::Event e = s.img.event(i);
    if (e.type != type || (matchArg && e.arg != arg)) continue;
    if (!glowVM->runEvent(s.img, host, e.fn, s.state, s.stateSize, hw_random() | 1, GLOW_BUDGET)) {
      s.lastError = glowVM->lastError;
      DEBUG_PRINTF_P(PSTR("Glow show %s: %s\n"), s.file, glow::errorText(s.lastError));
    }
  }
}

static void glowShowStop() {
  GlowShow &s = glowShow;
  if (!s.bytes) return;
  glowShowRun(glow::EV_STOP, 0, false);
  free(s.bytes); free(s.state);
  s = GlowShow();
  stateChanged = true;
}

static bool glowShowStart(const char *name) {
  glowShowStop();
  if (!validName(name) || glowFileKind(name) != glow::K_SHOW || !glowVM) return false;
  char path[64];
  snprintf_P(path, sizeof(path), PSTR("%s/%s.glw"), _glow_dir, name);
  File f = WLED_FS.open(path, "r");
  if (!f) return false;
  size_t sz = f.size();
  if (sz < 20 || sz > GLOW_MAX_IMAGE) { f.close(); return false; }
  uint8_t *buf = (uint8_t *)malloc(sz);
  if (!buf) { f.close(); return false; }
  bool ok = f.read(buf, sz) == sz; f.close();
  glow::Image img;
  if (!ok || img.load(buf, sz) || img.kind != glow::K_SHOW) { free(buf); return false; }
  ShowHost host;
  uint32_t arena = 0;
  if (!glowVM->measureArena(img, host, arena)) { free(buf); return false; }
  size_t need = glow::stateBaseSize(img) + arena;
  uint8_t *state = (uint8_t *)calloc(1, need);
  if (!state) { free(buf); return false; }
  GlowShow &s = glowShow;
  s.bytes = buf; s.size = sz; s.img = img; s.state = state; s.stateSize = need;
  strlcpy(s.file, name, sizeof(s.file));
  uint32_t now = millis();
  for (uint8_t i = 0; i < img.nEvents && i < 64; i++) s.next[i] = now + img.event(i).arg;
  glowShowRun(glow::EV_START, 0, false);
  stateChanged = true;
  return true;
}

static void glowShowLoop() {
  GlowShow &s = glowShow;
  if (!s.bytes) return;
  uint32_t now = millis();
  ShowHost host;
  for (uint8_t i = 0; i < s.img.nEvents && i < 64 && s.bytes; i++) {
    glow::Event e = s.img.event(i);
    if (e.type != glow::EV_EVERY || (int32_t)(now - s.next[i]) < 0) continue;
    s.next[i] = now + e.arg;
    if (!glowVM->runEvent(s.img, host, e.fn, s.state, s.stateSize, hw_random() | 1, GLOW_BUDGET)) s.lastError = glowVM->lastError;
  }
  if (localTime > 1600000000UL) {   // only once the clock is set
    uint16_t m = hour(localTime) * 60 + minute(localTime);
    if (m != s.lastMinute) { bool first = s.lastMinute == 0xffff; s.lastMinute = m; if (!first) glowShowRun(glow::EV_AT, m, true); }
  }
  um_data_t *um;
  if (UsermodManager::getUMData(&um, USERMOD_ID_AUDIOREACTIVE)) {
    bool peak = *(uint8_t *)um->u_data[3] != 0;
    if (peak && !s.lastPeak) glowShowRun(glow::EV_BEAT, 0, false);
    s.lastPeak = peak;
  }
}

// Load everything: keep slot assignments from slots.json, give new scripts free slots.
static void glowReloadAll() {
  glowShowCount = 0;
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
    if (glowFileKind(n.c_str()) == glow::K_SHOW) { glowAddShowName(n.c_str()); continue; }
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
  if (glowDeletePending[0]) {
    if (!strcmp(glowShow.file, glowDeletePending)) glowShowStop();
    glowDelete(glowDeletePending); glowDeletePending[0] = 0; updateFSInfo(); glowReloadPending = true;
  }
  if (glowReloadPending) {
    glowReloadPending = false; glowReloadAll(); stateChanged = true;
    // a reloaded show restarts so it runs the new code
    if (glowShow.bytes) strlcpy(glowShowPending, glowShow.file, sizeof(glowShowPending));
  }
  if (glowShowStopPending) { glowShowStopPending = false; glowShowStop(); }
  if (glowShowPending[0]) { glowShowStart(glowShowPending); glowShowPending[0] = 0; }
  glowShowLoop();
}

bool glowButton(uint8_t b) {
  if (!glowShow.bytes) return false;
  for (uint8_t i = 0; i < glowShow.img.nEvents; i++) {
    glow::Event e = glowShow.img.event(i);
    if (e.type == glow::EV_BUTTON && e.arg == b) { glowShowRun(glow::EV_BUTTON, b, true); return true; }
  }
  return false;
}

void glowSerializeState(JsonObject root) {
  if (glowShow.bytes) root.createNestedObject(F("glow"))[F("show")] = glowShow.file;
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
  JsonArray sh = g.createNestedArray(F("shows"));
  for (int i = 0; i < glowShowCount; i++) sh.add(glowShowNames[i]);
  if (glowShow.bytes) {
    g[F("show")] = glowShow.file;
    if (glowShow.lastError) g[F("showErr")] = glow::errorText(glowShow.lastError);
  }
}

void glowDeserializeState(JsonObject g) {
  if (g[F("reload")]) glowRequestReload();
  const char *del = g[F("del")] | "";
  if (del[0] && validName(del)) strlcpy(glowDeletePending, del, sizeof(glowDeletePending));
  if (g.containsKey(F("show"))) {
    const char *sh = g[F("show")] | "";
    if (!sh[0]) glowShowStopPending = true;
    else if (validName(sh) && strcmp(sh, glowShow.file)) strlcpy(glowShowPending, sh, sizeof(glowShowPending));
  }
}

#else
bool glowButton(uint8_t) { return false; }
void glowSerializeState(JsonObject) {}
void glowSetup() {}
void glowLoop() {}
void glowRequestReload() {}
void glowSerializeInfo(JsonObject) {}
void glowDeserializeState(JsonObject) {}
#endif
