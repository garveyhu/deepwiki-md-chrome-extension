const TRANSLATE_PREF_KEY = "deepwikiPreferredTranslateLang";
const DEFAULT_TRANSLATE_LANG = "zh-CN";
let preferredTranslateLang = DEFAULT_TRANSLATE_LANG;
let translatePreferenceLoaded = false;

function ensureTranslatePreferenceLoaded() {
  if (translatePreferenceLoaded) {
    return Promise.resolve(preferredTranslateLang);
  }
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      translatePreferenceLoaded = true;
      resolve(preferredTranslateLang);
      return;
    }
    chrome.storage.sync.get([TRANSLATE_PREF_KEY], (result = {}) => {
      const stored = result[TRANSLATE_PREF_KEY];
      if (typeof stored === "string") {
        preferredTranslateLang = stored;
      } else {
        preferredTranslateLang = DEFAULT_TRANSLATE_LANG;
        chrome.storage.sync.set({
          [TRANSLATE_PREF_KEY]: preferredTranslateLang,
        });
      }
      translatePreferenceLoaded = true;
      resolve(preferredTranslateLang);
    });
  });
}

function saveTranslatePreference(lang) {
  const normalized = typeof lang === "string" ? lang : "";
  preferredTranslateLang = normalized;
  translatePreferenceLoaded = true;
  if (chrome?.storage?.sync) {
    chrome.storage.sync.set({ [TRANSLATE_PREF_KEY]: preferredTranslateLang });
  }
}

async function resolveTargetLanguage(requestedLang) {
  await ensureTranslatePreferenceLoaded();
  if (typeof requestedLang === "string") {
    return requestedLang;
  }
  return preferredTranslateLang || "";
}

function applyPreferredLangToSelect(selectElement) {
  if (!selectElement) return;
  const availableValues = new Set(
    Array.from(selectElement.options || []).map((option) => option.value)
  );
  let valueToUse = preferredTranslateLang;
  if (typeof valueToUse !== "string") {
    valueToUse = "";
  }
  if (valueToUse && !availableValues.has(valueToUse)) {
    valueToUse = DEFAULT_TRANSLATE_LANG;
    saveTranslatePreference(valueToUse);
  }
  if (!availableValues.has(valueToUse) && availableValues.has("")) {
    valueToUse = "";
  }
  selectElement.value = valueToUse;
}

const GOOGLE_TRANSLATE_ELEMENT_SRC_FRAGMENT =
  "translate.google.com/translate_a/element.js";

function installGoogleTranslateElementBlocker() {
  if (window.__deepwikiTranslateElementBlockerInstalled) {
    return;
  }
  window.__deepwikiTranslateElementBlockerInstalled = true;

  const isBlockedScript = (node, overrideSrc) => {
    if (
      !node ||
      !(
        node instanceof HTMLScriptElement ||
        (typeof node.tagName === "string" &&
          node.tagName.toLowerCase() === "script")
      )
    ) {
      return false;
    }
    const srcValue =
      typeof overrideSrc === "string" && overrideSrc
        ? overrideSrc
        : node.getAttribute("src") || node.src || "";
    return (
      typeof srcValue === "string" &&
      srcValue.includes(GOOGLE_TRANSLATE_ELEMENT_SRC_FRAGMENT)
    );
  };

  const blockScript = (node, overrideSrc) => {
    if (isBlockedScript(node, overrideSrc)) {
      try {
        node.remove();
      } catch (e) {
        // ignore removal errors
      }
      console.warn(
        "[DeepWiki] Blocked Google Translate Element script to comply with CSP"
      );
      return true;
    }
    return false;
  };

  const wrapNodeMethod = (prototype, methodName, argIndex = 0) => {
    const original = prototype[methodName];
    if (typeof original !== "function") return;
    prototype[methodName] = function (...args) {
      const node = args[argIndex];
      if (blockScript(node)) {
        if (methodName === "replaceChild") {
          // replaceChild should return the removed node when successful
          return args[1];
        }
        return node;
      }
      return original.apply(this, args);
    };
  };

  wrapNodeMethod(Element.prototype, "appendChild");
  wrapNodeMethod(Element.prototype, "insertBefore");
  wrapNodeMethod(Node.prototype, "replaceChild");

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (
      this instanceof HTMLScriptElement &&
      name === "src" &&
      blockScript(this, value)
    ) {
      return value;
    }
    return nativeSetAttribute.call(this, name, value);
  };

  const srcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLScriptElement.prototype,
    "src"
  );
  if (srcDescriptor && srcDescriptor.configurable) {
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      get() {
        return srcDescriptor.get ? srcDescriptor.get.call(this) : "";
      },
      set(value) {
        if (!blockScript(this, value)) {
          if (srcDescriptor.set) {
            srcDescriptor.set.call(this, value);
          } else {
            nativeSetAttribute.call(this, "src", value);
          }
        }
        return value;
      },
      configurable: true,
      enumerable: true,
    });
  }

  document
    .querySelectorAll(`script[src*="${GOOGLE_TRANSLATE_ELEMENT_SRC_FRAGMENT}"]`)
    .forEach((script) => blockScript(script));

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (blockScript(node)) {
          return;
        }
        if (node?.querySelectorAll) {
          node
            .querySelectorAll(
              `script[src*="${GOOGLE_TRANSLATE_ELEMENT_SRC_FRAGMENT}"]`
            )
            .forEach((script) => blockScript(script));
        }
      });
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof HTMLScriptElement &&
        mutation.attributeName === "src"
      ) {
        blockScript(mutation.target);
      }
    }
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  if (typeof window !== "undefined" && !window.googleTranslateElementInit) {
    window.googleTranslateElementInit = () => {};
  }
}

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(changes, TRANSLATE_PREF_KEY)) {
      const newValue = changes[TRANSLATE_PREF_KEY]?.newValue;
      if (typeof newValue === "string") {
        preferredTranslateLang = newValue;
      } else {
        preferredTranslateLang = DEFAULT_TRANSLATE_LANG;
        saveTranslatePreference(preferredTranslateLang);
      }
      translatePreferenceLoaded = true;
      const existingSelect = document.getElementById("export-translate-lang");
      if (existingSelect) {
        applyPreferredLangToSelect(existingSelect);
      }
    }
  });
}
