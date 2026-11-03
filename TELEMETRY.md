# Telemetry

Oobee Desktop sends usage information to the Oobee team at GovTech. This page explains what is collected, why, and what control you have over it.

## Why we collect telemetry

We use telemetry to understand:

- **Adoption.** How many people install and use Oobee Desktop, how often they come back, and how quickly they move to new releases.
- **Who our users are.** Which organisations, sectors and industries use Oobee (for example, government agencies or private-sector companies), so we can prioritise the support, guides and features that matter most to them.
- **The types and scope of accessibility issues.** Which WCAG success criteria fail most often and how many issues a typical site has. This tells us which checks, explanations and fix guidance are most valuable, and helps us track the overall state of web accessibility over time.
- **How often and how widely scans are run.** How frequently people scan, which scan types they use (website crawl, sitemap, custom flow, local file, and so on), how many pages a typical scan covers, and which operating systems and browsers they use.
- **Product health.** Which app versions are in use and on which operating systems, so we can focus testing where it matters and know when it is safe to retire older releases.

We do not use telemetry for advertising, and we do not sell it.

## Your name and email

When you first open Oobee Desktop, the onboarding screen asks for your name and email address. You can change them at any time from the home screen. These details are:

- saved on your computer (see [Where data is stored on your machine](#where-data-is-stored-on-your-machine)), and
- included with the scan summary sent at the end of each scan (see below).

We use your email domain to understand which organisations and industries are using Oobee.

## What is collected

### When you open and close the app

| Event | Data sent |
| ----- | --------- |
| App launched | Your operating system (Windows or macOS), the app version and your anonymous user ID. |
| App closed | Your operating system, the app version and your anonymous user ID. |

The **anonymous user ID** is a random ID (UUID) generated the first time you open the app. It lets us count active and returning users without relying on your email.

### When a scan finishes

Each time a scan completes, the app records a *Scan Completed* event with your operating system and app version. The scan engine then sends a scan summary:

| Data | Notes |
| ---- | ----- |
| Name, email and anonymous user ID | As described above. |
| Website scanned | The URL you entered and, if it redirected, the URL it ended up at. Usage analytics (Sentry) receives **only the host name** (for example, `www.example.gov.sg`), with no path, query string or credentials. Local file scans are reported as `file://redacted`. |
| Scan settings | Scan type, browser and Oobee version. |
| Page counts | The number of pages scanned, pages skipped and redirects followed. |
| Issue counts | The number of distinct issues and total occurrences in each of *Must Fix*, *Good to Fix* and *Manual Review Required*, plus the number of occurrences of each WCAG success criterion and each failed rule. |
| Cleaned-up HTML snippets (selected rules only) | For a set of form and ARIA rules (for example, missing labels or invalid ARIA attributes), Oobee sends the **structure** of the failing element so we can improve fix suggestions. Before sending, Oobee removes all text content and all attributes except a short allow-list of structural ones (such as `type`, `role` and `aria-*`). Values that could identify content, such as `href`, `src`, `name`, `value`, `title` and `aria-label`, are replaced with `...`. |

Nothing is sent while a scan is running. If a scan is cancelled or no pages could be scanned, no scan summary is sent.

### Error reports

If the app crashes or hits an unexpected error, a crash report is sent to Sentry with technical details (such as the error message, stack trace, app version and operating system) so we can fix the problem.

### What is *not* collected

- Page content, page text, screenshots or your generated reports.
- Full page URLs, URL paths or query strings (usage analytics only sees the host name; see above).
- Cookies, passwords or anything you type into sites during a custom flow scan.
- Files on your computer, apart from the crash details above.

## Where telemetry is sent

| Destination | Purpose |
| ----------- | ------- |
| [Sentry](https://sentry.io) (`*.ingest.us.sentry.io`) | App launch and close events, scan analytics, WCAG breakdowns and crash reports. |
| Google Forms (`docs.google.com`) | Scan summary records: name, email, scanned URL, scan type, page counts and the issue summary described above. |

If these services can't be reached (for example, behind a corporate firewall), the app and your scans still work and your reports are unaffected.

## Turning telemetry off

Oobee Desktop doesn't currently have a setting in the app to turn telemetry off.

You can stop the **scan summary** (name, email, scanned website and issue counts) from being sent by starting Oobee Desktop with the `OOBEE_DISABLE_TELEMETRY` environment variable set to `1`:

```shell
# macOS (Terminal)
OOBEE_DISABLE_TELEMETRY=1 open -a "Oobee Desktop"
```

```powershell
# Windows (PowerShell): launch Oobee Desktop from this same window afterwards
$env:OOBEE_DISABLE_TELEMETRY = "1"
```

Note:

- The variable must be set when the app starts. Opening Oobee Desktop from the Dock, Start menu or a desktop shortcut won't pick it up unless it is also set system-wide.
- App launch, app close, *Scan Completed* and crash report events are **still sent**. These contain only your operating system, the app version and your anonymous user ID, not your name, email or scanned websites.

If you need scans that send no telemetry at all, use the [Oobee command-line tool](https://github.com/GovTechSG/oobee) with `OOBEE_DISABLE_TELEMETRY=1`. See its [TELEMETRY.md](https://github.com/GovTechSG/oobee/blob/master/TELEMETRY.md) for details.

## Where data is stored on your machine

Oobee Desktop keeps your name, email, anonymous user ID and app preferences in a file called `userData.txt`:

| Platform | Location |
| -------- | -------- |
| Windows | `%APPDATA%\Oobee\userData.txt` |
| macOS | `~/Library/Application Support/Oobee/userData.txt` |

Deleting this file resets your anonymous user ID and preferences.

## Privacy

Collection and use of this data follow [GovTech's Privacy Policy](https://www.tech.gov.sg/privacy/) and the [Oobee Privacy Statement](https://go.gov.sg/oobee-privacy-statement), which you can also find in the app under **About**. For questions or requests about your data, please [open an issue](https://github.com/GovTechSG/oobee-desktop/issues) or contact the Oobee team.
