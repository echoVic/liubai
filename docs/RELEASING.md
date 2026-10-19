# 发版

留白的正式安装包由维护者在 macOS 上构建：Developer ID 签名、Apple 公证，并生成应用内自动更新用的签名更新包。下面的步骤需要维护者的证书、公证凭据和更新签名私钥。

## 准备

- 钥匙串里有 `mygo.json` 中 `macos.signingIdentity` 对应的 Developer ID 证书，以及 notarytool 凭据 `clipnest-notary`。
- 更新签名私钥不在仓库和配置里（`updates_test.go` 不允许把它写进 `mygo.json`），发版时通过环境变量 `MYGO_UPDATER_PRIVATE_KEY` 传入。没有私钥时构建照样成功，但不会生成更新包，已安装的留白就收不到这一版。

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

`scripts/package-macos.sh` 只生成未公证的临时预览 ZIP，会重新签名，不能用于正式发布。
