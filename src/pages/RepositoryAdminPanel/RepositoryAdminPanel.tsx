import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import type { RepositoryDocumentStatus } from '@/types/repository';
import type { RepositoryProfileUpdateRequest, RepositoryUser } from '@/types/repositoryAuth';
import type { RepositoryAuthorReference, RepositoryOrganizationReference } from '@/types/repositoryReference';
import { getRepositoryToken } from '@/utils/repositoryAuthStorage';
import { extractApiErrorMessage } from '@/utils/apiErrors';
import { filterItemsByQuery } from '@/utils/search';
import '@/pages/AdminPanel/AdminPanel.scss';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';

const API_BASE = '/api';

type ReferenceStatus = RepositoryOrganizationReference['status'];

interface ReviewDocument {
  id: string;
  name: string;
  parentPath: string[];
  updatedAt?: string;
  reviewRequestedAt?: string;
  documentStatus: RepositoryDocumentStatus;
  creatorName?: string;
  creatorEmail?: string;
  documentType?: string;
}

interface OrganizationDraft {
  nameRu: string;
  nameEn: string;
  fullNameRu: string;
  fullNameEn: string;
  status: ReferenceStatus;
}

interface AuthorDraft {
  nameRu: string;
  nameEn: string;
  organizationId: string;
  status: ReferenceStatus;
}

const statusLabels: Record<RepositoryDocumentStatus, string> = {
  draft: 'Черновик',
  needs_revision: 'На доработке',
  under_review: 'На регистрации',
  verified: 'Опубликован',
};

const referenceStatusLabels: Record<ReferenceStatus, string> = {
  pending: 'Ожидает одобрения',
  approved: 'Одобрен',
  rejected: 'Отклонен',
};

const userStatusLabels: Record<'pending' | 'active' | 'blocked', string> = {
  pending: 'Ожидает',
  active: 'Активен',
  blocked: 'Заблокирован',
};

const profileChangeLabels: Record<string, string> = {
  full_name: 'ФИО',
  email: 'Email',
  organization: 'Организация',
  position: 'Должность',
};

/* Делает: Собирает черновик организации. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function buildOrganizationDraft(organization: RepositoryOrganizationReference): OrganizationDraft {
  return {
    nameRu: organization.name_ru,
    nameEn: organization.name_en || '',
    fullNameRu: organization.full_name_ru || '',
    fullNameEn: organization.full_name_en || '',
    status: organization.status,
  };
}

/* Делает: Получает идентификатор основного организации. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getPrimaryOrganizationId(author: RepositoryAuthorReference) {
  return author.organizations[0] ? String(author.organizations[0].id) : '';
}

/* Делает: Собирает черновик автора. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function buildAuthorDraft(author: RepositoryAuthorReference): AuthorDraft {
  return {
    nameRu: author.name_ru,
    nameEn: author.name_en,
    organizationId: getPrimaryOrganizationId(author),
    status: author.status,
  };
}

/* Делает: Получает значения пользовательского поискового. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getUserSearchValues(user: RepositoryUser) {
  return [user.id, user.name, user.full_name, user.email, user.organization, user.position, user.role, user.status];
}

/* Делает: Получает значения организации поискового. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getOrganizationSearchValues(organization: RepositoryOrganizationReference) {
  return [
    organization.name_ru,
    organization.name_en,
    organization.full_name_ru,
    organization.full_name_en,
    organization.requester_name,
    organization.requester_email,
    organization.status,
  ];
}

/* Делает: Получает значения автора поискового. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getAuthorSearchValues(author: RepositoryAuthorReference) {
  return [
    author.name_ru,
    author.name_en,
    author.requester_name,
    author.requester_email,
    author.status,
    ...author.organizations.flatMap(/* Делает: Преобразует элемент и разворачивает результат. Применение: передаётся как callback в flatMap внутри getAuthorSearchValues. */ (organization) => [
      organization.name_ru,
      organization.name_en,
      organization.full_name_ru,
      organization.full_name_en,
    ]),
  ];
}

/* Делает: Получает profile update changes. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getProfileUpdateChanges(request: RepositoryProfileUpdateRequest) {
  return request.requested_changes || request.requestedChanges || {};
}

/* Делает: Получает profile update change entries. Применение: используется локально в файле src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */
function getProfileUpdateChangeEntries(request: RepositoryProfileUpdateRequest) {
  return Object.entries(getProfileUpdateChanges(request))
    .filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри getProfileUpdateChangeEntries. */ ([key]) => key !== 'organization_id')
    .map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри getProfileUpdateChangeEntries. */ ([key, value]) => ({
      key,
      label: profileChangeLabels[key] || key,
      value: String(value || 'Не указано'),
    }));
}

/* Делает: Рендерит React-компонент RepositoryAdminPanel и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function RepositoryAdminPanel() {
  const { repositoryUser, loading } = useRepositoryAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<RepositoryUser[]>([]);
  const [pendingUsers, setPendingUsers] = useState<RepositoryUser[]>([]);
  const [profileUpdateRequests, setProfileUpdateRequests] = useState<RepositoryProfileUpdateRequest[]>([]);
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocument[]>([]);
  const [organizations, setOrganizations] = useState<RepositoryOrganizationReference[]>([]);
  const [authors, setAuthors] = useState<RepositoryAuthorReference[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'profile' | 'review' | 'organizations' | 'authors'>('pending');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [revisionModalDocument, setRevisionModalDocument] = useState<ReviewDocument | null>(null);
  const [revisionCommentDraft, setRevisionCommentDraft] = useState('');
  const [organizationForm, setOrganizationForm] = useState<OrganizationDraft>({
    nameRu: '',
    nameEn: '',
    fullNameRu: '',
    fullNameEn: '',
    status: 'approved',
  });
  const [authorForm, setAuthorForm] = useState<AuthorDraft>({
    nameRu: '',
    nameEn: '',
    organizationId: '',
    status: 'approved',
  });
  const [organizationDrafts, setOrganizationDrafts] = useState<Record<number, OrganizationDraft>>({});
  const [authorDrafts, setAuthorDrafts] = useState<Record<number, AuthorDraft>>({});
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [organizationSearchQuery, setOrganizationSearchQuery] = useState('');
  const [authorSearchQuery, setAuthorSearchQuery] = useState('');
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText: string;
    onConfirm: () => void;
  }>(null);

    /* Делает: Выполняет request config. Применение: используется внутри функции RepositoryAdminPanel. */
  const requestConfig = () => ({
    headers: {
      Authorization: `Bearer ${getRepositoryToken() || ''}`,
    },
  });

    /* Делает: Запрашивает данные. Применение: используется внутри функции RepositoryAdminPanel. */
  const fetchData = async () => {
    setPageLoading(true);
    try {
      const [
        usersResponse,
        pendingResponse,
        profileRequestsResponse,
        reviewResponse,
        organizationsResponse,
        authorsResponse,
      ] = await Promise.all([
        axios.get<{ users: RepositoryUser[] }>(`${API_BASE}/repository-admin/users`, requestConfig()),
        axios.get<{ users: RepositoryUser[] }>(`${API_BASE}/repository-admin/users/pending`, requestConfig()),
        axios.get<{ requests: RepositoryProfileUpdateRequest[] }>(`${API_BASE}/repository-admin/profile-update-requests`, requestConfig()),
        axios.get<{ documents: ReviewDocument[] }>(`${API_BASE}/repository-admin/documents/review`, requestConfig()),
        axios.get<{ organizations: RepositoryOrganizationReference[] }>(`${API_BASE}/repository-admin/organizations`, requestConfig()),
        axios.get<{ authors: RepositoryAuthorReference[] }>(`${API_BASE}/repository-admin/authors`, requestConfig()),
      ]);
      setUsers(usersResponse.data.users);
      setPendingUsers(pendingResponse.data.users);
      setProfileUpdateRequests(profileRequestsResponse.data.requests);
      setReviewDocuments(reviewResponse.data.documents);
      setOrganizations(organizationsResponse.data.organizations);
      setAuthors(authorsResponse.data.authors);
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка загрузки repository admin') });
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryAdminPanel. */ () => {
    if (repositoryUser?.role === 'admin') {
      void fetchData();
    }
  }, [repositoryUser]);

  if (loading) {
    return <div className='admin-panel loading'>Загрузка...</div>;
  }
  if (!repositoryUser) {
    return <Navigate to='/repository/login' replace />;
  }
  if (repositoryUser.role !== 'admin') {
    return <Navigate to='/repository' replace />;
  }

  const pendingOrganizationsCount = organizations.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри RepositoryAdminPanel. */ (organization) => organization.status === 'pending').length;
  const pendingAuthorsCount = authors.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри RepositoryAdminPanel. */ (author) => author.status === 'pending').length;
  const organizationOptions = organizations.filter(/* Делает: Проверяет, нужно ли оставить элемент в коллекции. Применение: передаётся как callback в filter внутри RepositoryAdminPanel. */ (organization) => organization.status !== 'rejected');
  const filteredUsers = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryAdminPanel. */ () => filterItemsByQuery(users, userSearchQuery, getUserSearchValues),
    [users, userSearchQuery]
  );
  const filteredPendingUsers = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryAdminPanel. */ () => filterItemsByQuery(pendingUsers, userSearchQuery, getUserSearchValues),
    [pendingUsers, userSearchQuery]
  );
  const filteredOrganizations = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryAdminPanel. */ () => filterItemsByQuery(organizations, organizationSearchQuery, getOrganizationSearchValues),
    [organizations, organizationSearchQuery]
  );
  const filteredAuthors = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryAdminPanel. */ () => filterItemsByQuery(authors, authorSearchQuery, getAuthorSearchValues),
    [authors, authorSearchQuery]
  );

    /* Делает: Обновляет роль пользовательского. Применение: используется внутри функции RepositoryAdminPanel. */
  const updateUserRole = async (userId: number, role: 'user' | 'editor' | 'admin') => {
    try {
      await axios.put(`${API_BASE}/repository-admin/users/${userId}`, { role, status: 'active' }, requestConfig());
      setNotification({ type: 'success', text: `Роль ${role} выдана` });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, `Ошибка выдачи роли ${role}`) });
    }
  };

    /* Делает: Обновляет статус пользовательского. Применение: используется внутри функции RepositoryAdminPanel. */
  const updateUserStatus = async (userId: number, status: 'active' | 'blocked' | 'pending') => {
    try {
      await axios.put(`${API_BASE}/repository-admin/users/${userId}`, { status }, requestConfig());
      setNotification({ type: 'success', text: 'Статус пользователя обновлен' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка изменения статуса') });
    }
  };

    /* Делает: Удаляет пользователя. Применение: используется внутри функции RepositoryAdminPanel. */
  const deleteUser = async (userId: number) => {
    try {
      await axios.delete(`${API_BASE}/repository-admin/users/${userId}`, requestConfig());
      setNotification({ type: 'success', text: 'Пользователь удален' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка удаления') });
    }
  };

    /* Делает: Выполняет доработку send документа to. Применение: используется внутри функции RepositoryAdminPanel. */
  const sendDocumentToRevision = async (documentId: string, comment = '') => {
    try {
      await axios.post(
        `${API_BASE}/repository-admin/documents/${documentId}/send-back`,
        { comment },
        requestConfig()
      );
      setNotification({ type: 'success', text: 'Документ отправлен на доработку' });
      setRevisionModalDocument(null);
      setRevisionCommentDraft('');
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка отправки документа на доработку') });
    }
  };

    /* Делает: Одобряет запрос профиля update. Применение: используется внутри функции RepositoryAdminPanel. */
  const approveProfileUpdateRequest = async (requestId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/profile-update-requests/${requestId}/approve`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на изменение профиля одобрена' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка одобрения заявки на изменение профиля') });
    }
  };

    /* Делает: Отклоняет запрос профиля update. Применение: используется внутри функции RepositoryAdminPanel. */
  const rejectProfileUpdateRequest = async (requestId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/profile-update-requests/${requestId}/reject`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на изменение профиля отклонена' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка отклонения заявки на изменение профиля') });
    }
  };

    /* Делает: Одобряет организацию. Применение: используется внутри функции RepositoryAdminPanel. */
  const approveOrganization = async (organizationId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/organizations/${organizationId}/approve`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Организация одобрена' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка одобрения организации') });
    }
  };

    /* Делает: Отклоняет организацию. Применение: используется внутри функции RepositoryAdminPanel. */
  const rejectOrganization = async (organizationId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/organizations/${organizationId}/reject`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на организацию отклонена' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка отклонения организации') });
    }
  };

    /* Делает: Одобряет автора. Применение: используется внутри функции RepositoryAdminPanel. */
  const approveAuthor = async (authorId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/authors/${authorId}/approve`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Автор одобрен' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка одобрения автора') });
    }
  };

    /* Делает: Отклоняет автора. Применение: используется внутри функции RepositoryAdminPanel. */
  const rejectAuthor = async (authorId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/authors/${authorId}/reject`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на автора отклонена' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка отклонения автора') });
    }
  };

    /* Делает: Создаёт организацию. Применение: используется внутри функции RepositoryAdminPanel. */
  const createOrganization = async () => {
    try {
      await axios.post(
        `${API_BASE}/repository-admin/organizations`,
        {
          nameRu: organizationForm.nameRu,
          nameEn: organizationForm.nameEn,
          fullNameRu: organizationForm.fullNameRu,
          fullNameEn: organizationForm.fullNameEn,
          status: organizationForm.status,
        },
        requestConfig()
      );
      setNotification({ type: 'success', text: 'Организация создана' });
      setOrganizationForm({ nameRu: '', nameEn: '', fullNameRu: '', fullNameEn: '', status: 'approved' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка создания организации') });
    }
  };

    /* Делает: Сохраняет организацию. Применение: используется внутри функции RepositoryAdminPanel. */
  const saveOrganization = async (organizationId: number) => {
    const organization = organizations.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри saveOrganization. */ (item) => item.id === organizationId);
    if (!organization) {
      return;
    }

    const draft = organizationDrafts[organizationId] || buildOrganizationDraft(organization);
    try {
      await axios.put(
        `${API_BASE}/repository-admin/organizations/${organizationId}`,
        {
          nameRu: draft.nameRu,
          nameEn: draft.nameEn,
          fullNameRu: draft.fullNameRu,
          fullNameEn: draft.fullNameEn,
          status: draft.status,
        },
        requestConfig()
      );
      setNotification({ type: 'success', text: 'Организация обновлена' });
      setOrganizationDrafts(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setOrganizationDrafts внутри saveOrganization. */ (current) => {
        const next = { ...current };
        delete next[organizationId];
        return next;
      });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка обновления организации') });
    }
  };

    /* Делает: Удаляет организацию. Применение: используется внутри функции RepositoryAdminPanel. */
  const deleteOrganization = async (organizationId: number) => {
    try {
      await axios.delete(`${API_BASE}/repository-admin/organizations/${organizationId}`, requestConfig());
      setNotification({ type: 'success', text: 'Организация удалена' });
      setOrganizationDrafts(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setOrganizationDrafts внутри deleteOrganization. */ (current) => {
        const next = { ...current };
        delete next[organizationId];
        return next;
      });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка удаления организации') });
    }
  };

    /* Делает: Создаёт автора. Применение: используется внутри функции RepositoryAdminPanel. */
  const createAuthor = async () => {
    try {
      await axios.post(
        `${API_BASE}/repository-admin/authors`,
        {
          nameRu: authorForm.nameRu,
          nameEn: authorForm.nameEn,
          organizationId: authorForm.organizationId ? Number(authorForm.organizationId) : null,
          status: authorForm.status,
        },
        requestConfig()
      );
      setNotification({ type: 'success', text: 'Автор создан' });
      setAuthorForm({ nameRu: '', nameEn: '', organizationId: '', status: 'approved' });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка создания автора') });
    }
  };

    /* Делает: Сохраняет автора. Применение: используется внутри функции RepositoryAdminPanel. */
  const saveAuthor = async (authorId: number) => {
    const author = authors.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри saveAuthor. */ (item) => item.id === authorId);
    if (!author) {
      return;
    }

    const draft = authorDrafts[authorId] || buildAuthorDraft(author);
    try {
      await axios.put(
        `${API_BASE}/repository-admin/authors/${authorId}`,
        {
          nameRu: draft.nameRu,
          nameEn: draft.nameEn,
          organizationId: draft.organizationId ? Number(draft.organizationId) : null,
          status: draft.status,
        },
        requestConfig()
      );
      setNotification({ type: 'success', text: 'Автор обновлен' });
      setAuthorDrafts(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setAuthorDrafts внутри saveAuthor. */ (current) => {
        const next = { ...current };
        delete next[authorId];
        return next;
      });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка обновления автора') });
    }
  };

    /* Делает: Удаляет автора. Применение: используется внутри функции RepositoryAdminPanel. */
  const deleteAuthor = async (authorId: number) => {
    try {
      await axios.delete(`${API_BASE}/repository-admin/authors/${authorId}`, requestConfig());
      setNotification({ type: 'success', text: 'Автор удален' });
      setAuthorDrafts(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в setAuthorDrafts внутри deleteAuthor. */ (current) => {
        const next = { ...current };
        delete next[authorId];
        return next;
      });
      await fetchData();
    } catch (error) {
      setNotification({ type: 'error', text: extractApiErrorMessage(error, 'Ошибка удаления автора') });
    }
  };

    /* Делает: Подтверждает role change. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmRoleChange = (user: RepositoryUser, nextRole: 'user' | 'editor' | 'admin') => {
    setConfirmAction({
      title: 'Изменение роли',
      message: `Выдать пользователю "${user.name}" роль ${nextRole}?`,
      variant: nextRole === 'admin' ? 'warning' : 'info',
      confirmText: 'Изменить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmRoleChange. */
      onConfirm: () => {
        void updateUserRole(user.id, nextRole);
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает status change. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmStatusChange = (user: RepositoryUser, nextStatus: 'active' | 'blocked' | 'pending') => {
    const statusLabel: Record<'active' | 'blocked' | 'pending', string> = {
      active: 'активен',
      blocked: 'заблокирован',
      pending: 'ожидает',
    };

    setConfirmAction({
      title: 'Изменение статуса',
      message: `Изменить статус пользователя "${user.name}" на "${statusLabel[nextStatus]}"?`,
      variant: nextStatus === 'blocked' ? 'danger' : 'warning',
      confirmText: 'Изменить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmStatusChange. */
      onConfirm: () => {
        if (nextStatus === 'active') {
          void updateUserRole(user.id, user.role);
        } else {
          void updateUserStatus(user.id, nextStatus);
        }
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает delete. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmDelete = (user: RepositoryUser) => {
    setConfirmAction({
      title: 'Удаление пользователя',
      message: `Удалить пользователя репозитория "${user.name}"? Это действие необратимо.`,
      variant: 'danger',
      confirmText: 'Удалить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmDelete. */
      onConfirm: () => {
        void deleteUser(user.id);
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает организацию delete. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmDeleteOrganization = (organization: RepositoryOrganizationReference) => {
    setConfirmAction({
      title: 'Удаление организации',
      message: `Удалить организацию "${organization.name_ru}"? Она будет удалена из справочника и отвязана от пользователей и авторов.`,
      variant: 'danger',
      confirmText: 'Удалить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmDeleteOrganization. */
      onConfirm: () => {
        void deleteOrganization(organization.id);
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает автора delete. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmDeleteAuthor = (author: RepositoryAuthorReference) => {
    setConfirmAction({
      title: 'Удаление автора',
      message: `Удалить автора "${author.name_ru}"? Все связи автора с организациями также будут удалены.`,
      variant: 'danger',
      confirmText: 'Удалить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmDeleteAuthor. */
      onConfirm: () => {
        void deleteAuthor(author.id);
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает доработку. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmRevision = (document: ReviewDocument) => {
    setRevisionCommentDraft('');
    setRevisionModalDocument(document);
  };

    /* Делает: Подтверждает approve profile update. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmApproveProfileUpdate = (request: RepositoryProfileUpdateRequest) => {
    setConfirmAction({
      title: 'Одобрить изменение профиля',
      message: `Одобрить изменения профиля пользователя "${request.user?.full_name || request.user?.name || request.repository_user_id}"?`,
      variant: 'success',
      confirmText: 'Одобрить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmApproveProfileUpdate. */
      onConfirm: () => {
        void approveProfileUpdateRequest(request.id);
        setConfirmAction(null);
      },
    });
  };

    /* Делает: Подтверждает reject profile update. Применение: используется внутри функции RepositoryAdminPanel. */
  const confirmRejectProfileUpdate = (request: RepositoryProfileUpdateRequest) => {
    setConfirmAction({
      title: 'Отклонить изменение профиля',
      message: `Отклонить изменения профиля пользователя "${request.user?.full_name || request.user?.name || request.repository_user_id}"?`,
      variant: 'warning',
      confirmText: 'Отклонить',
            /* Делает: Выполняет on confirm. Применение: используется внутри функции confirmRejectProfileUpdate. */
      onConfirm: () => {
        void rejectProfileUpdateRequest(request.id);
        setConfirmAction(null);
      },
    });
  };

  return (
    <div className='admin-panel'>
      <div className='admin-panel__reference-card-header'>
        <h1>Админ-панель репозитория</h1>
      </div>

      {notification && (
        <div className={`admin-notification admin-notification--${notification.type}`}>
          {notification.text}
        </div>
      )}

      <div className='tabs'>
        <button type='button' className={`tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('pending')}>
          Ожидают выдачи роли ({pendingUsers.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'profile' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('profile')}>
          Изменение профиля ({profileUpdateRequests.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'review' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('review')}>
          Регистрация документов ({reviewDocuments.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'organizations' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('organizations')}>
          Организации ({organizations.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'authors' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('authors')}>
          Авторы ({authors.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'all' ? 'active' : ''}`} onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setActiveTab('all')}>
          Все пользователи ({users.length})
        </button>
      </div>

      <div className='tab-content'>
        {pageLoading ? (
          <div className='admin-panel loading'>Загрузка...</div>
        ) : activeTab === 'pending' ? (
          <div className='pending-users'>
            <div className='admin-panel__search-row'>
              <input
                type='text'
                className='admin-panel__search-input'
                value={userSearchQuery}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setUserSearchQuery(event.target.value)}
                placeholder='Поиск пользователя по имени, ФИО, email или организации'
              />
              <span className='admin-panel__search-meta'>
                Показано {filteredPendingUsers.length} из {pendingUsers.length} пользователей
              </span>
            </div>
            {pendingUsers.length === 0 ? (
              <p>Нет пользователей, ожидающих назначения роли.</p>
            ) : filteredPendingUsers.length === 0 ? (
              <p>Пользователи по этому запросу не найдены.</p>
            ) : (
              <div className='users-grid'>
                {filteredPendingUsers.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (user) => (
                  <div key={user.id} className='user-card'>
                    <div className='admin-panel__reference-card-header'>
                      <h3>{user.name}</h3>
                      <span className={`status-badge status-${user.status}`}>
                        {userStatusLabels[user.status]}
                      </span>
                    </div>
                    <div className='admin-panel__detail-list'>
                      <div className='admin-panel__detail-row'>
                        <span>ФИО</span>
                        <strong>{user.full_name || '—'}</strong>
                      </div>
                      <div className='admin-panel__detail-row'>
                        <span>Email</span>
                        <strong>{user.email}</strong>
                      </div>
                      <div className='admin-panel__detail-row'>
                        <span>Организация</span>
                        <strong>{user.organization || '—'}</strong>
                      </div>
                      <div className='admin-panel__detail-row'>
                        <span>Должность</span>
                        <strong>{user.position || '—'}</strong>
                      </div>
                    </div>
                    <div className='user-actions admin-panel__action-grid'>
                      <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmRoleChange(user, 'editor')}>Выдать editor</button>
                      <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmRoleChange(user, 'user')}>Выдать user</button>
                      <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmRoleChange(user, 'admin')}>Выдать admin</button>
                      <button type='button' className='btn-reject' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmStatusChange(user, 'blocked')}>Заблокировать</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'profile' ? (
          <div className='pending-users'>
            {profileUpdateRequests.length === 0 ? (
              <p>Нет заявок на изменение профиля.</p>
            ) : (
              <div className='users-grid'>
                {profileUpdateRequests.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (request) => {
                  const changeEntries = getProfileUpdateChangeEntries(request);
                  return (
                    <div key={request.id} className='user-card'>
                      <div className='admin-panel__reference-card-header'>
                        <h3>{request.user?.full_name || request.user?.name || `Пользователь #${request.repository_user_id}`}</h3>
                        <span className='status-badge status-pending'>Ожидает решения</span>
                      </div>
                      <div className='admin-panel__detail-list'>
                        <div className='admin-panel__detail-row'>
                          <span>Логин</span>
                          <strong>{request.user?.name || '—'}</strong>
                        </div>
                        <div className='admin-panel__detail-row'>
                          <span>Текущий email</span>
                          <strong>{request.user?.email || '—'}</strong>
                        </div>
                        <div className='admin-panel__detail-row'>
                          <span>Текущая организация</span>
                          <strong>{request.user?.organization || '—'}</strong>
                        </div>
                        <div className='admin-panel__detail-row'>
                          <span>Дата заявки</span>
                          <strong>{request.created_at ? new Date(request.created_at).toLocaleString('ru-RU') : '—'}</strong>
                        </div>
                      </div>
                      <div className='admin-panel__detail-list'>
                        {changeEntries.length === 0 ? (
                          <div className='admin-panel__detail-row'>
                            <span>Изменения</span>
                            <strong>Не указаны</strong>
                          </div>
                        ) : (
                          changeEntries.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (entry) => (
                            <div key={entry.key} className='admin-panel__detail-row'>
                              <span>{entry.label}</span>
                              <strong>{entry.value}</strong>
                            </div>
                          ))
                        )}
                      </div>
                      <div className='user-actions admin-panel__action-grid'>
                        <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmApproveProfileUpdate(request)}>
                          Одобрить
                        </button>
                        <button type='button' className='btn-reject' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmRejectProfileUpdate(request)}>
                          Отклонить
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'organizations' ? (
          <div className='admin-panel__reference-layout'>
            <div className='admin-panel__reference-create-card'>
              <h2>Создать организацию</h2>
              <div className='admin-panel__reference-form'>
                <label className='admin-panel__field'>
                  Название (RU)
                  <input
                    type='text'
                    value={organizationForm.nameRu}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, nameRu: event.target.value }))}
                    placeholder='Например, ФИЦ ЕГС РАН'
                  />
                </label>
                <label className='admin-panel__field'>
                  Название (EN)
                  <input
                    type='text'
                    value={organizationForm.nameEn}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, nameEn: event.target.value }))}
                    placeholder='For example, GS RAS'
                  />
                </label>
                <label className='admin-panel__field'>
                  Полное наименование (RU)
                  <input
                    type='text'
                    value={organizationForm.fullNameRu}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, fullNameRu: event.target.value }))}
                    placeholder='Например, Федеральный исследовательский центр...'
                  />
                </label>
                <label className='admin-panel__field'>
                  Полное наименование (EN)
                  <input
                    type='text'
                    value={organizationForm.fullNameEn}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, fullNameEn: event.target.value }))}
                    placeholder='For example, Geophysical Survey...'
                  />
                </label>
                <label className='admin-panel__field'>
                  Статус
                  <select
                    value={organizationForm.status}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, status: event.target.value as ReferenceStatus }))}
                  >
                    <option value='approved'>Одобрен</option>
                    <option value='pending'>Ожидает одобрения</option>
                    <option value='rejected'>Отклонен</option>
                  </select>
                </label>
              </div>
              <div className='user-actions'>
                <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void createOrganization()}>
                  Создать организацию
                </button>
                {pendingOrganizationsCount > 0 && (
                  <span className='admin-panel__reference-summary'>Заявок на одобрение: {pendingOrganizationsCount}</span>
                )}
              </div>
            </div>

            <div className='admin-panel__search-row'>
              <input
                type='text'
                className='admin-panel__search-input'
                value={organizationSearchQuery}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setOrganizationSearchQuery(event.target.value)}
                placeholder='Поиск организации по названию, полному имени или заявителю'
              />
              <span className='admin-panel__search-meta'>
                Показано {filteredOrganizations.length} из {organizations.length} организаций
              </span>
            </div>

            {organizations.length === 0 ? (
              <p>Пока нет организаций в справочнике.</p>
            ) : filteredOrganizations.length === 0 ? (
              <p>Организации по этому запросу не найдены.</p>
            ) : (
              <div className='admin-panel__reference-table-wrap'>
                <table className='admin-panel__reference-table'>
                  <thead>
                    <tr>
                      <th>Название RU</th>
                      <th>Название EN</th>
                      <th>Полное RU</th>
                      <th>Полное EN</th>
                      <th>Статус</th>
                      <th>Заявка</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrganizations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (organization) => {
                      const draft = organizationDrafts[organization.id] || buildOrganizationDraft(organization);
                      return (
                        <tr key={organization.id} className={`admin-panel__reference-row admin-panel__reference-row--${organization.status}`}>
                          <td>
                            <input
                              className='admin-panel__table-input'
                              type='text'
                              value={draft.nameRu}
                              aria-label='Название организации на русском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setOrganizationDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [organization.id]: {
                                    ...draft,
                                    nameRu: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              className='admin-panel__table-input'
                              type='text'
                              value={draft.nameEn}
                              aria-label='Название организации на английском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setOrganizationDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [organization.id]: {
                                    ...draft,
                                    nameEn: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td className='admin-panel__reference-table-cell--wide'>
                            <textarea
                              className='admin-panel__table-textarea'
                              value={draft.fullNameRu}
                              rows={2}
                              aria-label='Полное наименование организации на русском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setOrganizationDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [organization.id]: {
                                    ...draft,
                                    fullNameRu: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td className='admin-panel__reference-table-cell--wide'>
                            <textarea
                              className='admin-panel__table-textarea'
                              value={draft.fullNameEn}
                              rows={2}
                              aria-label='Полное наименование организации на английском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setOrganizationDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [organization.id]: {
                                    ...draft,
                                    fullNameEn: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <span className={`status-badge status-${organization.status}`}>
                              {referenceStatusLabels[organization.status]}
                            </span>
                            <select
                              className='admin-panel__table-select'
                              value={draft.status}
                              aria-label='Статус организации'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setOrganizationDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [organization.id]: {
                                    ...draft,
                                    status: event.target.value as ReferenceStatus,
                                  },
                                }))
                              }
                            >
                              <option value='approved'>Одобрен</option>
                              <option value='pending'>Ожидает одобрения</option>
                              <option value='rejected'>Отклонен</option>
                            </select>
                          </td>
                          <td className='admin-panel__reference-table-meta'>
                            <strong>{organization.requester_name || '—'}</strong>
                            <span>{organization.requester_email || '—'}</span>
                          </td>
                          <td>
                            <div className='admin-panel__table-actions'>
                              <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void saveOrganization(organization.id)}>
                                Сохранить
                              </button>
                              {organization.status === 'pending' && (
                                <>
                                  <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void approveOrganization(organization.id)}>
                                    Одобрить
                                  </button>
                                  <button type='button' className='btn-reject' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void rejectOrganization(organization.id)}>
                                    Отклонить
                                  </button>
                                </>
                              )}
                              <button type='button' className='btn-delete' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmDeleteOrganization(organization)}>
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'authors' ? (
          <div className='admin-panel__reference-layout'>
            <div className='admin-panel__reference-create-card'>
              <h2>Создать автора</h2>
              <div className='admin-panel__reference-form'>
                <label className='admin-panel__field'>
                  Автор (RU)
                  <input
                    type='text'
                    value={authorForm.nameRu}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setAuthorForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, nameRu: event.target.value }))}
                    placeholder='Фамилия Имя Отчество'
                  />
                </label>
                <label className='admin-panel__field'>
                  Автор (EN)
                  <input
                    type='text'
                    value={authorForm.nameEn}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setAuthorForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, nameEn: event.target.value }))}
                    placeholder='Surname Name Patronymic'
                  />
                </label>
                <label className='admin-panel__field'>
                  Организация
                  <select
                    value={authorForm.organizationId}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setAuthorForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, organizationId: event.target.value }))}
                  >
                    <option value=''>Не выбрана</option>
                    {organizationOptions.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name_ru}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='admin-panel__field'>
                  Статус
                  <select
                    value={authorForm.status}
                    onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setAuthorForm(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({ ...current, status: event.target.value as ReferenceStatus }))}
                  >
                    <option value='approved'>Одобрен</option>
                    <option value='pending'>Ожидает одобрения</option>
                    <option value='rejected'>Отклонен</option>
                  </select>
                </label>
              </div>
              <div className='user-actions'>
                <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void createAuthor()}>
                  Создать автора
                </button>
                {pendingAuthorsCount > 0 && (
                  <span className='admin-panel__reference-summary'>Заявок на одобрение: {pendingAuthorsCount}</span>
                )}
              </div>
            </div>

            <div className='admin-panel__search-row'>
              <input
                type='text'
                className='admin-panel__search-input'
                value={authorSearchQuery}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setAuthorSearchQuery(event.target.value)}
                placeholder='Поиск автора по имени, организации или заявителю'
              />
              <span className='admin-panel__search-meta'>
                Показано {filteredAuthors.length} из {authors.length} авторов
              </span>
            </div>

            {authors.length === 0 ? (
              <p>Пока нет авторов в справочнике.</p>
            ) : filteredAuthors.length === 0 ? (
              <p>Авторы по этому запросу не найдены.</p>
            ) : (
              <div className='admin-panel__reference-table-wrap'>
                <table className='admin-panel__reference-table admin-panel__reference-table--authors'>
                  <thead>
                    <tr>
                      <th>Автор RU</th>
                      <th>Автор EN</th>
                      <th>Организация</th>
                      <th>Связанные организации</th>
                      <th>Статус</th>
                      <th>Заявка</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuthors.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (author) => {
                      const draft = authorDrafts[author.id] || buildAuthorDraft(author);
                      const linkedOrganizations = author.organizations.length > 0
                        ? author.organizations.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (organization) => organization.name_ru).join(', ')
                        : 'Не указаны';
                      return (
                        <tr key={author.id} className={`admin-panel__reference-row admin-panel__reference-row--${author.status}`}>
                          <td>
                            <input
                              className='admin-panel__table-input'
                              type='text'
                              value={draft.nameRu}
                              aria-label='Автор на русском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setAuthorDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [author.id]: {
                                    ...draft,
                                    nameRu: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              className='admin-panel__table-input'
                              type='text'
                              value={draft.nameEn}
                              aria-label='Автор на английском'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setAuthorDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [author.id]: {
                                    ...draft,
                                    nameEn: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td className='admin-panel__reference-table-cell--organization'>
                            <select
                              className='admin-panel__table-select'
                              value={draft.organizationId}
                              aria-label='Организация автора'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setAuthorDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [author.id]: {
                                    ...draft,
                                    organizationId: event.target.value,
                                  },
                                }))
                              }
                            >
                              <option value=''>Не выбрана</option>
                              {organizationOptions.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри mapCallback. */ (organization) => (
                                <option key={organization.id} value={organization.id}>
                                  {organization.name_ru}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className='admin-panel__reference-table-meta'>
                            <span>{linkedOrganizations}</span>
                          </td>
                          <td>
                            <span className={`status-badge status-${author.status}`}>
                              {referenceStatusLabels[author.status]}
                            </span>
                            <select
                              className='admin-panel__table-select'
                              value={draft.status}
                              aria-label='Статус автора'
                              onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) =>
                                setAuthorDrafts(/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (current) => ({
                                  ...current,
                                  [author.id]: {
                                    ...draft,
                                    status: event.target.value as ReferenceStatus,
                                  },
                                }))
                              }
                            >
                              <option value='approved'>Одобрен</option>
                              <option value='pending'>Ожидает одобрения</option>
                              <option value='rejected'>Отклонен</option>
                            </select>
                          </td>
                          <td className='admin-panel__reference-table-meta'>
                            <strong>{author.requester_name || '—'}</strong>
                            <span>{author.requester_email || '—'}</span>
                          </td>
                          <td>
                            <div className='admin-panel__table-actions'>
                              <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void saveAuthor(author.id)}>
                                Сохранить
                              </button>
                              {author.status === 'pending' && (
                                <>
                                  <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void approveAuthor(author.id)}>
                                    Одобрить
                                  </button>
                                  <button type='button' className='btn-reject' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => void rejectAuthor(author.id)}>
                                    Отклонить
                                  </button>
                                </>
                              )}
                              <button type='button' className='btn-delete' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmDeleteAuthor(author)}>
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'review' ? (
          <div className='pending-users'>
            {reviewDocuments.length === 0 ? (
              <p>Нет документов на регистрации.</p>
            ) : (
              <div className='users-grid'>
                {reviewDocuments.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (document) => (
                  <div key={document.id} className='user-card'>
                    <h3>{document.name}</h3>
                    <p><strong>Статус:</strong> {statusLabels[document.documentStatus]}</p>
                    <p><strong>Тип документа:</strong> {document.documentType || 'Не указан'}</p>
                    <p><strong>Заполнитель:</strong> {document.creatorName || 'Не указан'}</p>
                    <p><strong>Email заполнителя:</strong> {document.creatorEmail || 'Не указан'}</p>
                    <p><strong>Раздел:</strong> {document.parentPath.length ? document.parentPath.join(' / ') : 'Корневой каталог'}</p>
                    <p><strong>Отправлен на регистрацию:</strong> {document.reviewRequestedAt ? new Date(document.reviewRequestedAt).toLocaleString('ru-RU') : '—'}</p>
                    <div className='user-actions'>
                      <button type='button' className='btn-approve' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => navigate(`/repository/edit#${document.id}`)}>
                        Открыть документ
                      </button>
                      <button type='button' className='btn-reject' onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmRevision(document)}>
                        Отправить на доработку
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className='users-table'>
            <div className='admin-panel__search-row'>
              <input
                type='text'
                className='admin-panel__search-input'
                value={userSearchQuery}
                onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setUserSearchQuery(event.target.value)}
                placeholder='Поиск пользователя по имени, ФИО, email или организации'
              />
              <span className='admin-panel__search-meta'>
                Показано {filteredUsers.length} из {users.length} пользователей
              </span>
            </div>
            {users.length === 0 ? (
              <p>Пользователи пока не найдены.</p>
            ) : filteredUsers.length === 0 ? (
              <p>Пользователи по этому запросу не найдены.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Имя</th>
                    <th>ФИО</th>
                    <th>Email</th>
                    <th>Организация</th>
                    <th>Должность</th>
                    <th>Роль</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри RepositoryAdminPanel. */ (user) => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      <td>{user.name}</td>
                      <td>{user.full_name || '—'}</td>
                      <td>{user.email}</td>
                      <td>{user.organization}</td>
                      <td>{user.position || '—'}</td>
                      <td>
                        <select
                          value={user.role}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => confirmRoleChange(user, event.target.value as 'user' | 'editor' | 'admin')}
                          disabled={user.id === repositoryUser.id}
                        >
                          <option value='user'>user</option>
                          <option value='editor'>editor</option>
                          <option value='admin'>admin</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={user.status}
                          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => confirmStatusChange(user, event.target.value as 'active' | 'blocked' | 'pending')}
                          disabled={user.id === repositoryUser.id}
                        >
                          <option value='pending'>Ожидает</option>
                          <option value='active'>Активен</option>
                          <option value='blocked'>Заблокирован</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type='button'
                          className='btn-delete'
                          onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => confirmDelete(user)}
                          disabled={user.id === repositoryUser.id}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={confirmAction !== null}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'info'}
        confirmText={confirmAction?.confirmText || 'Подтвердить'}
        onConfirm={confirmAction?.onConfirm || (/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => {})}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => setConfirmAction(null)}
      />
      <ConfirmModal
        isOpen={revisionModalDocument !== null}
        title='Отправить на доработку'
        message={revisionModalDocument ? `Вернуть документ "${revisionModalDocument.name}" на доработку автору?` : ''}
        variant='warning'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={/* Делает: Обрабатывает событие onConfirm в JSX-разметке. Применение: используется как inline-обработчик onConfirm внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => {
          if (!revisionModalDocument) {
            return;
          }
          void sendDocumentToRevision(revisionModalDocument.id, revisionCommentDraft);
        }}
        onCancel={/* Делает: Обрабатывает событие onCancel в JSX-разметке. Применение: используется как inline-обработчик onCancel внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ () => {
          setRevisionModalDocument(null);
          setRevisionCommentDraft('');
        }}
      >
        <label className='admin-panel__revision-comment-field'>
          Комментарий для доработки
          <textarea
            className='admin-panel__revision-comment-textarea'
            value={revisionCommentDraft}
            onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/pages/RepositoryAdminPanel/RepositoryAdminPanel.tsx. */ (event) => setRevisionCommentDraft(event.target.value)}
            placeholder='Укажите замечания для автора документа'
            maxLength={2000}
          />
        </label>
      </ConfirmModal>
    </div>
  );
}
