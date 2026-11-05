/*
 * Crash log: keeps the last panic (reason, PC, backtrace) in RTC memory across the reboot and
 * reports it in /json/info as "crash", so a crash can be located without a serial cable:
 *   xtensa-esp32-elf-addr2line -pfiaC -e firmware.elf <bt...>
 *
 * Uses the Arduino core's panic hook (set_arduino_panic_handler), which runs inside the panic
 * handler with the backtrace already walked. RTC_NOINIT memory survives software resets and
 * panics but not power loss; the magic word guards against garbage after power-on.
 */
#include "wled.h"

#if defined(ARDUINO_ARCH_ESP32) && defined(WLED_CRASH_LOG)
#include "esp_attr.h"

#define CRASH_MAGIC 0x43525348u
#define CRASH_DEPTH 16

struct CrashLog {
  uint32_t magic;
  uint32_t core, pc, n;
  uint32_t bt[CRASH_DEPTH];
  char reason[40];
};
static RTC_NOINIT_ATTR CrashLog crashLog;

// Runs inside the panic handler: no allocation, no locks, nothing that may need the flash cache
// except the reason string, which IDF keeps in DRAM/rodata it can already print from.
static void IRAM_ATTR crashLogPanic(arduino_panic_info_t *info, void *) {
  crashLog.magic = 0;  // invalid until complete
  crashLog.core = info->core;
  crashLog.pc = (uint32_t)info->pc;
  crashLog.n = info->backtrace_len < CRASH_DEPTH ? info->backtrace_len : CRASH_DEPTH;
  for (uint32_t i = 0; i < crashLog.n; i++) crashLog.bt[i] = info->backtrace[i];
  size_t k = 0;
  if (info->reason) for (; k < sizeof(crashLog.reason) - 1 && info->reason[k]; k++) crashLog.reason[k] = info->reason[k];
  crashLog.reason[k] = 0;
  crashLog.magic = CRASH_MAGIC;
}

static struct CrashLogInit { CrashLogInit() { set_arduino_panic_handler(crashLogPanic, nullptr); } } crashLogInit;

void crashLogSerialize(JsonObject root) {
  if (crashLog.magic != CRASH_MAGIC || crashLog.n > CRASH_DEPTH) return;
  char buf[12];
  JsonObject c = root.createNestedObject(F("crash"));
  c[F("core")] = crashLog.core;
  crashLog.reason[sizeof(crashLog.reason) - 1] = 0;
  c[F("reason")] = (char *)crashLog.reason;  // non-const: ArduinoJson copies it
  snprintf_P(buf, sizeof(buf), PSTR("0x%08x"), crashLog.pc); c[F("pc")] = buf;
  JsonArray bt = c.createNestedArray(F("bt"));
  for (uint32_t i = 0; i < crashLog.n; i++) { snprintf_P(buf, sizeof(buf), PSTR("0x%08x"), crashLog.bt[i]); bt.add(buf); }
}
#else
void crashLogSerialize(JsonObject) {}
#endif
