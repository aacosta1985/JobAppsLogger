// deployment_version 15 (change history):
// - Added ID column generation using Date Found, Job Title, Company, Source.
// - Updated ID concatenation to include Activity Type.
// - Added logging for inputs, outputs, and errors in web app handlers.
// - Added logging for spreadsheet and sheet identity to verify write target.
// - Added first-empty-row insert to avoid formula-filled blank rows.
// - Added simplified title and level defaults based on job title.
// - Normalized software engineer titles and mapped Staff to Mid-Level.
// - Added title simplification for Technical Lead/Architect and Program Manager.
// - Excluded Technical Lead and Program Manager from level detection.
// - Added dual-sheet writes: Activities for all rows, Jobs for Application rows.
// - Added Activities URL duplicate check for preflight validation.
// - Mapped Software Engineering Manager titles to Generic level and Manager simplified title.
// - Stripped dash suffixes from titles and mapped Backend Engineer to Software Engineer.
// - Moved private configuration into Script Properties for GitHub-safe backups.

// === CONFIG ===
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const ACTIVITIES_SHEET = SCRIPT_PROPS.getProperty("ACTIVITIES_SHEET") || "Activities";
const JOBS_SHEET = SCRIPT_PROPS.getProperty("JOBS_SHEET") || "Jobs";
const TIMEZONE = SCRIPT_PROPS.getProperty("TIMEZONE") || "America/Denver";
const TOKEN = SCRIPT_PROPS.getProperty("JOB_APPS_TOKEN") || "";

// Updated headers to match your sheet row 1
const HEADERS = [
  "ID",
  "Date Found",
  "Activity Type",
  "Response Time",
  "Level",
  "Simplified Title",
  "Job Title",
  "Company",
  "Link",
  "Salary Min",
  "Salary Max",
  "Employment Type",
  "Location",
  "Status",
  "Source",
  "Last Reply",
  "Verification Notes"
];

function doPost(e) {
  Logger.log("doPost: raw event=%s", JSON.stringify(e || {}));
  try {
    const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};
    Logger.log("doPost: parsed body=%s", JSON.stringify(body || {}));
    if (!body.token || body.token !== TOKEN) {
      Logger.log("doPost: unauthorized token");
      return json_({ ok: false, error: "Unauthorized" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log("doPost: spreadsheet id=%s name=%s", ss.getId(), ss.getName());
    const activitiesSheet = ss.getSheetByName(ACTIVITIES_SHEET);
    const jobsSheet = ss.getSheetByName(JOBS_SHEET);
    if (!activitiesSheet) {
      Logger.log("doPost: sheet not found=%s", ACTIVITIES_SHEET);
      return json_({ ok: false, error: `Sheet not found: ${ACTIVITIES_SHEET}` });
    }
    if (!jobsSheet) {
      Logger.log("doPost: sheet not found=%s", JOBS_SHEET);
      return json_({ ok: false, error: `Sheet not found: ${JOBS_SHEET}` });
    }
    Logger.log(
      "doPost: activities sheet name=%s id=%s url=%s",
      activitiesSheet.getName(),
      activitiesSheet.getSheetId(),
      ss.getUrl()
    );
    Logger.log(
      "doPost: jobs sheet name=%s id=%s url=%s",
      jobsSheet.getName(),
      jobsSheet.getSheetId(),
      ss.getUrl()
    );

    // Header safety check
    const headersMatchActivities = headersMatch_(activitiesSheet);
    if (!headersMatchActivities.ok) {
      Logger.log(
        "doPost: header mismatch activities expected=%s found=%s",
        JSON.stringify(HEADERS),
        JSON.stringify(headersMatchActivities.found)
      );
      return json_({
        ok: false,
        error: `Header mismatch in sheet: ${ACTIVITIES_SHEET}. Ensure row 1 headers match expected order.`,
        expected: HEADERS,
        found: headersMatchActivities.found
      });
    }

    if (body.action === "CHECK_URL") {
      const linkIndex = HEADERS.indexOf("Link") + 1;
      if (linkIndex <= 0) {
        return json_({ ok: false, error: "Link column not found in headers." });
      }
      const link = (body.link || "").toString().trim();
      if (!link) return json_({ ok: false, error: "Missing link to check." });
      const isDup = isDuplicateLink_(activitiesSheet, linkIndex, link);
      Logger.log("doPost: duplicate check link=%s result=%s", link, isDup);
      if (isDup) {
        return json_({ ok: false, duplicate: true, error: "Duplicate URL in Activities." });
      }
      return json_({ ok: true, duplicate: false });
    }

    const headersMatchJobs = headersMatch_(jobsSheet);
    if (!headersMatchJobs.ok) {
      Logger.log(
        "doPost: header mismatch jobs expected=%s found=%s",
        JSON.stringify(HEADERS),
        JSON.stringify(headersMatchJobs.found)
      );
      return json_({
        ok: false,
        error: `Header mismatch in sheet: ${JOBS_SHEET}. Ensure row 1 headers match expected order.`,
        expected: HEADERS,
        found: headersMatchJobs.found
      });
    }

    const now = new Date();
    const derived = deriveTitleAndLevel_(
      body.jobTitle || "",
      body.level || "",
      body.simplifiedTitle || ""
    );
    const rowObj = {
      "Date Found": body.dateFound || Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd"),
      "Activity Type": body.activityType || "",
      "Response Time": body.responseTime || "",
      "Level": derived.level,
      "Simplified Title": derived.simplifiedTitle,
      "Job Title": body.jobTitle || "",
      "Company": body.company || "",
      "Link": body.link || "",
      "Salary Min": body.salaryMin || "",
      "Salary Max": body.salaryMax || "",
      "Employment Type": body.employmentType || "",
      "Location": body.location || "",
      "Status": body.status || "Interested",
      "Source": body.source || "",
      "Last Reply": body.lastReply || "",
      "Verification Notes": body.verificationNotes || ""
    };

    rowObj.ID = [
      rowObj["Date Found"],
      rowObj["Activity Type"],
      rowObj["Job Title"],
      rowObj["Company"],
      rowObj["Source"]
    ].join("-");

    const row = HEADERS.map(h => rowObj[h] ?? "");
    const activityRow = findFirstEmptyRow_(activitiesSheet, 1);
    Logger.log("doPost: write activities row=%s targetRow=%s", JSON.stringify(row), activityRow);
    activitiesSheet.getRange(activityRow, 1, 1, HEADERS.length).setValues([row]);

    const isApplication = rowObj["Activity Type"].toLowerCase().startsWith("application");
    if (isApplication) {
      const jobsRow = findFirstEmptyRow_(jobsSheet, 1);
      Logger.log("doPost: write jobs row=%s targetRow=%s", JSON.stringify(row), jobsRow);
      jobsSheet.getRange(jobsRow, 1, 1, HEADERS.length).setValues([row]);
    }

    Logger.log("doPost: appended ok");
    return json_({ ok: true, appended: rowObj });
  } catch (err) {
    Logger.log("doPost: error=%s", String(err));
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  Logger.log("doGet: ping");
  return json_({ ok: true, message: "Job log endpoint running" });
}

function findFirstEmptyRow_(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2;

  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const v = (values[i][0] || "").toString().trim();
    if (!v) return i + 2;
  }
  return lastRow + 1;
}

function headersMatch_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const ok = HEADERS.every((h, i) => (firstRow[i] || "").toString().trim() === h);
  return { ok: ok, found: firstRow };
}

function isDuplicateLink_(sheet, linkColumn, link) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, linkColumn, lastRow - 1, 1).getValues();
  const target = link.toString().trim();
  for (let i = 0; i < values.length; i++) {
    const v = (values[i][0] || "").toString().trim();
    if (v === target) return true;
  }
  return false;
}

function deriveTitleAndLevel_(jobTitle, level, simplifiedTitle) {
  const title = stripDashSuffix_(normalizeWhitespace_(jobTitle));
  const providedLevel = normalizeWhitespace_(level);
  const providedSimplified = normalizeWhitespace_(simplifiedTitle);

  let detectedLevel = detectLevel_(title);
  if (detectedLevel === "Staff") detectedLevel = "Mid-Level";
  const finalLevel = providedLevel || detectedLevel || "Generic";

  let finalSimplified = providedSimplified;
  if (!finalSimplified) {
    finalSimplified = simplifyTitle_(title) || stripLevelFromTitle_(title) || title;
  }

  return { level: finalLevel, simplifiedTitle: finalSimplified };
}

function detectLevel_(title) {
  const lower = (title || "").toLowerCase();
  if (lower.includes("software engineering manager")) return "";
  if (lower.includes("technical lead")) return "";
  if (lower.includes("program manager")) return "";
  if (/\b(intern|internship)\b/.test(lower)) return "Intern";
  if (/\b(junior|jr\.?)\b/.test(lower)) return "Junior";
  if (/\b(mid|mid-level)\b/.test(lower)) return "Mid-Level";
  if (/\b(senior|sr\.?)\b/.test(lower)) return "Senior";
  if (/\b(staff)\b/.test(lower)) return "Staff";
  if (/\b(principal)\b/.test(lower)) return "Principal";
  if (/\b(lead)\b/.test(lower)) return "Lead";
  if (/\b(director)\b/.test(lower)) return "Director";
  if (/\b(manager)\b/.test(lower)) return "Manager";
  if (/\b(vp|vice president)\b/.test(lower)) return "VP";
  return "";
}

function stripLevelFromTitle_(title) {
  let t = normalizeWhitespace_(title);
  if (!t) return "";

  const patterns = [
    /\b(intern|internship)\b/gi,
    /\b(junior|jr\.?)\b/gi,
    /\b(mid|mid-level)\b/gi,
    /\b(senior|sr\.?)\b/gi,
    /\b(staff)\b/gi,
    /\b(principal)\b/gi,
    /\b(lead)\b/gi,
    /\b(director)\b/gi,
    /\b(manager)\b/gi,
    /\b(vp|vice president)\b/gi
  ];

  patterns.forEach((re) => {
    t = t.replace(re, "");
  });

  t = t.replace(/\s+[-–—]\s+/g, " ").replace(/\s+/g, " ").trim();
  return t;
}

function simplifyTitle_(title) {
  const lower = (title || "").toLowerCase();
  if (lower.includes("software engineering manager")) return "Manager";
  if (lower.includes("technical lead")) return "Technical Lead";
  if (lower.includes("program manager")) return "Program Manager";
  if (lower.includes("backend engineer")) return "Software Engineer";
  if (lower.includes("software engineer")) return "Software Engineer";
  return "";
}

function normalizeWhitespace_(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Details after a dash are assumed to be role-specific, not part of the title.
function stripDashSuffix_(s) {
  return (s || "").split(/[-–—]/)[0].trim();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
