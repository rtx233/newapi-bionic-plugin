// Bionic: serves the models of a Bionic desktop app (Element Labs, built on
// the LM Studio engine) through a New API type-61 channel.
//
// Bionic already speaks the OpenAI, OpenAI Responses and Anthropic Messages
// protocols on its local server, so most routes are plain relays and the host
// does all request handling, streaming and token billing. The plugin adds:
//   - a model list for the channel form, read from Bionic's native
//     /api/v1/models so it can be filtered by model type and load state;
//   - an optional idle TTL, so models Bionic loads on demand unload again;
//   - an optional health check that disables the channel key while Bionic is
//     unreachable (a laptop asleep, the app closed) and enables it again when
//     Bionic answers.

export const meta = {
  "apiVersion": 1,
  "key": "rtx233_bionic",
  "name": { "en": "Bionic", "zh": "Bionic 本地模型" },
  "version": "1.0.0",
  "author": { "name": "rtx233", "url": "https://github.com/rtx233" },
  "description": {
    "en": "Serve the models running in the Bionic desktop app for chat, Responses, Claude Messages, Gemini, completions and embeddings",
    "zh": "把 Bionic 桌面应用里运行的模型接入网关，支持对话、Responses、Claude Messages、Gemini、补全和向量"
  },
  "baseUrl": "http://127.0.0.1:1234",
  "models": ["text-embedding-nomic-embed-text-v1.5"],
  "relay": [
    { "incoming_path": "/v1/chat/completions", "upstream_path": "/v1/chat/completions" },
    { "incoming_path": "/v1/responses", "upstream_path": "/v1/responses" },
    { "incoming_path": "/v1/messages", "upstream_path": "/v1/messages" },
    {
      "incoming_path": "/v1beta/models/{model}:generateContent",
      "upstream_path": "/v1/chat/completions",
      "converter": "gemini_generate_content_to_openai_chat_completions"
    },
    { "incoming_path": "/v1/completions", "upstream_path": "/v1/completions" },
    { "incoming_path": "/v1/embeddings", "upstream_path": "/v1/embeddings" },
    { "incoming_path": "/v1/models", "upstream_path": "/api/v1/models", "converter": "plugin" }
  ],
  "channelConfig": {
    "type": "object",
    "properties": {
      "modelTypes": {
        "type": "string",
        "title": { "en": "Models to fetch", "zh": "获取的模型" },
        "description": {
          "en": "Which Bionic models the channel form lists when you fetch models",
          "zh": "在渠道表单里获取模型时列出哪些 Bionic 模型"
        },
        "enum": ["all", "llm", "embedding"],
        "enumTitles": [
          { "en": "All models", "zh": "全部模型" },
          { "en": "Language models only", "zh": "仅语言模型" },
          { "en": "Embedding models only", "zh": "仅向量模型" }
        ],
        "default": "all"
      },
      "loadedOnly": {
        "type": "boolean",
        "title": { "en": "Loaded models only", "zh": "仅已加载的模型" },
        "description": {
          "en": "List only the models Bionic has loaded into memory",
          "zh": "只列出 Bionic 当前已加载到内存的模型"
        },
        "default": false
      },
      "ttl": {
        "type": "integer",
        "title": { "en": "Idle unload time", "zh": "空闲卸载时间" },
        "description": {
          "en": "Unload a model Bionic loaded on demand after it is idle this long, 0 keeps the Bionic setting",
          "zh": "按需加载的模型空闲这么久后由 Bionic 卸载，0 表示沿用 Bionic 的设置"
        },
        "unit": "second",
        "minimum": 0,
        "maximum": 86400,
        "default": 0
      },
      "healthCheck": {
        "type": "boolean",
        "title": { "en": "Health check", "zh": "健康检查" },
        "description": {
          "en": "Disable the key while Bionic is unreachable and enable it again when Bionic answers",
          "zh": "Bionic 无法访问时自动禁用密钥，恢复访问后自动启用"
        },
        "default": true
      },
      "healthInterval": {
        "type": "integer",
        "title": { "en": "Health check interval", "zh": "健康检查间隔" },
        "unit": "second",
        "minimum": 60,
        "maximum": 3600,
        "default": 300,
        "visibleWhen": { "healthCheck": true }
      }
    }
  },
  "keyHint": {
    "en": "The Bionic API token when the server requires authentication, otherwise any value",
    "zh": "Bionic 服务开启身份验证时填 API Token，否则随便填"
  }
};

const MODEL_LIST_FALLBACKS = ["/api/v0/models", "/v1/models"];
const HEALTH_PATH = "/v1/models";
const HEALTH_ATTEMPTS = 2;
const TTL_PATHS = ["/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/completions", "/v1/embeddings"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function settings(ctx) {
  const config = isObject(ctx && ctx.config) ? ctx.config : {};
  const modelTypes = config.modelTypes === "llm" || config.modelTypes === "embedding" ? config.modelTypes : "all";
  const ttl = Number.isInteger(config.ttl) && config.ttl > 0 ? Math.min(config.ttl, 86400) : 0;
  const interval = Number.isInteger(config.healthInterval) ? config.healthInterval : 300;
  return {
    modelTypes: modelTypes,
    loadedOnly: config.loadedOnly === true,
    ttl: ttl,
    healthCheck: config.healthCheck !== false,
    healthInterval: Math.max(60, Math.min(3600, interval)),
  };
}

// ---------------------------------------------------------------------------
// Model list
// ---------------------------------------------------------------------------

// Bionic's model types: /api/v1 uses "llm" and "embedding"; /api/v0 uses
// "llm", "vlm" and "embeddings". Anything that is not an embedding model is a
// language model.
function modelKind(type, id) {
  if (typeof type === "string" && type) return /^embedding/.test(type) ? "embedding" : "llm";
  return /embed/i.test(id) ? "embedding" : "llm";
}

function wanted(cfg, kind, loaded) {
  if (cfg.modelTypes !== "all" && cfg.modelTypes !== kind) return false;
  if (cfg.loadedOnly && loaded === false) return false;
  return true;
}

function entry(id, owner) {
  return { id: id, object: "model", owned_by: typeof owner === "string" && owner ? owner : "bionic" };
}

// Turns any of Bionic's three model lists into an OpenAI model list.
export function toModelList(cfg, parsed) {
  const data = [];
  const seen = {};
  function add(id, owner) {
    if (typeof id !== "string" || !id || seen[id]) return;
    seen[id] = true;
    data.push(entry(id, owner));
  }

  if (isObject(parsed) && Array.isArray(parsed.models)) {
    // GET /api/v1/models
    for (const model of parsed.models) {
      if (!isObject(model)) continue;
      const loaded = Array.isArray(model.loaded_instances) ? model.loaded_instances.length > 0 : undefined;
      if (wanted(cfg, modelKind(model.type, model.key), loaded)) add(model.key, model.publisher);
    }
  } else if (isObject(parsed) && Array.isArray(parsed.data)) {
    // GET /api/v0/models carries type and state; GET /v1/models carries neither.
    for (const model of parsed.data) {
      if (!isObject(model)) continue;
      const loaded = typeof model.state === "string" ? model.state === "loaded" : undefined;
      if (wanted(cfg, modelKind(model.type, model.id), loaded)) add(model.id, model.publisher || model.owned_by);
    }
  } else {
    return null;
  }
  return { object: "list", data: data };
}

function errorMessage(body) {
  if (typeof body !== "string" || !body) return "";
  try {
    const parsed = JSON.parse(body);
    if (isObject(parsed)) {
      if (typeof parsed.error === "string") return parsed.error;
      if (isObject(parsed.error) && typeof parsed.error.message === "string") return parsed.error.message;
      if (typeof parsed.message === "string") return parsed.message;
    }
  } catch (_) {
    // Not JSON: fall through to the raw text.
  }
  return body.slice(0, 256);
}

// Only the /v1/models route runs a converter, so this is the model list fetch.
// Older Bionic and LM Studio builds lack /api/v1/models; fall back to /api/v0
// and then to the OpenAI-compatible list.
export function convertResponse(ctx, response) {
  const state = isObject(ctx && ctx.state) ? ctx.state : { fallback: 0 };
  const fallback = Number.isInteger(state.fallback) ? state.fallback : 0;

  if (response.status === 404 && fallback < MODEL_LIST_FALLBACKS.length) {
    return { next: { method: "GET", path: MODEL_LIST_FALLBACKS[fallback] }, state: { fallback: fallback + 1 } };
  }
  if (response.status < 200 || response.status > 299) {
    const detail = errorMessage(response.body);
    return {
      error: {
        status: response.status >= 400 && response.status <= 599 ? response.status : 502,
        message: "bionic: " + (detail || "model list request failed with status " + response.status),
      },
    };
  }
  if (typeof response.body !== "string") {
    return { error: { status: 502, message: "bionic: the model list is not text" } };
  }
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch (_) {
    return { error: { status: 502, message: "bionic: the model list is not JSON" } };
  }
  const list = toModelList(settings(ctx), parsed);
  if (!list) return { error: { status: 502, message: "bionic: unrecognized model list" } };
  return { body: list };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// Adds the channel's idle unload time to requests that do not set their own.
// Bionic reads ttl (seconds) on every inference endpoint and applies it to
// models it loads on demand.
export function prepareRequest(ctx, request) {
  const cfg = settings(ctx);
  if (!cfg.ttl || !request || !isObject(request.body)) return null;
  if (TTL_PATHS.indexOf(request.upstreamPath) < 0) return null;
  if (request.body.ttl !== undefined) return null;
  return { effects: [{ type: "json.patch", ops: [{ op: "add", path: "/ttl", value: cfg.ttl }] }] };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

function joinUrl(baseUrl, path) {
  return String(baseUrl || "").replace(/\/+$/, "") + path;
}

// Returns "online", "unauthorized" or "offline".
export function probe(ctx) {
  const headers = { Accept: "application/json" };
  if (typeof ctx.apiKey === "string" && ctx.apiKey) headers.Authorization = "Bearer " + ctx.apiKey;
  let result = "offline";
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
    try {
      const response = utils.fetch({ url: joinUrl(ctx.baseUrl, HEALTH_PATH), method: "GET", headers: headers });
      if (response.status >= 200 && response.status <= 299) return "online";
      if (response.status === 401 || response.status === 403) return "unauthorized";
      result = "offline";
    } catch (_) {
      result = "offline";
    }
  }
  return result;
}

const OFFLINE_NOTICE = {
  en: "Bionic is unreachable; the key was disabled until it answers again",
  zh: "Bionic 无法访问，密钥已禁用，恢复访问后会自动启用",
};
const ONLINE_NOTICE = {
  en: "Bionic is reachable again; the key was enabled",
  zh: "Bionic 已恢复访问，密钥已重新启用",
};
const UNAUTHORIZED_NOTICE = {
  en: "Bionic rejected the API token; the key was disabled",
  zh: "Bionic 拒绝了 API Token，密钥已禁用",
};

export function scheduled(ctx) {
  const cfg = settings(ctx);
  if (!cfg.healthCheck) return { next: 3600 };

  const status = probe(ctx);
  const result = { next: cfg.healthInterval };
  if (status === "online") {
    if (ctx.keyStatus === "auto_disabled") {
      result.keyStatus = "enabled";
      result.notify = ONLINE_NOTICE;
    }
  } else if (ctx.keyStatus === "enabled") {
    result.keyStatus = "auto_disabled";
    result.notify = status === "unauthorized" ? UNAUTHORIZED_NOTICE : OFFLINE_NOTICE;
  } else {
    // Already disabled: look again soon, so the key comes back quickly.
    result.next = 60;
  }
  return result;
}
