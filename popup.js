document.addEventListener("DOMContentLoaded", () => {
  const convertBtn = document.getElementById("convertBtn");
  const batchDownloadBtn = document.getElementById("batchDownloadBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const status = document.getElementById("status");
  const translateLangSelect = document.getElementById("translateLang");
  let currentMarkdown = "";
  let currentTitle = "";
  let currentHeadTitle = "";
  let allPages = [];
  let baseUrl = "";
  let convertedPages = []; // Store all converted page content
  let isCancelled = false; // Flag to control cancellation

  const TRANSLATE_PREF_KEY = "deepwikiPreferredTranslateLang";
  const DEFAULT_TRANSLATE_LANG = "zh-CN";
  const LANGUAGE_DISPLAY_NAMES = {
    "": "原文",
    "zh-CN": "中文（简体）",
    "zh-TW": "中文（繁体）",
    ja: "日语",
    ko: "韩语",
    fr: "法语",
    de: "德语",
    es: "西班牙语",
    pt: "葡萄牙语",
    ru: "俄语",
  };

  const getLanguageDisplayName = (code) =>
    LANGUAGE_DISPLAY_NAMES[code] || code || "原文";

  const savePreferredTranslateLang = (lang) => {
    if (!chrome?.storage?.sync) {
      return;
    }
    const normalized = typeof lang === "string" ? lang : "";
    chrome.storage.sync.set({ [TRANSLATE_PREF_KEY]: normalized });
  };

  const loadPreferredTranslateLang = () => {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) {
        resolve(DEFAULT_TRANSLATE_LANG);
        return;
      }
      chrome.storage.sync.get([TRANSLATE_PREF_KEY], (result = {}) => {
        const stored = result[TRANSLATE_PREF_KEY];
        if (typeof stored === "string") {
          resolve(stored);
        } else {
          chrome.storage.sync.set({
            [TRANSLATE_PREF_KEY]: DEFAULT_TRANSLATE_LANG,
          });
          resolve(DEFAULT_TRANSLATE_LANG);
        }
      });
    });
  };

  const applyPreferredTranslateLangToSelect = (lang) => {
    if (!translateLangSelect) return;
    const optionValues = new Set(
      Array.from(translateLangSelect.options || []).map(
        (option) => option.value
      )
    );
    let valueToApply = typeof lang === "string" ? lang : DEFAULT_TRANSLATE_LANG;
    if (valueToApply && !optionValues.has(valueToApply)) {
      valueToApply = DEFAULT_TRANSLATE_LANG;
    }
    if (valueToApply === "" && !optionValues.has("")) {
      valueToApply = DEFAULT_TRANSLATE_LANG;
    }
    translateLangSelect.value = valueToApply;
    return valueToApply;
  };

  applyPreferredTranslateLangToSelect(DEFAULT_TRANSLATE_LANG);

  loadPreferredTranslateLang().then((storedLang) => {
    const applied = applyPreferredTranslateLangToSelect(storedLang);
    if (applied !== storedLang && chrome?.storage?.sync) {
      savePreferredTranslateLang(applied);
    }
  });

  translateLangSelect?.addEventListener("change", () => {
    savePreferredTranslateLang(translateLangSelect.value);
  });

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(changes, TRANSLATE_PREF_KEY)) {
        const newValue = changes[TRANSLATE_PREF_KEY]?.newValue;
        if (typeof newValue === "string") {
          applyPreferredTranslateLangToSelect(newValue);
        } else {
          const appliedDefault = applyPreferredTranslateLangToSelect(
            DEFAULT_TRANSLATE_LANG
          );
          savePreferredTranslateLang(appliedDefault);
        }
      }
    });
  }

  // Convert button click event - now also downloads
  convertBtn.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.url.includes("deepwiki.com")) {
        showStatus("Please use this extension on a DeepWiki page", "error");
        return;
      }

      const translateLang = translateLangSelect?.value ?? "";

      await waitForContentScriptReady(tab.id, 8000);

      if (translateLang) {
        showStatus(
          `Translating page to ${getLanguageDisplayName(translateLang)}...`,
          "info"
        );
        try {
          const translateResponse = await chrome.tabs.sendMessage(tab.id, {
            action: "translatePageAuto",
            targetLang: translateLang,
          });

          if (!translateResponse?.success) {
            showStatus(
              "Translation may have failed; exporting original content",
              "warning"
            );
          } else {
            await waitForTranslation(tab.id, 10000);
          }
        } catch (translateError) {
          console.warn("Single page translation error", translateError);
          showStatus(
            "Translation error, continuing with original language",
            "warning"
          );
        }
      }

      showStatus("Converting page...", "info");
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "convertToMarkdown",
      });

      if (response && response.success) {
        currentMarkdown = response.markdown;
        currentTitle = response.markdownTitle;
        currentHeadTitle = response.headTitle || "";

        // Create filename with head title and content title
        const fileName = currentHeadTitle
          ? `${currentHeadTitle}-${currentTitle}.md`
          : `${currentTitle}.md`;

        // Automatically download after successful conversion
        const blob = new Blob([currentMarkdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
          url: url,
          filename: fileName,
          saveAs: true,
        });

        showStatus("Conversion successful! Downloading...", "success");
      } else {
        showStatus(
          "Conversion failed: " + (response?.error || "Unknown error"),
          "error"
        );
      }
    } catch (error) {
      showStatus("An error occurred: " + error.message, "error");
    }
  });

  // Batch download button click event
  batchDownloadBtn.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.url.includes("deepwiki.com")) {
        showStatus("Please use this extension on a DeepWiki page", "error");
        return;
      }

      // Get selected translation language
      const translateLang = translateLangSelect?.value ?? "";

      // Reset cancellation flag and show cancel button
      isCancelled = false;
      showCancelButton(true);
      disableBatchButton(true);

      if (translateLang) {
        showStatus(
          `Extracting all page links... (Translation: ${getLanguageDisplayName(
            translateLang
          )})`,
          "info"
        );
      } else {
        showStatus("Extracting all page links...", "info");
      }

      // Extract all links first
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "extractAllPages",
      });

      if (response && response.success) {
        allPages = response.pages;
        baseUrl = response.baseUrl;

        // Use head title for folder name if available
        const headTitle = response.headTitle || "";
        const folderName =
          headTitle || response.currentTitle.replace(/\s+/g, "-");

        // Clear previous conversion results
        convertedPages = [];

        showStatus(
          translateLang
            ? `Found ${
                allPages.length
              } pages, starting batch conversion with ${getLanguageDisplayName(
                translateLang
              )} translation`
            : `Found ${allPages.length} pages, starting batch conversion`,
          "info"
        );

        // Process all pages - collect conversion results
        await processAllPages(tab.id, folderName, translateLang);

        // Download all collected content at once if not cancelled
        if (!isCancelled && convertedPages.length > 0) {
          await downloadAllPagesAsZip(folderName);
        }
      } else {
        showStatus(
          "Failed to extract page links: " +
            (response?.error || "Unknown error"),
          "error"
        );
      }
    } catch (error) {
      showStatus("An error occurred: " + error.message, "error");
    } finally {
      // Hide cancel button and re-enable batch button
      showCancelButton(false);
      disableBatchButton(false);
    }
  });

  // Cancel button click event
  cancelBtn.addEventListener("click", () => {
    isCancelled = true;
    showStatus("Cancelling batch operation...", "info");
    showCancelButton(false);
    disableBatchButton(false);
  });

  // Wait for translation to complete
  async function waitForTranslation(tabId, maxWaitTime = 10000) {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkTranslation = async () => {
        const now = Date.now();

        if (now - startTime > maxWaitTime) {
          console.log("Translation wait timeout");
          resolve(false);
          return;
        }

        try {
          // Check translation status in the page
          const result = await chrome.tabs.sendMessage(tabId, {
            action: "checkTranslationStatus",
          });
          if (result && result.isTranslated) {
            console.log("Translation detected");
            resolve(true);
            return;
          }
        } catch (error) {
          console.log("Error checking translation status:", error);
        }

        setTimeout(checkTranslation, 500);
      };

      checkTranslation();
    });
  }

  async function waitForTabLoad(tabId, maxWaitTime = 20000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < maxWaitTime) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === "complete") {
          return true;
        }
      } catch (error) {
        console.warn("waitForTabLoad error", error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return false;
  }

  async function waitForContentScriptReady(
    tabId,
    maxWaitTime = 12000,
    interval = 250
  ) {
    const start = Date.now();
    while (Date.now() - start < maxWaitTime) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: "ping",
        });
        if (response?.ready) {
          return true;
        }
      } catch (error) {
        // Ignore errors until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return false;
  }

  // Process all pages - collect conversion results but don't download immediately
  async function processAllPages(tabId, folderName, translateLang = "") {
    let processedCount = 0;
    let errorCount = 0;

    // Save current page URL
    const currentPageUrl = allPages.find((page) => page.selected)?.url || "";

    for (const page of allPages) {
      // Check if operation was cancelled
      if (isCancelled) {
        showStatus(
          `Operation cancelled. Processed: ${processedCount}, Failed: ${errorCount}`,
          "info"
        );
        // Return to original page
        if (currentPageUrl) {
          await chrome.tabs.update(tabId, { url: currentPageUrl });
        }
        return;
      }

      try {
        showStatus(
          `Processing ${processedCount + 1}/${allPages.length}: ${page.title}`,
          "info"
        );

        // Navigate to page
        await chrome.tabs.update(tabId, { url: page.url });

        const loaded = await waitForTabLoad(tabId, 25000);
        if (!loaded) {
          showStatus(
            `Timed out waiting for page to load: ${page.title}`,
            "warning"
          );
        }

        await waitForContentScriptReady(tabId, 15000);

        // Translate page if language is specified
        if (translateLang) {
          showStatus(
            `Translating ${processedCount + 1}/${allPages.length}: ${
              page.title
            } → ${getLanguageDisplayName(translateLang)}`,
            "info"
          );

          // Send translation request to content script using new automatic method
          try {
            const translateResponse = await chrome.tabs.sendMessage(tabId, {
              action: "translatePageAuto",
              targetLang: translateLang,
            });

            if (translateResponse && translateResponse.success) {
              showStatus(
                `Translation successful for: ${page.title}`,
                "success"
              );
            } else {
              showStatus(
                `Translation may have failed for: ${page.title}, continuing anyway`,
                "warning"
              );
            }
          } catch (translateError) {
            console.warn(
              "Translation failed for page:",
              page.title,
              translateError
            );
            showStatus(
              `Translation error for: ${page.title}, continuing anyway`,
              "warning"
            );
          }
        }

        // Wait for translation to complete (if automatic translation is being used)
        await waitForTranslation(tabId, translateLang ? 12000 : 5000);

        // Additional wait to ensure content is fully translated
        await new Promise((resolve) => setTimeout(resolve, 600));

        // Check again if cancelled during wait
        if (isCancelled) {
          showStatus(
            `Operation cancelled. Processed: ${processedCount}, Failed: ${errorCount}`,
            "info"
          );
          if (currentPageUrl) {
            await chrome.tabs.update(tabId, { url: currentPageUrl });
          }
          return;
        }

        // Convert page content
        const convertResponse = await chrome.tabs.sendMessage(tabId, {
          action: "convertToMarkdown",
        });

        if (convertResponse && convertResponse.success) {
          // Create file path that preserves hierarchy
          const safePath = (page.path || page.title).replace(/[<>:"|?*]/g, "-");
          const fileName = `${safePath}.md`;

          // Store converted content with hierarchy info
          convertedPages.push({
            title:
              convertResponse.markdownTitle || page.title.replace(/\s+/g, "-"),
            fileName: fileName,
            content: convertResponse.markdown,
            level: page.level || 0,
            originalTitle: page.title,
          });

          processedCount++;
        } else {
          errorCount++;
          console.error(
            `Page processing failed: ${page.title}`,
            convertResponse?.error
          );
        }
      } catch (err) {
        errorCount++;
        console.error(`Error processing page: ${page.title}`, err);
      }
    }

    // Return to original page after processing
    if (currentPageUrl) {
      await chrome.tabs.update(tabId, { url: currentPageUrl });
    }

    if (!isCancelled) {
      showStatus(
        `Batch conversion complete! Success: ${processedCount}, Failed: ${errorCount}, Preparing download...`,
        "success"
      );
    }
  }

  // Package all pages into a ZIP file for download with hierarchy preserved
  async function downloadAllPagesAsZip(folderName) {
    try {
      showStatus("Creating ZIP file...", "info");

      // Create new JSZip instance
      const zip = new JSZip();

      // Create hierarchical index file
      let indexContent = `# ${folderName}\n\n## 内容索引\n\n`;

      // Group by level for better organization
      const levelMap = new Map();
      convertedPages.forEach((page) => {
        const level = page.level || 0;
        if (!levelMap.has(level)) {
          levelMap.set(level, []);
        }
        levelMap.get(level).push(page);
      });

      // Create hierarchical index
      for (const [level, levelPages] of levelMap) {
        const indent = "  ".repeat(level);
        levelPages.forEach((page) => {
          const title = page.originalTitle || page.title;
          const fileName = page.fileName || `${page.title}.md`;
          indexContent += `${indent}- [${title}](${fileName})\n`;
        });
      }

      // Add index file to zip
      zip.file("README.md", indexContent);

      // Add all Markdown files to zip with preserved hierarchy
      convertedPages.forEach((page) => {
        const fileName = page.fileName || `${page.title}.md`;
        zip.file(fileName, page.content);
      });

      // Generate zip file
      showStatus("Compressing files...", "info");
      const zipContent = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
      });

      // Download zip file
      const zipUrl = URL.createObjectURL(zipContent);
      chrome.downloads.download(
        {
          url: zipUrl,
          filename: `${folderName}.zip`,
          saveAs: true,
        },
        () => {
          if (chrome.runtime.lastError) {
            showStatus(
              "Error downloading ZIP file: " + chrome.runtime.lastError.message,
              "error"
            );
          } else {
            showStatus(
              `ZIP file successfully generated! Contains ${convertedPages.length} Markdown files with preserved structure`,
              "success"
            );
          }
        }
      );
    } catch (error) {
      showStatus("Error creating ZIP file: " + error.message, "error");
    }
  }

  // Show or hide cancel button
  function showCancelButton(show) {
    cancelBtn.style.display = show ? "block" : "none";
  }

  // Enable or disable batch button
  function disableBatchButton(disable) {
    batchDownloadBtn.disabled = disable;
  }

  // Display status information
  function showStatus(message, type) {
    status.textContent = message;
    status.className = type;
  }
});
