import { Navigate, Route, Routes } from 'react-router-dom';
import Header from '@gsras-pages/Header/Header';
import Footer from '@gsras-pages/Footer/Footer';
import SiteHome from '@gsras-pages/SiteHome/SiteHome';
import SectionPage from '@gsras-pages/SectionPage/SectionPage';
import ContentPage from '@gsras-pages/ContentPage/ContentPage';
import NewsHome from '@gsras-pages/NewsHome/NewsHome';
import NewsArchive from '@gsras-pages/NewsArchive/NewsArchive';
import EarthquakePage from '@gsras-pages/EarthquakePage/EarthquakePage';
import { SITE_BASE_PATH } from '@gsras-utils/siteLanguage';

const SITE_EN_BASE_PATH = `${SITE_BASE_PATH}/en`;

/* Делает: Рендерит React-компонент App и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function App() {
  return (
    <div className='page__container'>
      <Header />
      <Routes>
        <Route path={SITE_BASE_PATH} element={<SiteHome locale='ru' />} />
        <Route path={`${SITE_BASE_PATH}/map`} element={<EarthquakePage locale='ru' />} />
        <Route path={`${SITE_BASE_PATH}/news`} element={<NewsHome locale='ru' />} />
        <Route path={`${SITE_BASE_PATH}/news/archive`} element={<NewsArchive locale='ru' />} />
        <Route path={`${SITE_BASE_PATH}/section/:sectionId`} element={<SectionPage locale='ru' />} />
        <Route path={`${SITE_BASE_PATH}/page/:pageId`} element={<ContentPage locale='ru' />} />
        <Route path={SITE_EN_BASE_PATH} element={<SiteHome locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/map`} element={<EarthquakePage locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/news`} element={<NewsHome locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/news/archive`} element={<NewsArchive locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/section/:sectionId`} element={<SectionPage locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/page/:pageId`} element={<ContentPage locale='en' />} />
        <Route path={`${SITE_EN_BASE_PATH}/*`} element={<Navigate to={SITE_EN_BASE_PATH} replace />} />
        <Route path='*' element={<Navigate to={SITE_BASE_PATH} replace />} />
      </Routes>
      <Footer />
    </div>
  );
}
