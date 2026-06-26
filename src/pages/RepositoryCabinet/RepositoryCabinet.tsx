import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { FormEvent } from 'react';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import SearchableSelect, { type SearchableSelectOption } from '@/components/SearchableSelect/SearchableSelect';
import { repositoryAuthService } from '@/services/repositoryAuthService';
import { repositoryReferenceService } from '@/services/repositoryReferenceService';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentSummary } from '@/types/repository';
import type { RepositoryAuthFieldErrors } from '@/types/repositoryAuth';
import type { RepositoryOrganizationReference } from '@/types/repositoryReference';
import { getApiErrorDetails } from '@/utils/apiErrors';
import RepositoryDocumentsTable from '@/components/RepositoryDocumentsTable/RepositoryDocumentsTable';
import './RepositoryCabinet.scss';

/* Делает: Нормализует текст. Применение: используется локально в файле src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */
function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

const CABINET_DOCUMENT_STATUS_ORDER = {
  draft: 0,
  needs_revision: 1,
  under_review: 2,
  verified: 3,
} as const;

/* Делает: Получает cabinet document status order. Применение: используется локально в файле src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */
function getCabinetDocumentStatusOrder(status: RepositoryDocumentSummary['documentStatus']) {
  return CABINET_DOCUMENT_STATUS_ORDER[status || 'draft'] ?? CABINET_DOCUMENT_STATUS_ORDER.draft;
}

const repositoryRoleLabels = {
  admin: 'Администратор',
  editor: 'Редактор',
  user: 'Пользователь',
} as const;

const repositoryUserStatusLabels = {
  pending: 'Ожидает подтверждения',
  active: 'Активен',
  blocked: 'Заблокирован',
} as const;

interface CabinetProfileForm {
  fullName: string;
  email: string;
  organizationId: string;
  position: string;
}

interface CabinetPasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

/* Делает: Собирает опции организации. Применение: используется локально в файле src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */
function buildOrganizationOptions(
  organizations: RepositoryOrganizationReference[],
  currentUserOrganization?: { id?: number | null; name?: string | null }
): SearchableSelectOption[] {
  const options = organizations
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри buildOrganizationOptions. */ (organization) => organization.status !== 'rejected')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри buildOrganizationOptions. */ (organization) => ({
      id: String(organization.id),
      label: organization.name_ru,
      description: organization.name_en || organization.full_name_ru || undefined,
      searchValues: [organization.name_ru, organization.name_en, organization.full_name_ru, organization.full_name_en],
    }));

  const currentId = currentUserOrganization?.id ? String(currentUserOrganization.id) : '';
  if (currentId && currentUserOrganization?.name && !options.some(/* Делает: Проверяет наличие подходящего элемента в коллекции. Применение: передаётся как callback в some внутри buildOrganizationOptions. */ (option) => option.id === currentId)) {
    options.unshift({
      id: currentId,
      label: currentUserOrganization.name,
      description: 'Текущая организация пользователя',
      searchValues: [currentUserOrganization.name],
    });
  }

  return options;
}

/* Делает: Рендерит React-компонент RepositoryCabinet и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryCabinet() {
  const location = useLocation();
  const { repositoryUser, loading: authLoading } = useRepositoryAuth();
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<RepositoryOrganizationReference[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [profileForm, setProfileForm] = useState<CabinetProfileForm>({
    fullName: '',
    email: '',
    organizationId: '',
    position: '',
  });
  const [profileFieldErrors, setProfileFieldErrors] = useState<RepositoryAuthFieldErrors>({});
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [passwordForm, setPasswordForm] = useState<CabinetPasswordForm>({
    oldPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<RepositoryAuthFieldErrors>({});
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [personalDataOpen, setPersonalDataOpen] = useState(false);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryCabinet. */ () => {
    if (!repositoryUser) {
      setProfileForm({ fullName: '', email: '', organizationId: '', position: '' });
      return;
    }

    setProfileForm({
      fullName: repositoryUser.full_name || '',
      email: repositoryUser.email || '',
      organizationId: repositoryUser.organization_id || repositoryUser.organizationId
        ? String(repositoryUser.organization_id ?? repositoryUser.organizationId)
        : '',
      position: repositoryUser.position || '',
    });
  }, [repositoryUser]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryCabinet. */ () => {
    if (!repositoryUser) {
      setOrganizations([]);
      setOrganizationsLoading(false);
      return;
    }

    let isActive = true;
        /* Делает: Загружает организации. Применение: используется внутри функции useEffectCallback. */
    const loadOrganizations = async () => {
      setOrganizationsLoading(true);
      try {
        const items = await repositoryReferenceService.getOrganizations();
        if (isActive) {
          setOrganizations(items);
        }
      } catch (loadError) {
        if (isActive) {
          setProfileMessage({
            type: 'error',
            text: getApiErrorDetails(loadError, 'Не удалось загрузить справочник организаций').message,
          });
        }
      } finally {
        if (isActive) {
          setOrganizationsLoading(false);
        }
      }
    };

    void loadOrganizations();

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [repositoryUser]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryCabinet. */ () => {
    if (!repositoryUser) {
      setDocuments([]);
      setLoading(false);
      setError(null);
      return;
    }

    let isActive = true;
    const currentUserId = normalizeText(String(repositoryUser.id || ''));

        /* Делает: Выполняет load. Применение: используется внутри функции useEffectCallback. */
    const load = async () => {
      setLoading(true);
      setError(null);
      setDocuments([]);

      try {
        const userDocuments = await repositoryService.getMyDocuments();
        if (!isActive) {
          return;
        }

        setDocuments(
          userDocuments.filter(
            /* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри load. */ (document) => currentUserId && normalizeText(document.meta?.creatorUserId) === currentUserId
          )
        );
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить документы пользователя.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void load();

    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      isActive = false;
    };
  }, [repositoryUser]);

  const userId = normalizeText(String(repositoryUser?.id || ''));

  const userDocuments = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryCabinet. */ () => {
    return documents
      .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри useMemoCallback. */ (document) => {
        const creatorUserId = normalizeText(document.meta?.creatorUserId);
        return Boolean(userId && creatorUserId === userId);
      })
      .sort(/* Делает: Сравнивает элементы при сортировке. Применение: передаётся как callback в sort внутри useMemoCallback. */ (left, right) => {
        const statusOrderDiff =
          getCabinetDocumentStatusOrder(left.documentStatus) -
          getCabinetDocumentStatusOrder(right.documentStatus);
        if (statusOrderDiff !== 0) {
          return statusOrderDiff;
        }

        const leftTime = Date.parse(left.updatedAt || left.meta?.publicationDate || '') || 0;
        const rightTime = Date.parse(right.updatedAt || right.meta?.publicationDate || '') || 0;
        return rightTime - leftTime;
      });
  }, [documents, userId]);

  const statusCounters = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryCabinet. */ () => {
    return userDocuments.reduce(
      /* Делает: Накопляет итоговое значение при обходе коллекции. Применение: передаётся как callback в reduce внутри useMemoCallback. */ (acc, document) => {
        const status = document.documentStatus || 'draft';
        acc.total += 1;
        if (status === 'draft') {
          acc.draft += 1;
        } else if (status === 'under_review') {
          acc.underReview += 1;
        } else if (status === 'verified') {
          acc.verified += 1;
        } else {
          acc.needsRevision += 1;
        }
        return acc;
      },
      {
        total: 0,
        draft: 0,
        needsRevision: 0,
        underReview: 0,
        verified: 0,
      }
    );
  }, [userDocuments]);

  const documentsWithRevisionComments = useMemo(/* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryCabinet. */ () => {
    return userDocuments.filter(
      /* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри useMemoCallback. */ (document) => String(document.meta?.revisionComment || '').trim()
    );
  }, [userDocuments]);

  const organizationOptions = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryCabinet. */ () =>
      buildOrganizationOptions(organizations, {
        id: repositoryUser?.organization_id ?? repositoryUser?.organizationId ?? null,
        name: repositoryUser?.organization || '',
      }),
    [organizations, repositoryUser]
  );

    /* Делает: Обновляет форму профиля. Применение: используется внутри функции RepositoryCabinet. */
  const updateProfileForm = (field: keyof CabinetProfileForm, value: string) => {
    setProfileForm(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setProfileForm внутри updateProfileForm. */ (current) => ({ ...current, [field]: value }));
    setProfileFieldErrors(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setProfileFieldErrors внутри updateProfileForm. */ (current) => {
      if (!current[field as keyof RepositoryAuthFieldErrors]) {
        return current;
      }

      const next = { ...current };
      delete next[field as keyof RepositoryAuthFieldErrors];
      return next;
    });
  };

    /* Делает: Обновляет форму пароля. Применение: используется внутри функции RepositoryCabinet. */
  const updatePasswordForm = (field: keyof CabinetPasswordForm, value: string) => {
    setPasswordForm(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setPasswordForm внутри updatePasswordForm. */ (current) => ({ ...current, [field]: value }));
    setPasswordFieldErrors(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setPasswordFieldErrors внутри updatePasswordForm. */ (current) => {
      if (!current[field as keyof RepositoryAuthFieldErrors]) {
        return current;
      }

      const next = { ...current };
      delete next[field as keyof RepositoryAuthFieldErrors];
      return next;
    });
  };

    /* Делает: Отправляет запрос профиля update. Применение: используется внутри функции RepositoryCabinet. */
  const submitProfileUpdateRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileSubmitting(true);
    setProfileMessage(null);
    setProfileFieldErrors({});

    try {
      const result = await repositoryAuthService.requestProfileUpdate({
        fullName: profileForm.fullName,
        email: profileForm.email,
        organizationId: profileForm.organizationId ? Number(profileForm.organizationId) : null,
        position: profileForm.position,
      });
      setProfileMessage({ type: 'success', text: result.message || 'Заявка отправлена администратору.' });
    } catch (submitError) {
      const details = getApiErrorDetails(submitError, 'Не удалось отправить заявку на изменение параметров');
      setProfileFieldErrors((details.fieldErrors || {}) as RepositoryAuthFieldErrors);
      setProfileMessage({ type: 'error', text: details.message });
    } finally {
      setProfileSubmitting(false);
    }
  };

    /* Делает: Отправляет password change. Применение: используется внутри функции RepositoryCabinet. */
  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordSubmitting(true);
    setPasswordMessage(null);
    setPasswordFieldErrors({});

    try {
      const result = await repositoryAuthService.changePassword(passwordForm);
      setPasswordMessage({ type: 'success', text: result.message || 'Пароль успешно изменен.' });
      setPasswordForm({ oldPassword: '', newPassword: '', confirmNewPassword: '' });
    } catch (submitError) {
      const details = getApiErrorDetails(submitError, 'Не удалось сменить пароль');
      setPasswordFieldErrors((details.fieldErrors || {}) as RepositoryAuthFieldErrors);
      setPasswordMessage({ type: 'error', text: details.message });
    } finally {
      setPasswordSubmitting(false);
    }
  };

  if (authLoading) {
    return <section className='repository-cabinet repository-cabinet--state'>Проверка доступа...</section>;
  }

  if (!repositoryUser) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to='/repository/login' state={{ from: returnTo }} replace />;
  }

  return (
    <section className='repository-cabinet'>
      <div className='repository-cabinet__container'>
        <h1>Кабинет пользователя</h1>
        <p className='repository-cabinet__lead'>
          Здесь отображаются документы, которые вы создали в репозитории.
        </p>

        <button
          type='button'
          className={`repository-cabinet__personal-data-toggle${personalDataOpen ? ' is-open' : ''}`}
          aria-expanded={personalDataOpen}
          onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ () => setPersonalDataOpen(/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (current) => !current)}
        >
          <span>Персональные данные</span>
          <span className='repository-cabinet__personal-data-toggle-state'>
            {personalDataOpen ? 'Скрыть' : 'Открыть'}
          </span>
        </button>

        {personalDataOpen && <div className='repository-cabinet__profile-layout'>
          <article className='repository-cabinet__card'>
            <div className='repository-cabinet__card-header'>
              <h2>Информация о пользователе</h2>
              <span className={`repository-cabinet__user-status repository-cabinet__user-status--${repositoryUser.status}`}>
                {repositoryUserStatusLabels[repositoryUser.status]}
              </span>
            </div>
            <div className='repository-cabinet__info-grid'>
              <div>
                <span>ФИО</span>
                <strong>{repositoryUser.full_name || 'Не указано'}</strong>
              </div>
              <div>
                <span>Организация</span>
                <strong>{repositoryUser.organization || 'Не указана'}</strong>
              </div>
              <div>
                <span>Должность</span>
                <strong>{repositoryUser.position || 'Не указана'}</strong>
              </div>
              <div>
                <span>Роль</span>
                <strong>{repositoryRoleLabels[repositoryUser.role]}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{repositoryUser.email}</strong>
              </div>
              <div>
                <span>Логин</span>
                <strong>{repositoryUser.name}</strong>
              </div>
            </div>
          </article>

          <form className='repository-cabinet__card repository-cabinet__form-card' onSubmit={submitProfileUpdateRequest}>
            <div className='repository-cabinet__card-header'>
              <h2>Изменить параметры</h2>
              <span>После отправки заявка попадет администратору.</span>
            </div>
            <div className='repository-cabinet__form-grid'>
              <label className='repository-cabinet__field'>
                ФИО
                <input
                  type='text'
                  value={profileForm.fullName}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updateProfileForm('fullName', event.target.value)}
                  disabled={profileSubmitting}
                />
                {profileFieldErrors.fullName && <span>{profileFieldErrors.fullName}</span>}
              </label>
              <label className='repository-cabinet__field'>
                Email
                <input
                  type='email'
                  value={profileForm.email}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updateProfileForm('email', event.target.value)}
                  disabled={profileSubmitting}
                />
                {profileFieldErrors.email && <span>{profileFieldErrors.email}</span>}
              </label>
              <label className='repository-cabinet__field repository-cabinet__field--wide'>
                Организация
                <SearchableSelect
                  options={organizationOptions}
                  value={profileForm.organizationId}
                  onSelect={/* Делает: Обрабатывает событие onSelect в JSX-разметке. Применение: используется как inline-обработчик onSelect внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (value) => updateProfileForm('organizationId', value)}
                  placeholder='Поиск организации по названию'
                  emptyText='Организации по этому запросу не найдены'
                  disabled={profileSubmitting || organizationsLoading}
                />
                {profileFieldErrors.organizationId && <span>{profileFieldErrors.organizationId}</span>}
              </label>
              <label className='repository-cabinet__field repository-cabinet__field--wide'>
                Должность
                <input
                  type='text'
                  value={profileForm.position}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updateProfileForm('position', event.target.value)}
                  disabled={profileSubmitting}
                />
                {profileFieldErrors.position && <span>{profileFieldErrors.position}</span>}
              </label>
            </div>
            {profileMessage && (
              <p className={`repository-cabinet__message repository-cabinet__message--${profileMessage.type}`}>
                {profileMessage.text}
              </p>
            )}
            <div className='repository-cabinet__form-actions'>
              <button type='submit' disabled={profileSubmitting || organizationsLoading}>
                {profileSubmitting ? 'Отправка...' : 'Отправить заявку'}
              </button>
            </div>
          </form>

          <form className='repository-cabinet__card repository-cabinet__form-card' onSubmit={submitPasswordChange}>
            <div className='repository-cabinet__card-header'>
              <h2>Смена пароля</h2>
              <span>Введите старый пароль и дважды новый пароль.</span>
            </div>
            <div className='repository-cabinet__form-grid repository-cabinet__form-grid--password'>
              <label className='repository-cabinet__field'>
                Старый пароль
                <input
                  type='password'
                  value={passwordForm.oldPassword}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updatePasswordForm('oldPassword', event.target.value)}
                  disabled={passwordSubmitting}
                  autoComplete='current-password'
                />
                {passwordFieldErrors.oldPassword && <span>{passwordFieldErrors.oldPassword}</span>}
              </label>
              <label className='repository-cabinet__field'>
                Новый пароль
                <input
                  type='password'
                  value={passwordForm.newPassword}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updatePasswordForm('newPassword', event.target.value)}
                  disabled={passwordSubmitting}
                  autoComplete='new-password'
                />
                {passwordFieldErrors.newPassword && <span>{passwordFieldErrors.newPassword}</span>}
              </label>
              <label className='repository-cabinet__field'>
                Подтвердите новый пароль
                <input
                  type='password'
                  value={passwordForm.confirmNewPassword}
                  onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryCabinet/RepositoryCabinet.tsx. */ (event) => updatePasswordForm('confirmNewPassword', event.target.value)}
                  disabled={passwordSubmitting}
                  autoComplete='new-password'
                />
                {passwordFieldErrors.confirmNewPassword && <span>{passwordFieldErrors.confirmNewPassword}</span>}
              </label>
            </div>
            {passwordMessage && (
              <p className={`repository-cabinet__message repository-cabinet__message--${passwordMessage.type}`}>
                {passwordMessage.text}
              </p>
            )}
            <div className='repository-cabinet__form-actions'>
              <button type='submit' disabled={passwordSubmitting}>
                {passwordSubmitting ? 'Сохранение...' : 'Сменить пароль'}
              </button>
            </div>
          </form>
        </div>}

        <div className='repository-cabinet__stats'>
          <div className='repository-cabinet__stat'>
            <span>Всего</span>
            <strong>{statusCounters.total}</strong>
          </div>
          <div className='repository-cabinet__stat repository-cabinet__stat--info'>
            <span>Черновики</span>
            <strong>{statusCounters.draft}</strong>
          </div>
          <div className='repository-cabinet__stat repository-cabinet__stat--warning'>
            <span>На доработке</span>
            <strong>{statusCounters.needsRevision}</strong>
          </div>
          <div className='repository-cabinet__stat repository-cabinet__stat--info'>
            <span>На регистрации</span>
            <strong>{statusCounters.underReview}</strong>
          </div>
          <div className='repository-cabinet__stat repository-cabinet__stat--success'>
            <span>Опубликованные</span>
            <strong>{statusCounters.verified}</strong>
          </div>
        </div>

        {documentsWithRevisionComments.length > 0 && (
          <section className='repository-cabinet__comments'>
            <div className='repository-cabinet__comments-header'>
              <h2>Комментарии администратора</h2>
              <span>Здесь собраны замечания по документам, которые требуют вашего внимания.</span>
            </div>
            <div className='repository-cabinet__comments-list'>
              {documentsWithRevisionComments.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryCabinet. */ (document) => (
                <article key={document.id} className='repository-cabinet__comment-card'>
                  <div className='repository-cabinet__comment-card-header'>
                    <h3>{document.name}</h3>
                    <span>{document.documentStatus === 'needs_revision' ? 'На доработке' : 'Комментарий сохранен'}</span>
                  </div>
                  <p className='repository-cabinet__comment-text'>{document.meta.revisionComment}</p>
                  {(document.meta.revisionCommentAuthor || document.meta.revisionCommentUpdatedAt) && (
                    <p className='repository-cabinet__comment-meta'>
                      {document.meta.revisionCommentAuthor ? `Автор: ${document.meta.revisionCommentAuthor}` : 'Автор не указан'}
                      {document.meta.revisionCommentUpdatedAt
                        ? `, ${new Date(document.meta.revisionCommentUpdatedAt).toLocaleString('ru-RU')}`
                        : ''}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {loading && <div className='repository-cabinet__state'>Загрузка...</div>}
        {error && <div className='repository-cabinet__state repository-cabinet__state--error'>{error}</div>}

        {!loading && !error && userDocuments.length === 0 && (
          <div className='repository-cabinet__state'>По вашему профилю пока нет созданных документов.</div>
        )}

        {!loading && !error && userDocuments.length > 0 && (
          <RepositoryDocumentsTable documents={userDocuments} showStatus />
        )}
      </div>
    </section>
  );
}
