import './Footer.scss';
import LinkOrganization from '@/components/LinkOrganization/LinkOrganization';

function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className='footer'>
      <div className='footer__container'>
        <div className='footer__headline'>
          <span className='footer__title'>Федеральный исследовательский центр</span>
          <span className='footer__subtitle'>Единая геофизическая служба Российской академии наук</span>
        </div>
        <LinkOrganization classNamePart='footer' />
        <p className='footer__copyright'>© ФИЦ ЕГС РАН 1993-{currentYear}</p>
      </div>
    </footer>
  );
}

export default Footer;
