import { useEffect, useState } from 'react';
import { getGsrasSiteData } from '@gsras-services/gsrasSiteService';

/* Делает: Инкапсулирует логику React-хука useGsrasSiteData и возвращает связанные данные или обработчики. Применение: экспортируется из модуля src/gsras/hooks/useGsrasSiteData.js и используется React-компонентами проекта. */
export function useGsrasSiteData(locale = 'ru') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useGsrasSiteData. */ () => {
    let active = true;

        /* Делает: Загружает данные. Применение: используется внутри функции useEffectCallback. */
    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const payload = await getGsrasSiteData(locale);

        if (!active) {
          return;
        }

        setData(payload);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить карту сайта.');
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
  }, [locale]);

  return { data, loading, error };
}

