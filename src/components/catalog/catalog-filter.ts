import {
  EMPTY_CABINET_FILTER,
  matchesCabinetFilter,
  toCatalogMounting,
  type CabinetFilter,
  type CatalogCabinet,
} from "@/lib/catalog-list";
import { plural, type PluralForms } from "@/lib/i18n/format";

/**
 * The browser half of the catalog lists: reads the filter bar, applies the `catalog-list.ts`
 * predicates to server-rendered items and toggles `hidden` / `open`. Everything is rendered in full
 * on the server, so without this script every item is still listed and every `<details>` group
 * still opens natively.
 *
 * DOM contract (one root per list; a page may hold several):
 * - root `[data-catalog-list="<kind>"]`, `kind` picking an adapter below; optional `data-view`;
 * - filter bar `[data-catalog-filter-bar]` (server-rendered `hidden`, revealed here), its controls
 *   `[data-filter-key]` (text / number inputs, selects, the `showArchived` checkbox), a
 *   `[data-filter-clear]` button and `[data-view-option]` buttons;
 * - groups `details[data-catalog-group]` with a `[data-catalog-group-count]` carrying
 *   `data-forms-one/few/many`; items `[data-catalog-item]` carrying the adapter's `data-*`;
 * - a `[data-catalog-empty]` line shown when nothing matches.
 *
 * Filter controls have no `name`, so a picker inside a form never submits them.
 */

type FilterValues = Record<string, string | boolean>;

interface ListAdapter<Item, Filter> {
  readItem(element: HTMLElement): Item;
  readFilter(values: FilterValues): Filter;
  matches(item: Item, filter: Filter): boolean;
  /** Whether the filter narrows beyond the default view — groups with matches then open. */
  narrows(filter: Filter): boolean;
}

function text(values: FilterValues, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

function positiveInt(value: string): number | null {
  const n = Number(value);
  return value.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

const cabinetAdapter: ListAdapter<CatalogCabinet, CabinetFilter> = {
  readItem: (element) => {
    const { name = "", model = "", manufacturer = "", mounting = "", totalModules = "0" } = element.dataset;
    return {
      name,
      model,
      manufacturer,
      archived_at: element.dataset.archived === undefined ? null : "archived",
      mounting: toCatalogMounting(mounting),
      totalModules: Number(totalModules),
    };
  },
  readFilter: (values) => ({
    query: text(values, "query"),
    mounting: toCatalogMounting(text(values, "mounting")),
    minModules: positiveInt(text(values, "minModules")),
    showArchived: values.showArchived === true,
  }),
  matches: matchesCabinetFilter,
  narrows: (filter) =>
    filter.query.trim() !== "" ||
    filter.mounting !== EMPTY_CABINET_FILTER.mounting ||
    filter.minModules !== EMPTY_CABINET_FILTER.minModules,
};

/** Phase 4 registers the device list here. */
const ADAPTERS: Record<string, ListAdapter<unknown, unknown> | undefined> = {
  cabinet: cabinetAdapter,
};

const VIEW_STORAGE_PREFIX = "catalog-view:";

function readStoredView(kind: string): string | null {
  try {
    return localStorage.getItem(VIEW_STORAGE_PREFIX + kind);
  } catch {
    return null;
  }
}

function storeView(kind: string, view: string): void {
  try {
    localStorage.setItem(VIEW_STORAGE_PREFIX + kind, view);
  } catch {
    // Private mode or blocked storage: the view simply is not remembered.
  }
}

function controls(root: HTMLElement): (HTMLInputElement | HTMLSelectElement)[] {
  return [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter-key]")];
}

function readValues(root: HTMLElement): FilterValues {
  const values: FilterValues = {};
  for (const control of controls(root)) {
    const key = control.dataset.filterKey;
    if (key === undefined) continue;
    values[key] = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value;
  }
  return values;
}

/** Empties the narrowing controls; the archived toggle is a display choice and stays. */
function clearValues(root: HTMLElement): void {
  for (const control of controls(root)) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") continue;
    if (control instanceof HTMLSelectElement) control.selectedIndex = 0;
    else control.value = "";
  }
}

function setView(root: HTMLElement, view: string): void {
  root.dataset.view = view;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-view-option]")) {
    button.setAttribute("aria-pressed", String(button.dataset.viewOption === view));
  }
}

function initList(root: HTMLElement, adapter: ListAdapter<unknown, unknown>, kind: string): void {
  const groups = [...root.querySelectorAll<HTMLDetailsElement>("details[data-catalog-group]")];
  const empty = root.querySelector<HTMLElement>("[data-catalog-empty]");
  let openBeforeNarrowing: boolean[] | null = null;

  const apply = () => {
    const filter = adapter.readFilter(readValues(root));
    const narrows = adapter.narrows(filter);
    if (narrows && openBeforeNarrowing === null) openBeforeNarrowing = groups.map((group) => group.open);

    let visibleTotal = 0;
    groups.forEach((group, index) => {
      let visible = 0;
      for (const item of group.querySelectorAll<HTMLElement>("[data-catalog-item]")) {
        // The checked radio never hides: the form would otherwise submit a choice nobody can see.
        const show = adapter.matches(adapter.readItem(item), filter) || item.querySelector("input:checked") !== null;
        item.hidden = !show;
        if (show) visible += 1;
      }
      visibleTotal += visible;
      group.hidden = visible === 0;
      const count = group.querySelector<HTMLElement>("[data-catalog-group-count]");
      if (count) {
        const { formsOne = "", formsFew = "", formsMany = "" } = count.dataset;
        const forms: PluralForms = { one: formsOne, few: formsFew, many: formsMany };
        count.textContent = `${String(visible)} ${plural(visible, forms)}`;
      }
      if (narrows) group.open = visible > 0;
      else if (openBeforeNarrowing !== null) group.open = openBeforeNarrowing[index] ?? group.open;
    });
    if (!narrows) openBeforeNarrowing = null;
    if (empty) empty.hidden = visibleTotal > 0;
  };

  root.addEventListener("input", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-filter-key]")) apply();
  });
  // Selects, the archived toggle and the picker's radios: a newly checked radio frees the old one to hide.
  root.addEventListener("change", apply);
  root.addEventListener("keydown", (event) => {
    // Enter in a search box would submit the picker's form.
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.dataset.filterKey) {
      event.preventDefault();
    }
  });

  root.querySelector("[data-filter-clear]")?.addEventListener("click", () => {
    clearValues(root);
    apply();
  });

  // A required radio inside a closed group cannot be focused, so the browser would refuse the
  // submit without showing why. `invalid` does not bubble — listen in the capture phase.
  root.addEventListener(
    "invalid",
    () => {
      clearValues(root);
      apply();
      for (const group of groups) if (!group.hidden) group.open = true;
    },
    true,
  );

  const viewButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-view-option]")];
  if (viewButtons.length > 0) {
    const stored = readStoredView(kind);
    if (stored !== null && viewButtons.some((button) => button.dataset.viewOption === stored)) setView(root, stored);
    else if (root.dataset.view !== undefined) setView(root, root.dataset.view);
    for (const button of viewButtons) {
      button.addEventListener("click", () => {
        const view = button.dataset.viewOption;
        if (view === undefined) return;
        setView(root, view);
        storeView(kind, view);
      });
    }
  }

  root.querySelector<HTMLElement>("[data-catalog-filter-bar]")?.removeAttribute("hidden");
  apply();
}

export function initCatalogLists(): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-catalog-list]")) {
    const kind = root.dataset.catalogList ?? "";
    const adapter = ADAPTERS[kind];
    if (adapter === undefined || root.dataset.catalogReady !== undefined) continue;
    root.dataset.catalogReady = "";
    initList(root, adapter, kind);
  }
}
