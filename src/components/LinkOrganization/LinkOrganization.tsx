import './LinkOrganization.scss';

interface LinkOrganizationProps {
  classNamePart: string;
}

interface NavigationLink {
  href: string;
  content: string;
}

/* Делает: Рендерит React-компонент LinkOrganization и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function LinkOrganization({ classNamePart }: LinkOrganizationProps) {
  const links: NavigationLink[] = [
    { href: '/gsras/news', content: 'Новости' },
    { href: '/gsras/section/ssd', content: 'ССД' },
    { href: '/gsras/section/wf', content: 'Сейсм.данные' },
    { href: '/gsras/section/gncc', content: 'ГНСС данные' },
    { href: '/gsras/section/soft', content: 'Продукты' },
    { href: '/gsras/section/links', content: 'Ссылки' },
    { href: '/gsras/section/struct', content: 'Структура' },
    { href: '/gsras/section/public', content: 'Публикации' },
    { href: '/gsras/section/conf', content: 'Конференции' },
    { href: '/gsras/section/announ', content: 'Объявления' },
    { href: '/gsras/section/about', content: 'О нас' },
  ];

  return (
    <div className={`${classNamePart}__links`}>
      {links.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри LinkOrganization. */ (link) => {
        const className = `${classNamePart}__link`.trim();

        return (
          <a key={link.href} className={className} href={link.href}>
            <span className={`${classNamePart}__link-label`}>{link.content}</span>
          </a>
        );
      })}
    </div>
  );
}

export default LinkOrganization;
