---
changelogVersion: 1
plugin: "rtx233_bionic"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.0]

### Added

- Serve the models running in the Bionic desktop app on a Task Plugin channel, through chat completions, Responses, Claude Messages, completions and embeddings, with streaming and billing by the tokens Bionic reports.
- Gemini `generateContent` and `streamGenerateContent` requests are converted to chat completions for Bionic.
- Fetch the channel's models from Bionic, optionally limited to language models, embedding models, or the models already loaded.
- An idle unload time per channel lets Bionic unload the models it loads on demand.
- A health check disables the channel key while Bionic is unreachable and enables it again when Bionic answers.
