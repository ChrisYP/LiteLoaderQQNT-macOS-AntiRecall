# LiteLoaderQQNT macOS 一键离线安装包（v5 轻量化修复版）

> 当前仓库是供个人设备迁移和维护的非官方修复版。仓库保持私有；请勿提交 QQ 账号数据、消息数据库、图片缓存、诊断日志或其他个人信息。

此包用于个人设备间迁移，包含：

- LiteLoaderQQNT 1.4.1。
- 针对新版 Node.js 移除 `Dirent.path` 的兼容修复。
- 轻量 Anti-Recall 0.3.0 的 macOS 修复版；默认在全新配置中启用防撤回与本地持久化。
- 后台私聊/群聊主动取回：即使未打开对应聊天框，也会从“最近联系人更新”取得消息 ID，并在撤回前主动向 QQ 获取完整消息缓存。
- 后台图片主动下载：未打开聊天框时收到并撤回的图片，也能在进入会话时立即显示。
- 后台捕获已限流：只处理 15 分钟内的候选消息；消息内的每张图片都进入同一个有界优先队列，总并发固定为 3、等待任务最多 48 个，避免相册消息或大群历史触发下载风暴。
- 历史补抓属于低优先级，最多占用 2 个下载槽；实时消息与实际撤回始终保留 1 个槽位，并可在队列满时淘汰历史任务。
- 图片跨重启持久化：保存原图副本，并在数据库恢复时重建 QQ 所需的图片路径类型；文字持久化逻辑保持原样。
- 图片采用两级存储：未撤回图片只进入有容量/时限保护的会话缓存，退出 QQ 自动清理；实际撤回且已开启数据库时才永久保存。
- 群撤回回退图通过受限的本地文件 URL 直接显示，不再把最高 30 MB 的图片转成 Base64 经 IPC 复制；网络补抓也改成限 30 MB 的流式落盘，失败时自动清理临时文件。
- DOM 撤回标记采用单飞调度，同一聊天页面不会并行重入整页扫描。
- 主进程逻辑已拆出事件解析、图片存储和优先任务队列模块，降低后续 QQ 版本适配时的维护风险。
- `level-party` 的 macOS App Sandbox 本地模式修复，不再创建会触发 `ENOENT` / `EINVAL` 的 Unix Socket。
- 针对 Mac App Store 沙盒 QQ 的容错启动器：辅助进程无法读取 LiteLoader 时回退到原版 QQ，不让整个应用崩溃。
- 安装前自动备份与 `restore.sh` 恢复脚本。
- 支持在全新 QQ 的 `app_launcher` 中创建尚不存在的 `ml_install.js`，无需整段使用 `sudo`。
- rkey 服务改为并行竞速，共享 4.5 秒总预算；失败后冷却 5 分钟，避免网络不通时反复拖慢会话加载。
- 群聊回退卡片只针对文字/图片消息生成；头像与昵称仅在当前消息行内匹配，不再扫描整个聊天页面，也不会重复补一枚头像。
- 安装与恢复脚本会核对进程的实际可执行路径；同名进程及退出后残留的 `QQEXDOC` 不会误阻止操作。

安装包不包含 QQ 账号、消息、缓存、令牌、贴纸、语音库或原电脑的插件配置。

## 使用方法

1. 安装官方 QQ，并按 `Command-Q` 完全退出。
2. 解压本安装包。
3. 在终端进入解压目录并运行：

   ```bash
   bash install.sh
   ```

4. 根据 macOS 提示授权修改 `QQ.app`，然后重新打开 QQ。

QQ 不在 `/Applications/QQ.app` 时：

```bash
QQ_APP_PATH="/自定义路径/QQ.app" bash install.sh
```

恢复安装前状态：

```bash
bash restore.sh
```

也可以把 `install.sh` 最后输出的备份目录作为参数，精确恢复某次安装：

```bash
bash restore.sh "/备份目录/20260810-123456"
```

## 行为说明

- 已有的 `LiteLoaderQQNT/data`、普通插件和 Anti-Recall 配置/数据库都会保留。
- 撤回图片副本保存在 `LiteLoaderQQNT/data/anti_recall/preserved-images`；重复安装不会清除该目录。
- 会话图片缓存最多 512 MB、5000 个文件或 24 小时，QQ 正常退出及下次启动时都会清理。
- 单张供群聊回退显示或网络补抓的图片上限为 30 MB，超过限制会保留撤回提示但不会载入图片。
- 设置中的“清空已储存的撤回消息”会同时清空撤回数据库和永久图片，不影响当前会话的临时防撤回缓存。
- 仅当不存在 Anti-Recall 配置时，安装器才写入默认配置。
- 已安装的 Anti-Recall 会先备份再升级；为避免重复注入，QQNT Toolbox 和 Lite Tools 会被移入本次备份并停用，随时可用 `restore.sh` 恢复。
- QQ 更新通常会覆盖注入入口，更新后重新运行 `install.sh` 即可。
- 此包按 QQ 6.9.99 / build 51802 验证。未来 QQ 内部入口改变时可能需要重新适配。
- 防撤回仅对启用后捕获的事件生效，无法恢复安装前或 QQ 离线期间已经撤回的消息。

## 开发与校验

安装包内文件的 SHA-256 清单位于 `CHECKSUMS.txt`。修改 payload 后可重新生成：

```bash
find . -type f \
  ! -path './.git/*' \
  ! -path './tests/*' \
  ! -name run-tests.sh \
  ! -name CHECKSUMS.txt \
  -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 > CHECKSUMS.txt
```

运行离线测试与语法检查：

```bash
bash run-tests.sh
```

包含本机回环 HTTP 流式下载测试：

```bash
RUN_NETWORK_TESTS=1 bash run-tests.sh
```

## 来源、许可与风险

- LiteLoaderQQNT：<https://github.com/LiteLoaderQQNT/LiteLoaderQQNT>，MIT License。
- Anti-Recall：<https://github.com/xh321/LiteLoaderQQNT-Anti-Recall>，MIT License。本包基于 0.3.0 加入 macOS 数据库、后台会话主动取回、图片本地保存与跨重启恢复修复。

这是非官方修改，会改变 QQ 应用包并使腾讯原始代码签名校验失败。第三方插件可能带来账号、隐私、数据和兼容性风险。建议仅自用，不要公开传播，也不要向 QQ 官方渠道提交带有第三方插件界面的截图或反馈。
