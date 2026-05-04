import { Navigate, Route, Routes } from 'react-router-dom';
import Header from '@pages/Header/Header';
import Footer from '@pages/Footer/Footer';
import RepositoryPage from '@pages/RepositoryPage/RepositoryPage';
import RepositoryLatestUploads from '@pages/RepositoryLatestUploads/RepositoryLatestUploads';
import RepositorySearch from '@pages/RepositorySearch/RepositorySearch';
import RepositoryAbout from '@pages/RepositoryAbout/RepositoryAbout';
import RepositoryInstruction from '@pages/RepositoryInstruction/RepositoryInstruction';
import RepositoryCabinet from '@pages/RepositoryCabinet/RepositoryCabinet';
import RepositoryWorkspaceAdd from '@pages/RepositoryWorkspaceAdd/RepositoryWorkspaceAdd';
import RepositoryWorkspaceEdit from '@pages/RepositoryWorkspaceEdit/RepositoryWorkspaceEdit';
import RepositoryLogin from '@pages/RepositoryAuthorization/RepositoryLogin';
import RepositoryRegistration from '@pages/RepositoryAuthorization/RepositoryRegistration';
import RepositoryForgotPassword from '@pages/RepositoryAuthorization/RepositoryForgotPassword';
import RepositoryResetPassword from '@pages/RepositoryAuthorization/RepositoryResetPassword';
import RepositoryAdminPanel from '@pages/RepositoryAdminPanel/RepositoryAdminPanel';
import '@pages/Authorization/Authorization.scss';

export default function App() {
  return (
    <div className='page__container'>
      <Header />
      <Routes>
        <Route path='/' element={<Navigate to='/repository/latest' replace />} />
        <Route path='/repository' element={<Navigate to='/repository/latest' replace />} />
        <Route path='/repository/latest' element={<RepositoryLatestUploads />} />
        <Route path='/repository/search' element={<RepositorySearch />} />
        <Route path='/repository/about' element={<RepositoryAbout />} />
        <Route path='/repository/instruction' element={<RepositoryInstruction />} />
        <Route path='/repository/cabinet' element={<RepositoryCabinet />} />
        <Route path='/repository/add' element={<RepositoryWorkspaceAdd />} />
        <Route path='/repository/edit' element={<RepositoryWorkspaceEdit />} />
        <Route path='/repository/workspace' element={<RepositoryPage />} />
        <Route path='/repository/login' element={<RepositoryLogin />} />
        <Route path='/repository/registration' element={<RepositoryRegistration />} />
        <Route path='/repository/forgot-password' element={<RepositoryForgotPassword />} />
        <Route path='/repository/reset-password' element={<RepositoryResetPassword />} />
        <Route path='/repository/admin' element={<RepositoryAdminPanel />} />
        <Route path='*' element={<Navigate to='/repository/latest' replace />} />
      </Routes>
      <Footer />
    </div>
  );
}
