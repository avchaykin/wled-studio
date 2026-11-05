#!/bin/sh
# Native VM benchmark: frames/second for a few representative scripts (250 LEDs).
# usage: sh glow/test/native/bench.sh [cxxflags]
set -e
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
W=$(mktemp -d)
c++ -std=c++17 -O2 ${1:-} -o "$W/h" "$ROOT/glow/test/native/harness.cpp" "$ROOT/wled00/glow_vm.cpp"
cat > "$W/noise10.glow" <<'G'
effect "Bench" { fn pixel(i) { let s = 0
 for k in 0..10 { s += noise(i / 9 + k, t / 2000) }
 return hsv(s * 25.5, 255, 255) } }
G
cat > "$W/arith.glow" <<'G'
effect "Arith" { fn pixel(i) { let a = 0
 for k in 0..20 { a = (a + i * k * 3 + 7) % 251 }
 return rgb(a, 255 - a, k_dummy()) }
 fn k_dummy() { return 0 } }
G
for f in noise10 arith; do
  node "$ROOT/glow/cli.mjs" compile "$W/$f.glow" --out "$W/$f.glw" >/dev/null
  N=2000
  T0=$(python3 -c 'import time;print(time.perf_counter())')
  GLOW_QUIET=1 "$W/h" "$W/$f.glw" 250 $N 1 >/dev/null
  T1=$(python3 -c 'import time;print(time.perf_counter())')
  python3 -c "print('$f: %.0f frames/s (250 LEDs)' % ($N/($T1-$T0)))"
done
for ex in "$ROOT"/glow/examples/*.glow; do
  node "$ROOT/glow/cli.mjs" compile "$ex" --out "$W/ex.glw" >/dev/null
  T0=$(python3 -c 'import time;print(time.perf_counter())'); GLOW_QUIET=1 "$W/h" "$W/ex.glw" 250 2000 1 >/dev/null; T1=$(python3 -c 'import time;print(time.perf_counter())')
  python3 -c "print('$(basename $ex .glow): %.0f frames/s' % (2000/($T1-$T0)))"
done
rm -rf "$W"
