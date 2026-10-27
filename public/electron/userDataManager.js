const fs = require("fs");
const {
    userDataFilePath,
    defaultExportDir, 
} = require("./constants"); 
const { ipcMain, dialog, shell } = require("electron");
const path = require('path');
const telemetry = require('./telemetry');
const localeManager = require('./localeManager');
const { v4: uuidv4 } = require('uuid');

const sanitizeIncomingPath = (rawPath) => {
    if (!rawPath || typeof rawPath !== 'string') return '';
    return rawPath
        .replace(/\x1B\[[0-9;]*m/g, '')
        .trim();
}

const readUserDataFromFile = () => {
    if (!fs.existsSync(userDataFilePath)) {
        // Return an empty object if the file doesn't exist to prevent errors.
        return {};
    }
    return JSON.parse(fs.readFileSync(userDataFilePath));
}

const getProxySettings = () => {
    const userData = readUserDataFromFile();
    return userData.allProxy || '';
}

const setProxySettings = (proxyValue) => {
    const userData = readUserDataFromFile();
    userData.allProxy = proxyValue || '';
    fs.writeFileSync(userDataFilePath, JSON.stringify(userData));
    return { success: true };
}

const getIncludeProxy = () => {
    const userData = readUserDataFromFile();
    return userData.includeProxy || '';
}

const setIncludeProxy = (includeProxyValue) => {
    const userData = readUserDataFromFile();
    userData.includeProxy = includeProxyValue || '';
    fs.writeFileSync(userDataFilePath, JSON.stringify(userData));
    return { success: true };
}

// Only these keys may be updated by a payload that arrives from the renderer
// — ipcMain.on('editUserData') and the onboarding 'userDataReceived' hop. An
// unfiltered `{...userData, ...data}` spread on those paths would let a
// compromised UI overwrite server-managed fields (userId, autoUpdate,
// exportDir) or plant a value the main process later trusts.
const RENDERER_WRITABLE_FIELDS = new Set([
    'name',
    'email',
    'browser',
    'event',
    // 'autoUpdate' is intentionally excluded — the invariant above lists it
    // as a server-managed field. A renderer-driven write here would let a
    // compromised UI (e.g. via the release-notes XSS surface) silently
    // disable the app's update prompt on the next launch.
    'isLabMode',
    'firstLaunchOnUpdate',
    // Validated further in applyTelemetryOptOutPolicy() below.
    'telemetryOptOut',
]);

// Main-process enforcement of the telemetry opt-out, independent of the UI:
// - only a strict boolean is accepted;
// - a *new* opt-out is only accepted outside Singapore (the UI hides the option
//   in Singapore; this stops a compromised renderer from bypassing that);
// - opting back in is always allowed, and an existing opt-out is always kept;
// - while opted out, name and email are always blanked so no PII is stored.
const applyTelemetryOptOutPolicy = (current, patch, isOutsideSingapore) => {
    const next = { ...patch };
    if ('telemetryOptOut' in next) {
        const requested = next.telemetryOptOut;
        if (typeof requested !== 'boolean') {
            delete next.telemetryOptOut;
        } else if (requested && current.telemetryOptOut !== true && !isOutsideSingapore()) {
            delete next.telemetryOptOut;
        }
    }
    const effectiveOptOut = 'telemetryOptOut' in next
        ? next.telemetryOptOut
        : current.telemetryOptOut === true;
    if (effectiveOptOut) {
        next.name = '';
        next.email = '';
    }
    return next;
}

// A profile is complete when the user has given name + email, or has opted
// out of telemetry (in which case name + email are intentionally blank).
const isUserProfileComplete = (data) =>
    !!data && (data.telemetryOptOut === true || (data.name !== '' && data.email !== ''));

// Trusted writer, for main-process callers that pass their own literal keys.
// Deliberately unfiltered: an allowlist here silently drops any field a caller
// forgets to register, which is indistinguishable from a successful save.
const writeUserDetailsToFile = (data) => {
    const userData = readUserDataFromFile();
    const patch = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const updatedData = { ...userData, ...patch };
    fs.writeFileSync(userDataFilePath, JSON.stringify(updatedData));

    telemetry.setUser({
        id: userData.userId,
    });
}

const writeRendererSuppliedUserDetails = (data) => {
    const clean = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const key of Object.keys(data)) {
            if (RENDERER_WRITABLE_FIELDS.has(key)) {
                clean[key] = data[key];
            }
        }
    }
    const current = readUserDataFromFile();
    const patch = applyTelemetryOptOutPolicy(current, clean, localeManager.isOutsideSingapore);
    // Apply the opt-out before writing so setUser() inside the writer is
    // already a no-op, and the running Sentry client is shut down.
    if ('telemetryOptOut' in patch) {
        telemetry.setTelemetryOptOut(patch.telemetryOptOut);
    }
    writeUserDetailsToFile(patch);
}

const createExportDir = (path) => {
    try {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path, { recursive: true });
        }

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

const init = async () => {
    const userDataExists = fs.existsSync(userDataFilePath);
    if (!userDataExists) {
        const defaultSettings = {
            name: "", 
            email: "",
            event: false, 
            browser: "chrome",
            autoUpdate: true,
            exportDir: defaultExportDir,
            userId: uuidv4() // Generate a unique ID for new users
        }; 
        fs.writeFileSync(userDataFilePath, JSON.stringify(defaultSettings));
    } else {
        // check if mandatory fields are set 
        const userData = JSON.parse(fs.readFileSync(userDataFilePath));
        if (!userData.exportDir) {
            userData.exportDir = defaultExportDir;
        }
        if (!userData.name) {
            userData.name = "";
        }
        if (!userData.email) {
            userData.email = "";
        }
        if (!userData.browser) {
            userData.browser = "chrome";
        }
        if (!userData.userId) {
            userData.userId = uuidv4(); // Generate ID for existing users who don't have one
        }
        fs.writeFileSync(userDataFilePath, JSON.stringify(userData));
    }


    ipcMain.handle("getUserData", (_event) => { 
        const data = readUserDataFromFile();
        return data;
    })

    ipcMain.on("editUserData", (_event, data) => {
        writeRendererSuppliedUserDetails(data);
    })

    ipcMain.handle("setExportDir", (_event) => {
        const data = readUserDataFromFile();
        const results = dialog.showOpenDialogSync({
            properties: ['openDirectory'],
            defaultPath: data.exportDir
        }); 
        if (results) {
            data.exportDir = results[0]; 
        }    
        fs.writeFileSync(userDataFilePath, JSON.stringify(data));
        return data.exportDir;
    })

    ipcMain.on("openResultsFolder", (_event, resultsPath) => {
        const safeResultsPath = sanitizeIncomingPath(resultsPath);
        if (!safeResultsPath) {
            console.error('openResultsFolder received an invalid path');
            return;
        }

        // Confine the path to the configured export directory (or the default)
        // so a renderer-side XSS / malformed IPC payload can't drive shell.openPath
        // to launch arbitrary local files with their OS default handler.
        const userData = readUserDataFromFile();
        const exportRoot = path.resolve(userData.exportDir || defaultExportDir);
        const target = path.resolve(exportRoot, safeResultsPath);
        const rel = path.relative(exportRoot, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            console.error('openResultsFolder rejected: path escapes exportDir', { target, exportRoot });
            return;
        }
        shell.openPath(target);
    })
}

const setData = async (userDataEvent) => {
    const data = readUserDataFromFile();

    if (!isUserProfileComplete(data)) {
        const userData = new Promise((resolve) => {
           userDataEvent.emit("userDataDoesNotExist", resolve);
        })
        const userDetailsReceived = await userData; 
        writeRendererSuppliedUserDetails(userDetailsReceived);
        createExportDir(data.exportDir); 
    } else {
        userDataEvent.emit("userDataDoesExist");
    }
}

module.exports = {
    init,
    setData, 
    readUserDataFromFile,
    writeUserDetailsToFile,
    createExportDir,
    getProxySettings,
    setProxySettings,
    getIncludeProxy,
    setIncludeProxy,
    applyTelemetryOptOutPolicy,
    isUserProfileComplete,
}
