import Button from '@components/Button/Button';
import '@pages/Authorization/Login/Login.scss';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';

/* Делает: Рендерит React-компонент RepositoryForgotPassword и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryForgotPassword() {
  const { forgotPassword } = useRepositoryAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

    /* Делает: Обрабатывает submit. Применение: используется внутри функции RepositoryForgotPassword. */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await forgotPassword(email.trim());
      if (!result.success) {
        setError(result.message || 'Ошибка восстановления пароля');
        return;
      }

      setSuccess(result.message || 'Инструкции отправлены на email');
      setEmail('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className='login'>
      <div className='login__container'>
        <h2 className='login__title'>Восстановление пароля репозитория</h2>
        {error && <div className='login__server-error'>{error}</div>}
        {success && <div className='login__success'>{success}</div>}

        <form id='repository-forgot-password-form' className='login__form' onSubmit={handleSubmit}>
          <input
            type='email'
            className='login__form-input'
            placeholder='Введите email'
            value={email}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAuthorization/RepositoryForgotPassword.tsx. */ (event) => setEmail(event.target.value)}
            disabled={isLoading}
            required
          />
        </form>

        <Button
          type='submit'
          form='repository-forgot-password-form'
          aim='login'
          content={isLoading ? 'Отправка...' : 'Восстановить пароль'}
          disabled={isLoading || !email.trim()}
        />

        <div className='login__links'>
          <p>
            Вспомнили пароль? <Link to='/repository/login' className='login__link'>Войти</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
