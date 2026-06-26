import './Footer.scss';
import LinkOrganization from '@/components/LinkOrganization/LinkOrganization';

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
        <LinkOrganization classNamePart='repository-footer' />
        <p className='repository-footer__copyright'>© ФИЦ ЕГС РАН 1993-{currentYear}</p>
      </div>
    </footer>
  );
}

export default Footer;
