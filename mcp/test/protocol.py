# /// script
# dependencies = ["mcp>=1.10,<2"]
# ///
"""End-to-end MCP check: spawn the server over stdio, list tools/resources, call wled_status."""
import asyncio, json, os, sys, pathlib
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = pathlib.Path(__file__).resolve().parent.parent

async def main():
    params = StdioServerParameters(command="uv", args=["run", "--quiet", "--python", sys.executable, str(ROOT / "wled_mcp.py")],
                                   env={**os.environ})
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("server:", init.serverInfo.name)
            tools = await s.list_tools()
            print("tools:", len(tools.tools), [t.name for t in tools.tools])
            res = await s.list_resources(); print("resources:", [str(x.uri) for x in res.resources])
            ref = await s.read_resource("glow://reference"); print("reference chars:", len(ref.contents[0].text))
            out = await s.call_tool("wled_status", {})
            print("wled_status ->", json.loads(out.content[0].text)["segments"][0])
asyncio.run(main())
