import Button from '@components/Button/Button';
import '@pages/Authorization/Login/Login.scss';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';

const validatePasswordStrength = (password: string) => {
  if (!password) return 'Пароль обязателен';
  if (password.length < 8) return 'Минимум 8 символов';
  if (!/[A-Z]/.test(password)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-z]/.test(password)) return 'Нужна хотя бы одна строчная буква';
  if (!/\d/.test(password)) return 'Нужна хотя бы одна цифра';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) return 'Нужен хотя бы один спецсимвол';
  return '';
};

export default function RepositoryResetPassword() {
  const { verifyResetToken, resetPassword } = useRepositoryAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const checkToken = async () => {
      if (!token) {
        setError('Ссылка для сброса пароля недействительна');
        setIsLoading(false);
        return;
      }

      const result = await verifyResetToken(token);
      if (!result.success) {
        setError(result.message || 'Ссылка недействительна');
        setIsLoading(false);
        return;
      }

      setEmail(result.email || '');
      setIsLoading(false);
    };

    void checkToken();
  }, [token, verifyResetToken]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setError('');
    setSubmitting(true);
    const result = await resetPassword(token, password);
    setSubmitting(false);

    if (!result.success) {
      setError(result.message || 'Ошибка смены пароля');
      return;
    }

    setSuccessMessage(result.message || 'Пароль изменен');
    setTimeout(() => navigate('/repository/login', { replace: true }), 1400);
  };

  if (isLoading) {
    return <section className='login'><div className='login__container'><h2 className='login__title'>Проверка ссылки</h2></div></section>;
  }

  if (error && !email && !successMessage) {
    return (
      <section className='login'>
        <div className='login__container'>
          <h2 className='login__title'>Ошибка</h2>
          <div className='login__server-error'>{error}</div>
          <div className='login__links'>
            <p><Link to='/repository/login' className='login__link'>Вернуться ко входу</Link></p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className='login'>
      <div className='login__container'>
        <h2 className='login__title'>Новый пароль репозитория</h2>
        {email && <p className='login__form-hint'>Аккаунт: {email}</p>}
        {error && <div className='login__server-error'>{error}</div>}
        {successMessage && <div className='login__success'>{successMessage}</div>}
        {!successMessage && (
          <>
            <form id='repository-reset-form' className='login__form' onSubmit={handleSubmit}>
              <input type='password' className='login__form-input' placeholder='Новый пароль' value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} required />
              <input type='password' className='login__form-input' placeholder='Повторите пароль' value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} required />
            </form>
            <Button form='repository-reset-form' type='submit' aim='login' content={submitting ? 'Сохранение...' : 'Сохранить пароль'} disabled={submitting} />
          </>
        )}
      </div>
    </section>
  );
}
