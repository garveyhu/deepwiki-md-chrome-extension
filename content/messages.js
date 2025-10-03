chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "convertToMarkdown") {
    try {
      const headTitle = document.title || "";
      const formattedHeadTitle = headTitle
        .replace(/[\/|]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/---/, "-");

      const title =
        document
          .querySelector(
            '.container > div:nth-child(1) a[data-selected="true"]'
          )
          ?.textContent?.trim() ||
        document
          .querySelector(".container > div:nth-child(1) h1")
          ?.textContent?.trim() ||
        document.querySelector("h1")?.textContent?.trim() ||
        "Untitled";

      const contentContainer =
        document.querySelector(".container > div:nth-child(2) .prose") ||
        document.querySelector(".container > div:nth-child(2) .prose-custom") ||
        document.querySelector(".container > div:nth-child(2)") ||
        document.body;

      let markdown = ``;
      let markdownTitle = title.replace(/\s+/g, "-");

      contentContainer.childNodes.forEach((child) => {
        markdown += processNode(child);
      });

      markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");
      sendResponse({
        success: true,
        markdown,
        markdownTitle,
        headTitle: formattedHeadTitle,
      });
    } catch (error) {
      console.error("Error converting to Markdown:", error);
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === "extractAllPages") {
    try {
      const { structure, flatList } = getSidebarStructure();
      const headTitle = document.title || "";
      const formattedHeadTitle = headTitle
        .replace(/[\/|]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/---/, "-");

      const currentPageTitle =
        document
          .querySelector(
            '.container > div:nth-child(1) a[data-selected="true"]'
          )
          ?.textContent?.trim() ||
        document
          .querySelector(".container > div:nth-child(1) h1")
          ?.textContent?.trim() ||
        document.querySelector("h1")?.textContent?.trim() ||
        "Untitled";

      sendResponse({
        success: true,
        pages: flatList,
        structure: structure,
        currentTitle: currentPageTitle,
        baseUrl: window.location.origin,
        headTitle: formattedHeadTitle,
      });
    } catch (error) {
      console.error("Error extracting page links:", error);
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === "pageLoaded") {
    console.log("Page loaded:", window.location.href);
    sendResponse({ received: true });
  } else if (request.action === "tabActivated") {
    console.log("Tab activated:", window.location.href);
    sendResponse({ received: true });
  } else if (request.action === "checkTranslationStatus") {
    try {
      const hasTranslatedContent = document.querySelector(
        '[data-translate="translated"], .translated, [translate="yes"]'
      );
      const hasGoogleTranslate = document.querySelector(
        "body.translated-ltr, body.translated-rtl"
      );
      const hasTranslateAttribute =
        document.documentElement.hasAttribute("translate");
      const hasDeepwikiAutoTranslation = !!document.body.dataset.translatedLang;

      const contentContainer =
        document.querySelector(".container > div:nth-child(2) .prose") ||
        document.querySelector(".container > div:nth-child(2) .prose-custom") ||
        document.querySelector(".container > div:nth-child(2)");

      let hasChineseContent = false;
      if (contentContainer) {
        const text = contentContainer.textContent;
        const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const totalCharCount = text.length;
        if (totalCharCount > 0 && chineseCharCount / totalCharCount > 0.1) {
          hasChineseContent = true;
        }
      }

      const isTranslated =
        hasTranslatedContent ||
        hasGoogleTranslate ||
        hasTranslateAttribute ||
        hasChineseContent ||
        hasDeepwikiAutoTranslation;

      sendResponse({
        success: true,
        isTranslated: isTranslated,
        indicators: {
          hasTranslatedContent: !!hasTranslatedContent,
          hasGoogleTranslate: !!hasGoogleTranslate,
          hasTranslateAttribute: !!hasTranslateAttribute,
          hasChineseContent: hasChineseContent,
          hasDeepwikiAutoTranslation: hasDeepwikiAutoTranslation,
        },
      });
    } catch (error) {
      console.error("Error checking translation status:", error);
      sendResponse({ success: false, error: error.message });
    }
  } else if (request.action === "translatePage") {
    (async () => {
      try {
        const success = await translatePageTo(request.targetLang);
        sendResponse({ success: success });
      } catch (error) {
        console.error("Error translating page:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
  } else if (request.action === "translatePageAuto") {
    (async () => {
      try {
        const success = await translatePageTo(request.targetLang);
        sendResponse({
          success: success,
          message: success
            ? "Translation completed or not required"
            : "Translation failed",
        });
      } catch (error) {
        console.error("Error in automatic translation:", error);
        sendResponse({
          success: false,
          error: error.message,
          message: "Translation failed with error",
        });
      }
    })();
  } else if (request.action === "ping") {
    sendResponse({ ready: true });
  }
  return true;
});
