#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

say() {
    printf '[LiteLoaderQQNT Restore] %s\n' "$*"
}

die() {
    printf '[LiteLoaderQQNT Restore] ERROR: %s\n' "$*" >&2
    exit 1
}

write_app_file() {
    source_file="$1"
    destination_file="$2"
    if [ -w "$destination_file" ] || { [ ! -e "$destination_file" ] && [ -w "$(dirname "$destination_file")" ]; }; then
        cp "$source_file" "$destination_file"
    else
        say "macOS 将请求管理员授权以恢复 QQ.app。"
        if [ -e "$destination_file" ]; then
            /usr/libexec/authopen -w "$destination_file" < "$source_file"
        else
            /usr/libexec/authopen -c -m 0644 -w "$destination_file" < "$source_file"
        fi
    fi
    cmp -s "$source_file" "$destination_file" || die "恢复后校验失败：$destination_file"
}

[ "$(uname -s)" = "Darwin" ] || die "此恢复脚本仅支持 macOS。"

for required_command in pgrep ps; do
    command -v "$required_command" >/dev/null 2>&1 || die "缺少系统命令：$required_command"
done

QQ_APP_PATH="${QQ_APP_PATH:-/Applications/QQ.app}"
if [ ! -d "$QQ_APP_PATH" ] && [ -d "$HOME/Applications/QQ.app" ]; then
    QQ_APP_PATH="$HOME/Applications/QQ.app"
fi

QQ_EXECUTABLE="$QQ_APP_PATH/Contents/MacOS/QQ"
QQ_RESOURCE_ROOT="$QQ_APP_PATH/Contents/Resources/app"
QQ_PACKAGE_JSON="$QQ_RESOURCE_ROOT/package.json"
QQ_LAUNCHER="$QQ_RESOURCE_ROOT/app_launcher/ml_install.js"

[ -x "$QQ_EXECUTABLE" ] || die "未找到有效的 QQ.app。"

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
BACKUP_DIR="${1:-}"

if [ -z "$BACKUP_DIR" ]; then
    if [ -d "$BACKUP_ROOT" ]; then
        BACKUP_DIR="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
    fi
fi

[ -n "$BACKUP_DIR" ] || die "没有找到备份。"
[ -f "$BACKUP_DIR/qq-app/package.json" ] || die "备份不完整：$BACKUP_DIR"

say "从备份恢复：$BACKUP_DIR"
write_app_file "$BACKUP_DIR/qq-app/package.json" "$QQ_PACKAGE_JSON"
if [ -f "$BACKUP_DIR/qq-app/ml_install.js" ]; then
    write_app_file "$BACKUP_DIR/qq-app/ml_install.js" "$QQ_LAUNCHER"
fi

rollback_timestamp="$(date '+%Y%m%d-%H%M%S')-$$"
rollback_dir="$BACKUP_DIR/replaced-during-restore-$rollback_timestamp"
mkdir -p "$rollback_dir/plugins"

for item in LICENSE package.json src; do
    if [ -e "$BACKUP_DIR/liteloader/$item" ] || [ -e "$BACKUP_DIR/liteloader/$item.was-absent" ]; then
        if [ -e "$LITELOADER_ROOT/$item" ]; then
            mv "$LITELOADER_ROOT/$item" "$rollback_dir/$item"
        fi
        if [ -d "$BACKUP_DIR/liteloader/$item" ]; then
            ditto --noextattr --noqtn "$BACKUP_DIR/liteloader/$item" "$LITELOADER_ROOT/$item"
        elif [ -f "$BACKUP_DIR/liteloader/$item" ]; then
            cp "$BACKUP_DIR/liteloader/$item" "$LITELOADER_ROOT/$item"
        fi
    fi
done

for plugin_name in qq-anti-recall QQNT-Toolbox lite-tools; do
    if [ -e "$BACKUP_DIR/liteloader/plugins/$plugin_name" ] || [ -e "$BACKUP_DIR/liteloader/plugins/$plugin_name.was-absent" ]; then
        if [ -e "$LITELOADER_ROOT/plugins/$plugin_name" ]; then
            mv "$LITELOADER_ROOT/plugins/$plugin_name" "$rollback_dir/plugins/$plugin_name"
        fi
        if [ -d "$BACKUP_DIR/liteloader/plugins/$plugin_name" ]; then
            ditto --noextattr --noqtn "$BACKUP_DIR/liteloader/plugins/$plugin_name" "$LITELOADER_ROOT/plugins/$plugin_name"
        elif [ -f "$BACKUP_DIR/liteloader/plugins/$plugin_name" ]; then
            cp "$BACKUP_DIR/liteloader/plugins/$plugin_name" "$LITELOADER_ROOT/plugins/$plugin_name"
        fi
    fi
done

say "恢复完成。用户 data 和其他插件未被修改。"
say "若安装前不存在 ml_install.js，残留文件不会再被 QQ package.json 引用，可安全忽略。"
