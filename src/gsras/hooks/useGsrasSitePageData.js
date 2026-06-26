import { useEffect, useState } from 'react';
import { getGsrasSitePageData } from '@gsras-services/gsrasSiteService';

/* Делает: Проверяет страницу same. Применение: используется локально в файле src/gsras/hooks/useGsrasSitePageData.js. */
function isSamePage(currentData, page) {
  if (!currentData || !page) {
    return false;
  }

  return currentData.id === page.id;
}

/* Делает: Инкапсулирует логику React-хука useGsrasSitePageData и возвращает связанные данные или обработчики. Применение: экспортируется из модуля src/gsras/hooks/useGsrasSitePageData.js и используется React-компонентами проекта. */
export function useGsrasSitePageData(page) {
  const [data, setData] = useState(page ?? null);
  const [loading, setLoading] = useState(Boolean(page?.contentFile && !page?.bodyHtml));
  const [error, setError] = useState(null);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useGsrasSitePageData. */ () => {
    let active = true;

    if (!page) {
      setData(null);
      setError(null);
      setLoading(false);
      return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
        active = false;
      };
    }

    setData(page);

    if (page.bodyHtml || !page.contentFile) {
      setError(null);
      setLoading(false);
      return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
        active = false;
      };
    }

        /* Делает: Загружает данные. Применение: используется внутри функции useEffectCallback. */
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const payload = await getGsrasSitePageData(page.contentFile);

        if (!active) {
          return;
        }

        setData({
          ...page,
          ...payload,
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить содержимое страницы.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      active = false;
    };
  }, [page]);

  const resolvedData = isSamePage(data, page) ? data : page ?? null;
  const waitingForFullContent = Boolean(page?.contentFile && !resolvedData?.bodyHtml && !error);

  return {
    data: resolvedData,
    loading: loading || waitingForFullContent,
    error,
  };
}

