import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import RepositoryPage from '@/pages/RepositoryPage/RepositoryPage';
import { getStoredRepositoryUser, hasRepositoryToken } from '@/utils/repositoryAuthStorage';

export default function RepositoryWorkspaceAdd() {
  const { loading, canEditRepository, repositoryUser, refreshProfile } = useRepositoryAuth();
  const location = useLocation();
  const [restoringAccess, setRestoringAccess] = useState(false);
  const tokenPresent = hasRepositoryToken();
  const storedUser = getStoredRepositoryUser();
  const canEditByStoredSession = useMemo(
    () => Boolean(tokenPresent && storedUser && ['admin', 'editor', 'user'].includes(storedUser.role)),
    [storedUser, tokenPresent]
  );

  useEffect(() => {
    if (loading || repositoryUser || !tokenPresent) {
      return;
    }

    let isActive = true;
    setRestoringAccess(true);

    void refreshProfile().finally(() => {
      if (isActive) {
        setRestoringAccess(false);
      }
    });

    return () => {
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

  return <RepositoryPage workspaceMode='add' />;
}
