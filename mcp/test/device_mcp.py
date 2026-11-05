# /// script
# dependencies = ["mcp>=1.10,<2"]
# ///
"""Talk to the on-device MCP endpoint (http://<device>/mcp) with the official MCP client."""
import asyncio, json, os, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

HOST = os.environ.get("WLED_HOST", "192.168.1.118")

async def main():
    async with streamablehttp_client(f"http://{HOST}/mcp") as (r, w, _):
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("server:", init.serverInfo.name, init.serverInfo.version, "protocol", init.protocolVersion)
            tools = await s.list_tools(); print("tools:", [t.name for t in tools.tools])
            st = json.loads((await s.call_tool("get_state", {})).content[0].text)
            print("get_state: on", st["state"]["on"], "bri", st["state"]["bri"], "segs", len(st["state"]["seg"]), "leds", st["info"]["leds"]["count"])
            fx = (await s.call_tool("list_effects", {})).content[0].text.splitlines()
            print("list_effects:", len(fx), fx[:2], [l for l in fx if l.startswith("23")][:3])
            pal = (await s.call_tool("list_palettes", {})).content[0].text.splitlines(); print("list_palettes:", len(pal), pal[:2])
            r = await s.call_tool("set_state", {"state": {"bri": 80}}); print("set_state:", r.content[0].text, "isError", r.isError)
            st2 = json.loads((await s.call_tool("get_state", {})).content[0].text); print("bri now", st2["state"]["bri"])
            bad = await s.call_tool("set_state", {}); print("missing arg ->", bad.content[0].text, bad.isError)
asyncio.run(main())
