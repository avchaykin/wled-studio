#!/usr/bin/env python3
"""Dev server for WLED Studio: serves a fresh bundle at / and proxies everything
else (HTTP and WebSocket) to a device as raw TCP.

Python rather than Node because macOS "Local Network" privacy can block the
Node binary from reaching LAN devices.
Usage: DEVICE=192.168.1.118 PORT=5180 python3 studio/dev.py
"""
import os, socket, socketserver, subprocess, threading

DEVICE = os.environ.get("DEVICE", "192.168.1.118")
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


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"WLED Studio dev: http://localhost:{PORT}  (device {DEVICE})", flush=True)
    Server(("127.0.0.1", PORT), Handler).serve_forever()
