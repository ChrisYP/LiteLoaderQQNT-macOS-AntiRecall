#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_ROOT="$SCRIPT_DIR/payload/LiteLoaderQQNT"
LAUNCHER_PAYLOAD="$SCRIPT_DIR/payload/ml_install.js"
ANTI_RECALL_PAYLOAD="$PAYLOAD_ROOT/plugins/qq-anti-recall"
DEFAULT_ANTI_RECALL_CONFIG="$SCRIPT_DIR/payload/defaults/anti_recall/config.json"
PACKAGE_PATCHER="$SCRIPT_DIR/payload/patch-package.js"

say() {
    printf '[LiteLoaderQQNT Installer] %s\n' "$*"
}

die() {
    printf '[LiteLoaderQQNT Installer] ERROR: %s\n' "$*" >&2
    exit 1
}

write_app_file() {
    source_file="$1"
    destination_file="$2"

    if [ -w "$destination_file" ] || { [ ! -e "$destination_file" ] && [ -w "$(dirname "$destination_file")" ]; }; then
        cp "$source_file" "$destination_file"
    else
        say "macOS 将请求管理员授权以修改 QQ.app。"
        if [ -e "$destination_file" ]; then
            /usr/libexec/authopen -w "$destination_file" < "$source_file"
        else
            /usr/libexec/authopen -c -m 0644 -w "$destination_file" < "$source_file"
        fi
    fi

    cmp -s "$source_file" "$destination_file" || die "写入后校验失败：$destination_file"
}

[ "$(uname -s)" = "Darwin" ] || die "此安装包仅支持 macOS。"

for required_command in plutil ditto pgrep ps mktemp cmp osascript; do
    command -v "$required_command" >/dev/null 2>&1 || die "缺少系统命令：$required_command"
done

[ -f "$PAYLOAD_ROOT/package.json" ] || die "安装包不完整：缺少 LiteLoaderQQNT。"
[ -f "$PAYLOAD_ROOT/src/main.js" ] || die "安装包不完整：缺少 LiteLoaderQQNT/src/main.js。"
[ -f "$ANTI_RECALL_PAYLOAD/manifest.json" ] || die "安装包不完整：缺少 Anti-Recall。"
[ -f "$ANTI_RECALL_PAYLOAD/main.js" ] || die "安装包不完整：缺少 Anti-Recall/main.js。"
[ -f "$ANTI_RECALL_PAYLOAD/imageStore.js" ] || die "安装包不完整：缺少 Anti-Recall/imageStore.js。"
[ -f "$ANTI_RECALL_PAYLOAD/eventParser.js" ] || die "安装包不完整：缺少 Anti-Recall/eventParser.js。"
[ -f "$ANTI_RECALL_PAYLOAD/priorityTaskQueue.js" ] || die "安装包不完整：缺少 Anti-Recall/priorityTaskQueue.js。"
[ -f "$ANTI_RECALL_PAYLOAD/node_modules/level-party/index.js" ] || die "安装包不完整：缺少 Anti-Recall 离线依赖。"
[ -f "$DEFAULT_ANTI_RECALL_CONFIG" ] || die "安装包不完整：缺少 Anti-Recall 默认配置。"
[ -f "$LAUNCHER_PAYLOAD" ] || die "安装包不完整：缺少启动器。"
[ -f "$PACKAGE_PATCHER" ] || die "安装包不完整：缺少 package.json 修改器。"

QQ_APP_PATH="${QQ_APP_PATH:-/Applications/QQ.app}"
if [ ! -d "$QQ_APP_PATH" ] && [ -d "$HOME/Applications/QQ.app" ]; then
    QQ_APP_PATH="$HOME/Applications/QQ.app"
fi

[ -d "$QQ_APP_PATH" ] || die "未找到 QQ.app。可使用 QQ_APP_PATH=/路径/QQ.app bash install.sh 指定。"

QQ_EXECUTABLE="$QQ_APP_PATH/Contents/MacOS/QQ"
QQ_RESOURCE_ROOT="$QQ_APP_PATH/Contents/Resources/app"
QQ_PACKAGE_JSON="$QQ_RESOURCE_ROOT/package.json"
QQ_LAUNCHER_DIR="$QQ_RESOURCE_ROOT/app_launcher"
QQ_LAUNCHER="$QQ_LAUNCHER_DIR/ml_install.js"

[ -x "$QQ_EXECUTABLE" ] || die "QQ.app 结构不受支持：缺少 Contents/MacOS/QQ。"
[ -f "$QQ_PACKAGE_JSON" ] || die "QQ.app 结构不受支持：缺少 Resources/app/package.json。"
[ -d "$QQ_LAUNCHER_DIR" ] || die "QQ.app 结构不受支持：缺少 Resources/app/app_launcher。"

bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$QQ_APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
[ "$bundle_id" = "com.tencent.qq" ] || die "目标应用不是腾讯 QQ（Bundle ID: ${bundle_id:-unknown}）。"

target_qq_is_running() {
    candidate_pids="$(pgrep -x -U "$(id -u)" "$(basename "$QQ_EXECUTABLE")" 2>/dev/null || true)"
    [ -n "$candidate_pids" ] || return 1

    for candidate_pid in $candidate_pids; do
        process_command="$(ps -ww -p "$candidate_pid" -o command= 2>/dev/null || true)"
        process_command="${process_command#"${process_command%%[![:space:]]*}"}"
        case "$process_command" in
            "$QQ_EXECUTABLE"|"$QQ_EXECUTABLE "*) return 0 ;;
        esac
    done
    return 1
}

if target_qq_is_running; then
    die "QQ 仍在运行。请按 Command-Q 完全退出 QQ 后重试。"
fi

LITELOADER_ROOT="${LITELOADER_ROOT:-$HOME/Library/Containers/com.tencent.qq/Data/Documents/LiteLoaderQQNT}"
BACKUP_ROOT="${LITELOADER_BACKUP_ROOT:-$HOME/Library/Containers/com.tencent.qq/Data/Documents/LiteLoaderQQNT-Installer-Backups}"
timestamp="$(date '+%Y%m%d-%H%M%S')-$$"
BACKUP_DIR="$BACKUP_ROOT/$timestamp"

case "$LITELOADER_ROOT" in
    "$HOME"|/|"") die "拒绝使用不安全的 LiteLoaderQQNT 目标路径。" ;;
esac

mkdir -p "$BACKUP_DIR/qq-app" "$BACKUP_DIR/liteloader/plugins" "$LITELOADER_ROOT/plugins" "$LITELOADER_ROOT/data"

say "备份当前文件到：$BACKUP_DIR"
cp "$QQ_PACKAGE_JSON" "$BACKUP_DIR/qq-app/package.json"
if [ -f "$QQ_LAUNCHER" ]; then
    cp "$QQ_LAUNCHER" "$BACKUP_DIR/qq-app/ml_install.js"
else
    touch "$BACKUP_DIR/qq-app/ml_install.js.was-absent"
fi

for item in LICENSE package.json src; do
    if [ -e "$LITELOADER_ROOT/$item" ]; then
        mv "$LITELOADER_ROOT/$item" "$BACKUP_DIR/liteloader/$item"
    else
        touch "$BACKUP_DIR/liteloader/$item.was-absent"
    fi
done

for plugin_name in qq-anti-recall QQNT-Toolbox lite-tools; do
    if [ -e "$LITELOADER_ROOT/plugins/$plugin_name" ]; then
        mv "$LITELOADER_ROOT/plugins/$plugin_name" "$BACKUP_DIR/liteloader/plugins/$plugin_name"
        if [ "$plugin_name" != "qq-anti-recall" ]; then
            say "已备份并停用冲突插件：$plugin_name"
        fi
    else
        touch "$BACKUP_DIR/liteloader/plugins/$plugin_name.was-absent"
    fi
done

say "安装 LiteLoaderQQNT 1.4.1（包含 Node Dirent 兼容修复）。"
ditto --noextattr --noqtn "$PAYLOAD_ROOT/src" "$LITELOADER_ROOT/src"
cp "$PAYLOAD_ROOT/package.json" "$LITELOADER_ROOT/package.json"
cp "$PAYLOAD_ROOT/LICENSE" "$LITELOADER_ROOT/LICENSE"

say "安装轻量 Anti-Recall 0.3.0（v5 有界任务调度与跨重启持久化修复版）。"
ditto --noextattr --noqtn "$ANTI_RECALL_PAYLOAD" "$LITELOADER_ROOT/plugins/qq-anti-recall"

anti_recall_config="$LITELOADER_ROOT/data/anti_recall/config.json"
if [ ! -f "$anti_recall_config" ]; then
    mkdir -p "$(dirname "$anti_recall_config")"
    cp "$DEFAULT_ANTI_RECALL_CONFIG" "$anti_recall_config"
    say "已为新安装默认开启防撤回与本地持久化记录。"
else
    say "检测到现有 Anti-Recall 配置，已保留，不覆盖功能开关。"
fi

xattr -dr com.apple.quarantine "$LITELOADER_ROOT" 2>/dev/null || true

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/liteloaderqqnt-installer.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT
/usr/bin/osascript -l JavaScript "$PACKAGE_PATCHER" "$QQ_PACKAGE_JSON" "$temporary_dir/package.json"
[ -s "$temporary_dir/package.json" ] || die "生成 QQ package.json 失败。"
staged_main="$(plutil -extract main raw -o - "$temporary_dir/package.json" 2>/dev/null || true)"
[ "$staged_main" = "./app_launcher/ml_install.js" ] || die "生成 QQ package.json 后校验失败。"

say "写入带沙盒容错和原版 QQ 回退的启动器。"
write_app_file "$LAUNCHER_PAYLOAD" "$QQ_LAUNCHER"
write_app_file "$temporary_dir/package.json" "$QQ_PACKAGE_JSON"

installed_main="$(plutil -extract main raw -o - "$QQ_PACKAGE_JSON")"
[ "$installed_main" = "./app_launcher/ml_install.js" ] || die "QQ package.json 校验失败。"

qq_version="$(plutil -extract CFBundleShortVersionString raw -o - "$QQ_APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
say "安装完成。QQ ${qq_version:-unknown}：$QQ_APP_PATH"
say "LiteLoaderQQNT：$LITELOADER_ROOT"
say "回滚命令：bash \"$SCRIPT_DIR/restore.sh\" \"$BACKUP_DIR\""
say "现在可以重新打开 QQ。QQ 更新后若注入失效，重新运行本脚本即可。"
