#!/usr/bin/env python3
"""Publish a WLED Studio firmware release.

Bumps wled00/studio_version.h, rebuilds the Studio UI header and the firmware, then adds
the binary and a manifest entry to the public release repo (served by GitHub Pages at
https://avchaykin.github.io/wled-studio-releases/), which Studio's update check reads.
Each release links to its tagged source in the public repo avchaykin/wled-studio (EUPL).

  python3 tools/release.py 0.2.0 -n "Presets on Lights" -n "Palette editor"
  python3 tools/release.py 0.2.0 --dry-run      # build and stage, commit/push nothing

Environment: RELEASES_REPO (default ~/dev/wled-studio-releases, a clone of the public
repo), PIO (default ~/.local/bin/pio). The firmware.elf of each release is kept in
build_output/elf/ for decoding crash backtraces (info.crash) with addr2line.
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASES = os.path.expanduser(os.environ.get("RELEASES_REPO", "~/dev/wled-studio-releases"))
PIO = os.path.expanduser(os.environ.get("PIO", "~/.local/bin/pio"))
# PlatformIO env -> the device's info.release (WLED_RELEASE_NAME), the manifest's build key
ENVS = {"esp32dev": "ESP32"}


def run(*cmd, cwd=ROOT):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def git_out(*args, cwd=ROOT):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", help="semantic version, e.g. 0.2.0")
    ap.add_argument("-n", "--note", action="append", default=[], help="release note line (repeatable)")
    ap.add_argument("--env", action="append", help="PlatformIO env(s) to build (default: all in ENVS)")
    ap.add_argument("--dry-run", action="store_true", help="build and stage files but do not commit, tag or push")
    a = ap.parse_args()

    if not re.fullmatch(r"\d+\.\d+\.\d+", a.version):
        sys.exit("version must look like 1.2.3")
    if not os.path.isdir(os.path.join(RELEASES, ".git")):
        sys.exit(f"release repo clone not found at {RELEASES} (set RELEASES_REPO)")
    dirty = [l for l in git_out("status", "--porcelain").splitlines() if not l.startswith("??")]
    if dirty and not a.dry_run:
        sys.exit("source tree has uncommitted changes:\n" + "\n".join(dirty))
    manifest_path = os.path.join(RELEASES, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"releases": []}
    if any(r["version"] == a.version for r in manifest["releases"]):
        sys.exit(f"{a.version} is already published")

    vh = os.path.join(ROOT, "wled00", "studio_version.h")
    src = open(vh).read()
    open(vh, "w").write(re.sub(r'#define STUDIO_VERSION "[^"]*"', f'#define STUDIO_VERSION "{a.version}"', src))
    run("node", "studio/build.mjs", "--header")

    builds = {}
    os.makedirs(os.path.join(RELEASES, "fw"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "build_output", "elf"), exist_ok=True)
    for env in a.env or list(ENVS):
        run(PIO, "run", "-e", env)
        out = os.path.join(ROOT, ".pio", "build", env)
        name = f"wled-studio-{a.version}-{env}.bin"
        shutil.copy(os.path.join(out, "firmware.bin"), os.path.join(RELEASES, "fw", name))
        shutil.copy(os.path.join(out, "firmware.elf"), os.path.join(ROOT, "build_output", "elf", f"wled-studio-{a.version}-{env}.elf"))
        data = open(os.path.join(out, "firmware.bin"), "rb").read()
        builds[ENVS[env]] = {"file": f"fw/{name}", "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "env": env}
        print(f"  {name}: {len(data)} bytes")

    # EUPL: every published binary points at its exact source
    rel = {"version": a.version, "date": datetime.date.today().isoformat(), "notes": a.note,
           "source": f"https://github.com/avchaykin/wled-studio/tree/v{a.version}", "builds": builds}
    manifest["releases"] = [rel] + [r for r in manifest["releases"] if r["version"] != a.version]
    manifest["latest"] = a.version
    json.dump(manifest, open(manifest_path, "w"), indent=1)
    open(manifest_path, "a").write("\n")

    if a.dry_run:
        print(f"dry run: staged {a.version} in {RELEASES}; nothing committed")
        return
    run("git", "add", "wled00/studio_version.h", "wled00/html_studio.h")
    if git_out("diff", "--cached", "--name-only"):
        run("git", "commit", "-m", f"Release {a.version}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")
    run("git", "tag", "-a", f"v{a.version}", "-m", f"WLED Studio {a.version}")
    run("git", "add", "manifest.json", "fw", cwd=RELEASES)
    run("git", "commit", "-m", f"WLED Studio {a.version}", cwd=RELEASES)
    run("git", "push", cwd=RELEASES)
    run("git", "push", "--follow-tags", cwd=ROOT)
    print(f"published {a.version}: https://avchaykin.github.io/wled-studio-releases/manifest.json (Pages takes a minute)")


if __name__ == "__main__":
    main()
