const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("services", {
  getVersionInfo: (callback) => {
    ipcRenderer.on("versionInfo", (event, data) => {
      callback(data);
    });
  },
  restartApp: () => {
    ipcRenderer.send("restartApp");
  },
  checkChromeExistsOnMac: async () => {
    const chromeExists = await ipcRenderer.invoke("checkChromeExistsOnMac");
    return chromeExists;
  },
  startScan: async (scanDetails) => {
    const results = await ipcRenderer.invoke("startScan", scanDetails);
    return results;
  },
  abortScan: async () => {
    await ipcRenderer.invoke("abortScan");
  },

  openReport: (scanId) => {
    ipcRenderer.send("openReport", scanId);
  },
  openResultsFolder: (resultsPath) => {
    ipcRenderer.send("openResultsFolder", resultsPath);
  },
  openUploadFolder: () => {
    ipcRenderer.send("openUploadFolder");
  },
  getEngineVersion: async () => {
    const phEngineVersion = await ipcRenderer.invoke("getEngineVersion");
    return phEngineVersion;
  },
  getResultsFolderPath: async (scanId) => {
    const reportPath = await ipcRenderer.invoke("getResultsFolderPath", scanId);
    return reportPath;
  },
  getUploadFolderPath: async () => {
    const uploadFolderPath = await ipcRenderer.invoke("getUploadFolderPath");
    return uploadFolderPath;
  },
  setExportDir: async () => {
    const exportDir = await ipcRenderer.invoke("setExportDir");
    return exportDir;
  },
  getUserData: async () => {
    const data = await ipcRenderer.invoke("getUserData");
    return data;
  },
  getErrorLog: async (timeOfScan, timeOfError) => {
    const errorLog = await ipcRenderer.invoke(
      "getErrorLog",
      timeOfScan,
      timeOfError
    );
    return errorLog;
  },
  openErrorLog: async () => {
    return await ipcRenderer.invoke("openErrorLog");
  },
  editUserData: async (userData) => {
    ipcRenderer.send("editUserData", userData);
  },
  guiReady: async () => {
    ipcRenderer.send("guiReady");
  },
  appStatus: (callback) => {
    ipcRenderer.on("appStatus", (event, data) => {
      callback(data);
    });
  },
  launchStatus: (callback) => {
    ipcRenderer.on("launchStatus", (event, data) => {
      callback(data);
    });
  },
  scanStarted: (callback) => {
    ipcRenderer.removeAllListeners("scanStarted");
    ipcRenderer.on("scanStarted", () => {
      callback();
    });
  },
  scanningUrl: (callback) => {
    ipcRenderer.removeAllListeners("scanningUrl");
    ipcRenderer.on("scanningUrl", (event, data) => {
      callback(data);
    });
  },
  scanningCompleted: (callback) => {
    ipcRenderer.removeAllListeners("scanningCompleted");
    ipcRenderer.on("scanningCompleted", () => {
      callback();
    });
  },
  generatingReport: (callback) => {
    ipcRenderer.removeAllListeners("generatingReport");
    ipcRenderer.on("generatingReport", () => {
      callback();
    });
  },
  killScan: (callback) => {
    ipcRenderer.removeAllListeners("killScan");
    ipcRenderer.on("killScan", () => {
      callback();
    });
  },
  removeAllScanListeners: () => {
    ipcRenderer.removeAllListeners("scanningUrl");
    ipcRenderer.removeAllListeners("scanningCompleted");
    ipcRenderer.removeAllListeners("generatingReport");
    ipcRenderer.removeAllListeners("killScan");
  },
  userDataExists: (callback) => {
    ipcRenderer.on("userDataExists", (event, data) => {
      callback(data);
    });
  },
  proceedUpdate: (response) => {
    ipcRenderer.send("proceedUpdate", response);
  },
  launchInstaller: (response) => {
    ipcRenderer.send("launchInstaller", response);
  },
  restartAppAfterMacOSFrontendUpdate: (response) => {
    ipcRenderer.send("restartAppAfterMacOSFrontendUpdate", response);
  },
  setUserData: (data) => {
    ipcRenderer.send("userDataReceived", data);
  },
  enableReportDownload: (callback) => {
    ipcRenderer.on("enableReportDownload", () => callback());
  },
  openLink: (url) => {
    ipcRenderer.send("openLink", url);
  },
  mailReport: async (formDetails, scanId) => {
    const response = await ipcRenderer.invoke(
      "mailReport",
      formDetails,
      scanId
    );
    return response;
  },
    selectFile: async (options) => {
      const filePath = await ipcRenderer.invoke("selectFile", options);
      return filePath;
    },
    registerExistingReportFolder: async (folderPath) =>
      ipcRenderer.invoke("registerExistingReportFolder", folderPath),
    getIsWindows: async () => ipcRenderer.invoke("isWindows"),
    checkNeedsElevation: async () => ipcRenderer.invoke("checkNeedsElevation"),
    getProxySettings: async () => ipcRenderer.invoke("getProxySettings"),
    setProxySettings: async (proxyValue) => ipcRenderer.invoke("setProxySettings", proxyValue),
    getIncludeProxy: async () => ipcRenderer.invoke("getIncludeProxy"),
    setIncludeProxy: async (includeProxyValue) => ipcRenderer.invoke("setIncludeProxy", includeProxyValue),
    llmChatProviders: async () => ipcRenderer.invoke("llmChat:providers"),
    llmFindingDetail: async ({ sessionId, category, ruleId }) =>
      ipcRenderer.invoke("llmChat:findingDetail", { sessionId, category, ruleId }),
    llmChatStart: async ({ sessionId, scanId, provider, modelId, cpuOnly, thinking, newChat }) =>
      ipcRenderer.invoke("llmChat:start", { sessionId, scanId, provider, modelId, cpuOnly, thinking, newChat }),
    llmChatSend: (payload) => ipcRenderer.send("llmChat:send", payload),
    llmChatAbort: (sessionId) => ipcRenderer.send("llmChat:abort", sessionId),
    llmChatDispose: (sessionId) => ipcRenderer.send("llmChat:dispose", sessionId),
    llmChatPreloadModel: async (modelId, cpuOnly) =>
      ipcRenderer.invoke("llmChat:preloadModel", modelId, cpuOnly),
    llmChatGetCustomProviderConfig: async () =>
      ipcRenderer.invoke("llmChat:getCustomProviderConfig"),
    llmChatSetCustomProviderConfig: async ({ baseUrl, apiKey, model }) =>
      ipcRenderer.invoke("llmChat:setCustomProviderConfig", { baseUrl, apiKey, model }),
    llmModelList: async () => ipcRenderer.invoke("llmModel:list"),
    llmModelStatus: async (modelId) => ipcRenderer.invoke("llmModel:status", modelId),
    llmModelDownload: async (modelId) => ipcRenderer.invoke("llmModel:download", modelId),
    llmModelDownloadAbort: (modelId) => ipcRenderer.send("llmModel:downloadAbort", modelId),
    onLlmModelDownloadProgress: (callback) => {
      ipcRenderer.removeAllListeners("llmModel:downloadProgress");
      ipcRenderer.on("llmModel:downloadProgress", (_e, data) => callback(data));
    },
    removeLlmModelDownloadListeners: () => {
      ipcRenderer.removeAllListeners("llmModel:downloadProgress");
    },
    onLlmChatChunk: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:chunk");
      ipcRenderer.on("llmChat:chunk", (_e, data) => callback(data));
    },
    onLlmChatUsage: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:usage");
      ipcRenderer.on("llmChat:usage", (_e, data) => callback(data));
    },
    onLlmChatStatus: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:status");
      ipcRenderer.on("llmChat:status", (_e, data) => callback(data));
    },
    onLlmChatThinking: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:thinking");
      ipcRenderer.on("llmChat:thinking", (_e, data) => callback(data));
    },
    onLlmChatToolCall: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:toolCall");
      ipcRenderer.on("llmChat:toolCall", (_e, data) => callback(data));
    },
    onLlmChatAttachment: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:attachment");
      ipcRenderer.on("llmChat:attachment", (_e, data) => callback(data));
    },
    onLlmChatDone: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:done");
      ipcRenderer.on("llmChat:done", (_e, data) => callback(data));
    },
    onLlmChatError: (callback) => {
      ipcRenderer.removeAllListeners("llmChat:error");
      ipcRenderer.on("llmChat:error", (_e, data) => callback(data));
    },
    removeLlmChatListeners: () => {
      ipcRenderer.removeAllListeners("llmChat:chunk");
      ipcRenderer.removeAllListeners("llmChat:usage");
      ipcRenderer.removeAllListeners("llmChat:status");
      ipcRenderer.removeAllListeners("llmChat:thinking");
      ipcRenderer.removeAllListeners("llmChat:toolCall");
      ipcRenderer.removeAllListeners("llmChat:attachment");
      ipcRenderer.removeAllListeners("llmChat:done");
      ipcRenderer.removeAllListeners("llmChat:error");
    },
    onLlmAnalysisUnlocked: (callback) => {
      ipcRenderer.removeAllListeners("llmAnalysisUnlocked");
      ipcRenderer.on("llmAnalysisUnlocked", () => callback());
    },
  });
