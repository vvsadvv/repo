import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import './Header.scss';
import logo320 from '@assets/logo/header-logo-320.svg';
import logo575 from '@assets/logo/header-logo-575.svg';
import logo767 from '@assets/logo/header-logo-767.svg';
import logo992 from '@assets/logo/header-logo-992.svg';
import logo1600 from '@assets/logo/header-logo-1600.svg';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';

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

  const handleRepositoryLogout = () => {
    repositoryLogout();
    navigate('/repository/latest');
  };

  return (
    <header className='header'>
      <div className='header__container'>
        <div className='header__logo-container'>
          <a className='header__home-link' href='http://www.gsras.ru/new/ssd_news.htm'>
            <picture className='header__picture'>
              <source srcSet={logo320} media='(max-width: 320px)' />
              <source srcSet={logo575} media='(max-width: 575px)' />
              <source srcSet={logo767} media='(max-width: 767px)' />
              <source srcSet={logo992} media='(max-width: 992px)' />
              <img src={logo1600} alt='ФИЦ ЕГС РАН' className='header__logo' />
            </picture>
          </a>
          <Link to='/repository/latest' className='header__repository-label'>
            <span className='header__repository-label-icon' aria-hidden='true'>
              <svg viewBox='0 0 24 24' focusable='false'>
                <path d='M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3V6zm0 4h18l-1.2 7A2 2 0 0 1 17.83 19H6.17a2 2 0 0 1-1.97-1.66L3 10z' />
              </svg>
            </span>
            <span>Репозиторий геофизических данных</span>
          </Link>
        </div>

        <div className='header__nav-container'>
          <nav className='header__nav' aria-label='Навигация репозитория'>
            <NavLink to='/repository/search' className={({ isActive }) => `header__link${isActive ? ' header__link--active' : ''}`}>
              Поиск
            </NavLink>
            <NavLink to='/repository/about' className={({ isActive }) => `header__link${isActive ? ' header__link--active' : ''}`}>
              О репозитории
            </NavLink>
            {canEditRepository && (
              <NavLink to='/repository/add' className={({ isActive }) => `header__link${isActive ? ' header__link--active' : ''}`}>
                Добавить
              </NavLink>
            )}
            {canEditRepository && (
              <NavLink to='/repository/edit' className={({ isActive }) => `header__link${isActive ? ' header__link--active' : ''}`}>
                Редактирование
              </NavLink>
            )}
          </nav>

          <div className='header__auth'>
            {repositoryUser ? (
              <div className='header__user-menu'>
                <span className='header__user-info'>
                  {repositoryUser.name} ({repositoryUser.role})
                </span>
                <Link to='/repository/cabinet' className='header__admin-link'>
                  Кабинет
                </Link>
                {isRepositoryAdmin && (
                  <Link to='/repository/admin' className='header__admin-link'>
                    Админ-панель репозитория
                  </Link>
                )}
                <button onClick={handleRepositoryLogout} className='header__logout-btn'>
                  Выйти
                </button>
              </div>
            ) : (
              <Link to='/repository/login' state={{ from: returnTo }} className='header__auth-link'>
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
