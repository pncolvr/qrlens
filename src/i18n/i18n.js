const SUPPORTED_LANGUAGES = ["en", "pt", "es"];
const STORAGE_KEY = "scan-language";
let translations = {};
let currentLanguage = "en";

function normalizeLanguage(value){
  const language = String(value || "").toLowerCase().split("-")[0].split("_")[0];
  return SUPPORTED_LANGUAGES.includes(language) ? language : null;
}

function detectLanguage(){
  try {
    const saved = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch(error){ }
  for (const language of navigator.languages || [navigator.language]){
    const detected = normalizeLanguage(language);
    if (detected) return detected;
  }
  return "en";
}

async function loadLanguage(language){
  const response = await fetch(new URL(`${language}.json`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load the ${language} translation.`);
  translations = await response.json();
  currentLanguage = language;
}

function replacePlaceholders(value, variables){
  return value.replace(/\{(\w+)\}/g, (match, key) => variables[key] ?? match);
}

export function t(key, variables = {}){
  const value = translations[key] ?? key;
  return replacePlaceholders(value, variables);
}

export function applyTranslations(){
  document.documentElement.lang = currentLanguage;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach(element => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(element => { element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel)); });
  document.querySelectorAll("[data-i18n-title]").forEach(element => { element.setAttribute("title", t(element.dataset.i18nTitle)); });
}

export async function initTranslations({ selector } = {}){
  currentLanguage = detectLanguage();
  try {
    await loadLanguage(currentLanguage);
  } catch(error){
    if (currentLanguage !== "en"){
      currentLanguage = "en";
      await loadLanguage("en");
    } else {
      throw error;
    }
  }
  applyTranslations();
  if (selector){
    selector.value = currentLanguage;
    selector.addEventListener("change", async event => {
      const language = normalizeLanguage(event.target.value) || "en";
      await loadLanguage(language);
      try { localStorage.setItem(STORAGE_KEY, language); } catch(error){ }
      applyTranslations();
      selector.value = language;
      selector.dispatchEvent(new CustomEvent("languagechange", { detail: language }));
    });
  }
  return { t: (key, variables) => t(key, variables), getLanguage: () => currentLanguage };
}
