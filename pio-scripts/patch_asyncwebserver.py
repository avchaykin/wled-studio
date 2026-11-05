# ESPAsyncWebServer frees its 1460-byte multipart item buffer only when a file part
# completes, so every upload whose connection drops mid-file leaks it (~1.5 KB of heap
# per aborted /upload, measured on an ESP32 with a flaky Wi-Fi link).
#
# Patch the fetched library source in place: free any leftover buffer in the request
# destructor (the normal path already sets the pointer to NULL after freeing). Idempotent.
Import("env")
import os

MARK = "/* wled-studio: free multipart buffer */"
path = os.path.join(env.subst("$PROJECT_LIBDEPS_DIR"), env.subst("$PIOENV"), "ESPAsyncWebServerWLED", "src", "WebRequest.cpp")

if not os.path.isfile(path):
  print("patch_asyncwebserver: library not found, skipping (" + path + ")")
else:
  src = open(path).read()
  if MARK not in src:
    dtor = "  if(_tempFile){\n    _tempFile.close();\n  }\n"
    if src.count(dtor) != 1 or "free(_itemBuffer);\n        _itemBuffer = NULL;" not in src:
      raise SystemExit("patch_asyncwebserver: unexpected WebRequest.cpp layout, update the patch")
    src = src.replace(dtor, dtor + "\n  " + MARK + "\n  if(_itemBuffer){\n    free(_itemBuffer);\n    _itemBuffer = NULL;\n  }\n")
    open(path, "w").write(src)
    print("patch_asyncwebserver: patched " + path)
