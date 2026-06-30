import { Suspense, lazy } from 'react';

const RepositoryShell = lazy(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в lazy. */ () => import('@/repository/RepositoryShell'));

/* Делает: Рендерит React-компонент AppFallback и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function AppFallback() {
  return <div className='page__container' />;
}

/* Делает: Рендерит React-компонент App и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function App() {
  return (
    <Suspense fallback={<AppFallback />}>
      <RepositoryShell />
    </Suspense>
  );
}
