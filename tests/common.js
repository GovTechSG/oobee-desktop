import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import common from "./common.js";

const websiteUrl = 'https://www.tech.gov.sg/'; 
const sitemapUrl = 'https://www.tech.gov.sg/sitemap.xml'
const cappedPages = '1'; 

const testHappyFlow = async (scanType, deviceType) => {
    // Launch Electron app.
    const electronApp = await electron.launch({ args: ['public/electron/main.js'] });
  
    // Get first window that app opens 
    const launchWindow = await electronApp.firstWindow();

    await Promise.resolve(
        launchWindow.locator('#loading-spinner').waitFor()
    ).catch(() => {});

    const isCheckForUpdate = await Promise.any([
        launchWindow.getByRole('heading', {name: 'Checking for Updates'}).waitFor().then(() => {return true}),
        launchWindow.getByRole('heading', {name: 'Setting up'}).waitFor().then(() => {return false}),
        launchWindow.getByRole('heading', {name: 'Updating app'}).waitFor().then(() => {return false}),
    ]).catch(() => {});
    
    if (isCheckForUpdate) {
        await Promise.resolve(
            launchWindow.getByRole('heading', {name: 'New update available'}).waitFor().then(async () => {
                    await validatePromptUpdateElements(launchWindow);
                    await launchWindow.getByRole('button', {name: 'Update'}).click();
                }
            )
    ).catch(() => {});
   }
  
    const mainWindow = await electronApp.waitForEvent('window', {timeout: 300000}); 
  
    // Home Page
    await common.validateHomePageElements(mainWindow); 
    
    // Init Scan Form
    await mainWindow.locator('#url-input').click();
    const url = (scanType == "Website crawl") ? websiteUrl : sitemapUrl;  
    await mainWindow.locator('#url-input').fill(url);
    await mainWindow.getByRole('button', { name: 'capped at 100 pages' }).click();
    await common.validatePageLimitElements(mainWindow);
    await mainWindow.getByLabel('pages').click();
    await mainWindow.getByLabel('pages').fill(`${cappedPages}`); 
    await mainWindow.getByRole('button', { name: `capped at ${cappedPages} pages` }).click();
    
    // Advanced Scan Options
    await mainWindow.getByRole('button', { name: 'Advanced scan options' }).click();
    await common.validateAdvancedPageOptionsLocator(mainWindow);
    await (mainWindow.locator('#scan-type-dropdown')).selectOption(scanType);
    await (mainWindow.locator('#viewport-type-dropdown')).selectOption(deviceType);
    await mainWindow.getByLabel('Scan in background').check();
    await mainWindow.getByLabel('Scan in background').uncheck();
  
    // Start Scan
    await mainWindow.getByRole('button', { name: 'Scan', exact: true }).click();
  
    // Scan Page
    await common.validateScanPageElements(mainWindow);

    // Result Page 
   await expect(mainWindow.getByRole('heading', {name: 'Scan Completed'})).toBeVisible({timeout: 180000});
   await common.validateResultPageElements(mainWindow);

    // Exit App 
    await electronApp.close();
}

const validatePromptUpdateElements = async (launchWindow) => {
   await expect(await launchWindow.getByText('Would you like to update now? It may take a few minutes.')).toBeVisible();
   await expect(await launchWindow.getByRole('button', {name: 'Later'})).toBeVisible();
   await expect(await launchWindow.getByRole('button', {name: 'Update'})).toBeVisible();
}
  
const validateHomePageElements = async (mainWindow) => {
    await expect(mainWindow.locator('#home-page')).toBeVisible(); 
    await expect(mainWindow.getByRole('img', { name: 'Logo of the GovTech Accessibility Enabling Team'})).toBeVisible();
    await expect(mainWindow.getByRole('heading', {name: 'Accessibility Site Scanner'})).toBeVisible();
    await expect(mainWindow.getByText('Enter your URL to get started')).toBeVisible();
    await expect(mainWindow.locator('#url-input')).toBeVisible(); 
    await expect(mainWindow.locator('#url-input')).toBeEditable(); 
    await expect(await mainWindow.getByRole('button', { name: 'capped at 100 pages' })).toBeVisible();
    await expect(await mainWindow.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: 'Advanced scan options' })).toBeVisible();
}
  
const validatePageLimitElements = async (mainWindow) => {
    await expect(await mainWindow.getByLabel('pages')).toBeVisible();
    await expect(await mainWindow.getByText('pages', { exact: true })).toBeVisible();
    await expect(await mainWindow.getByText('pages', { exact: true })).toBeEditable();
}
  
const validateAdvancedPageOptionsLocator = async (mainWindow) => {
    await expect(mainWindow.getByText('Scan Type:')).toBeVisible();
    await expect(mainWindow.locator('#scan-type-dropdown')).toBeVisible();
    await expect(mainWindow.locator('#scan-type-dropdown')).toBeEditable();
    await expect(mainWindow.getByText('Viewport:')).toBeVisible();
    await expect(mainWindow.locator('#viewport-type-dropdown')).toBeVisible();
    await expect(mainWindow.locator('#viewport-type-dropdown')).toBeEditable();
    await expect(mainWindow.getByText('Scan in background')).toBeVisible();
    await expect(mainWindow.getByLabel('Scan in background')).toBeVisible();
    await expect(mainWindow.getByLabel('Scan in background')).toBeEditable();
}
  
const validateScanPageElements = async (mainWindow) => {
    await mainWindow.locator('#loading-spinner').waitFor({state: "visible"});
    await expect(mainWindow.getByRole('heading', { name: 'Please wait while we scan your site...' })).toBeVisible();
}
  
const validateResultPageElements = async (mainWindow) => {
    await expect(mainWindow.getByText('Fill in the form beside to view your report.')).toBeVisible({timeout: 60000});
    await expect(mainWindow.locator('#scan-again')).toBeVisible();
}

const commons = {
    testHappyFlow,
    validateAdvancedPageOptionsLocator,
    validateHomePageElements,
    validatePageLimitElements, 
    validatePromptUpdateElements,
    validateResultPageElements,
    validateScanPageElements,
  };
  
  export default commons;

