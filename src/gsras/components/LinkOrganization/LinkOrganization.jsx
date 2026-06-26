import { Link } from 'react-router-dom';
import './LinkOrganization.scss';
import { getOrganizationLinks } from '@gsras-utils/siteLanguage';

/* Делает: Рендерит React-компонент LinkOrganization и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function LinkOrganization({ classNamePart, locale = 'ru' }) {
  const links = getOrganizationLinks(locale);

  return (
    <div className={`${classNamePart}__links`}>
      {links.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри LinkOrganization. */ (link) => {
        const className = `${classNamePart}__link`.trim();
        const key = `${link.content}-${link.routePath ?? link.externalUrl ?? ''}`;

        if (link.externalUrl) {
          return (
            <a key={key} className={className} href={link.externalUrl}>
              <span className={`${classNamePart}__link-label`}>{link.content}</span>
            </a>
          );
        }

        return (
          <Link key={key} className={className} to={link.routePath}>
            <span className={`${classNamePart}__link-label`}>{link.content}</span>
          </Link>
        );
      })}
    </div>
  );
}

