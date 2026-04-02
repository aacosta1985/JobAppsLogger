chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["config.local.js", "extension.js"]
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "JOBLOG_POST") return;

  (async () => {
    try {
      const res = await fetch(msg.webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload)
      });

      const text = await res.text(); // Apps Script sometimes returns text even for JSON
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      sendResponse({ ok: true, status: res.status, data });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keeps the message channel open for async response
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "JOBLOG_CHECK") return;

  (async () => {
    try {
      const res = await fetch(msg.webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload)
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      sendResponse({ ok: true, status: res.status, data });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true;
});
