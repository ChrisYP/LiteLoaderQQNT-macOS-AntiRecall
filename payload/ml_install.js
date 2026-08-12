"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const officialMain = "./application.asar/app_launcher/index.js";

function launchOfficialQQ() {
    const officialEntry = path.join(process.resourcesPath, "app", officialMain);
    require(officialEntry);
    setImmediate(() => {
        if (global.launcher?.installPathPkgJson) {
            global.launcher.installPathPkgJson.main = officialMain;
        }
    });
}

let liteLoaderPath = "";

try {
    const { app } = require("electron");
    const candidates = [
        process.env.LITELOADERQQNT_PROFILE,
        path.join(app.getPath("documents"), "LiteLoaderQQNT"),
        path.join(os.homedir(), "Library", "Containers", "com.tencent.qq", "Data", "Documents", "LiteLoaderQQNT"),
        path.join(os.homedir(), "Documents", "LiteLoaderQQNT")
    ].filter(Boolean);

    liteLoaderPath = candidates.find(candidate =>
        fs.existsSync(path.join(candidate, "package.json")) &&
        fs.existsSync(path.join(candidate, "src", "main.js"))
    ) || "";

    if (!liteLoaderPath) {
        const error = new Error("LiteLoaderQQNT installation was not accessible in this process");
        error.code = "MODULE_NOT_FOUND";
        throw error;
    }

    require(liteLoaderPath);
} catch (error) {
    const isExpectedAccessFailure =
        error?.code === "EPERM" ||
        error?.code === "EACCES" ||
        (error?.code === "MODULE_NOT_FOUND" && (!liteLoaderPath || error.message.includes(liteLoaderPath)));

    if (!isExpectedAccessFailure) {
        throw error;
    }

    console.warn(`[LiteLoaderQQNT] skipped in this QQ process: ${error.message}`);
    launchOfficialQQ();
}
