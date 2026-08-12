"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ImgDownloader } = require("../payload/LiteLoaderQQNT/plugins/qq-anti-recall/imgDownloader.js");

(async () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-recall-download-test-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/declared-too-large") {
      response.writeHead(200, { "content-type": "image/png", "content-length": "999999" });
      response.end(Buffer.alloc(16));
      return;
    }
    if (request.url === "/truncated") {
      response.writeHead(200, { "content-type": "image/png", "content-length": "2000" });
      response.write(Buffer.alloc(700));
      response.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "image/png" });
    response.write(Buffer.alloc(700));
    response.end(Buffer.alloc(700));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const downloader = new ImgDownloader();
  try {
    const validPath = path.join(testDir, "valid.png");
    await downloader.downloadToFile(`${base}/valid`, validPath, 2048);
    assert.equal(fs.statSync(validPath).size, 1400);

    const streamingOverflowPath = path.join(testDir, "overflow.png");
    await assert.rejects(
      () => downloader.downloadToFile(`${base}/valid`, streamingOverflowPath, 1024),
      /exceeds size limit/
    );
    assert(!fs.existsSync(streamingOverflowPath));

    const declaredOverflowPath = path.join(testDir, "declared.png");
    await assert.rejects(
      () => downloader.downloadToFile(`${base}/declared-too-large`, declaredOverflowPath, 1024),
      /exceeds size limit/
    );
    assert(!fs.existsSync(declaredOverflowPath));

    const truncatedPath = path.join(testDir, "truncated.png");
    await assert.rejects(
      () => downloader.downloadToFile(`${base}/truncated`, truncatedPath, 2048),
      /aborted|socket hang up/
    );
    assert(!fs.existsSync(truncatedPath));
  } finally {
    server.close();
  }
  console.log("IMG_DOWNLOADER_TEST_OK");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
