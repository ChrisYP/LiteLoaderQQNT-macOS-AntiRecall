#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/payload/LiteLoaderQQNT/plugins/qq-anti-recall"

for file in \
    main.js preload.js renderer.js imgDownloader.js rkeyManager.js \
    imageStore.js eventParser.js priorityTaskQueue.js; do
    node --check "$PLUGIN_DIR/$file"
done

for test in \
    test-priority-task-queue.js \
    test-event-parser.js \
    test-rkey-manager.js \
    test-global-capture.js \
    test-image-persistence.js; do
    node "$SCRIPT_DIR/tests/$test"
done

if [ "${RUN_NETWORK_TESTS:-0}" = "1" ]; then
    node "$SCRIPT_DIR/tests/test-img-downloader.js"
else
    printf 'SKIP: downloader loopback test (run with RUN_NETWORK_TESTS=1).\n'
fi

printf 'ALL_TESTS_OK\n'
