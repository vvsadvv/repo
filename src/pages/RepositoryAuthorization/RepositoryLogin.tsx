import Button from '@components/Button/Button';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import '@pages/Authorization/Login/Login.scss';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import {
  checkRateLimitStatus,
  recordFailedAttempt,
  resetRateLimit,
  getRemainingAttempts,
  formatTimeRemaining,
  MAX_ATTEMPTS_BEFORE_LOCK,
} from '@/utils/rateLimiter';

interface LoginFormData {
  login: string;
  password: string;
}

const RATE_LIMIT_KEY = 'repository_login';

/* Делает: Рендерит React-компонент RepositoryLogin и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryLogin() {
  const { register, handleSubmit, formState } = useForm<LoginFormData>();
  const { login } = useRepositoryAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [lockoutTime, setLockoutTime] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState(MAX_ATTEMPTS_BEFORE_LOCK);
  const isLocked = lockoutTime > 0;

  const updateLockoutStatus = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryLogin. */ () => {
    const timeRemaining = checkRateLimitStatus(RATE_LIMIT_KEY);
    setLockoutTime(timeRemaining);
    setRemainingAttempts(getRemainingAttempts(RATE_LIMIT_KEY));
  }, []);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryLogin. */ () => {
    updateLockoutStatus();
  }, [updateLockoutStatus]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryLogin. */ () => {
    if (lockoutTime <= 0) {
      return;
    }

    const timer = setInterval(/* Делает: Запускает периодическое действие по таймеру. Применение: передаётся как callback в setInterval внутри useEffectCallback. */ () => {
      setLockoutTime(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setLockoutTime внутри setIntervalCallback. */ (current) => {
        if (current <= 1) {
          clearInterval(timer);
          updateLockoutStatus();
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => clearInterval(timer);
  }, [lockoutTime, updateLockoutStatus]);

    /* Делает: Выполняет on submit. Применение: используется внутри функции RepositoryLogin. */
  const onSubmit = async (data: LoginFormData) => {
    if (isLocked) {
      setServerError(`Слишком много попыток. Подождите ${formatTimeRemaining(lockoutTime)}`);
      return;
    }

    setIsLoading(true);
    setServerError('');

    try {
      const result = await login(data);
      if (!result.success || !result.user) {
        const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
        updateLockoutStatus();

        if ((result.message || '').includes('не активирован')) {
          setPendingModalOpen(true);
          setServerError(result.message || 'Аккаунт репозитория ещё не активирован');
          return;
        }

        if (lockTime > 0) {
          setServerError(
            `Превышен лимит попыток. Доступ заблокирован на ${formatTimeRemaining(lockTime)}`
          );
          return;
        }

        const message = result.message || 'Ошибка входа в репозиторий';
        setServerError(message);
        return;
      }

      resetRateLimit(RATE_LIMIT_KEY);
      navigate('/repository/cabinet', { replace: true });
    } catch (error: any) {
      const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
      updateLockoutStatus();

      if (lockTime > 0) {
        setServerError(
          `Превышен лимит попыток. Доступ заблокирован на ${formatTimeRemaining(lockTime)}`
        );
      } else {
        const message = error?.message || 'Ошибка входа в репозиторий';
        setServerError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className='login'>
      <div className='login__container'>
        <h2 className='login__title'>Вход в репозиторий</h2>
        {isLocked && (
          <div className='login__lockout-warning'>
            <span className='login__lockout-icon'>⏳</span>
            Слишком много неудачных попыток входа.
            <br />
            Повторите через: <strong>{formatTimeRemaining(lockoutTime)}</strong>
          </div>
        )}

        {serverError && !isLocked && <div className='login__server-error'>{serverError}</div>}

        {!isLocked && remainingAttempts < MAX_ATTEMPTS_BEFORE_LOCK && remainingAttempts > 0 && (
          <div className='login__attempts-warning'>
            Осталось попыток: {remainingAttempts} из {MAX_ATTEMPTS_BEFORE_LOCK}
          </div>
        )}

        <form id='repository-login-form' className='login__form' onSubmit={handleSubmit(onSubmit)}>
          <input
            {...register('login', { required: 'Логин обязателен' })}
            type='text'
            className='login__form-input'
            placeholder='Логин или email'
            disabled={isLoading || isLocked}
          />
          {formState.errors.login && <p className='login__form-error'>{formState.errors.login.message}</p>}
          <p className='login__form-hint'>Логин или email вводятся на английском языке.</p>

          <input
            {...register('password', {
              required: 'Пароль обязателен',
              minLength: { value: 8, message: 'Минимум 8 символов' },
            })}
            type='password'
            className='login__form-input'
            placeholder='Пароль'
            disabled={isLoading || isLocked}
          />
          {formState.errors.password && <p className='login__form-error'>{formState.errors.password.message}</p>}
          <p className='login__form-hint'>Пароль вводится в английской раскладке.</p>
        </form>

        <Button
          form='repository-login-form'
          type='submit'
          aim='login'
          content={isLoading ? 'Вход...' : isLocked ? 'Заблокировано' : 'Войти'}
          disabled={isLoading || isLocked}
        />

        <div className='login__links'>
          <p>
            Нет аккаунта? <Link to='/repository/registration' className='login__link'>Зарегистрироваться</Link>
          </p>
          <p>
            <Link to='/repository/forgot-password' className='login__link login__link--forgot'>Забыли пароль?</Link>
          </p>
        </div>
      </div>
      <ConfirmModal
        isOpen={pendingModalOpen}
        title='Ожидается подтверждение'
        message='Аккаунт репозитория ожидает активации администратором.'
        variant='info'
        confirmText='Понятно'
        showCancel={false}
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAuthorization/RepositoryLogin.tsx. */ () => setPendingModalOpen(false)}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAuthorization/RepositoryLogin.tsx. */ () => setPendingModalOpen(false)}
      />
    </section>
  );
}
