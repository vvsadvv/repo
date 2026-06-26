import { Link, NavLink } from 'react-router-dom';
import { getHomeRoute, getMainNavigation, isEnglishLocale } from '@gsras-utils/siteLanguage';
import './Header.scss';
import logo320 from '@gsras-assets/logo/header-logo-320.svg';
import logo575 from '@gsras-assets/logo/header-logo-575.svg';
import logo767 from '@gsras-assets/logo/header-logo-767.svg';
import logo992 from '@gsras-assets/logo/header-logo-992.svg';
import logo1600 from '@gsras-assets/logo/header-logo-1600.svg';

const copy = {
  ru: {
    eyebrow: 'Официальный сайт',
    title: 'Федеральный исследовательский центр «Единая геофизическая служба РАН»',
    cta: 'Сообщить об ощущаемом землетрясении',
    navLabel: 'Навигация сайта',
    logoAlt: 'ФИЦ ЕГС РАН',
  },
  en: {
    eyebrow: 'Official website',
    title: 'Federal Research Center Geophysical Survey of the Russian Academy of Sciences',
    cta: 'Report a felt earthquake',
    navLabel: 'Site navigation',
    logoAlt: 'GS RAS',
  },
};

/* Делает: Рендерит React-компонент Header и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function Header({ locale = 'ru' }) {
  const currentCopy = copy[locale] ?? copy.ru;
  const navigation = getMainNavigation(locale);
  const english = isEnglishLocale(locale);
  const russianHomeRoute = getHomeRoute('ru');
  const englishHomeRoute = getHomeRoute('en');

  return (
    <header className='header'>
      <div className='header__container'>
        <div className='header__logo-container'>
          <Link className='header__home-link' to={getHomeRoute(locale)}>
            <picture className='header__picture'>
              <source srcSet={logo320} media='(max-width: 320px)' />
              <source srcSet={logo575} media='(max-width: 575px)' />
              <source srcSet={logo767} media='(max-width: 767px)' />
              <source srcSet={logo992} media='(max-width: 992px)' />
              <img src={logo1600} alt={currentCopy.logoAlt} className='header__logo' />
            </picture>
          </Link>

          <div className='header__brand-row'>
            <div className='header__brand-copy'>
              <span className='header__eyebrow'>{currentCopy.eyebrow}</span>
              <span className='header__title'>{currentCopy.title}</span>
            </div>

            <div className='header__actions'>
              <Link className={`header__lang${english ? '' : ' header__lang--active'}`} to={russianHomeRoute}>
                RUS
              </Link>
              <Link className={`header__lang${english ? ' header__lang--active' : ''}`} to={englishHomeRoute}>
                ENG
              </Link>
              <a className='header__cta' href='http://mseism.gsras.ru/DyfitWeb' target='_blank' rel='noreferrer'>
                {currentCopy.cta}
              </a>
            </div>
          </div>
        </div>

        <div className='header__nav-container'>
          <nav className='header__nav' aria-label={currentCopy.navLabel}>
            {navigation.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри Header. */ (item) =>
              item.externalUrl ? (
                <a key={item.label} href={item.externalUrl} className='header__link'>
                  {item.label}
                </a>
              ) : item.routePath ? (
                <NavLink
                  key={item.label}
                  to={item.routePath}
                  className={/* Делает: Обрабатывает событие className в JSX-разметке. Применение: используется как inline-обработчик className внутри файла src/gsras/pages/Header/Header.jsx. */ ({ isActive }) => `header__link${isActive ? ' header__link--active' : ''}`}
                  end={item.routePath === russianHomeRoute || item.routePath === englishHomeRoute}
                >
                  {item.label}
                </NavLink>
              ) : (
                <a key={item.label} href={item.externalUrl ?? '#'} className='header__link'>
                  {item.label}
                </a>
              )
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
