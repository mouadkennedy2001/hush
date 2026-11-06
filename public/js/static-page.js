import { initI18n, onLanguageChange, t } from './i18n.js';
import { initTheme } from './theme.js';

initI18n();
initTheme();

function applyTitle() {
  const key = document.body?.dataset.titleKey;
  if (key) document.title = t(key);
}

applyTitle();
onLanguageChange(applyTitle);
