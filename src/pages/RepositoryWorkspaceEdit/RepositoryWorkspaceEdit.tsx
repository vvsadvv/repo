import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import RepositoryPage from '@/pages/RepositoryPage/RepositoryPage';
import { getStoredRepositoryUser, hasRepositoryToken } from '@/utils/repositoryAuthStorage';

/* Делает: Рендерит React-компонент RepositoryWorkspaceEdit и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryWorkspaceEdit() {
  const { loading, canEditRepository, repositoryUser, refreshProfile } = useRepositoryAuth();
  const location = useLocation();
  const [restoringAccess, setRestoringAccess] = useState(false);
  const tokenPresent = hasRepositoryToken();
  const storedUser = getStoredRepositoryUser();
  const canEditByStoredSession = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryWorkspaceEdit. */ () => Boolean(tokenPresent && storedUser && ['admin', 'editor', 'user'].includes(storedUser.role)),
    [storedUser, tokenPresent]
  );

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryWorkspaceEdit. */ () => {
    if (loading || repositoryUser || !tokenPresent) {
      return;
    }

    let isActive = true;
    setRestoringAccess(true);

    void refreshProfile().finally(/* Делает: Выполняет завершающее действие после промиса. Применение: передаётся как callback в finally внутри useEffectCallback. */ () => {
      if (isActive) {
        setRestoringAccess(false);
      }
    });

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [loading, repositoryUser, refreshProfile, tokenPresent]);

  if (loading || restoringAccess) {
    return <section className='repository-page repository-page--state'>Проверка доступа...</section>;
  }

  if (!repositoryUser && !canEditByStoredSession) {
    return <Navigate to='/repository/login' state={{ from: `${location.pathname}${location.search}${location.hash}` }} replace />;
  }

  if (!canEditRepository && !canEditByStoredSession) {
    return <Navigate to='/repository/latest' replace />;
  }

  return <RepositoryPage workspaceMode='edit' />;
}
