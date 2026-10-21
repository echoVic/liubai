# 发版

留白的正式安装包由维护者在 macOS 上构建：Developer ID 签名、Apple 公证，并生成应用内自动更新用的签名更新包。下面的步骤需要维护者的证书、公证凭据和更新签名私钥。

## 准备

- 钥匙串里有 `mygo.json` 中 `macos.signingIdentity` 对应的 Developer ID 证书，以及 notarytool 凭据 `clipnest-notary`。
- 更新签名私钥不在仓库和配置里（`updates_test.go` 不允许把它写进 `mygo.json`），发版时通过环境变量 `MYGO_UPDATER_PRIVATE_KEY` 传入。没有私钥时，加了 `-upload` 的构建会直接报错停止（MyGo 0.6 起）；不加 `-upload` 的构建照样成功，但不生成更新包，已安装的留白就收不到这一版。

## 步骤

1. 改版本号：`mygo.json`、`package.json`，以及 `main.go` 里 `ShowAboutPanel` 的 `ApplicationVersion` 和 `mygo.App.SetVersion`。在 `CHANGELOG.md` 顶部写好 `## <版本>` 一节，它会成为应用内的更新说明，缺少时构建失败。
2. 提交 `chore(release): <版本>`，打附注标签 `v<版本>`，推送 `main` 和标签。
3. 在这个提交上、工作区干净时构建并上传：

   ```sh
   MYGO_UPDATER_PRIVATE_KEY="$(cat <私钥文件>)" go tool mygo build -platform darwin/universal -o build/release-<版本> -upload .
   ```

   它会签名、公证，生成 DMG、完整更新包、从最近几个版本升级的增量包和 `update-darwin-universal.json`，建立 GitHub Release 草稿 `v<版本>` 并上传这些文件。

4. 检查产物，每条都应通过：

   ```sh
   cd build/release-<版本>/darwin-universal
   codesign --verify --deep --strict Liubai.app && spctl -a -t exec -vv Liubai.app && xcrun stapler validate Liubai.app
   codesign --verify --strict "Liubai <版本>.dmg" && spctl -a -t open --context context:primary-signature -vv "Liubai <版本>.dmg"
   xcrun stapler validate "Liubai <版本>.dmg" && hdiutil verify "Liubai <版本>.dmg"
   ```

   用 `lipo -thin arm64` 取出一个架构后，`go version -m` 读到的 `vcs.revision` 应是标签所在的提交，`vcs.modified` 为 `false`。

5. 发布：`gh release edit v<版本> --title "留白 <版本>" --notes-file <说明文件> --draft=false --latest`。GitHub 会把 `Liubai <版本>.dmg` 改名为 `Liubai.<版本>.dmg`，说明里用这个名字。
6. 验证更新源：匿名下载 `https://github.com/echoVic/liubai/releases/latest/download/update-darwin-universal.json`，确认是新版本，并且与本地构建的文件一致。

网站 [liubai.echovic.com](https://liubai.echovic.com/) 的下载链接、版本号和安装包大小会自动跟随最新发布，不需要修改。

## 预发布

需要先在真机上验证时，第 5 步改用 `--prerelease`，不加 `--latest`：

```sh
gh release edit v<版本> --title "留白 <版本>" --notes-file <说明文件> --draft=false --prerelease
```

已安装的留白只读取最新正式版的更新源（`releases/latest/download/…`），网站也只跟随最新正式版。所以预发布版只能手动下载安装，不会推送给用户。

验证通过后，用 `gh release edit v<版本> --prerelease=false --latest` 转为正式版，再做第 6 步的检查。

## Windows（内测）

Windows 版与 macOS 版用同一个版本号、同一个 Release，在 macOS 上交叉构建即可，MyGo 不需要 cgo。

1. 安装 NSIS：`brew install makensis`。没有它，构建会跳过安装包，只生成程序文件。
2. 在上面第 3 步的命令里加上 Windows 的两个平台，一次构建全部：

   ```sh
   MYGO_UPDATER_PRIVATE_KEY="$(cat <私钥文件>)" go tool mygo build -platform darwin/universal,windows/amd64,windows/arm64 -o build/release-<版本> -upload .
   ```

   `windows-amd64/` 和 `windows-arm64/` 里有安装包 `Liubai Setup <版本> amd64.exe`、`Liubai Setup <版本> arm64.exe`，以及完整更新包和 `update-windows-amd64.json`、`update-windows-arm64.json`（第一个 Windows 版没有增量包）。它们会和 macOS 的文件上传到同一个 Release 草稿。安装包按用户安装到 `%LOCALAPPDATA%\Programs\Liubai`，不需要管理员权限；已安装的 Windows 版从这两个更新源自动更新。
3. 签名：目前没有 Windows 代码签名证书，安装包未签名。下载后 SmartScreen 会提示「Windows 已保护你的电脑」，要点「更多信息」→「仍要运行」。发布说明里要写明这一点，并把 Windows 版标为内测版。拿到证书后，在 `mygo.json` 加 `windows.signCommand`（硬件令牌或云签名服务）或 `windows.certificate`（密码放在 `MYGO_WINDOWS_CERTIFICATE_PASSWORD`），构建时会给程序、安装包和卸载程序签名。
4. 检查：`file windows-*/Liubai.exe` 应分别是 x86-64 和 Aarch64 的 PE32+ GUI 程序，安装包是 Nullsoft Installer。`go version -m windows-*/Liubai.exe` 的 `vcs.revision` 应是标签所在的提交。构建时 MyGo 会在包目录临时写入 `mygo_windows_<架构>.syso`（图标、版本信息和清单），`.gitignore` 已忽略这个文件；在此之前构建的 0.6.0 因此记成了 `vcs.modified=true`。然后在 Windows 上按 [验证记录](superpowers/validation/2026-10-20-windows-support.md) 里的清单把安装、打开、保存和更新走一遍。
5. 发布后，GitHub 会把文件名里的空格换成点，例如 `Liubai.Setup.<版本>.amd64.exe`，说明里用这个名字。验证更新源时，也要匿名下载 `update-windows-amd64.json` 和 `update-windows-arm64.json` 核对。

`scripts/package-macos.sh` 只生成未公证的临时预览 ZIP，会重新签名，不能用于正式发布。
