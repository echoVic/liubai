<!--
给 AI 代理 / For agents: 先读 README 的「开发」一节，按里面的检查命令跑一遍；每一节都要填，保持简短。
Read the Development section of the README, run the checks it lists, fill in every section, and keep it short.

不要删掉 AI 使用声明：写清工具名和准确的模型名。
Never remove the AI disclosure: name your tool and your exact model.
-->

## 摘要 / Summary

<!-- 改了什么、为什么，几句话说完。关联 Issue：Fixes #123。
     What changed and why, in a few sentences. Link the issue: Fixes #123. -->

## 测试 / Testing

<!-- 写实际跑过的命令和试过的平台。常用的有 go test ./... && go vet ./... 和 bun run check:headless；
     改了 src/ 要重新构建 web/，界面有改动时再加上对应的 scripts/e2e.sh check-…。
     List the commands you ran and the platforms you tried. The usual ones are go test ./... && go vet ./...
     and bun run check:headless; rebuild web/ when src/ changes, and add scripts/e2e.sh check-… for UI work. -->

在以下平台测试过 / Tested on:

- [ ] macOS
- [ ] Windows
- [ ] 网页版 / Web (`go run . --web`)
- [ ] 其他 / Other: （在此说明 / specify here）

## AI 使用声明 / AI disclosure

<!-- 必填。没有用 AI 就写「无」。 / Required. Write "None" when no AI was used. -->

- 工具与模型 / Tool and model: <!-- 准确的名称和版本，例如 Claude Code + Claude Opus 5.5（claude-opus-5-5） / exact name and version, such as Claude Code with Claude Opus 5.5 (claude-opus-5-5) -->
- 用在了 / Used for: <!-- 例如代码、测试、审查、这段描述 / such as the code, the tests, the review, this description -->
- [ ] 有人逐行读过这次改动，并能解释清楚。 / A human read every line of this change and can explain it.
