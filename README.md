---
locale: en
translations:
  zh-CN: README.zh-CN.md
---
# Bionic

Serves the models you run in the Bionic desktop app (by Element Labs, built on LM Studio) through New API. Bionic's local server already speaks the OpenAI, OpenAI Responses and Anthropic Messages protocols, so the gateway relays those requests unchanged and bills them by the tokens Bionic reports. Gemini clients are converted to chat completions on the way.

The plugin also:

- Fetches the channel's model list from Bionic, optionally only language models, only embedding models, or only the models already loaded.
- Adds an idle unload time to every request, so models Bionic loads on demand free their memory again.
- Checks Bionic every few minutes and disables the channel key while Bionic is unreachable, for example when the computer sleeps or the app is closed, then enables it again when Bionic answers.

Requires New API v1.0.0-rc.50 or later.

## Before you start

1. In Bionic, open the Local Server tab, start the server and note its port, `1234` by default.
2. If New API runs on another machine, turn on Serve on Local Network in the server settings, or expose the port through a tunnel such as Tailscale, frp, Cloudflare Tunnel or `ssh -R`.
3. Optional: turn on Require Authentication in the server settings and create an API token under Manage Tokens. Do this whenever the port is reachable from other machines.

## Channel setup

1. Install the plugin, then add a channel of type Task Plugin and bind it to this plugin.
2. Base URL: the Bionic server origin without `/v1`, for example `http://192.168.1.20:1234`. The default is `http://127.0.0.1:1234`, which works only when New API runs directly on the same computer as Bionic. Inside Docker use an address the container can reach, such as `http://host.docker.internal:1234` on Docker Desktop.
3. Key: the Bionic API token when authentication is on, otherwise any value.
4. Models: click "Fetch models" to read them from Bionic. Model names are Bionic's model keys, such as `qwen/qwen3-8b`. Use model mapping to publish friendlier names.
5. Channel settings:
   - Models to fetch: all models, language models only, or embedding models only.
   - Loaded models only: list only the models Bionic has loaded into memory.
   - Idle unload time: seconds after which Bionic unloads a model it loaded for a request. `0` keeps Bionic's own setting. A request that sets its own `ttl` keeps it.
   - Health check and its interval: on by default, every 300 seconds. The channel's automatic disabling must be on for the check to disable a key.

## Models and endpoints

| Client endpoint | Sent to Bionic | Models |
| --- | --- | --- |
| `POST /v1/chat/completions` | `/v1/chat/completions` | Language models |
| `POST /v1/responses` | `/v1/responses` | Language models |
| `POST /v1/messages` | `/v1/messages` | Language models |
| `POST /v1beta/models/{model}:generateContent` | `/v1/chat/completions`, converted | Language models |
| `POST /v1/completions` | `/v1/completions` | Language models |
| `POST /v1/embeddings` | `/v1/embeddings` | Embedding models |
| `GET /v1/models` | `/api/v1/models`, falling back to `/api/v0/models` and `/v1/models` | Model list for the channel form |

Streaming works on every chat endpoint. Bionic loads a model on its first request when Just-in-Time Model Loading is on in its server settings; the first request then waits for the load.

## Billing

Requests are billed like any OpenAI-compatible channel, by the prompt and completion tokens in Bionic's reply, at each model's ratio or price. Set a model ratio or a fixed price for each model name before users call it. Bionic reports no token count for embeddings; New API then estimates the prompt tokens from the input text.

## Example

```bash
curl https://your-gateway.example/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen/qwen3-8b", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

## Limits

- Bionic serves requests on one computer. Large models and parallel requests are limited by its memory and its parallel request setting; use several channels to spread load over several computers.
- Bionic's local server has no TLS. Across the internet, put it behind a tunnel or an HTTPS proxy, and turn on authentication.
- The health check runs only on the New API master node. Its first run comes within ten minutes after the channel is created or the gateway restarts.
