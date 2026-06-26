/* Делает: Нормализует значение поискового. Применение: используется локально в файле src/utils/search.ts. */
export function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/* Делает: Выполняет matches search query. Применение: используется локально в файле src/utils/search.ts. */
export function matchesSearchQuery(values: unknown[], query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри matchesSearchQuery. */ (value) => normalizeSearchValue(value).includes(normalizedQuery));
}

/* Делает: Фильтрует items by query. Применение: используется локально в файле src/utils/search.ts. */
export function filterItemsByQuery<T>(
  items: T[],
  query: string,
  getSearchValues: (item: T) => unknown[]
) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return items;
  }

  return items.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри filterItemsByQuery. */ (item) => matchesSearchQuery(getSearchValues(item), normalizedQuery));
}

/* Делает: Фильтрует элементы selectable. Применение: используется локально в файле src/utils/search.ts. */
export function filterSelectableItems<T extends { id: string | number }>(
  items: T[],
  query: string,
  getSearchValues: (item: T) => unknown[],
  selectedId?: string | number | null
) {
  const filtered = filterItemsByQuery(items, query, getSearchValues);
  const normalizedSelectedId = normalizeSearchValue(selectedId);

  if (!normalizedSelectedId) {
    return filtered;
  }

  const selectedItem = items.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри filterSelectableItems. */ (item) => normalizeSearchValue(item.id) === normalizedSelectedId);
  if (!selectedItem) {
    return filtered;
  }

  const hasSelectedInFiltered = filtered.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри filterSelectableItems. */ (item) => normalizeSearchValue(item.id) === normalizedSelectedId);
  return hasSelectedInFiltered ? filtered : [selectedItem, ...filtered];
}
