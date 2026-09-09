const fs = require("fs");
const {
    userDataFilePath,
    defaultExportDir, 
} = require("./constants"); 
const { ipcMain, dialog, shell } = require("electron");
const path = require('path');
const Sentry = require('@sentry/electron/main');
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

// Only these keys may be updated by editUserData / writeUserDetailsToFile. The
// data payload is renderer-controlled (arrives via ipcMain.on('editUserData')),
// so a `{...userData, ...data}` spread would let it overwrite server-managed
// fields (userId, autoUpdate, exportDir, etc.). Keep this list in sync with
// fields written elsewhere by the main process.
const USER_DATA_WRITABLE_FIELDS = new Set([
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
]);

const writeUserDetailsToFile = (data) => {
    const userData = readUserDataFromFile();
    const clean = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const key of Object.keys(data)) {
            if (USER_DATA_WRITABLE_FIELDS.has(key)) {
                clean[key] = data[key];
            }
        }
    }
    const updatedData = { ...userData, ...clean };
    fs.writeFileSync(userDataFilePath, JSON.stringify(updatedData));

    Sentry.setUser({
        id: userData.userId,
    });
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
        writeUserDetailsToFile(data);
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

    if (data.name === "" || data.email === "") {
        const userData = new Promise((resolve) => {
           userDataEvent.emit("userDataDoesNotExist", resolve);
        })
        const userDetailsReceived = await userData; 
        writeUserDetailsToFile(userDetailsReceived);
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
}
