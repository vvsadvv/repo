import Button from '@components/Button/Button';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import '@pages/Authorization/Login/Login.scss';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

export default function RepositoryLogin() {
  const { register, handleSubmit, formState } = useForm<LoginFormData>();
  const { login } = useRepositoryAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [lockoutTime, setLockoutTime] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState(MAX_ATTEMPTS_BEFORE_LOCK);
  const from = (location.state as { from?: string })?.from || '/repository';
  const isLocked = lockoutTime > 0;

  const updateLockoutStatus = useCallback(() => {
    const timeRemaining = checkRateLimitStatus(RATE_LIMIT_KEY);
    setLockoutTime(timeRemaining);
    setRemainingAttempts(getRemainingAttempts(RATE_LIMIT_KEY));
  }, []);

  useEffect(() => {
    updateLockoutStatus();
  }, [updateLockoutStatus]);

  useEffect(() => {
    if (lockoutTime <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setLockoutTime((current) => {
        if (current <= 1) {
          clearInterval(timer);
          updateLockoutStatus();
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutTime, updateLockoutStatus]);

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

        const attemptsLeft = getRemainingAttempts(RATE_LIMIT_KEY);
        const message = result.message || 'Ошибка входа в репозиторий';
        setServerError(attemptsLeft > 0 ? `${message}. Осталось попыток: ${attemptsLeft}` : message);
        return;
      }

      resetRateLimit(RATE_LIMIT_KEY);

      if (result.user.role === 'admin') {
        navigate('/repository/admin', { replace: true });
        return;
      }

      navigate(from, { replace: true });
    } catch (error: any) {
      const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
      updateLockoutStatus();

      if (lockTime > 0) {
        setServerError(
          `Превышен лимит попыток. Доступ заблокирован на ${formatTimeRemaining(lockTime)}`
        );
      } else {
        const attemptsLeft = getRemainingAttempts(RATE_LIMIT_KEY);
        const message = error?.message || 'Ошибка входа в репозиторий';
        setServerError(attemptsLeft > 0 ? `${message}. Осталось попыток: ${attemptsLeft}` : message);
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
        onConfirm={() => setPendingModalOpen(false)}
        onCancel={() => setPendingModalOpen(false)}
      />
    </section>
  );
}
