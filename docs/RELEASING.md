# 发版

留白的正式安装包由维护者在 macOS 上构建：Developer ID 签名、Apple 公证，并生成应用内自动更新用的签名更新包。Windows 内测版用同一个版本号、同一个 Release，由同一条命令在 macOS 上交叉构建。下面的步骤需要维护者的证书、公证凭据和更新签名私钥。

## 准备

- 钥匙串里有 `mygo.json` 中 `macos.signingIdentity` 对应的 Developer ID 证书，以及 notarytool 凭据 `clipnest-notary`。
- 构建 Windows 安装包需要 NSIS，见下面 Windows 一节的第 1 步。
- 更新签名私钥不在仓库和配置里（`updates_test.go` 不允许把它写进 `mygo.json`），发版时通过环境变量 `MYGO_UPDATER_PRIVATE_KEY` 传入。没有私钥时，构建照样成功，但只有安装包和安装脚本，没有完整更新包、增量包和更新源，已安装的留白就收不到这一版；加了 `-upload` 的构建则会直接报错停止（MyGo 0.6 起）。

## 步骤

0.6.7 和 0.7.0 都按这个顺序发布：先在本地构建并检查产物，再建立 Release 草稿、上传文件、通过 GitHub API 核对，最后发布。

1. 改版本号：`mygo.json` 和 `package.json`。在 `CHANGELOG.md` 顶部写好 `## <版本>` 一节，它会成为应用内的更新说明，缺少时构建失败；在 `docs/releases/<版本>.md` 写好发布说明，它是 Release 页面的正文。执行 `npm run check`、`npm run build`，把重建的 `web/` 与源码一起提交。
2. 提交 `chore(release): <版本>`，打附注标签 `v<版本>`，推送 `main` 和标签。
3. 在这个提交上、工作区干净时构建（有未跟踪的文件也会让程序记成 `vcs.modified=true`）：

   ```sh
   MYGO_UPDATER_PRIVATE_KEY="$(cat <私钥文件>)" go tool mygo build -platform darwin/universal,windows/amd64,windows/arm64 -o build/release-<版本> .
   ```

   它会签名、公证，并在 `darwin-universal/`、`windows-amd64/`、`windows-arm64/` 三个目录里各生成：安装包（`liubai-<版本>.dmg`、`liubai-setup-<版本>-amd64.exe`、`liubai-setup-<版本>-arm64.exe`）、完整更新包 `liubai-<版本>-<平台>.tar.gz`、从最近三个版本升级的增量包 `liubai-<旧版本>-to-<版本>-<平台>.delta`、更新源 `update-<平台>.json`，以及安装脚本（macOS 的 `install.sh`，Windows 两个目录里内容相同的 `install.ps1`）。输出目录顶层还有 `SHA256SUMS`，列出除更新源以外每个文件的 SHA-256。

   网络不稳时（例如 `lookup github.com: no such host`），构建读不到上一版的更新源，会出现 `No delta updates for <平台>` 或 `No delta update from <版本> for <平台>` 的警告，缺少增量包。这时还没有上传任何文件：网络恢复后删掉输出目录，重新完整构建。

4. 检查产物，每条都应通过：

   ```sh
   cd build/release-<版本>/darwin-universal
   codesign --verify --deep --strict Liubai.app && spctl -a -t exec -vv Liubai.app && xcrun stapler validate Liubai.app
   codesign --verify --strict "liubai-<版本>.dmg" && spctl -a -t open --context context:primary-signature -vv "liubai-<版本>.dmg"
   xcrun stapler validate "liubai-<版本>.dmg" && hdiutil verify "liubai-<版本>.dmg"
   ```

   用 `lipo -thin arm64` 取出一个架构后，`go version -m` 读到的 `vcs.revision` 应是标签所在的提交，`vcs.modified` 为 `false`。Windows 程序的检查见下面 Windows 一节的第 4 步。0.6.7 和 0.7.0 还核对了：每个完整更新包和增量包的大小与更新源一致，签名能用 `mygo.json` 里的公钥验证；App 里的前端资源与提交的 `web/` 逐文件一致。

5. 建立 Release 草稿并上传：

   ```sh
   gh release create v<版本> --verify-tag --draft --title "留白 <版本>" --notes-file docs/releases/<版本>.md
   cd build/release-<版本>
   gh release upload v<版本> SHA256SUMS */liubai-*.dmg */liubai-setup-*.exe */*.tar.gz */*.delta */update-*.json darwin-universal/install.sh windows-amd64/install.ps1
   ```

   0.7.0 共 21 个文件：3 个安装包、3 个完整更新包、9 个增量包、3 个更新源、`install.sh`、一份 `install.ps1` 和 `SHA256SUMS`。不上传 `Liubai.app`、`Liubai.exe` 等程序文件。0.6.7 和 0.7.0 上传的 `SHA256SUMS` 是按同样的文件名另行计算的，多了三个更新源，共 20 行。

6. 通过 GitHub API 核对草稿：

   ```sh
   gh release view v<版本> --json assets --jq '.assets[] | [.name, .state, .size, .digest] | @tsv'
   ```

   每个文件的状态应为 `uploaded`，字节数和 `sha256:` 摘要与本地文件（`shasum -a 256`）一致。

7. 发布：`gh release edit v<版本> --title "留白 <版本>" --notes-file docs/releases/<版本>.md --draft=false --latest`。
8. 验证更新源：匿名下载 `https://github.com/echoVic/liubai/releases/latest/download/update-darwin-universal.json`、`update-windows-amd64.json` 和 `update-windows-arm64.json`，确认是新版本，并且与本地构建的文件逐字节一致。

网站 [liubai.echovic.com](https://liubai.echovic.com/) 在浏览器里读取最新发布的下载链接、版本号和安装包大小，但页面里写好的备用值只在网站重新部署时更新。所以发版后要在网站仓库里把这些备用值改成新版本，新功能的介绍和截图也要手动更新，然后推送。0.6.7 推送后网站自动部署。0.7.0 推送后是手动部署的：从线上 Worker 导出生产模块，只重建留白的文件，跑网站的测试和 Wrangler dry-run 后用 Wrangler 部署，并核对 Worker 里其他资源没有变化。部署后匿名下载中英文首页和更新日志，与部署的文件逐字节核对，再在浏览器里确认版本号和新内容。

### 一步构建并上传

第 3 步的命令加上 `-upload`，构建完会直接建立 Release 草稿 `v<版本>` 并上传：先上传安装包、更新包、增量包、安装脚本和 `SHA256SUMS`，再上传三个更新源，同名文件会被替换。和上面的做法相比：

- 草稿的标题是标签 `v<版本>`，正文是 `CHANGELOG.md` 里这一节；第 7 步的命令会改成「留白 <版本>」和 `docs/releases/<版本>.md`。
- 上传的是构建写的 `SHA256SUMS`，不含更新源。Release 里已经有 `SHA256SUMS` 时，其中这次没有上传的文件的行会保留下来。
- 文件在检查前就已上传：第 4 步的检查和第 6 步的核对放到上传之后、发布之前做。
- 网络不稳时，上传也可能失败。草稿还没有建立：网络恢复后删掉输出目录，重新完整构建；草稿已经建立：只重建缺增量包的平台，方法见下面 Windows 一节的第 5 步。

## 仅本地准备

用户要求准备安装包而尚未要求发布时，完成本地提交和标签后只做第 3、4 步，不推送分支、标签，也不建立 Release。仍需传入更新签名私钥，才能准备完整更新包和增量包。待发布时推送分支和标签，从第 5 步继续，复用这些产物。

## 预发布

需要先在真机上验证时，第 7 步改用 `--prerelease`，不加 `--latest`：

```sh
gh release edit v<版本> --title "留白 <版本>" --notes-file docs/releases/<版本>.md --draft=false --prerelease
```

已安装的留白只读取最新正式版的更新源（`releases/latest/download/…`），网站也只跟随最新正式版。所以预发布版只能手动下载安装，不会推送给用户。

验证通过后，用 `gh release edit v<版本> --prerelease=false --latest` 转为正式版，再做第 8 步的检查。

## Windows（内测）

Windows 版由上面第 3 步的命令在 macOS 上交叉构建，MyGo 不需要 cgo。

1. 安装 NSIS：`brew install makensis`。没有它，构建会跳过安装包，只生成程序文件。
2. `windows-amd64/` 和 `windows-arm64/` 里有安装包 `liubai-setup-<版本>-amd64.exe`、`liubai-setup-<版本>-arm64.exe`，以及完整更新包、增量包和 `update-windows-amd64.json`、`update-windows-arm64.json`，与 macOS 的文件上传到同一个 Release。安装包按用户安装到 `%LOCALAPPDATA%\Programs\Liubai`，不需要管理员权限；已安装的 Windows 版从这两个更新源自动更新。
3. 签名：目前没有 Windows 代码签名证书，安装包未签名。下载后 SmartScreen 会提示「Windows 已保护你的电脑」，要点「更多信息」→「仍要运行」。发布说明里要写明这一点，并把 Windows 版标为内测版。拿到证书后，在 `mygo.json` 加 `windows.signCommand`（硬件令牌或云签名服务）或 `windows.certificate`（密码放在 `MYGO_WINDOWS_CERTIFICATE_PASSWORD`），构建时会给程序、安装包和卸载程序签名。
4. 检查：`file windows-*/Liubai.exe` 应分别是 x86-64 和 Aarch64 的 PE32+ GUI 程序，安装包是 Nullsoft Installer。`go version -m windows-*/Liubai.exe` 的 `vcs.revision` 应是标签所在的提交。构建时 MyGo 会在包目录临时写入 `mygo_windows_<架构>.syso`（图标、版本信息和清单），`.gitignore` 已忽略这个文件；在此之前构建的 0.6.0 因此记成了 `vcs.modified=true`。然后在 Windows 上按 [验证记录](superpowers/validation/2026-10-20-windows-support.md) 里的清单把安装、打开、保存和更新走一遍。
5. 用一步上传的做法、草稿已经建立后才出现 `No delta updates for windows-…` 的警告时，说明读取上一版更新清单失败了，多半是网络问题。这时只重建这些平台，加上 `-upload`，并输出到另一个目录，例如 `-platform windows/amd64,windows/arm64 -o build/release-<版本>-windows`。上传会替换 Release 里的同名文件，`SHA256SUMS` 保留其他平台的行，其他平台的文件不受影响。
6. 发布后，第 8 步也要核对 `update-windows-amd64.json` 和 `update-windows-arm64.json`。
