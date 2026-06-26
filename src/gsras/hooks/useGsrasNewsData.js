import { useEffect, useState } from 'react';
import { getGsrasNewsData } from '@gsras-services/gsrasNewsService';

/* Делает: Инкапсулирует логику React-хука useGsrasNewsData и возвращает связанные данные или обработчики. Применение: экспортируется из модуля src/gsras/hooks/useGsrasNewsData.js и используется React-компонентами проекта. */
export function useGsrasNewsData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useGsrasNewsData. */ () => {
    let active = true;

        /* Делает: Загружает данные. Применение: используется внутри функции useEffectCallback. */
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const payload = await getGsrasNewsData();

        if (!active) {
          return;
        }

        setData(payload);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить данные страницы новостей.');
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
  }, []);

  return { data, loading, error };
}

