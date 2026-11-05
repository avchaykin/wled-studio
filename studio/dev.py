#!/usr/bin/env python3
"""Dev server for WLED Studio: serves a fresh bundle at / and proxies everything
else (HTTP and WebSocket) to a device as raw TCP.

Python rather than Node because macOS "Local Network" privacy can block the
Node binary from reaching LAN devices.
Usage: DEVICE=192.168.1.118 PORT=5180 python3 studio/dev.py
"""
import json, os, re, socket, socketserver, subprocess, threading, urllib.request

DEVICE = os.environ.get("DEVICE", "192.168.1.118")
# MOCK2D=WxH fakes a matrix device (info/state handled here, catalogue proxied, no WebSocket)
MOCK2D = os.environ.get("MOCK2D")
mock_state = None
PORT = int(os.environ.get("PORT", "5180"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pipe(src, dst):
    try:
        while (b := src.recv(65536)):
            dst.sendall(b)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        c = self.request
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = c.recv(65536)
            if not chunk: return
            head += chunk
        line = head.split(b"\r\n", 1)[0].decode("latin1")
        parts = line.split(" ")
        path = parts[1] if len(parts) > 1 else "/"
        if parts[0] == "GET" and path.split("?")[0] in ("/", "/index.html"):
            r = subprocess.run(["node", os.path.join(ROOT, "studio", "build.mjs"), "--dev"], cwd=ROOT, capture_output=True)
            if r.returncode == 0:
                body = open(os.path.join(ROOT, "studio", "dist", "index.html"), "rb").read()
                status, ctype = "200 OK", "text/html; charset=utf-8"
            else:
                body, status, ctype = r.stderr, "500 Build Failed", "text/plain"
            c.sendall(f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + body)
            return
        if MOCK2D and self.mock(c, parts[0], path, head):
            return
        # rewrite Host and force one request per connection so "/" is always ours
        lines = head.split(b"\r\n")
        out = [lines[0]]
        upgrade = any(l.lower().startswith(b"upgrade:") for l in lines)
        for l in lines[1:]:
            ll = l.lower()
            if ll.startswith(b"host:"): l = b"Host: " + DEVICE.encode()
            elif ll.startswith(b"connection:") and not upgrade: l = b"Connection: close"
            out.append(l)
        try:
            d = socket.create_connection((DEVICE, 80), timeout=10)
            d.settimeout(None)
        except OSError as e:
            msg = f"device unreachable: {e}".encode()
            c.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(msg) + msg)
            return
        d.sendall(b"\r\n".join(out))
        t = threading.Thread(target=pipe, args=(c, d), daemon=True)
        t.start()
        pipe(d, c)
        t.join(timeout=1)


def _mock_reply(c, obj, status="200 OK"):
    body = json.dumps(obj).encode()
    c.sendall(f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)


def _mock(self, c, method, path, head):
    global mock_state
    w, h = (int(v) for v in MOCK2D.split("x"))
    p = path.split("?")[0]
    if p == "/ws":
        c.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return True
    if p not in ("/json/si", "/json/info", "/json/state"):
        return False
    try:
        real = json.loads(urllib.request.urlopen(f"http://{DEVICE}/json/si", timeout=3).read())
    except OSError:  # device offline: a minimal stand-in (catalogue comes from the browser cache)
        real = {"info": {"name": "Mock", "ver": "mock", "vid": 2607201, "leds": {"count": 0, "maxseg": 32, "fps": 0},
                         "wifi": {"signal": 0}, "freeheap": 0, "uptime": 0,
                         "glow": {"v": 1, "slots": [{"file": f, "fx": 230 + i} for i, f in enumerate(["aurora", "comet", "fire-bars", "rainbow-pulse", "sparkle"])], "shows": []}},
                "state": {"on": True, "bri": 128, "seg": [{"id": 0, "start": 0, "stop": 1, "fx": 0, "pal": 0, "col": [[255, 120, 0], [0, 0, 0], [0, 0, 0]], "sx": 128, "ix": 128, "on": True, "bri": 255}]}}
    info = real["info"]; info["name"] = "Mock Matrix"; info["leds"]["count"] = w * h; info["leds"]["matrix"] = {"w": w, "h": h}
    if mock_state is None:
        mock_state = real["state"]
        mock_state["seg"] = [{**real["state"]["seg"][0], "id": 0, "start": 0, "stop": w, "startY": 0, "stopY": h, "len": w * h}]
    if method == "POST" and p == "/json/state":
        n = int(re.search(rb"(?i)content-length:\s*(\d+)", head).group(1))
        body = head.split(b"\r\n\r\n", 1)[1]
        while len(body) < n: body += c.recv(65536)
        patch = json.loads(body)
        for k, v in patch.items():
            if k != "seg": mock_state[k] = v
        for s in patch.get("seg", []):
            cur = next((x for x in mock_state["seg"] if x["id"] == s["id"]), None)
            if cur is None: mock_state["seg"].append({**mock_state["seg"][0], "n": "", **s})
            else: cur.update(s)
        mock_state["seg"] = sorted([x for x in mock_state["seg"] if x.get("stop", 1) > x.get("start", 0)], key=lambda x: x["id"])
        _mock_reply(c, {"state": mock_state, "info": info}); return True
    _mock_reply(c, {"state": mock_state, "info": info} if p == "/json/si" else info if p == "/json/info" else mock_state)
    return True


Handler.mock = _mock


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"WLED Studio dev: http://localhost:{PORT}  (device {DEVICE})", flush=True)
    Server(("127.0.0.1", PORT), Handler).serve_forever()
