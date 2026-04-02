 (async () => {
  const WEB_APP_URL = globalThis.JOB_APPS_LOGGER_CONFIG?.WEB_APP_URL || "";
  const TOKEN = globalThis.JOB_APPS_LOGGER_CONFIG?.TOKEN || "";
  const DEDUPE_KEY = "joblog_seen_urls";

  if (!WEB_APP_URL || !TOKEN) {
    alert("Missing local config. Update chrome-extension/config.local.js before using the extension.");
    return;
  }

  const url = location.href;
  const normalizedUrl = normalizeUrl_(url);
  const title = document.title || "";
  const host = location.hostname.replace(/^www\./, "").toLowerCase();

  const now = new Date();
  const isoDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString().slice(0, 10);

  const serverDup = await checkServerDuplicate_(normalizedUrl);
  if (serverDup) {
    alert("Duplicate URL found in Activities. Not saved.");
    return;
  }
  const isDuplicate = await isDuplicateUrl_(normalizedUrl);
  if (isDuplicate) {
    const proceed = confirm("This URL looks like it was already saved. Save anyway?");
    if (!proceed) return;
  }

  // Source detection (normalized to your labels)
  const detectedSource = normalizeSource_(host, url);

  // Guess title/company (best-effort v1)
  const domGuess = guessFromDom_(host);
  const genericDetails = extractGenericDetails_();
  const remoteDetails = host.includes("remote.co") ? extractRemoteDetails_() : {};
  const indeedDetails = host.includes("indeed.com") ? extractIndeedDetails_() : {};
  const jobTitleGuess = indeedDetails.jobTitle || domGuess.jobTitle || guessJobTitle_(title);
  const companyGuess = indeedDetails.company || domGuess.company || guessCompany_(title, host);

  // How you found it — lets you pick Direct / Referral / Recruiter semantics
  const howFound = prompt(
    "Source (remote.co, LinkedIn, Otta, Indeed, BuiltIn, TechJobs, Direct, Referral, Recruiter):",
    detectedSource
  );
  if (howFound === null) return;
  const source = normalizeUserSource_(howFound);

  // Activity Type mapping (edit these phrases to match your dropdown if you use validation)
  let activityType = "Application";
  if (source === "Recruiter") activityType = "Recruiter Outreach";
  if (source === "Referral") activityType = "Application (Referral)";
  if (source === "Direct") activityType = "Application (Direct)";

  // Status default
  const status = "Applied";

  // Confirm/edit title & company quickly
  const jobTitle = prompt("Job Title:", jobTitleGuess || "");
  if (jobTitle === null) return;

  const company = prompt("Company:", companyGuess || "");
  if (company === null) return;

  // Verification notes prompt
  const verificationDefault =
    source === "Recruiter"
      ? "Recruiter name + where they contacted you (LinkedIn/email) + any req ID"
      : "";
  const verificationNotes = prompt("Verification Notes (optional):", verificationDefault);
  if (verificationNotes === null) return;

  // Month Day computed client-side (server also computes if omitted)
  const monthDay = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const payload = {
    token: TOKEN,
    dateFound: isoDate,
    monthDay: monthDay,
    activityType: activityType,
    responseTime: "",
    level: "",
    simplifiedTitle: "",
    jobTitle: jobTitle.trim(),
    company: company.trim(),
    link: normalizedUrl,
    salaryMin: indeedDetails.salaryMin || remoteDetails.salaryMin || genericDetails.salaryMin || "",
    salaryMax: indeedDetails.salaryMax || remoteDetails.salaryMax || genericDetails.salaryMax || "",
    employmentType:
      indeedDetails.employmentType ||
      remoteDetails.employmentType ||
      genericDetails.employmentType ||
      "",
    location: indeedDetails.location || remoteDetails.location || genericDetails.location || "",
    source: source,
    status: status,
    lastReply: "",
    verificationNotes: verificationNotes.trim()
  };

  chrome.runtime.sendMessage(
  {
    type: "JOBLOG_POST",
    webAppUrl: WEB_APP_URL,
    payload
  },
  async (resp) => {
    if (!resp) {
      alert("Save failed ❌\nNo response from extension background.");
      return;
    }
    if (resp.ok && resp.data?.ok === true) {
      await markUrlSeen_(normalizedUrl);
    } else {
      alert("Save failed ❌\n" + (resp.error || JSON.stringify(resp.data)));
    }
  }
);

  function normalizeSource_(hostname) {
    if (hostname.includes("linkedin.com")) return "LinkedIn";
    if (hostname.includes("remote.co")) return "remote.co";
    if (hostname.includes("otta.com")) return "Otta"; // keep label stable even if rebrand happens elsewhere
    if (hostname.includes("indeed.com")) return "Indeed";
    if (hostname.includes("builtin.com")) return "BuiltIn";
    if (hostname.includes("techjobs.xyz")) return "TechJobs";

    // ATS (optional usefulness)
    if (hostname.includes("greenhouse.io")) return "Greenhouse";
    if (hostname.includes("ashbyhq.com")) return "Ashby";
    if (hostname.includes("lever.co")) return "Lever";
    if (hostname.includes("myworkdayjobs.com") || hostname.includes("workday")) return "Workday";
    if (hostname.includes("smartrecruiters.com")) return "SmartRecruiters";

    // Fallback: root domain
    const parts = hostname.split(".");
    return parts.slice(-2).join(".");
  }

  function normalizeUserSource_(s) {
    const v = (s || "").trim();
    const lower = v.toLowerCase();

    // Your semantic categories
    if (lower === "direct") return "Direct";
    if (lower === "referral") return "Referral";
    if (lower === "recruiter") return "Recruiter";

    // Known sources / variants
    if (lower === "built in" || lower === "built-in") return "BuiltIn";
    if (lower === "techjobs.xyz" || lower === "techjobs") return "TechJobs";
    if (lower === "linkedin") return "LinkedIn";
    if (lower === "indeed") return "Indeed";
    if (lower === "otta") return "Otta";
    if (lower === "remote.co" || lower === "remote") return "remote.co";

    return v;
  }

  function guessJobTitle_(t) {
    const cleaned = (t || "").replace(/\s+\|\s+LinkedIn$/i, "").trim();

    // LinkedIn: "Company is hiring for X in Y | LinkedIn"
    const m = cleaned.match(/hiring\s+for\s+(.+?)\s+in\s+/i);
    if (m && m[1]) return m[1].trim();

    const parts = cleaned.split(/\s[-|–—]\s/).map(s => s.trim()).filter(Boolean);
    return parts[0] || cleaned || "";
  }

  function guessCompany_(t, h) {
    const cleaned = (t || "").trim();

    // LinkedIn: "Company is hiring for ..."
    const m = cleaned.match(/^(.+?)\s+is\s+hiring\s+for\s+/i);
    if (m && m[1]) return m[1].trim();

    const parts = cleaned.split(/\s[-|–—]\s/).map(s => s.trim()).filter(Boolean);

    // ATS marker present -> company often near it
    const ATS = ["Greenhouse", "Ashby", "Lever", "Workday", "SmartRecruiters"];
    const atsIndex = parts.findIndex(p => ATS.some(a => p.toLowerCase().includes(a.toLowerCase())));
    if (atsIndex > 0) return parts[atsIndex - 1];

    // Fallback: root domain guess
    return h.split(".").slice(-2).join(".");
  }

  function guessFromDom_(h) {
    if (!h.includes("remote.co")) return { jobTitle: "", company: "" };
    const h1 = document.querySelector("h1");
    const h2 = document.querySelector("h2");
    return {
      jobTitle: (h1?.textContent || "").trim(),
      company: (h2?.textContent || "").trim()
    };
  }

  function extractRemoteDetails_() {
    const details = {};

    const salaryText = findLabelValue_("Salary");
    if (salaryText) {
      const salary = normalizeSalaryRange_(salaryText);
      details.salaryMin = salary.min || "";
      details.salaryMax = salary.max || "";
    }

    const scheduleText = findLabelValue_("Job Schedule");
    details.employmentType = deriveEmploymentType_(scheduleText);

    const locationText = findLabelValue_("Location");
    const remoteLevelText = findLabelValue_("Remote Work Level");
    details.location = deriveLocation_(locationText, remoteLevelText);

    return details;
  }

  function extractGenericDetails_() {
    const details = {};

    const salaryText = findFirstLabelValue_([
      "Salary",
      "Compensation",
      "Pay",
      "Pay Range",
      "Salary Range"
    ]);
    if (salaryText) {
      const salary = normalizeSalaryRange_(salaryText);
      details.salaryMin = salary.min || "";
      details.salaryMax = salary.max || "";
    }

    const employmentText = findFirstLabelValue_([
      "Employment Type",
      "Job Schedule",
      "Schedule",
      "Job Type",
      "Type"
    ]);
    details.employmentType = deriveEmploymentType_(employmentText);

    const locationText = findFirstLabelValue_([
      "Location",
      "Work Location",
      "Workplace Type",
      "Remote Work Level"
    ]);
    const remoteText = findFirstLabelValue_([
      "Remote Work Level",
      "Workplace Type",
      "Remote",
      "Work Location"
    ]);
    details.location = deriveLocation_(locationText, remoteText);

    return details;
  }

  function extractIndeedDetails_() {
    const details = {};
    const job = getIndeedJobPosting_();

    if (job) {
      details.jobTitle = (job.title || "").toString().trim();
      details.company = (job.hiringOrganization?.name || "").toString().trim();

      const employmentText = Array.isArray(job.employmentType)
        ? job.employmentType.join(" ")
        : (job.employmentType || "");
      details.employmentType = deriveEmploymentType_(employmentText);

      const locText = formatIndeedLocation_(job);
      details.location = deriveLocation_(locText, job.jobLocationType || "");

      const salary = parseIndeedSalary_(job);
      details.salaryMin = salary.min || "";
      details.salaryMax = salary.max || "";
    }

    if (!details.jobTitle) {
      const h1 = document.querySelector("h1");
      details.jobTitle = (h1?.textContent || "").trim();
    }
    if (!details.company) {
      const companyEl =
        document.querySelector("[data-company-name]") ||
        document.querySelector("[data-company]") ||
        document.querySelector(".jobsearch-CompanyInfoContainer a");
      details.company = (companyEl?.textContent || "").trim();
    }
    if (!details.location) {
      const locationText = findLabelValue_("Location");
      details.location = deriveLocation_(locationText, "");
    }
    if (!details.salaryMin && !details.salaryMax) {
      const salaryText = findLabelValue_("Salary") || findLabelValue_("Compensation");
      if (salaryText) {
        const salary = normalizeSalaryRange_(salaryText);
        details.salaryMin = salary.min || "";
        details.salaryMax = salary.max || "";
      }
    }

    return details;
  }

  function getIndeedJobPosting_() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "");
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item && item["@type"] === "JobPosting") return item;
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }
    return null;
  }

  function formatIndeedLocation_(job) {
    const loc = job?.jobLocation;
    if (!loc) return "";
    const first = Array.isArray(loc) ? loc[0] : loc;
    if (typeof first === "string") return first;
    const addr = first?.address || {};
    const parts = [
      addr.addressLocality,
      addr.addressRegion,
      addr.addressCountry
    ].filter(Boolean);
    return parts.join(", ");
  }

  function parseIndeedSalary_(job) {
    const base = parseSalaryFromBaseSalary_(job?.baseSalary);
    if (base.min || base.max) {
      return normalizeSalaryNumbers_(base.min, base.max, base.unit);
    }
    return { min: "", max: "" };
  }

  function parseSalaryFromBaseSalary_(baseSalary) {
    if (!baseSalary) return { min: "", max: "", unit: "" };
    const unit = (baseSalary.unitText || baseSalary.value?.unitText || "").toString();
    const rawMin = baseSalary.value?.minValue ?? baseSalary.minValue ?? baseSalary.value?.value ?? baseSalary.value;
    const rawMax = baseSalary.value?.maxValue ?? baseSalary.maxValue ?? rawMin;
    return {
      min: rawMin != null ? Number(rawMin) : "",
      max: rawMax != null ? Number(rawMax) : "",
      unit: unit
    };
  }

  function findLabelValue_(label) {
    const nodes = Array.from(document.querySelectorAll("div, p, span, li, h3, h4"));
    const labelNode = nodes.find(n => (n.textContent || "").trim() === label);
    if (!labelNode) return "";

    // Prefer a sibling or next element with content.
    const next = labelNode.nextElementSibling;
    if (next && next.textContent) return next.textContent.trim();

    // Fallback: use parent container text minus label.
    const parentText = labelNode.parentElement?.textContent || "";
    const cleaned = parentText.replace(label, "").trim();
    return cleaned || "";
  }

  function findFirstLabelValue_(labels) {
    for (const label of labels) {
      const value = findLabelValue_(label);
      if (value) return value;
    }
    return "";
  }

  function parseSalaryRange_(text) {
    const cleaned = (text || "").replace(/,/g, "");
    const lower = cleaned.toLowerCase();
    const matches = cleaned.match(/\$?\s?\d{2,6}(?:\.\d+)?/g) || [];
    const nums = matches.map(s => Number(s.replace(/[^0-9.]/g, ""))).filter(n => !Number.isNaN(n));
    if (nums.length === 0) return { min: "", max: "", isHourly: false };
    const min = nums[0];
    const max = nums.length > 1 ? nums[1] : nums[0];
    const hourlyByText =
      lower.includes("per hour") ||
      lower.includes("hourly") ||
      lower.includes("/hr") ||
      lower.includes("hr");
    const hourlyByRange = Math.max(min, max) <= 150;
    return { min, max, isHourly: hourlyByText || hourlyByRange };
  }

  function normalizeSalaryRange_(text) {
    const parsed = parseSalaryRange_(text);
    if (!parsed.min && !parsed.max) return { min: "", max: "" };
    if (parsed.isHourly) {
      return {
        min: toAnnualSalary_(parsed.min),
        max: toAnnualSalary_(parsed.max)
      };
    }
    return {
      min: String(Math.round(parsed.min)),
      max: String(Math.round(parsed.max))
    };
  }

  function normalizeSalaryNumbers_(min, max, unit) {
    const minNum = Number(min);
    const maxNum = Number(max);
    if (Number.isNaN(minNum) && Number.isNaN(maxNum)) return { min: "", max: "" };
    const normalizedMin = Number.isNaN(minNum) ? maxNum : minNum;
    const normalizedMax = Number.isNaN(maxNum) ? minNum : maxNum;
    const unitLower = (unit || "").toLowerCase();
    const hourlyByUnit = unitLower.includes("hour") || unitLower.includes("hr");
    const hourlyByRange = Math.max(normalizedMin, normalizedMax) <= 150;
    if (hourlyByUnit || hourlyByRange) {
      return {
        min: toAnnualSalary_(normalizedMin),
        max: toAnnualSalary_(normalizedMax)
      };
    }
    return {
      min: String(Math.round(normalizedMin)),
      max: String(Math.round(normalizedMax))
    };
  }

  function toAnnualSalary_(value) {
    if (!value && value !== 0) return "";
    return String(Math.round(Number(value) * 2080));
  }

  function deriveEmploymentType_(text) {
    const lower = (text || "").toLowerCase();
    if (lower.includes("full-time") || lower.includes("employee")) return "FTE";
    if (lower.includes("contract") || lower.includes("temporary") || lower.includes("freelance")) return "Contract";
    return "FTE";
  }

  function deriveLocation_(locationText, remoteLevelText) {
    const combined = `${locationText || ""} ${remoteLevelText || ""}`.toLowerCase();
    if (combined.includes("100% remote") || combined.includes("remote")) return "Remote";
    if (combined.includes("hybrid")) return "Hybrid";
    if (combined.includes("on-site") || combined.includes("onsite")) return "On-site";
    return "";
  }
  function isDuplicateUrl_(rawUrl) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve(false);
      chrome.storage.local.get({ [DEDUPE_KEY]: {} }, (res) => {
        const seen = res[DEDUPE_KEY] || {};
        resolve(Boolean(seen[rawUrl]));
      });
    });
  }

  function markUrlSeen_(rawUrl) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve();
      chrome.storage.local.get({ [DEDUPE_KEY]: {} }, (res) => {
        const seen = res[DEDUPE_KEY] || {};
        seen[rawUrl] = Date.now();
        chrome.storage.local.set({ [DEDUPE_KEY]: seen }, () => resolve());
      });
    });
  }

  function checkServerDuplicate_(rawUrl) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "JOBLOG_CHECK",
          webAppUrl: WEB_APP_URL,
          payload: { action: "CHECK_URL", token: TOKEN, link: rawUrl }
        },
        (resp) => {
          if (!resp || !resp.ok || resp.data?.duplicate !== true) return resolve(false);
          return resolve(true);
        }
      );
    });
  }

  function normalizeUrl_(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "from", "jk", "tk", "advn", "adid", "ad", "sjdu", "acatk", "pub", "i2af", "camk", "jrtk", "xkcb", "xpse", "xfps"]
        .forEach((key) => u.searchParams.delete(key));
      return u.toString();
    } catch {
      return rawUrl;
    }
  }
})();
