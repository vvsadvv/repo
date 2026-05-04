import Button from '@components/Button/Button';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import '@pages/Authorization/Registration/Registration.scss';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import { repositoryReferenceService } from '@/services/repositoryReferenceService';
import type { RepositoryOrganizationReference } from '@/types/repositoryReference';
import {
  checkRateLimitStatus,
  recordFailedAttempt,
  resetRateLimit,
  getRemainingAttempts,
  formatTimeRemaining,
  MAX_ATTEMPTS_BEFORE_LOCK,
} from '@/utils/rateLimiter';

interface RegistrationFormData {
  name: string;
  fullName: string;
  email: string;
  organizationId: string;
  position: string;
  password: string;
  confirmPassword: string;
}

const DEFAULT_ORGANIZATION = 'ФИЦ ЕГС РАН';
const RATE_LIMIT_KEY = 'repository_registration';

const validatePasswordStrength = (password: string) => {
  if (!password) return 'Пароль обязателен';
  if (password.length < 8) return 'Минимум 8 символов';
  if (!/[A-Z]/.test(password)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-z]/.test(password)) return 'Нужна хотя бы одна строчная буква';
  if (!/\d/.test(password)) return 'Нужна хотя бы одна цифра';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]/.test(password)) return 'Нужен хотя бы один спецсимвол';
  return true;
};

export default function RepositoryRegistration() {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    getValues,
    setValue,
  } = useForm<RegistrationFormData>({
    mode: 'onChange',
    defaultValues: {
      name: '',
      fullName: '',
      email: '',
      organizationId: '',
      position: '',
      password: '',
      confirmPassword: '',
    },
  });
  const { register: registerRepositoryUser } = useRepositoryAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [successOpen, setSuccessOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lockoutTime, setLockoutTime] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState(MAX_ATTEMPTS_BEFORE_LOCK);
  const [organizations, setOrganizations] = useState<RepositoryOrganizationReference[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);
  const [organizationRequestOpen, setOrganizationRequestOpen] = useState(false);
  const [organizationRequestNameRu, setOrganizationRequestNameRu] = useState('');
  const [organizationRequestNameEn, setOrganizationRequestNameEn] = useState('');
  const [requestedOrganizationName, setRequestedOrganizationName] = useState('');
  const [organizationInfo, setOrganizationInfo] = useState('');
  const password = watch('password') || '';
  const confirmPassword = watch('confirmPassword') || '';
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
    let isActive = true;

    void (async () => {
      setOrganizationsLoading(true);
      try {
        const data = await repositoryReferenceService.getOrganizations();
        if (!isActive) {
          return;
        }

        setOrganizations(data);
        const defaultOrganization = data.find((organization) => organization.name_ru === DEFAULT_ORGANIZATION);
        if (defaultOrganization) {
          setValue('organizationId', String(defaultOrganization.id));
        }
      } catch (error: any) {
        if (isActive) {
          setServerError(error?.message || 'Не удалось загрузить список организаций');
        }
      } finally {
        if (isActive) {
          setOrganizationsLoading(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [setValue]);

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

  const onSubmit = async (data: RegistrationFormData) => {
    if (isLocked) {
      setServerError(`Слишком много попыток. Подождите ${formatTimeRemaining(lockoutTime)}`);
      return;
    }

    setIsLoading(true);
    setServerError('');
    setOrganizationInfo('');

    try {
      const selectedOrganization = organizations.find(
        (organization) => String(organization.id) === String(data.organizationId || '')
      );
      const organizationName = selectedOrganization?.name_ru || requestedOrganizationName.trim();

      if (!organizationName) {
        setServerError('Выберите организацию из списка или отправьте заявку на новую организацию');
        return;
      }

      const result = await registerRepositoryUser({
        name: data.name.trim(),
        fullName: data.fullName.trim(),
        email: data.email.trim(),
        organization: organizationName,
        organizationId: selectedOrganization?.id ?? null,
        position: data.position.trim(),
        password: data.password,
        confirmPassword: data.confirmPassword,
      });

      if (!result.success) {
        const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
        updateLockoutStatus();

        if (lockTime > 0) {
          setServerError(
            `Превышен лимит попыток. Регистрация заблокирована на ${formatTimeRemaining(lockTime)}`
          );
          return;
        }

        const attemptsLeft = getRemainingAttempts(RATE_LIMIT_KEY);
        const message = result.message || 'Ошибка регистрации в репозитории';
        setServerError(attemptsLeft > 0 ? `${message}. Осталось попыток: ${attemptsLeft}` : message);
        return;
      }

      resetRateLimit(RATE_LIMIT_KEY);
      setSuccessOpen(true);
    } catch (error: any) {
      const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
      updateLockoutStatus();

      if (lockTime > 0) {
        setServerError(
          `Превышен лимит попыток. Регистрация заблокирована на ${formatTimeRemaining(lockTime)}`
        );
      } else {
        const attemptsLeft = getRemainingAttempts(RATE_LIMIT_KEY);
        const message = error?.message || 'Ошибка регистрации в репозитории';
        setServerError(attemptsLeft > 0 ? `${message}. Осталось попыток: ${attemptsLeft}` : message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const requestOrganization = async () => {
    const nameRu = organizationRequestNameRu.trim();
    const nameEn = organizationRequestNameEn.trim();

    if (nameRu.length < 2) {
      setServerError('Укажите название организации на русском языке');
      return;
    }

    try {
      const result = await repositoryReferenceService.requestOrganization({
        nameRu,
        nameEn,
        requesterName: getValues('fullName'),
        requesterEmail: getValues('email'),
      });

      setOrganizationRequestOpen(false);
      setOrganizationRequestNameRu('');
      setOrganizationRequestNameEn('');
      setRequestedOrganizationName(result.organization?.name_ru || nameRu);
      setOrganizationInfo(`${result.message}. Для регистрации будет использовано значение: ${result.organization?.name_ru || nameRu}`);
      setServerError('');

      if (result.organization?.status === 'approved') {
        const refreshed = await repositoryReferenceService.getOrganizations();
        setOrganizations(refreshed);
        const approvedOrganization = refreshed.find((organization) => organization.id === result.organization.id);
        if (approvedOrganization) {
          setValue('organizationId', String(approvedOrganization.id));
          setRequestedOrganizationName('');
        }
      } else {
        setValue('organizationId', '');
      }
    } catch (error: any) {
      setServerError(error?.message || 'Не удалось отправить заявку на организацию');
    }
  };

  return (
    <section className='reg'>
      <div className='reg__container'>
        <h2 className='reg__title'>Регистрация в репозитории</h2>
        {isLocked && (
          <div className='reg__lockout-warning'>
            <span className='reg__lockout-icon'>⏳</span>
            Слишком много неудачных попыток регистрации.
            <br />
            Повторите через: <strong>{formatTimeRemaining(lockoutTime)}</strong>
          </div>
        )}

        {serverError && !isLocked && <div className='reg__server-error'>{serverError}</div>}

        {!isLocked && remainingAttempts < MAX_ATTEMPTS_BEFORE_LOCK && remainingAttempts > 0 && (
          <div className='reg__attempts-warning'>
            Осталось попыток: {remainingAttempts} из {MAX_ATTEMPTS_BEFORE_LOCK}
          </div>
        )}

        <form id='repository-registration-form' className='reg__form' onSubmit={handleSubmit(onSubmit)}>
          <input
            {...register('name', {
              required: 'Имя пользователя обязательно',
              minLength: { value: 2, message: 'Минимум 2 символа' },
              pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Только буквы, цифры и подчеркивание' },
            })}
            type='text'
            className='reg__form-input'
            placeholder='Имя пользователя'
            disabled={isLoading || isLocked}
          />
          {errors.name && <p className='reg__form-error'>{errors.name.message}</p>}

          <input
            {...register('fullName', {
              required: 'ФИО обязательно',
              pattern: {
                value: /^[А-ЯЁа-яё\s-]+$/,
                message: 'Только русские буквы, пробелы и дефис',
              },
              validate: (value) => {
                const parts = value.trim().split(/\s+/);
                if (parts.length < 3) return 'Введите Фамилию, Имя и Отчество';
                return true;
              },
            })}
            type='text'
            className='reg__form-input'
            placeholder='Фамилия Имя Отчество'
            disabled={isLoading || isLocked}
          />
          {errors.fullName && <p className='reg__form-error'>{errors.fullName.message}</p>}

          <input
            {...register('email', {
              required: 'Почта обязательна',
              pattern: { value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, message: 'Некорректный email' },
            })}
            type='email'
            className='reg__form-input'
            placeholder='Почта'
            disabled={isLoading || isLocked}
          />
          {errors.email && <p className='reg__form-error'>{errors.email.message}</p>}

          <div className='reg__organization'>
            <select
              {...register('organizationId')}
              className='reg__form-input'
              disabled={isLoading || isLocked || organizationsLoading}
            >
              <option value=''>Выберите организацию</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name_ru}
                </option>
              ))}
            </select>
            <button
              type='button'
              className='reg__organization-request-btn'
              onClick={() => setOrganizationRequestOpen(true)}
              disabled={isLoading || isLocked}
            >
              Добавить организацию
            </button>
          </div>
          {organizationInfo && <p className='reg__attempts-warning'>{organizationInfo}</p>}
          {requestedOrganizationName && !watch('organizationId') && (
            <p className='reg__attempts-warning'>Для регистрации будет использована организация: {requestedOrganizationName}</p>
          )}

          <input
            {...register('position', {
              required: 'Должность обязательна',
              minLength: { value: 2, message: 'Минимум 2 символа' },
            })}
            type='text'
            className='reg__form-input'
            placeholder='Должность'
            disabled={isLoading || isLocked}
          />
          {errors.position && <p className='reg__form-error'>{errors.position.message}</p>}

          <input
            {...register('password', {
              required: 'Пароль обязателен',
              validate: validatePasswordStrength,
            })}
            type='password'
            className='reg__form-input'
            placeholder='Пароль'
            disabled={isLoading || isLocked}
          />
          {errors.password && <p className='reg__form-error'>{errors.password.message}</p>}

          <div className='reg__password-requirements'>
            <p>Пароль должен содержать:</p>
            <ul>
              <li className={password.length >= 8 ? 'valid' : ''}>Минимум 8 символов</li>
              <li className={/[A-Z]/.test(password) ? 'valid' : ''}>Заглавную букву</li>
              <li className={/[a-z]/.test(password) ? 'valid' : ''}>Строчную букву</li>
              <li className={/\d/.test(password) ? 'valid' : ''}>Цифру</li>
              <li className={/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]/.test(password) ? 'valid' : ''}>Спецсимвол</li>
            </ul>
          </div>

          <input
            {...register('confirmPassword', {
              required: 'Подтверждение пароля обязательно',
              validate: (value) => value === getValues('password') || 'Пароли не совпадают',
            })}
            type='password'
            className='reg__form-input'
            placeholder='Подтверждение пароля'
            disabled={isLoading || isLocked}
          />
          {errors.confirmPassword && <p className='reg__form-error'>{errors.confirmPassword.message}</p>}

          {password && confirmPassword && (
            <div className={password === confirmPassword ? 'reg__password-match' : 'reg__password-mismatch'}>
              {password === confirmPassword ? 'Пароли совпадают' : 'Пароли не совпадают'}
            </div>
          )}
        </form>

        <Button
          form='repository-registration-form'
          type='submit'
          aim='reg'
          content={isLoading ? 'Регистрация...' : isLocked ? 'Заблокировано' : 'Зарегистрироваться'}
          disabled={isLoading || isLocked}
        />

        <div className='reg__links'>
          <p>
            Уже есть аккаунт? <Link to='/repository/login' className='reg__link'>Войти</Link>
          </p>
        </div>
      </div>
      <ConfirmModal
        isOpen={successOpen}
        title='Заявка отправлена'
        message='Регистрация в репозитории завершена. Теперь вы можете войти в систему.'
        variant='success'
        confirmText='Понятно'
        showCancel={false}
        onConfirm={() => navigate('/repository/login', { replace: true })}
        onCancel={() => navigate('/repository/login', { replace: true })}
      />
      <ConfirmModal
        isOpen={organizationRequestOpen}
        title='Новая организация'
        message='Укажите организацию, которую нужно добавить в справочник.'
        variant='info'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={() => {
          void requestOrganization();
        }}
        onCancel={() => setOrganizationRequestOpen(false)}
      >
        <div className='reg__organization-request-fields'>
          <input
            type='text'
            className='reg__form-input'
            placeholder='Организация (RU)'
            value={organizationRequestNameRu}
            onChange={(event) => setOrganizationRequestNameRu(event.target.value)}
          />
          <input
            type='text'
            className='reg__form-input'
            placeholder='Organization (EN)'
            value={organizationRequestNameEn}
            onChange={(event) => setOrganizationRequestNameEn(event.target.value)}
          />
        </div>
      </ConfirmModal>
    </section>
  );
}
