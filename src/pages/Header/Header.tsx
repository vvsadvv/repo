import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import './Header.scss';
import repositoryLogo from '@assets/logo/repository-logo-top.jpg';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';

/* Делает: Форматирует ФИО в вид фамилии с инициалами. Применение: используется локально в файле src/pages/Header/Header.tsx. */
function formatRepositoryUserDisplayName(fullName?: string | null, fallbackName = '') {
  const normalizedFullName = String(fullName || '').trim();
  if (!normalizedFullName) {
    return fallbackName;
  }

  const parts = normalizedFullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return normalizedFullName;
  }

  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatRepositoryUserDisplayName. */ (part) => part.match(/[А-ЯA-ZЁ]/i)?.[0]?.toUpperCase() || '')
    .filter(Boolean)
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри formatRepositoryUserDisplayName. */ (letter) => `${letter}.`)
    .join('');

  return initials ? `${surname} ${initials}` : surname;
}

/* Делает: Рендерит React-компонент Header и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    repositoryUser,
    isRepositoryAdmin,
    canEditRepository,
    logout: repositoryLogout,
  } = useRepositoryAuth();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const repositoryUserDisplayName = formatRepositoryUserDisplayName(
    repositoryUser?.full_name,
    repositoryUser?.name || ''
  );
  const repositoryUserLogin = repositoryUser?.name || '';

    /* Делает: Обрабатывает repository logout. Применение: используется внутри функции Header. */
  const handleRepositoryLogout = () => {
    repositoryLogout();
    navigate('/repository/latest');
  };

  return (
    <header className='repository-header'>
      <div className='repository-header__container'>
        <div className='repository-header__logo-container'>
          <a className='repository-header__home-link' href='/'>
            <img src={repositoryLogo} alt='Репозиторий геофизических данных ФИЦ ЕГС РАН' className='repository-header__logo' />
          </a>
        </div>

        <div className='repository-header__nav-container'>
          <nav className='repository-header__nav' aria-label='Навигация репозитория'>
            <NavLink to='/repository/search' className={/* Делает: Обрабатывает событие className в JSX-разметке. Применение: используется как inline-обработчик className внутри файла src/pages/Header/Header.tsx. */ ({ isActive }) => `repository-header__link${isActive ? ' repository-header__link--active' : ''}`}>
              Поиск
            </NavLink>
            <NavLink to='/repository/about' className={/* Делает: Обрабатывает событие className в JSX-разметке. Применение: используется как inline-обработчик className внутри файла src/pages/Header/Header.tsx. */ ({ isActive }) => `repository-header__link${isActive ? ' repository-header__link--active' : ''}`}>
              О репозитории
            </NavLink>
            {canEditRepository && (
              <NavLink to='/repository/add' className={/* Делает: Обрабатывает событие className в JSX-разметке. Применение: используется как inline-обработчик className внутри файла src/pages/Header/Header.tsx. */ ({ isActive }) => `repository-header__link${isActive ? ' repository-header__link--active' : ''}`}>
                Добавить
              </NavLink>
            )}
          </nav>

          <div className='repository-header__auth'>
            {repositoryUser ? (
              <div className='repository-header__user-menu'>
                <span
                  className='repository-header__user-info'
                  data-login={repositoryUserLogin}
                  tabIndex={0}
                >
                  {repositoryUserDisplayName} ({repositoryUser.role})
                </span>
                <Link to='/repository/cabinet' className='repository-header__admin-link'>
                  Кабинет
                </Link>
                {isRepositoryAdmin && (
                  <>
                    <Link to='/repository/admin' className='repository-header__admin-link'>
                      Админ-панель репозитория
                    </Link>
                  </>
                )}
                <button onClick={handleRepositoryLogout} className='repository-header__logout-btn'>
                  Выйти
                </button>
              </div>
            ) : (
              <Link to='/repository/login' state={{ from: returnTo }} className='repository-header__auth-link'>
                Вход
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
