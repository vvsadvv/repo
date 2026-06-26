import { Suspense, lazy } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const RepositoryShell = lazy(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в lazy. */ () => import('@/repository/RepositoryShell'));
const GsrasSiteEntry = lazy(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в lazy. */ () => import('@gsras/GsrasSiteEntry'));

const LEGACY_GSRAS_PATH_PATTERNS = [
  /^\/site(?:\/|$)/,
  /^\/news(?:\/|$)/,
  /^\/map(?:\/|$)/,
  /^\/section(?:\/|$)/,
  /^\/page(?:\/|$)/,
  /^\/en(?:\/|$)/,
];

/* Делает: Рендерит React-компонент AppFallback и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function AppFallback() {
  return <div className='page__container' />;
}

/* Делает: Получает legacy gsras redirect. Применение: используется локально в файле src/App.tsx. */
function getLegacyGsrasRedirect(pathname: string, search = '', hash = '') {
  if (pathname === '/') {
    return null;
  }

  if (!LEGACY_GSRAS_PATH_PATTERNS.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри getLegacyGsrasRedirect. */ (pattern) => pattern.test(pathname))) {
    return null;
  }

  if (pathname === '/site') {
    return `/gsras${search}${hash}`;
  }

  if (pathname.startsWith('/site/')) {
    return `/gsras${pathname.slice('/site'.length)}${search}${hash}`;
  }

  return `/gsras${pathname}${search}${hash}`;
}

/* Делает: Рендерит React-компонент App и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function App() {
  const { pathname, search, hash } = useLocation();
  const isGsrasRoute = pathname === '/gsras' || pathname.startsWith('/gsras/');
  const legacyGsrasRedirect = getLegacyGsrasRedirect(pathname, search, hash);

  return (
    <Suspense fallback={<AppFallback />}>
      {legacyGsrasRedirect ? <Navigate to={legacyGsrasRedirect} replace /> : isGsrasRoute ? <GsrasSiteEntry /> : <RepositoryShell />}
    </Suspense>
  );
}
