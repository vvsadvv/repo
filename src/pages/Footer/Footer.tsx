import './Footer.scss';

const footerLinks = [
  { href: 'https://www.gsras.ru/new/news/', content: 'Новости' },
  { href: 'https://www.gsras.ru/new/ssd.htm', content: 'ССД' },
  { href: 'https://www.gsras.ru/new/wf/', content: 'Сейсм.данные' },
  { href: 'https://www.gsras.ru/new/gncc/', content: 'ГНСС данные' },
  { href: 'https://www.gsras.ru/new/soft/', content: 'Продукты' },
  { href: 'https://www.gsras.ru/new/links.htm', content: 'Ссылки' },
  { href: 'https://www.gsras.ru/new/struct/', content: 'Структура' },
  { href: 'https://www.gsras.ru/new/public/', content: 'Публикации' },
  { href: 'https://www.gsras.ru/new/conf/', content: 'Конференции' },
  { href: 'https://www.gsras.ru/new/announ/', content: 'Объявления' },
  { href: 'https://www.gsras.ru/new/about.htm', content: 'О нас' },
];

/* Делает: Рендерит React-компонент Footer и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className='repository-footer'>
      <div className='repository-footer__container'>
        <div className='repository-footer__headline'>
          <span className='repository-footer__title'>Федеральный исследовательский центр</span>
          <span className='repository-footer__subtitle'>Единая геофизическая служба Российской академии наук</span>
        </div>
        <div className='repository-footer__links'>
          {footerLinks.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри Footer. */ (link) => (
            <a key={link.href} className='repository-footer__link' href={link.href}>
              <span className='repository-footer__link-label'>{link.content}</span>
            </a>
          ))}
        </div>
        <p className='repository-footer__copyright'>© ФИЦ ЕГС РАН 1993-{currentYear}</p>
      </div>
    </footer>
  );
}

export default Footer;
