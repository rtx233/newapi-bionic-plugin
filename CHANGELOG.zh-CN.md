---
changelogVersion: 1
plugin: "rtx233_bionic"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 通过任务插件渠道接入 Bionic 桌面应用里运行的模型，支持对话补全、Responses、Claude Messages、文本补全和向量接口，支持流式输出，按 Bionic 返回的 token 数计费。
- Gemini 的 `generateContent` 和 `streamGenerateContent` 请求会转换成对话补全发给 Bionic。
- 从 Bionic 获取渠道的模型列表，可以只列语言模型、向量模型或已加载的模型。
- 可以为每个渠道设置空闲卸载时间，让 Bionic 卸载按需加载的模型。
- 健康检查会在 Bionic 无法访问时禁用渠道密钥，恢复访问后重新启用。
