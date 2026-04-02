# JobAppsLogger
Chrome extension plus Google Apps Script workflow for logging job-search activity into Google Sheets and dashboards.

## Repository Layout

```text
JobAppsLogger/
├── chrome-extension/
│   ├── background.js
│   ├── extension.js
│   ├── config.example.js
│   ├── config.local.js
│   ├── icon-16.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── manifest.json
├── apps-script/
│   └── Code.gs
├── .env
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

## Private Configuration

These values should stay out of GitHub:

- `CHROME_EXTENSION_WEB_APP_URL`
- `CHROME_EXTENSION_TOKEN`
- `APPS_SCRIPT_JOB_APPS_TOKEN`

The repo now uses:

- `chrome-extension/config.local.js` for extension-only local values
- Apps Script Script Properties for deployed Google Apps Script values
- `.env` as a local reference file for the values you need to set

## Required Variables

Create a local `.env` file from `.env.example` and update:

```env
CHROME_EXTENSION_WEB_APP_URL=https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec
CHROME_EXTENSION_TOKEN=replace-with-shared-token
APPS_SCRIPT_JOB_APPS_TOKEN=replace-with-shared-token
APPS_SCRIPT_TIMEZONE=America/Denver
APPS_SCRIPT_ACTIVITIES_SHEET=Activities
APPS_SCRIPT_JOBS_SHEET=Jobs
```

Copy the same extension values into `chrome-extension/config.local.js`:

```js
globalThis.JOB_APPS_LOGGER_CONFIG = {
  WEB_APP_URL: "your-apps-script-web-app-url",
  TOKEN: "your-shared-token"
};
```

Set these Apps Script Script Properties in the bound Google Sheet project:

- `JOB_APPS_TOKEN`
- `TIMEZONE`
- `ACTIVITIES_SHEET`
- `JOBS_SHEET`

## Extension Setup

Load the unpacked extension from `chrome-extension/`.

Reload the extension whenever you change extension files.

## Apps Script Setup

Use `apps-script/Code.gs` as the backup/source file for your bound Apps Script project.

Deploy it as a Web App and use the `/exec` deployment URL in `chrome-extension/config.local.js`.

## Sheets Behavior

- `Activities` receives every activity type.
- `Jobs` receives rows whose `Activity Type` starts with `Application`.
- Duplicate URL checks run against `Activities` before prompting.

## Supported Webpages

### Customized extraction

- `remote.co`
  - title from first `h1`
  - company from first `h2`
  - site-specific title and company extraction
  - also benefits from the generic salary, employment type, and location parsing layer

- `Indeed`
  - prefers JSON-LD `JobPosting`
  - extracts title, company, location, employment type, salary
  - also benefits from the generic salary, employment type, and location parsing layer

- `LinkedIn`
  - source detection is supported
  - title/company are inferred from page title and visible top-card content
  - salary is often unavailable on public LinkedIn pages

### Universal parsing behaviors

- employment type inference from common labels such as `Employment Type`, `Job Schedule`, `Schedule`, and `Job Type`
- location inference from common `Location`, `Work Location`, `Workplace Type`, and remote-related fields
- hourly pay conversion to annualized pay using `2080` hours when salary text or structured data indicates an hourly rate

### Source normalization only

- `Otta`
- `BuiltIn`
- `TechJobs`
- `Greenhouse`
- `Ashby`
- `Lever`
- `Workday`
- `SmartRecruiters`

## Title Normalization

- strips anything after a dash before simplification
- treats dash suffixes as role-specific details rather than title text
- `Backend Engineer` becomes `Software Engineer`
- `Software Engineer ...` variants become `Software Engineer`
- `Software Engineering Manager ...` becomes simplified title `Manager`, level `Generic`
- `Technical Lead / Architect` becomes simplified title `Technical Lead`, level `Generic`
- `Program Manager` becomes simplified title `Program Manager`, level `Generic`
- `Staff` maps to `Mid-Level`
- missing level defaults to `Generic`

## Operational Notes

- extension success is silent
- alerts are shown only for errors, duplicate detection, or user prompts
- Chrome local storage keeps a seen-URL cache
- Apps Script remains the source of truth for duplicate checks


## Example Dashboard
<img width="1117" height="513" alt="image" src="https://github.com/user-attachments/assets/6011a87e-d464-4e70-8a95-289dbadad887" />
