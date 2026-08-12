const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("anti_recall", {
    clearDb: () => ipcRenderer.invoke("LiteLoader.anti_recall.clearDb"),
    getNowConfig: () =>
        ipcRenderer.invoke("LiteLoader.anti_recall.getNowConfig"),
    saveConfig: (config) =>
        ipcRenderer.invoke("LiteLoader.anti_recall.saveConfig", config),
    getRecalledMsgIds: () =>
        ipcRenderer.invoke("LiteLoader.anti_recall.getRecalledMsgIds"),
    getRecalledGroupImageIds: () =>
        ipcRenderer.invoke("LiteLoader.anti_recall.getRecalledGroupImageIds"),
    getRecalledGroupImages: (msgId) =>
        ipcRenderer.invoke("LiteLoader.anti_recall.getRecalledGroupImages", msgId),
    repatchCss: (callback) =>
        ipcRenderer.on(
            "LiteLoader.anti_recall.mainWindow.repatchCss",
            callback
        ),
    recallTip: (callback) =>
        ipcRenderer.on("LiteLoader.anti_recall.mainWindow.recallTip", callback),
    recallTipList: (callback) =>
        ipcRenderer.on(
            "LiteLoader.anti_recall.mainWindow.recallTipList",
            callback
        ),
    recalledImageReady: (callback) =>
        ipcRenderer.on(
            "LiteLoader.anti_recall.mainWindow.recalledImageReady",
            callback
        )
});
