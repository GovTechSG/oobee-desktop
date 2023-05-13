const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { fork, spawn } = require("child_process");
const fs = require("fs");
const { randomUUID } = require("crypto");
const {
  enginePath,
  getPathVariable,
  playwrightBrowsersPath,
} = require("./constants");

const scanHistory = {};

let currentChildProcess;

const killChildProcess = () => {
  if (currentChildProcess) {
    currentChildProcess.kill("SIGKILL");
  }
};

const getScanOptions = (details) => {
  const { scanType, url, customDevice, viewportWidth, maxPages, headlessMode } =
    details;
  const options = ["-c", scanType, "-u", url];

  if (customDevice) {
    options.push("-d", customDevice);
  }

  if (viewportWidth) {
    options.push("-w", viewportWidth);
  }

  if (maxPages) {
    options.push("-p", maxPages);
  }

  if (!headlessMode) {
    options.push("-h", "no");
  }

  return options;
};

const startScan = async (scanDetails) => {
  const { scanType, url } = scanDetails;
  console.log(`Starting new ${scanType} scan at ${url}.`);

  const response = await new Promise((resolve) => {
    const scan = fork(
      path.join(enginePath, "cli.js"),
      getScanOptions(scanDetails),
      {
        silent: true,
        cwd: enginePath,
        env: {
          PLAYWRIGHT_BROWSERS_PATH: `${playwrightBrowsersPath}`,
          PATH: getPathVariable(),
        },
      }
    );

    currentChildProcess = scan;
    // scan.stdout.on('data', (chunk) => {
    //   console.log(chunk.toString());
    // })

    scan.on("exit", (code) => {
      const stdout = scan.stdout.read().toString().trim();
      if (code === 0) {
        const resultsPath = stdout
          .split("Results directory is at ")[1]
          .split(" ")[0];
        const scanId = randomUUID();
        scanHistory[scanId] = resultsPath;
        resolve({ success: true, scanId });
      } else if (code === 2) {
        resolve({
          success: false,
          message: "An error has occurred when running the custom flow scan.",
        });
      } else {
        resolve({ success: false, statusCode: code, message: stdout });
      }
      currentChildProcess = null;
    });
  });

  return response;
};

const getReportPath = (scanId) => {
  if (scanHistory[scanId]) {
    return path.join(enginePath, scanHistory[scanId], "reports", "report.html");
  }
  return null;
};

const getResultsZipPath = (scanId) => {
  if (scanHistory[scanId]) {
    return path.join(enginePath, "a11y-scan-results.zip");
  }
  return null;
};

const getResultsZip = (scanId) => {
  const resultsZipPath = getResultsZipPath(scanId);
  if (!resultsZipPath) return "";

  const reportZip = fs.readFileSync(resultsZipPath);
  return reportZip;
};

const mailResults = async (formDetails, scanId) => {
  const resultsZipPath = getResultsZipPath(scanId);

  const { websiteURL, scanType, emailAddress } = formDetails;

  const shellCommand = `
if ((Split-Path -Path $pwd -Leaf) -eq "scripts") {
  cd ..
}

$attachmentCount = 0

#Get an Outlook application object
$o = New-Object -com Outlook.Application

if ($null -eq $o) {
  throw "Unable to open outlook"
  exit
}

$mail = $o.CreateItem(0)

$mail.subject = "${scanType} scan results for: ${websiteURL}"
$mail.body = "This is your scan results for PurpleHATS. Please see the attached files for more information."


$mail.To = "<${emailAddress}>"

# # Iterate over all files and only add the ones that have an .zip extension
$files = Get-ChildItem '${resultsZipPath}'

for ($i = 0; $i -lt $files.Count; $i++) {
  $outfileName = $files[$i].FullName
  $outfileNameExtension = $files[$i].Extension

  if ($outfileNameExtension -eq ".zip") {
      $mail.Attachments.Add($outfileName);
      $attachmentCount++
  }
}

if ($attachmentCount -eq 0) {
  throw "No files were found in the specified folder. Exiting."
  $o.Quit()
  exit
}

$mail.Send()

# give time to send the email
Start-Sleep -Seconds 5

# quit Outlook
$o.Quit()

#end the script
exit
`;

  const response = await new Promise((resolve) => {
    const mailProcess = spawn("powershell.exe", [
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      shellCommand,
    ]);

    mailProcess.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        mailProcess.stderr.on("data", (data) => {
          console.error(`stderr: ${data}`);
          resolve({
            success: false,
            message: `An error has occurred when sending the email: ${data}`,
          });
        });
      }
    });
  });

  return response;
};

function createReportWindow(contextWindow, reportPath) {
  let reportWindow = new BrowserWindow({
    parent: contextWindow,
  });
  reportWindow.maximize();
  reportWindow.loadFile(reportPath);
  reportWindow.on("close", () => reportWindow.destroy());
}

const init = (contextWindow) => {
  ipcMain.handle("startScan", async (_event, scanDetails) => {
    return await startScan(scanDetails);
  });

  ipcMain.on("openReport", (_event, scanId) => {
    const reportPath = getReportPath(scanId);
    if (!reportPath) return;
    createReportWindow(contextWindow, reportPath);
  });

  ipcMain.handle("downloadResults", (_event, scanId) => {
    return getResultsZip(scanId);
  });

  ipcMain.handle("mailReport", (_event, formDetails, scanId) => {
    return mailResults(formDetails, scanId);
  });
};

module.exports = {
  init,
  killChildProcess,
};
