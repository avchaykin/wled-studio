/*
 * Minimal on-device MCP server (Model Context Protocol, Streamable HTTP transport).
 *
 * POST /mcp with a JSON-RPC 2.0 message; the reply is a single application/json
 * response (no SSE, no sessions). Implements initialize, ping, tools/list and
 * tools/call with four tools that wrap the existing JSON API:
 *   get_state      -> {"state":..., "info":...} (same as /json/si)
 *   set_state      -> body of a POST /json/state, e.g. {"on":true,"seg":[{"id":0,"fx":9}]}
 *   list_effects   -> "id:name" lines (Glow scripts included)
 *   list_palettes  -> "id:name" lines
 * The richer host-side server lives in mcp/wled_mcp.py.
 */
#include "wled.h"

#ifndef WLED_DISABLE_MCP

static const char _mcp_tools[] PROGMEM = R"JSON({"tools":[
{"name":"get_state","description":"Current WLED state and device info: power, brightness, segments (start/stop LED, fx effect id, pal palette id, col colours as [r,g,b], sx speed, ix intensity, c1-c3/o1-o3 effect parameters), presets, LED count, Glow scripts. Same as GET /json/si.","inputSchema":{"type":"object","properties":{}}},
{"name":"set_state","description":"Change state with a WLED JSON API state object, e.g. {\"on\":true,\"bri\":128} or {\"seg\":[{\"id\":0,\"fx\":9,\"pal\":11,\"col\":[[255,80,0]],\"sx\":120}]} or {\"ps\":3} to apply a preset. Segments: start/stop are LED indices (stop exclusive); {\"id\":1,\"stop\":0} deletes segment 1. Use list_effects/list_palettes for ids.","inputSchema":{"type":"object","properties":{"state":{"type":"object","description":"WLED JSON API state patch"}},"required":["state"]}},
{"name":"list_effects","description":"All effects as id:name lines, including Glow script effects.","inputSchema":{"type":"object","properties":{}}},
{"name":"list_palettes","description":"All palettes as id:name lines.","inputSchema":{"type":"object","properties":{}}}
]})JSON";

// write s as a JSON string literal (quotes included)
static void mcpWriteString(Print &out, const char *s) {
  out.write('"');
  for (; *s; s++) {
    char c = *s;
    if (c == '"' || c == '\\') { out.write('\\'); out.write(c); }
    else if (c == '\n') out.print(F("\\n"));
    else if ((uint8_t)c < 0x20) out.printf("\\u%04x", c);
    else out.write(c);
  }
  out.write('"');
}

static void mcpError(AsyncWebServerRequest *request, const String &id, int code, const __FlashStringHelper *msg) {
  AsyncResponseStream *res = request->beginResponseStream(FPSTR(CONTENT_TYPE_JSON));
  res->print(F("{\"jsonrpc\":\"2.0\",\"id\":")); res->print(id.length() ? id : F("null"));
  res->printf("%s%d%s", ",\"error\":{\"code\":", code, ",\"message\":\"");
  res->print(msg); res->print(F("\"}}"));
  request->send(res);
}

// list of "id:name" lines for effects (palettes=false) or palettes (true), as one text block
static String mcpNameList(bool palettes) {
  String out;
  if (!palettes) {
    char buf[64];
    for (size_t i = 0; i < strip.getModeCount(); i++) {
      strncpy_P(buf, strip.getModeData(i), sizeof(buf) - 1); buf[sizeof(buf) - 1] = 0;
      char *at = strchr(buf, '@'); if (at) *at = 0;
      if (!buf[0] || !strcmp_P(buf, PSTR("RSVD"))) continue;
      out += i; out += ':'; out += buf; out += '\n';
    }
  } else {
    // palette names come from the same source as /json/pal
    if (!requestJSONBufferLock(JSON_LOCK_SERVER)) return out;
    pDoc->clear();
    deserializeJson(*pDoc, FPSTR(JSON_palette_names));
    JsonArray arr = pDoc->as<JsonArray>();
    for (size_t i = 0; i < arr.size(); i++) { out += i; out += ':'; out += arr[i].as<const char *>(); out += '\n'; }
    releaseJSONBufferLock();
  }
  return out;
}

static void handleMcp(AsyncWebServerRequest *request) {
  if (!requestJSONBufferLock(JSON_LOCK_SERVER)) { request->deferResponse(); return; }
  DeserializationError error = deserializeJson(*pDoc, (uint8_t *)(request->_tempObject));
  JsonObject root = pDoc->as<JsonObject>();
  if (error || root.isNull()) { releaseJSONBufferLock(); mcpError(request, String(), -32700, F("Parse error")); return; }

  String id;
  if (!root["id"].isNull()) serializeJson(root["id"], id);
  String method = root["method"] | "";

  // notifications (no id) are acknowledged without a body
  if (!id.length()) { releaseJSONBufferLock(); request->send(202); return; }

  if (method == F("initialize")) {
    String ver = root["params"]["protocolVersion"] | "2025-06-18";
    if (ver != F("2025-06-18") && ver != F("2025-03-26") && ver != F("2024-11-05")) ver = F("2025-06-18");
    releaseJSONBufferLock();
    AsyncResponseStream *res = request->beginResponseStream(FPSTR(CONTENT_TYPE_JSON));
    res->print(F("{\"jsonrpc\":\"2.0\",\"id\":")); res->print(id);
    res->print(F(",\"result\":{\"protocolVersion\":\"")); res->print(ver);
    res->print(F("\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"wled-studio-device\",\"version\":\""));
    res->print(versionString);
    res->print(F("\"},\"instructions\":\"WLED LED controller. Call get_state first; change things with set_state using the WLED JSON API.\"}}"));
    request->send(res);
    return;
  }
  if (method == F("ping")) {
    releaseJSONBufferLock();
    AsyncResponseStream *res = request->beginResponseStream(FPSTR(CONTENT_TYPE_JSON));
    res->print(F("{\"jsonrpc\":\"2.0\",\"id\":")); res->print(id); res->print(F(",\"result\":{}}"));
    request->send(res);
    return;
  }
  if (method == F("tools/list")) {
    releaseJSONBufferLock();
    AsyncResponseStream *res = request->beginResponseStream(FPSTR(CONTENT_TYPE_JSON));
    res->print(F("{\"jsonrpc\":\"2.0\",\"id\":")); res->print(id); res->print(F(",\"result\":"));
    res->print(FPSTR(_mcp_tools)); res->print('}');
    request->send(res);
    return;
  }
  if (method != F("tools/call")) { releaseJSONBufferLock(); mcpError(request, id, -32601, F("Method not found")); return; }

  String tool = root["params"]["name"] | "";
  String text;
  bool isError = false;
  if (tool == F("set_state")) {
    JsonObject st = root["params"]["arguments"]["state"];
    if (st.isNull()) { isError = true; text = F("arguments.state must be a WLED JSON state object"); }
    else {
      deserializeState(st);
      text = F("ok");
    }
    releaseJSONBufferLock();
    if (!isError) {
      // same follow-up as POST /json/state: push the change to WebSocket/MQTT clients
      lastInterfaceUpdate = millis();
      interfaceUpdateCallMode = CALL_MODE_WS_SEND;
    }
  } else if (tool == F("get_state")) {
    pDoc->clear();
    JsonObject s = pDoc->createNestedObject(F("state"));
    serializeState(s);
    JsonObject in = pDoc->createNestedObject(F("info"));
    serializeInfo(in);
    serializeJson(*pDoc, text);
    releaseJSONBufferLock();
  } else if (tool == F("list_effects") || tool == F("list_palettes")) {
    releaseJSONBufferLock();
    text = mcpNameList(tool == F("list_palettes"));
  } else {
    releaseJSONBufferLock();
    mcpError(request, id, -32602, F("Unknown tool"));
    return;
  }

  AsyncResponseStream *res = request->beginResponseStream(FPSTR(CONTENT_TYPE_JSON));
  res->print(F("{\"jsonrpc\":\"2.0\",\"id\":")); res->print(id);
  res->print(F(",\"result\":{\"content\":[{\"type\":\"text\",\"text\":"));
  mcpWriteString(*res, text.c_str());
  res->print(F("}],\"isError\":")); res->print(isError ? F("true") : F("false")); res->print(F("}}"));
  request->send(res);
}

void registerMcpHandler(AsyncWebServer &srv) {
  AsyncCallbackJsonWebHandler *h = new AsyncCallbackJsonWebHandler(F("/mcp"), handleMcp, JSON_BUFFER_SIZE);
  srv.addHandler(h);
  // Streamable HTTP clients may probe with GET for an SSE stream; we don't offer one
  srv.on(F("/mcp"), HTTP_GET, [](AsyncWebServerRequest *request) { request->send(405); });
}

#else
void registerMcpHandler(AsyncWebServer &) {}
#endif
