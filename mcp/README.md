# WLED Studio MCP server

Lets an AI assistant (Claude Code, Claude Desktop, any MCP client) control WLED devices and write Glow scripts for them.

## Tools

| Tool | What it does |
|---|---|
| `wled_status` | Power, brightness, every segment with effect, parameters (by label), colours, palette |
| `wled_power` | On/off, master brightness, transition |
| `wled_segment` | Change one segment: effect, palette, colours, parameters, range, name, flags |
| `wled_layout` | Replace the whole segment layout in one call |
| `wled_effects`, `wled_palettes` | Browse the catalogue (with parameter labels, audio/2D flags, scripts) |
| `wled_presets`, `wled_preset_apply`, `wled_preset_save` | Presets and playlists |
| `wled_snapshot` | What the LEDs show right now, as colour runs per segment |
| `glow_check`, `glow_install`, `glow_scripts`, `glow_source`, `glow_delete` | Glow scripts |
| `wled_json` | Any `/json/*` endpoint |
| `wled_devices`, `wled_add_device` | Multiple devices |

Resource `glow://reference` serves the language reference plus all examples.

## On-device endpoint

The firmware itself also speaks MCP (Streamable HTTP, JSON responses) at `http://<device>/mcp` with four tools — `get_state`, `set_state` (WLED JSON API patch), `list_effects`, `list_palettes` — for clients that should reach the controller directly without this host server:

```sh
claude mcp add --transport http wled-device http://192.168.1.118/mcp
```

Test: `WLED_HOST=192.168.1.118 uv run --python /opt/homebrew/bin/python3 mcp/test/device_mcp.py`

## Run

Needs [uv](https://docs.astral.sh/uv/) and Node.js (Node only compiles Glow scripts locally).

```sh
WLED_DEVICES="desk=192.168.1.118" uv run mcp/wled_mcp.py
```

Add to Claude Code:

```sh
claude mcp add wled-studio -e WLED_DEVICES=desk=192.168.1.118 -- \
  uv run --quiet --python /opt/homebrew/bin/python3 ~/dev/wled/mcp/wled_mcp.py
```

and the skill that teaches Claude the workflow and the Glow language:

```sh
ln -s ~/dev/wled/mcp/skill/wled-studio ~/.claude/skills/wled-studio
```

**macOS note:** Local Network privacy is granted per executable. If tools fail with "No route to host" although `curl` reaches the device, point uv at an interpreter that has Local Network access (`--python /opt/homebrew/bin/python3` here) or allow the interpreter in System Settings → Privacy & Security → Local Network.

## Tests

```sh
WLED_DEVICES="desk=192.168.1.118" uv run --python /opt/homebrew/bin/python3 mcp/test/smoke.py      # tool calls against a device (reinstalls the comet example)
WLED_DEVICES="desk=192.168.1.118" uv run --python /opt/homebrew/bin/python3 mcp/test/protocol.py   # full MCP handshake over stdio
```
