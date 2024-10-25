# Oobee Desktop

Oobee Desktop (formerly known as Purple A11y) is a desktop frontend for [Oobee](https://github.com/GovTechSG/oobee) an accessibility site scanner - a customisable, automated web accessibility testing tool that allows software development teams to find and fix accessibility problems to improve persons with disabilities (PWDs) access to digital services. The official application can only be downloaded at [https://go.gov.sg/get-purplea11y](https://go.gov.sg/get-purplea11y). We recommend that you download the software only from the official link, as other sources and/or third party links may pose risks and/or compromise your system.

<img alt="Oobee Desktop main screen" src="https://github.com/user-attachments/assets/3992115c-d237-4d66-b247-a541a2a49f9e">

## Technology Stack

1. [Electron](https://www.electronjs.org/)
2. [React](https://react.dev/)

## Installations

### Download Oobee Desktop

Oobee Desktop is available as a download for Windows and MacOS. Refer to [Installation Guide](/INSTALLATION.md) for step-by-step instructions.

### Development and Testing

#### Set Engine Version
First open terminal and navigate to the location of clone respository of Oobee Desktop.

Then export BE_TAG to set version of Oobee (engine).

```shell
export BE_TAG=0.9.48<version number>
```
#### Build Standalone App
For Mac

```shell
npm run make-mac
```
For Windows

```shell
npm run make-win
```

This will create a folder in your repository in the *out* folder.
Enter and run the Oobee.app in the newly created folder in ../out.

#### Run and Debug
Enter the code below to build Oobee Desktop.

```shell
npm run build
```

Finally to start Oobee Desktop enter the code below.

```shell
npm run start
```

An application window should be open with the inserted version. You may debug the app through Terminal / PowerShell window.

#### Facing issues?

Open an [issue ticket](https://github.com/GovTechSG/oobee-desktop/issues) for assistance.

---


## Basic Usage

Enter a valid URL to scan in the textbox and press the "Scan" button.  The default settings will crawl your website and scan 100 pages for accessibility issues.

![Oobee Desktop main page](https://github.com/user-attachments/assets/94d19cf8-88e4-46c3-b5d6-647b7c615a6e)

## Limiting pages scanned

If you find a scan takes too long to complete due to large website, or there are too many pages in a sitemap to scan, you may choose to limit number of pages scanned. Click on the drop down and enter the desired number of pages to scan.

![Limit Scan Pages](https://github.com/user-attachments/assets/b0180bd4-bd98-44f8-a8ea-9f73f29b7538)

## Advanced scan options

Click on the "Advanced scan options" button to configure the scan options.

![Advanced Scan Options](https://github.com/user-attachments/assets/58bbbf47-30f6-4751-bbb8-b8d6243f5187)

### Scan Type Selection

#### Website Crawl

The default scan option for Oobee Desktop. Oobee Desktop will crawl and scan all the links (up to page limit) within the domain in the provided URL.

#### Sitemap Crawl

With sitemap crawl, provide a URL to a sitemap file (e.g. `https.domain.com/sitemap.xml`) and Oobee Desktop will crawl and scan all the links (up to page limit) within the domain in the provided URL.

#### Custom Flow

Custom flow is used to scan Single-Page Applications (SPAs) or websites that require user authentication. 2 pop-up windows will appear after running the scan. The browser pop-up window will be used to record your actions, proceed with your actions as you would normally do on the website and close the browser window when you are done. The second window is used to log the actions in code (**do not close the second window** until the scan is completed).

![Custom Flow Browser](https://github.com/GovTechSG/purple-a11y-desktop/assets/2021525/c5962e1d-80c4-430d-853f-37009302c19d)

### Viewport Options

Customise the viewport options to render your websites for desktop and mobile device users.

#### Desktop

Defaults to screen size of 1280x720.

#### Mobile

Defaults to screen size of iPhone 11.

#### Specific device

<details>
  <summary>Click here for list of device options supported</summary>

- "Desktop Chrome HiDPI"
- "Desktop Edge HiDPI"
- "Desktop Firefox HiDPI"
- "Desktop Safari"
- "Desktop Chrome"
- "Desktop Edge"
- "Desktop Firefox"
- "Blackberry PlayBook"
- "Blackberry PlayBook landscape"
- "BlackBerry Z30"
- "BlackBerry Z30 landscape"
- "Galaxy Note 3"
- "Galaxy Note 3 landscape"
- "Galaxy Note II"
- "Galaxy Note II landscape"
- "Galaxy S III"
- "Galaxy S III landscape"
- "Galaxy S5"
- "Galaxy S5 landscape"
- "Galaxy S8"
- "Galaxy S8 landscape"
- "Galaxy S9+"
- "Galaxy S9+ landscape"
- "Galaxy Tab S4"
- "Galaxy Tab S4 landscape"
- "iPad (gen 6)"
- "iPad (gen 6) landscape"
- "iPad (gen 7)"
- "iPad (gen 7) landscape"
- "iPad Mini"
- "iPad Mini landscape"
- "iPad Pro 11"
- "iPad Pro 11 landscape"
- "iPhone 6"
- "iPhone 6 landscape"
- "iPhone 6 Plus"
- "iPhone 6 Plus landscape"
- "iPhone 7"
- "iPhone 7 landscape"
- "iPhone 7 Plus"
- "iPhone 7 Plus landscape"
- "iPhone 8"
- "iPhone 8 landscape"
- "iPhone 8 Plus"
- "iPhone 8 Plus landscape"
- "iPhone SE"
- "iPhone SE landscape"
- "iPhone X"
- "iPhone X landscape"
- "iPhone XR"
- "iPhone XR landscape"
- "iPhone 11"
- "iPhone 11 landscape"
- "iPhone 11 Pro"
- "iPhone 11 Pro landscape"
- "iPhone 11 Pro Max"
- "iPhone 11 Pro Max landscape"
- "iPhone 12"
- "iPhone 12 landscape"
- "iPhone 12 Pro"
- "iPhone 12 Pro landscape"
- "iPhone 12 Pro Max"
- "iPhone 12 Pro Max landscape"
- "iPhone 12 Mini"
- "iPhone 12 Mini landscape"
- "iPhone 13"
- "iPhone 13 landscape"
- "iPhone 13 Pro"
- "iPhone 13 Pro landscape"
- "iPhone 13 Pro Max"
- "iPhone 13 Pro Max landscape"
- "iPhone 13 Mini"
- "iPhone 13 Mini landscape"
- "Kindle Fire HDX"
- "Kindle Fire HDX landscape"
- "LG Optimus L70"
- "LG Optimus L70 landscape"
- "Microsoft Lumia 550"
- "Microsoft Lumia 550 landscape"
- "Microsoft Lumia 950"
- "Microsoft Lumia 950 landscape"
- "Nexus 10"
- "Nexus 10 landscape"
- "Nexus 4"
- "Nexus 4 landscape"
- "Nexus 5"
- "Nexus 5 landscape"
- "Nexus 5X"
- "Nexus 5X landscape"
- "Nexus 6"
- "Nexus 6 landscape"
- "Nexus 6P"
- "Nexus 6P landscape"
- "Nexus 7"
- "Nexus 7 landscape"
- "Nokia Lumia 520"
- "Nokia Lumia 520 landscape"
- "Nokia N9"
- "Nokia N9 landscape"
- "Pixel 2"
- "Pixel 2 landscape"
- "Pixel 2 XL"
- "Pixel 2 XL landscape"
- "Pixel 3"
- "Pixel 3 landscape"
- "Pixel 4"
- "Pixel 4 landscape"
- "Pixel 4a (5G)"
- "Pixel 4a (5G) landscape"
- "Pixel 5"
- "Pixel 5 landscape"
- "Moto G4"
- "Moto G4 landscape"

</details>

### Custom Width

Enter a custom width in pixels. Minimum width is 320px and Maximum width is 1080px.

## Report
Once a scan of the site is completed. 

A report will be downloaded into the ../Documents folder.

An Address link to report is provided. Click on the link to access the location of the report. 

You can also click on the view report button to see the Accessibility Scan Results.

## Accessibility Scan Results
For details on which accessibility scan results trigger "Must Fix" / "Good to Fix" findings, you may refer to [Scan Issue Details](https://github.com/GovTechSG/oobee/blob/master/DETAILS.md).

## Additional Information on Data

Oobee Desktop uses third-party open-source tools that may be downloaded over the Internet during the installation process of Oobee. Users should be aware of the libraries used by examining `package.json`.

Oobee Desktop may send information to the website or URL where the user chooses to initiate a Oobee scan. Limited user information such as e-mail address, name, and basic analytics is collected for the purpose of knowing our usage patterns better.
