import { initI18n, onLanguageChange, t } from './i18n.js';

initI18n();

function applyTitle() {
  const key = document.body?.dataset.titleKey;
  if (key) document.title = t(key);
}

applyTitle();
onLanguageChange(applyTitle);
