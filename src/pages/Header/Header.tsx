import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import './Header.scss';
import logo320 from '@assets/logo/header-logo-320.svg';
import logo575 from '@assets/logo/header-logo-575.svg';
import logo767 from '@assets/logo/header-logo-767.svg';
import logo992 from '@assets/logo/header-logo-992.svg';
import logo1600 from '@assets/logo/header-logo-1600.svg';
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
            <picture className='repository-header__picture'>
              <source srcSet={logo320} media='(max-width: 320px)' />
              <source srcSet={logo575} media='(max-width: 575px)' />
              <source srcSet={logo767} media='(max-width: 767px)' />
              <source srcSet={logo992} media='(max-width: 992px)' />
              <img src={logo1600} alt='ФИЦ ЕГС РАН' className='repository-header__logo' />
            </picture>
          </a>
          <Link to='/repository/latest' className='repository-header__repository-label'>
            <span className='repository-header__repository-label-icon' aria-hidden='true'>
              <svg width='20' height='20' viewBox='0 0 24 24' focusable='false'>
                <path
                  fill='currentColor'
                  d='M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3V6zm0 4h18l-1.2 7A2 2 0 0 1 17.83 19H6.17a2 2 0 0 1-1.97-1.66L3 10z'
                />
              </svg>
            </span>
            <span>Репозиторий геофизических данных</span>
          </Link>
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
                    <Link to='/repository/admin/gsras' className='repository-header__admin-link'>
                      GS RAS контент
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
