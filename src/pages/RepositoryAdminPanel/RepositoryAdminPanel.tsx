import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import type { RepositoryDocumentStatus } from '@/types/repository';
import type { RepositoryUser } from '@/types/repositoryAuth';
import type { RepositoryAuthorReference, RepositoryOrganizationReference } from '@/types/repositoryReference';
import { getRepositoryToken } from '@/utils/repositoryAuthStorage';
import '@/pages/AdminPanel/AdminPanel.scss';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';

const API_BASE = '/api';

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

const statusLabels: Record<RepositoryDocumentStatus, string> = {
  needs_revision: 'На доработке',
  under_review: 'На проверке',
  verified: 'Проверенный',
};

export default function RepositoryAdminPanel() {
  const { repositoryUser, loading } = useRepositoryAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<RepositoryUser[]>([]);
  const [pendingUsers, setPendingUsers] = useState<RepositoryUser[]>([]);
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocument[]>([]);
  const [pendingOrganizations, setPendingOrganizations] = useState<RepositoryOrganizationReference[]>([]);
  const [pendingAuthors, setPendingAuthors] = useState<RepositoryAuthorReference[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'review' | 'organizations' | 'authors'>('pending');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [revisionModalDocument, setRevisionModalDocument] = useState<ReviewDocument | null>(null);
  const [revisionCommentDraft, setRevisionCommentDraft] = useState('');
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info' | 'success';
    confirmText: string;
    onConfirm: () => void;
  }>(null);

  const requestConfig = () => ({
    headers: {
      Authorization: `Bearer ${getRepositoryToken() || ''}`,
    },
  });

  const fetchData = async () => {
    setPageLoading(true);
    try {
      const [usersResponse, pendingResponse, reviewResponse, organizationsResponse, authorsResponse] = await Promise.all([
        axios.get<{ users: RepositoryUser[] }>(`${API_BASE}/repository-admin/users`, requestConfig()),
        axios.get<{ users: RepositoryUser[] }>(`${API_BASE}/repository-admin/users/pending`, requestConfig()),
        axios.get<{ documents: ReviewDocument[] }>(`${API_BASE}/repository-admin/documents/review`, requestConfig()),
        axios.get<{ organizations: RepositoryOrganizationReference[] }>(`${API_BASE}/repository-admin/organizations/pending`, requestConfig()),
        axios.get<{ authors: RepositoryAuthorReference[] }>(`${API_BASE}/repository-admin/authors/pending`, requestConfig()),
      ]);
      setUsers(usersResponse.data.users);
      setPendingUsers(pendingResponse.data.users);
      setReviewDocuments(reviewResponse.data.documents);
      setPendingOrganizations(organizationsResponse.data.organizations);
      setPendingAuthors(authorsResponse.data.authors);
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка загрузки repository admin' });
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
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

  const approveUser = async (userId: number, role: 'user' | 'editor' | 'admin') => {
    try {
      await axios.put(`${API_BASE}/repository-admin/users/${userId}`, { role, status: 'active' }, requestConfig());
      setNotification({ type: 'success', text: `Роль ${role} выдана` });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || `Ошибка выдачи роли ${role}` });
    }
  };

  const updateUserStatus = async (userId: number, status: 'active' | 'blocked' | 'pending') => {
    try {
      await axios.put(`${API_BASE}/repository-admin/users/${userId}`, { status }, requestConfig());
      setNotification({ type: 'success', text: 'Статус пользователя обновлен' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка изменения статуса' });
    }
  };

  const deleteUser = async (userId: number) => {
    try {
      await axios.delete(`${API_BASE}/repository-admin/users/${userId}`, requestConfig());
      setNotification({ type: 'success', text: 'Пользователь удален' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка удаления' });
    }
  };

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
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка отправки документа на доработку' });
    }
  };

  const approveOrganization = async (organizationId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/organizations/${organizationId}/approve`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Организация одобрена' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка одобрения организации' });
    }
  };

  const rejectOrganization = async (organizationId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/organizations/${organizationId}/reject`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на организацию отклонена' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка отклонения организации' });
    }
  };

  const approveAuthor = async (authorId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/authors/${authorId}/approve`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Автор одобрен' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка одобрения автора' });
    }
  };

  const rejectAuthor = async (authorId: number) => {
    try {
      await axios.post(`${API_BASE}/repository-admin/authors/${authorId}/reject`, {}, requestConfig());
      setNotification({ type: 'success', text: 'Заявка на автора отклонена' });
      await fetchData();
    } catch (error: any) {
      setNotification({ type: 'error', text: error.message || 'Ошибка отклонения автора' });
    }
  };

  const confirmRoleChange = (user: RepositoryUser, nextRole: 'user' | 'editor' | 'admin') => {
    setConfirmAction({
      title: 'Изменение роли',
      message: `Выдать пользователю "${user.name}" роль ${nextRole}?`,
      variant: nextRole === 'admin' ? 'warning' : 'info',
      confirmText: 'Изменить',
      onConfirm: () => {
        void approveUser(user.id, nextRole);
        setConfirmAction(null);
      },
    });
  };

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
      onConfirm: () => {
        if (nextStatus === 'active') {
          void approveUser(user.id, user.role);
        } else {
          void updateUserStatus(user.id, nextStatus);
        }
        setConfirmAction(null);
      },
    });
  };

  const confirmDelete = (user: RepositoryUser) => {
    setConfirmAction({
      title: 'Удаление пользователя',
      message: `Удалить пользователя репозитория "${user.name}"? Это действие необратимо.`,
      variant: 'danger',
      confirmText: 'Удалить',
      onConfirm: () => {
        void deleteUser(user.id);
        setConfirmAction(null);
      },
    });
  };

  const confirmRevision = (document: ReviewDocument) => {
    setRevisionCommentDraft('');
    setRevisionModalDocument(document);
  };

  return (
    <div className='admin-panel'>
      <h1>Админ-панель репозитория</h1>

      {notification && (
        <div className={`admin-notification admin-notification--${notification.type}`}>
          {notification.text}
        </div>
      )}

      <div className='tabs'>
        <button type='button' className={`tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>
          Ожидают выдачи роли ({pendingUsers.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'review' ? 'active' : ''}`} onClick={() => setActiveTab('review')}>
          Проверка документов ({reviewDocuments.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'organizations' ? 'active' : ''}`} onClick={() => setActiveTab('organizations')}>
          Организации ({pendingOrganizations.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'authors' ? 'active' : ''}`} onClick={() => setActiveTab('authors')}>
          Авторы ({pendingAuthors.length})
        </button>
        <button type='button' className={`tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          Все пользователи ({users.length})
        </button>
      </div>

      <div className='tab-content'>
        {pageLoading ? (
          <div className='admin-panel loading'>Загрузка...</div>
        ) : activeTab === 'pending' ? (
          <div className='pending-users'>
            {pendingUsers.length === 0 ? (
              <p>Нет пользователей, ожидающих назначения роли.</p>
            ) : (
              <div className='users-grid'>
                {pendingUsers.map((user) => (
                  <div key={user.id} className='user-card'>
                    <h3>{user.name}</h3>
                    <p><strong>ФИО:</strong> {user.full_name || '—'}</p>
                    <p><strong>Email:</strong> {user.email}</p>
                    <p><strong>Организация:</strong> {user.organization}</p>
                    <p><strong>Должность:</strong> {user.position || '—'}</p>
                    <p><strong>Статус:</strong> {user.status}</p>
                    <div className='user-actions'>
                      <button type='button' className='btn-approve' onClick={() => confirmRoleChange(user, 'editor')}>Выдать editor</button>
                      <button type='button' className='btn-approve' onClick={() => confirmRoleChange(user, 'user')}>Выдать user</button>
                      <button type='button' className='btn-approve' onClick={() => confirmRoleChange(user, 'admin')}>Выдать admin</button>
                      <button type='button' className='btn-reject' onClick={() => confirmStatusChange(user, 'blocked')}>Заблокировать</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'organizations' ? (
          <div className='pending-users'>
            {pendingOrganizations.length === 0 ? (
              <p>Нет заявок на новые организации.</p>
            ) : (
              <div className='users-grid'>
                {pendingOrganizations.map((organization) => (
                  <div key={organization.id} className='user-card'>
                    <h3>{organization.name_ru}</h3>
                    <p><strong>Название (EN):</strong> {organization.name_en || '—'}</p>
                    <p><strong>Запросил:</strong> {organization.requester_name || 'Не указано'}</p>
                    <p><strong>Email:</strong> {organization.requester_email || 'Не указан'}</p>
                    <div className='user-actions'>
                      <button type='button' className='btn-approve' onClick={() => void approveOrganization(organization.id)}>Одобрить</button>
                      <button type='button' className='btn-reject' onClick={() => void rejectOrganization(organization.id)}>Отклонить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'authors' ? (
          <div className='pending-users'>
            {pendingAuthors.length === 0 ? (
              <p>Нет заявок на новых авторов.</p>
            ) : (
              <div className='users-grid'>
                {pendingAuthors.map((author) => (
                  <div key={author.id} className='user-card'>
                    <h3>{author.name_ru}</h3>
                    <p><strong>Автор (EN):</strong> {author.name_en}</p>
                    <p><strong>Запросил:</strong> {author.requester_name || 'Не указано'}</p>
                    <p><strong>Email:</strong> {author.requester_email || 'Не указан'}</p>
                    <p>
                      <strong>Организации:</strong>{' '}
                      {author.organizations.length > 0
                        ? author.organizations.map((organization) => organization.name_ru).join(', ')
                        : 'Не указаны'}
                    </p>
                    <div className='user-actions'>
                      <button type='button' className='btn-approve' onClick={() => void approveAuthor(author.id)}>Одобрить</button>
                      <button type='button' className='btn-reject' onClick={() => void rejectAuthor(author.id)}>Отклонить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'review' ? (
          <div className='pending-users'>
            {reviewDocuments.length === 0 ? (
              <p>Нет документов на проверке.</p>
            ) : (
              <div className='users-grid'>
                {reviewDocuments.map((document) => (
                  <div key={document.id} className='user-card'>
                    <h3>{document.name}</h3>
                    <p><strong>Статус:</strong> {statusLabels[document.documentStatus]}</p>
                    <p><strong>Тип документа:</strong> {document.documentType || 'Не указан'}</p>
                    <p><strong>Заполнитель:</strong> {document.creatorName || 'Не указан'}</p>
                    <p><strong>Email заполнителя:</strong> {document.creatorEmail || 'Не указан'}</p>
                    <p><strong>Раздел:</strong> {document.parentPath.length ? document.parentPath.join(' / ') : 'Корневой каталог'}</p>
                    <p><strong>Отправлен на проверку:</strong> {document.reviewRequestedAt ? new Date(document.reviewRequestedAt).toLocaleString('ru-RU') : '—'}</p>
                    <div className='user-actions'>
                      <button type='button' className='btn-approve' onClick={() => navigate(`/repository/edit#${document.id}`)}>
                        Открыть документ
                      </button>
                      <button type='button' className='btn-reject' onClick={() => confirmRevision(document)}>
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
                {users.map((user) => (
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
                        onChange={(event) => confirmRoleChange(user, event.target.value as 'user' | 'editor' | 'admin')}
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
                        onChange={(event) => confirmStatusChange(user, event.target.value as 'active' | 'blocked' | 'pending')}
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
                        onClick={() => confirmDelete(user)}
                        disabled={user.id === repositoryUser.id}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={confirmAction !== null}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'info'}
        confirmText={confirmAction?.confirmText || 'Подтвердить'}
        onConfirm={confirmAction?.onConfirm || (() => {})}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmModal
        isOpen={revisionModalDocument !== null}
        title='Отправить на доработку'
        message={revisionModalDocument ? `Вернуть документ "${revisionModalDocument.name}" на доработку автору?` : ''}
        variant='warning'
        confirmText='Отправить'
        cancelText='Отмена'
        onConfirm={() => {
          if (!revisionModalDocument) {
            return;
          }
          void sendDocumentToRevision(revisionModalDocument.id, revisionCommentDraft);
        }}
        onCancel={() => {
          setRevisionModalDocument(null);
          setRevisionCommentDraft('');
        }}
      >
        <label className='admin-panel__revision-comment-field'>
          Комментарий для доработки
          <textarea
            className='admin-panel__revision-comment-textarea'
            value={revisionCommentDraft}
            onChange={(event) => setRevisionCommentDraft(event.target.value)}
            placeholder='Укажите замечания для автора документа'
            maxLength={2000}
          />
        </label>
      </ConfirmModal>
    </div>
  );
}
