import Button from '@components/Button/Button';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import '@pages/Authorization/Registration/Registration.scss';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import SearchableSelect from '@/components/SearchableSelect/SearchableSelect';
import { repositoryReferenceService } from '@/services/repositoryReferenceService';
import type { RepositoryAuthFieldErrors } from '@/types/repositoryAuth';
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
  personalDataConsent: boolean;
  password: string;
  confirmPassword: string;
}

const DEFAULT_ORGANIZATION = 'ФИЦ ЕГС РАН';
const CONSENT_DOCUMENT_PATH = '/documents/repository-personal-data-consent.pdf';
const RATE_LIMIT_KEY = 'repository_registration';
const REGISTRATION_FORM_FIELDS: Array<keyof RegistrationFormData> = [
  'name',
  'fullName',
  'email',
  'organizationId',
  'position',
  'personalDataConsent',
  'password',
  'confirmPassword',
];

/* Делает: Проверяет корректность password strength. Применение: используется локально в файле src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */
const validatePasswordStrength = (password: string) => {
  if (!password) return 'Пароль обязателен';
  if (password.length < 8) return 'Минимум 8 символов';
  if (!/[A-Z]/.test(password)) return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-z]/.test(password)) return 'Нужна хотя бы одна строчная буква';
  if (!/\d/.test(password)) return 'Нужна хотя бы одна цифра';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]/.test(password)) return 'Нужен хотя бы один спецсимвол';
  return true;
};

/* Делает: Формирует логин из email, если пользователь не ввёл его вручную. Применение: используется локально в файле src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */
const buildLoginFromEmail = (email: string) => {
  const localPart = String(email || '').trim().split('@')[0] || '';
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return '';
  }

  return normalized.length >= 2 ? normalized : `${normalized}_user`;
};

/* Делает: Возвращает итоговый логин для регистрации. Применение: используется локально в файле src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */
const resolveRegistrationLogin = (name: string, email: string) => {
  const normalizedName = String(name || '').trim();
  if (normalizedName) {
    return normalizedName;
  }

  return buildLoginFromEmail(email);
};

/* Делает: Рендерит React-компонент RepositoryRegistration и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryRegistration() {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    getValues,
    clearErrors,
    setError,
    setValue,
  } = useForm<RegistrationFormData>({
    mode: 'onChange',
    defaultValues: {
      name: '',
      fullName: '',
      email: '',
      organizationId: '',
      position: '',
      personalDataConsent: false,
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
  const [organizationRequestFullNameRu, setOrganizationRequestFullNameRu] = useState('');
  const [organizationRequestFullNameEn, setOrganizationRequestFullNameEn] = useState('');
  const [requestedOrganizationName, setRequestedOrganizationName] = useState('');
  const [organizationInfo, setOrganizationInfo] = useState('');
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [organizationSuggestionOpen, setOrganizationSuggestionOpen] = useState(false);
  const [organizationSelectionRequiredOpen, setOrganizationSelectionRequiredOpen] = useState(false);
  const password = watch('password') || '';
  const confirmPassword = watch('confirmPassword') || '';
  const selectedOrganizationId = watch('organizationId') || '';
  const isLocked = lockoutTime > 0;

  const organizationOptions = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryRegistration. */ () =>
      organizations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри useMemoCallback. */ (organization) => ({
        id: String(organization.id),
        label: `${organization.name_ru}${organization.name_en ? ` / ${organization.name_en}` : ''}`,
        description:
          [organization.full_name_ru, organization.full_name_en].filter(Boolean).join(' / ') || undefined,
        searchValues: [
          organization.name_ru,
          organization.name_en,
          organization.full_name_ru,
          organization.full_name_en,
        ],
      })),
    [organizations]
  );

  const updateLockoutStatus = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ () => {
    const timeRemaining = checkRateLimitStatus(RATE_LIMIT_KEY);
    setLockoutTime(timeRemaining);
    setRemainingAttempts(getRemainingAttempts(RATE_LIMIT_KEY));
  }, []);

  const clearRegistrationErrors = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ () => {
    clearErrors(REGISTRATION_FORM_FIELDS);
  }, [clearErrors]);

  const openOrganizationRequestModal = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ (initialQuery = '') => {
    const normalizedQuery = initialQuery.trim();
    const hasCyrillic = /[А-Яа-яЁё]/.test(normalizedQuery);
    const hasLatin = /[A-Za-z]/.test(normalizedQuery);

    clearErrors('organizationId');
    setOrganizationSelectionRequiredOpen(false);
    setOrganizationRequestNameRu(hasCyrillic ? normalizedQuery : '');
    setOrganizationRequestNameEn(hasLatin && !hasCyrillic ? normalizedQuery : '');
    setOrganizationRequestFullNameRu('');
    setOrganizationRequestFullNameEn('');
    setOrganizationRequestOpen(true);
  }, [clearErrors]);

  const promptOrganizationSelection = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ () => {
    clearErrors('organizationId');
    setOrganizationSelectionRequiredOpen(true);
  }, [clearErrors]);

  const applyRegistrationFieldErrors = useCallback(
    /* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ (fieldErrors?: RepositoryAuthFieldErrors) => {
      clearRegistrationErrors();

      if (!fieldErrors) {
        return false;
      }

      let hasFieldErrors = false;
      const fieldMap: Partial<Record<keyof RepositoryAuthFieldErrors, keyof RegistrationFormData>> = {
        name: 'name',
        fullName: 'fullName',
        email: 'email',
        organization: 'organizationId',
        organizationId: 'organizationId',
        position: 'position',
        personalDataConsent: 'personalDataConsent',
        password: 'password',
        confirmPassword: 'confirmPassword',
      };

      Object.entries(fieldErrors).forEach(/* Делает: Выполняет действие для каждого элемента коллекции. Применение: передаётся как callback в forEach внутри useCallbackCallback. */ ([field, message]) => {
        const targetField = fieldMap[field as keyof RepositoryAuthFieldErrors];
        if (!targetField || !message) {
          return;
        }

        setError(targetField, { type: 'server', message });
        hasFieldErrors = true;
      });

      return hasFieldErrors;
    },
    [clearRegistrationErrors, setError]
  );

  const showRegistrationError = useCallback(
    /* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryRegistration. */ (message: string, fieldErrors?: RepositoryAuthFieldErrors) => {
      const hasFieldErrors = applyRegistrationFieldErrors(fieldErrors);
      const fieldMessages = fieldErrors ? Object.values(fieldErrors).filter(Boolean) : [];
      const shouldShowBanner = !hasFieldErrors || !fieldMessages.includes(message);
      setServerError(shouldShowBanner ? message : '');
    },
    [applyRegistrationFieldErrors]
  );

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryRegistration. */ () => {
    updateLockoutStatus();
  }, [updateLockoutStatus]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryRegistration. */ () => {
    let isActive = true;

    void (/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в внешний вызов внутри useEffectCallback. */ async () => {
      setOrganizationsLoading(true);
      try {
        const data = await repositoryReferenceService.getOrganizations();
        if (!isActive) {
          return;
        }

        setOrganizations(data);
        const defaultOrganization = data.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри callback. */ (organization) => organization.name_ru === DEFAULT_ORGANIZATION);
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

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [setValue]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryRegistration. */ () => {
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

    /* Делает: Выполняет on submit. Применение: используется внутри функции RepositoryRegistration. */
  const onSubmit = async (data: RegistrationFormData) => {
    if (isLocked) {
      setServerError(`Слишком много попыток. Подождите ${formatTimeRemaining(lockoutTime)}`);
      return;
    }

    setIsLoading(true);
    setServerError('');
    setOrganizationInfo('');
    setOrganizationSuggestionOpen(false);
    setOrganizationSelectionRequiredOpen(false);
    clearRegistrationErrors();

    try {
      const normalizedLogin = resolveRegistrationLogin(data.name, data.email);
      if (!normalizedLogin) {
        setError('name', {
          type: 'manual',
          message: 'Укажите логин вручную или корректный email для его автоматического заполнения',
        });
        return;
      }

      setValue('name', normalizedLogin, {
        shouldDirty: true,
        shouldValidate: true,
      });
      clearErrors('name');

      const selectedOrganization = organizations.find(
        /* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри onSubmit. */ (organization) => String(organization.id) === String(data.organizationId || '')
      );
      const pendingRequestedOrganization = requestedOrganizationName.trim();
      const typedOrganizationQuery = organizationSearchQuery.trim();

      if (!selectedOrganization && !pendingRequestedOrganization) {
        if (typedOrganizationQuery) {
          clearErrors('organizationId');
          setOrganizationSuggestionOpen(true);
          return;
        }

        promptOrganizationSelection();
        return;
      }

      const organizationName = selectedOrganization?.name_ru || pendingRequestedOrganization;

      if (!organizationName) {
        promptOrganizationSelection();
        return;
      }

      const result = await registerRepositoryUser({
        name: normalizedLogin,
        fullName: data.fullName.trim(),
        email: data.email.trim(),
        organization: organizationName,
        organizationId: selectedOrganization?.id ?? null,
        position: data.position.trim(),
        personalDataConsent: data.personalDataConsent,
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

        const message = result.message || 'Ошибка регистрации в репозитории';
        showRegistrationError(message, result.fieldErrors);
        return;
      }

      resetRateLimit(RATE_LIMIT_KEY);
      clearRegistrationErrors();
      setSuccessOpen(true);
    } catch (error: any) {
      const lockTime = recordFailedAttempt(RATE_LIMIT_KEY);
      updateLockoutStatus();

      if (lockTime > 0) {
        setServerError(
          `Превышен лимит попыток. Регистрация заблокирована на ${formatTimeRemaining(lockTime)}`
        );
      } else {
        const message = error?.message || 'Ошибка регистрации в репозитории';
        showRegistrationError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

    /* Делает: Выполняет организацию запроса. Применение: используется внутри функции RepositoryRegistration. */
  const requestOrganization = async () => {
    const nameRu = organizationRequestNameRu.trim();
    const nameEn = organizationRequestNameEn.trim();
    const fullNameRu = organizationRequestFullNameRu.trim();
    const fullNameEn = organizationRequestFullNameEn.trim();

    if (nameRu.length < 2) {
      setServerError('Укажите название организации на русском языке');
      return;
    }

    try {
      const result = await repositoryReferenceService.requestOrganization({
        nameRu,
        nameEn,
        fullNameRu,
        fullNameEn,
        requesterName: getValues('fullName'),
        requesterEmail: getValues('email'),
      });

      setOrganizationRequestOpen(false);
      setOrganizationSuggestionOpen(false);
      setOrganizationRequestNameRu('');
      setOrganizationRequestNameEn('');
      setOrganizationRequestFullNameRu('');
      setOrganizationRequestFullNameEn('');
      setRequestedOrganizationName(result.organization?.name_ru || nameRu);
      setOrganizationInfo(`${result.message}. Для регистрации будет использовано значение: ${result.organization?.name_ru || nameRu}`);
      setServerError('');

      if (result.organization?.status === 'approved') {
        const refreshed = await repositoryReferenceService.getOrganizations();
        setOrganizations(refreshed);
        const approvedOrganization = refreshed.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри requestOrganization. */ (organization) => organization.id === result.organization.id);
        if (approvedOrganization) {
          setValue('organizationId', String(approvedOrganization.id));
          clearErrors('organizationId');
          setRequestedOrganizationName('');
          setOrganizationSearchQuery('');
          setOrganizationInfo(`${result.message}. Организация выбрана из списка автоматически.`);
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
            {...register('fullName', {
              required: 'ФИО обязательно',
              pattern: {
                value: /^[А-ЯЁа-яё\s-]+$/,
                message: 'Только русские буквы, пробелы и дефис',
              },
                            /* Делает: Выполняет validate. Применение: используется внутри функции RepositoryRegistration. */
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
            <input type='hidden' {...register('organizationId')} />
            <SearchableSelect
              inputClassName='reg__form-input'
              options={organizationOptions}
              value={selectedOrganizationId}
              onQueryChange={/* Делает: Обрабатывает событие onQueryChange в JSX-разметке. Применение: используется как inline-обработчик onQueryChange внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (query) => {
                setOrganizationSearchQuery(query);

                if (query.trim() && requestedOrganizationName) {
                  setRequestedOrganizationName('');
                  setOrganizationInfo('');
                }
              }}
              onSelect={/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (value) => {
                setValue('organizationId', value, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                clearErrors('organizationId');
                setOrganizationSearchQuery('');
                setOrganizationSelectionRequiredOpen(false);

                if (value) {
                  setRequestedOrganizationName('');
                  setOrganizationInfo('');
                }
              }}
              placeholder='Поиск организации по названию'
              emptyText='Организации по этому запросу не найдены'
              disabled={isLoading || isLocked || organizationsLoading}
            />
            {errors.organizationId && <p className='reg__form-error'>{errors.organizationId.message}</p>}
            <button
              type='button'
              className='reg__organization-request-btn'
              onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => openOrganizationRequestModal(organizationSearchQuery)}
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

          <input
            {...register('confirmPassword', {
              required: 'Подтверждение пароля обязательно',
                            /* Делает: Выполняет validate. Применение: используется внутри функции RepositoryRegistration. */
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

          <div className='reg__password-help'>
            <p className='reg__form-hint reg__form-hint--password'>Пароль задавайте в английской раскладке.</p>

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
          </div>

          <div className='reg__consent'>
            <label className='reg__consent-label' htmlFor='repository-registration-consent'>
              <input
                id='repository-registration-consent'
                {...register('personalDataConsent', {
                  validate: (value) => value || 'Для регистрации необходимо дать согласие на обработку персональных данных',
                })}
                type='checkbox'
                className='reg__consent-checkbox'
                disabled={isLoading || isLocked}
              />
              <span>
                Я ознакомлен(а) с текстом{' '}
                <a
                  href={CONSENT_DOCUMENT_PATH}
                  target='_blank'
                  rel='noreferrer'
                  className='reg__consent-link'
                  onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (event) => {
                    event.stopPropagation();
                  }}
                >
                  Согласия на обработку персональных данных
                </a>
                {' '}и даю своё согласие на обработку моих персональных данных ФИЦ ЕГС РАН
              </span>
            </label>
          </div>
          {errors.personalDataConsent && <p className='reg__form-error'>{errors.personalDataConsent.message}</p>}

          <input
            {...register('name', {
              validate: (value) => {
                const normalizedValue = value.trim();
                if (!normalizedValue) {
                  return true;
                }

                if (normalizedValue.length < 2) {
                  return 'Минимум 2 символа';
                }

                if (!/^[a-zA-Z0-9_]+$/.test(normalizedValue)) {
                  return 'Только буквы, цифры и подчеркивание';
                }

                return true;
              },
            })}
            type='text'
            className='reg__form-input'
            placeholder='Имя пользователя (логин)'
            disabled={isLoading || isLocked}
          />
          {errors.name && <p className='reg__form-error'>{errors.name.message}</p>}
          <p className='reg__form-hint'>Если поле оставить пустым, логин будет сформирован автоматически по email.</p>
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
        message='Регистрация в репозитории завершена. Дождитесь подтверждения администратора перед входом в систему.'
        variant='success'
        confirmText='Понятно'
        showCancel={false}
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => navigate('/repository/login', { replace: true })}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => navigate('/repository/login', { replace: true })}
      />
      <ConfirmModal
        isOpen={organizationSuggestionOpen}
        title='Организация не найдена'
        message='Такой организации нет в справочнике. Отправить заявку на добавление новой организации?'
        variant='warning'
        confirmText='Отправить заявку'
        cancelText='Нет'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => {
          setOrganizationSuggestionOpen(false);
          openOrganizationRequestModal(organizationSearchQuery);
        }}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => {
          setOrganizationSuggestionOpen(false);
          promptOrganizationSelection();
        }}
      />
      <ConfirmModal
        isOpen={organizationSelectionRequiredOpen}
        title='Выберите организацию'
        message='Для регистрации нужно выбрать организацию из выпадающего списка.'
        variant='info'
        confirmText='Понятно'
        showCancel={false}
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => setOrganizationSelectionRequiredOpen(false)}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => setOrganizationSelectionRequiredOpen(false)}
      />
      <ConfirmModal
        isOpen={organizationRequestOpen}
        title='Новая организация'
        message='Укажите организацию, которую нужно добавить в справочник.'
        variant='info'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => {
          void requestOrganization();
        }}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ () => setOrganizationRequestOpen(false)}
      >
        <div className='reg__organization-request-fields'>
          <input
            type='text'
            className='reg__form-input'
            placeholder='Сокращенное название организации (RU)'
            value={organizationRequestNameRu}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (event) => setOrganizationRequestNameRu(event.target.value)}
          />
          <input
            type='text'
            className='reg__form-input'
            placeholder='Short organization name (EN)'
            value={organizationRequestNameEn}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (event) => setOrganizationRequestNameEn(event.target.value)}
          />
          <input
            type='text'
            className='reg__form-input'
            placeholder='Полное наименование организации (RU)'
            value={organizationRequestFullNameRu}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (event) => setOrganizationRequestFullNameRu(event.target.value)}
          />
          <input
            type='text'
            className='reg__form-input'
            placeholder='Full organization name (EN)'
            value={organizationRequestFullNameEn}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAuthorization/RepositoryRegistration.tsx. */ (event) => setOrganizationRequestFullNameEn(event.target.value)}
          />
        </div>
      </ConfirmModal>
    </section>
  );
}
