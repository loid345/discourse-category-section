import { apiInitializer } from "discourse/lib/api";
import { schedule } from "@ember/runloop";
import I18n from "discourse-i18n";

export default apiInitializer("1.14.0", (api) => {
  const isCategoriesHomepage = () => {
    return (
      document.body.classList.contains("navigation-categories") ||
      document.body.classList.contains("discovery-categories")
    );
  };

  const parseLocalizedTitle = (titleString, fallbackLocale = "en") => {
    if (!titleString) {
      return "";
    }

    const hasLocaleFormat =
      /^[a-z]{2}(_[A-Z]{2})?:/.test(titleString) || titleString.includes("|");

    if (!hasLocaleFormat) {
      return titleString;
    }

    const translations = {};
    const parts = titleString.split("|");

    parts.forEach((part) => {
      const match = part.match(/^([a-z]{2}(?:_[A-Z]{2})?):(.+)$/);
      if (match) {
        const [, locale, text] = match;
        translations[locale] = text.trim();
      }
    });

    const currentLocale = getCurrentLocale();

    if (translations[currentLocale]) {
      return translations[currentLocale];
    }

    const baseLocale = currentLocale.split("_")[0];
    if (translations[baseLocale]) {
      return translations[baseLocale];
    }

    if (translations[fallbackLocale]) {
      return translations[fallbackLocale];
    }

    const firstKey = Object.keys(translations)[0];
    return firstKey ? translations[firstKey] : titleString;
  };

  const getCurrentLocale = () => {
    if (typeof I18n !== "undefined" && I18n.currentLocale) {
      const locale = I18n.currentLocale();
      if (locale) {
        return locale;
      }
    }

    const htmlLang = document.documentElement.lang;
    if (htmlLang) {
      return htmlLang.replace("-", "_");
    }

    const currentUser = api.getCurrentUser();
    if (currentUser?.locale) {
      return currentUser.locale;
    }

    const siteSettings = api.container.lookup("service:site-settings");
    if (siteSettings?.default_locale) {
      return siteSettings.default_locale;
    }

    return settings.fallback_locale || "en";
  };

  const getOtherSectionTitle = () => {
    return parseLocalizedTitle(
      settings.other_section_title,
      settings.fallback_locale
    );
  };

  const extractCategoryId = (node) => {
    if (node.dataset.categoryId) {
      return node.dataset.categoryId;
    }

    const nested = node.querySelector("[data-category-id]");
    if (nested) {
      return nested.dataset.categoryId;
    }

    const link = node.querySelector("a[href*='/c/']");
    if (link) {
      const match = link.href.match(/\/c\/(?:[^/]+\/)*(\d+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  };

  const normalizeCategoryIds = (ids) => {
    if (Array.isArray(ids)) {
      return ids.map(String);
    }
    if (typeof ids === "string") {
      return ids
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (typeof ids === "number") {
      return [String(ids)];
    }
    return [];
  };

  const escapeHTML = (value) => {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  };

  const createSectionHeader = (title, isTable, isOther = false) => {
    const element = document.createElement(isTable ? "tr" : "div");
    element.className = `category-section-header${
      isOther ? " category-section-header--other" : ""
    }`;

    if (settings.enable_collapse) {
      element.classList.add("category-section-header--collapsible");
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-expanded", "true");
    }

    const inner = isTable
      ? `<td colspan="100"><span class="category-section-title">${escapeHTML(
          title
        )}</span></td>`
      : `<span class="category-section-title">${escapeHTML(title)}</span>`;

    element.innerHTML = inner;

    if (settings.enable_collapse) {
      element.addEventListener("click", handleCollapseToggle);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCollapseToggle.call(element);
        }
      });
    }

    return element;
  };

  const handleCollapseToggle = function () {
    const isCollapsed = this.classList.toggle(
      "category-section-header--collapsed"
    );
    this.setAttribute("aria-expanded", String(!isCollapsed));

    let sibling = this.nextElementSibling;
    while (sibling && !sibling.classList.contains("category-section-header")) {
      sibling.classList.toggle("category-section-item--hidden", isCollapsed);
      sibling = sibling.nextElementSibling;
    }
  };

  const buildSections = () => {
    const sections = settings.sections || [];
    if (!sections.length) {
      document.body.classList.remove("category-sections--loading");
      return;
    }

    const container = document.querySelector(
      ".category-list tbody, .category-boxes, .category-boxes-with-topics"
    );

    if (!container || container.dataset.sectionsProcessed === "true") {
      document.body.classList.remove("category-sections--loading");
      return;
    }

    const currentLocale = getCurrentLocale();
    const lastLocale = container.dataset.sectionsLocale;

    if (lastLocale && lastLocale !== currentLocale) {
      container.dataset.sectionsProcessed = "false";
    }

    container.dataset.sectionsProcessed = "true";
    container.dataset.sectionsLocale = currentLocale;

    const isTableLayout = container.tagName === "TBODY";
    const itemSelector = isTableLayout
      ? "tr[data-category-id]"
      : "[data-category-id]";

    const categoryIndex = new Map();

    container.querySelectorAll(itemSelector).forEach((node) => {
      const id = extractCategoryId(node);
      if (id) {
        categoryIndex.set(String(id), { node, assigned: false });
      }
    });

    if (categoryIndex.size === 0) {
      document.body.classList.remove("category-sections--loading");
      return;
    }

    const fragment = document.createDocumentFragment();
    const fallbackLocale = settings.fallback_locale || "en";

    sections.forEach((section) => {
      const categoryIds = normalizeCategoryIds(section.category_ids);
      const availableIds = categoryIds.filter((id) =>
        categoryIndex.has(String(id))
      );

      if (availableIds.length === 0) {
        return;
      }

      const localizedTitle = parseLocalizedTitle(
        section.title,
        fallbackLocale
      );
      const header = createSectionHeader(localizedTitle, isTableLayout);
      fragment.appendChild(header);

      categoryIds.forEach((id) => {
        const entry = categoryIndex.get(String(id));
        if (entry && !entry.assigned) {
          fragment.appendChild(entry.node);
          entry.assigned = true;
        }
      });
    });

    const unassigned = [...categoryIndex.values()].filter(
      (entry) => !entry.assigned
    );

    if (unassigned.length > 0) {
      if (settings.show_other_section) {
        const otherTitle = getOtherSectionTitle();
        const otherHeader = createSectionHeader(
          otherTitle,
          isTableLayout,
          true
        );
        fragment.appendChild(otherHeader);
      }

      unassigned.forEach(({ node }) => {
        fragment.appendChild(node);
      });
    }

    container.replaceChildren(fragment);
    document.body.classList.remove("category-sections--loading");
  };

  const resetSections = () => {
    const container = document.querySelector(
      ".category-list tbody, .category-boxes, .category-boxes-with-topics"
    );
    if (container) {
      container.dataset.sectionsProcessed = "false";
    }
  };

  api.onAppEvent("user-locale:changed", () => {
    resetSections();
    schedule("afterRender", buildSections);
  });

  api.onPageChange(() => {
    schedule("afterRender", () => {
      if (!isCategoriesHomepage()) {
        document.body.classList.remove("category-sections--loading");
        return;
      }

      document.body.classList.add("category-sections--loading");
      resetSections();
      buildSections();
    });
  });

  api.cleanupStream(resetSections);
});
