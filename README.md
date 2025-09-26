# Oobee

Oobee (formerly known as Purple A11y) is an accessibility site scanner - a customisable, automated web accessibility testing tool that allows software development teams to find and fix accessibility problems to improve persons with disabilities (PWDs) access to digital services. The official application can only be downloaded at [https://go.gov.sg/oobee](https://go.gov.sg/oobee). We recommend that you download the software only from the official link, as other sources and/or third party links may pose risks and/or compromise your system.

For software engineers who wish to run Oobee as a command line, please refer to [Oobee (CLI)](https://github.com/GovTechSG/oobee) instead.

<img alt="Oobee Desktop main screen" src="https://github.com/user-attachments/assets/3992115c-d237-4d66-b247-a541a2a49f9e">

## Technology Stack

1. [Electron](https://www.electronjs.org/)
2. [React](https://react.dev/)

## Installations

### Download Oobee

Oobee is available as a download for Windows and MacOS. Refer to [Installation Guide](/INSTALLATION.md) for step-by-step instructions.

### Development, Build and Testing

#### NodeJS Requirement
- Node LTS (22.19.0) is recommended.  The `npm` and `node` command is assumed to be available in `PATH`.
- 
#### Set Engine Version

First open terminal and navigate to the location of clone respository of Oobee.
Then set environment variable BE_TAG to set version of Oobee CLI Portable to be downloaded (see below).  Replace the version of BE_TAG `0.10.68` with the desired version.

#### Build Standalone App

##### For Mac

```shell
npm install
export BE_TAG=0.10.68
npm run make-mac
```

This will create a folder in your repository in the _out_ folder.
Enter and run the `Oobee.app` in the newly created folder in ../out.

##### For Windows

```shell
npm install -g win-node-env
npm install
$env:BE_TAG=0.10.68
npm run make-win
```

##### Special information about Windows build
- The Mac dev app includes a zipped Oobee backend when built using `npm run make-mac` process. When Oobee.app is run in the Setting Up screen, it first checks if the bundled `oobee-portable-mac.zip` version of Oobee the version to be unzipped.  If it does not match, it unzips `Oobee.app/Contents/oobee-portable-mac.zip` to the `~/Library/Application Support/Oobee/Oobee Baclemd`.
- The Windows dev app does not include the Oobee backend. It assumes the location of Oobee (CLI) Portable is already unzipped in `C:\Program Files\Oobee Desktop\Oobee Backend` or `%APPDATA%\Oobee Desktop\Oobee Backend`.

#### Run and Debug (Development)

The dev command is provided below so that a user can debug the Oobee app with STDOUT logs in the Terminal.

Run the code below to build Oobee.

##### For Mac

```shell
npm install
npm run make-mac
```

##### For Windows
```shell
npm install -g win-node-env
npm install
npm run build
```

##### Run the Dev App
Finally to start Oobee enter the code below.

```shell
npm run start
```

##### Special information about Mac and Windows development
- The Mac dev app does not include the Oobee Portable backend. It assumes the location of Oobee (CLI) Portable is already unzipped in `~/Library/Application Support/Oobee/Oobee Baclemd`.
- The Windows dev app does not include the Oobee Portable backend. It assumes the location of Oobee (CLI) Portable is already unzipped in `C:\Program Files\Oobee Desktop\Oobee Backend` or `%APPDATA%\Oobee Desktop\Oobee Backend`.

An application window should be open with the inserted version. You may debug the app through Terminal / PowerShell window.

#### Facing issues?

Open an [issue ticket](https://github.com/GovTechSG/oobee-desktop/issues) for assistance.

---

## Basic Usage

Enter a valid URL to scan in the textbox and press the "Scan" button. The default settings will crawl your website and scan 100 pages for accessibility issues.

![Oobee Desktop main page](https://github.com/user-attachments/assets/94d19cf8-88e4-46c3-b5d6-647b7c615a6e)

## Limiting pages scanned

If you find a scan takes too long to complete due to large website, or there are too many pages in a sitemap to scan, you may choose to limit number of pages scanned. Click on the drop down and enter the desired number of pages to scan.

![Limit Scan Pages](https://github.com/user-attachments/assets/b0180bd4-bd98-44f8-a8ea-9f73f29b7538)

## Advanced scan options

Click on the "Advanced scan options" button to configure the scan options.

![Advanced Scan Options](https://github.com/user-attachments/assets/58bbbf47-30f6-4751-bbb8-b8d6243f5187)

### Scan Type Selection

#### Website Crawl

The default scan option for Oobee. Oobee will crawl and scan all the links (up to page limit) within the domain in the provided URL.

#### Sitemap Crawl

With sitemap crawl, provide a URL to a sitemap file (e.g. `https.domain.com/sitemap.xml`) and Oobee will crawl and scan all the links (up to page limit) within the domain in the provided URL.

#### Custom Flow

Custom flow is used to scan Single-Page Applications (SPAs) or websites. Each page-scan is initiated by the user that is triggered via clicking the _`Scan this page`_ button. Once the specific user flow is completed and scanned, close the browser to automatically generate the Custom Flow Report.

![Screenshot 2024-11-04 at 11 08 36 AM](https://github.com/user-attachments/assets/9055ad9c-5dee-47a2-a01e-4d4d91be88cc)

### Viewport Options

Customise the viewport options to render your websites for desktop and mobile device users.

#### Desktop

Defaults to screen size of 1280x720.

#### Mobile

Defaults to screen size of iPhone 11.

#### Specific device

<details>
  <summary>Click here for list of device options supported</summary>

- Blackberry PlayBook
- Blackberry PlayBook landscape
- BlackBerry Z30
- BlackBerry Z30 landscape
- Galaxy Note 3
- Galaxy Note 3 landscape
- Galaxy Note II
- Galaxy Note II landscape
- Galaxy S III
- Galaxy S III landscape
- Galaxy S5
- Galaxy S5 landscape
- Galaxy S8
- Galaxy S8 landscape
- Galaxy S9+
- Galaxy S9+ landscape
- Galaxy Tab S4
- Galaxy Tab S4 landscape
- iPad (gen 5)
- iPad (gen 5) landscape
- iPad (gen 6)
- iPad (gen 6) landscape
- iPad (gen 7)
- iPad (gen 7) landscape
- iPad Mini
- iPad Mini landscape
- iPad Pro 11
- iPad Pro 11 landscape
- iPhone 6
- iPhone 6 landscape
- iPhone 6 Plus
- iPhone 6 Plus landscape
- iPhone 7
- iPhone 7 landscape
- iPhone 7 Plus
- iPhone 7 Plus landscape
- iPhone 8
- iPhone 8 landscape
- iPhone 8 Plus
- iPhone 8 Plus landscape
- iPhone SE
- iPhone SE landscape
- iPhone X
- iPhone X landscape
- iPhone XR
- iPhone XR landscape
- iPhone 11
- iPhone 11 landscape
- iPhone 11 Pro
- iPhone 11 Pro landscape
- iPhone 11 Pro Max
- iPhone 11 Pro Max landscape
- iPhone 12
- iPhone 12 landscape
- iPhone 12 Pro
- iPhone 12 Pro landscape
- iPhone 12 Pro Max
- iPhone 12 Pro Max landscape
- iPhone 12 Mini
- iPhone 12 Mini landscape
- iPhone 13
- iPhone 13 landscape
- iPhone 13 Pro
- iPhone 13 Pro landscape
- iPhone 13 Pro Max
- iPhone 13 Pro Max landscape
- iPhone 13 Mini
- iPhone 13 Mini landscape
- iPhone 14
- iPhone 14 landscape
- iPhone 14 Plus
- iPhone 14 Plus landscape
- iPhone 14 Pro
- iPhone 14 Pro landscape
- iPhone 14 Pro Max
- iPhone 14 Pro Max landscape
- iPhone 15
- iPhone 15 landscape
- iPhone 15 Plus
- iPhone 15 Plus landscape
- iPhone 15 Pro
- iPhone 15 Pro landscape
- iPhone 15 Pro Max
- iPhone 15 Pro Max landscape
- Kindle Fire HDX
- Kindle Fire HDX landscape
- LG Optimus L70
- LG Optimus L70 landscape
- Microsoft Lumia 550
- Microsoft Lumia 550 landscape
- Microsoft Lumia 950
- Microsoft Lumia 950 landscape
- Nexus 10
- Nexus 10 landscape
- Nexus 4
- Nexus 4 landscape
- Nexus 5
- Nexus 5 landscape
- Nexus 5X
- Nexus 5X landscape
- Nexus 6
- Nexus 6 landscape
- Nexus 6P
- Nexus 6P landscape
- Nexus 7
- Nexus 7 landscape
- Nokia Lumia 520
- Nokia Lumia 520 landscape
- Nokia N9
- Nokia N9 landscape
- Pixel 2
- Pixel 2 landscape
- Pixel 2 XL
- Pixel 2 XL landscape
- Pixel 3
- Pixel 3 landscape
- Pixel 4
- Pixel 4 landscape
- Pixel 4a (5G)
- Pixel 4a (5G) landscape
- Pixel 5
- Pixel 5 landscape
- Pixel 7
- Pixel 7 landscape
- Moto G4
- Moto G4 landscape
- Desktop Chrome HiDPI
- Desktop Chrome

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

## System Context Diagram

<img alt="System Context Diagram for Oobee" src="https://github.com/user-attachments/assets/31c7ac61-f242-4c5f-baf3-e2ed120fe1cb">

For Oobee's backed repository and to run Oobee as a command line, please refer to [Oobee (CLI)](https://github.com/GovTechSG/oobee).

## Additional Information on Data

Oobee uses third-party open-source tools that may be downloaded over the Internet during the installation process of Oobee. Users should be aware of the libraries used by examining `package.json`.

Oobee may send information to the website or URL where the user chooses to initiate a Oobee scan. Limited user information such as e-mail address, name, and basic analytics is collected for the purpose of knowing our usage patterns better.
