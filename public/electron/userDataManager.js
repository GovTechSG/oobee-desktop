const fs = require("fs");
const {
    userDataFilePath,
    defaultExportDir, 
} = require("./constants"); 
const { ipcMain, dialog, shell } = require("electron");
const path = require('path');
const Sentry = require('@sentry/electron/main');
const { v4: uuidv4 } = require('uuid');

const readUserDataFromFile = () => {
    if (!fs.existsSync(userDataFilePath)) {
        // Return an empty object if the file doesn't exist to prevent errors.
        return {};
    }
    return JSON.parse(fs.readFileSync(userDataFilePath));
}

const writeUserDetailsToFile = (data) => {
    const userData = readUserDataFromFile();
    const updatedData = { ...userData, ...data };
    fs.writeFileSync(userDataFilePath, JSON.stringify(updatedData));

    // Update Sentry user context with both ID and email
    Sentry.setUser({
        id: userData.userId, // Keep the existing userId
        email: data.email || userData.email || undefined,
        hasEmail: !!(data.email || userData.email)
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
        shell.openPath(resultsPath);
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
}