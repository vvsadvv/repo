import './Footer.scss';
import LinkOrganization from '@gsras-components/LinkOrganization/LinkOrganization';
import { getLocaleFromPathname } from '@gsras-utils/siteLanguage';
import { useLocation } from 'react-router-dom';

/* Делает: Рендерит React-компонент Footer и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function Footer() {
  const { pathname } = useLocation();
  const locale = getLocaleFromPathname(pathname);
  const currentYear = new Date().getFullYear();
  const copy = locale === 'en'
    ? {
        title: 'Federal Research Center',
        subtitle: 'Geophysical Survey of the Russian Academy of Sciences',
        copyright: `© GS RAS 1993-${currentYear}`,
      }
    : {
        title: 'Федеральный исследовательский центр',
        subtitle: 'Единая геофизическая служба Российской академии наук',
        copyright: `© ФИЦ ЕГС РАН 1993-${currentYear}`,
      };

  return (
    <footer className='footer'>
      <div className='footer__container'>
        <div className='footer__headline'>
          <span className='footer__title'>{copy.title}</span>
          <span className='footer__subtitle'>{copy.subtitle}</span>
        </div>
        <LinkOrganization classNamePart='footer' locale={locale} />
        <p className='footer__copyright'>{copy.copyright}</p>
      </div>
    </footer>
  );
}

