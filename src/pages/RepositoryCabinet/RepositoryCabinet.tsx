import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import { repositoryService } from '@/services/repositoryService';
import type { RepositoryDocumentStatus, RepositoryDocumentSummary } from '@/types/repository';
import './RepositoryCabinet.scss';

const DOCUMENT_STATUS_LABELS: Record<RepositoryDocumentStatus, string> = {
  needs_revision: 'На доработке',
  under_review: 'На проверке',
  verified: 'Проверенный',
};

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase();
}

function formatUpdatedAt(value?: string) {
  if (!value) {
    return '\u2014';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '\u2014';
  }

  return parsed.toLocaleString('ru-RU');
}

function buildWorkspaceDocumentPath(documentId: string) {
  return `/repository/workspace#${documentId}`;
}

export default function RepositoryCabinet() {
  const location = useLocation();
  const { repositoryUser, loading: authLoading } = useRepositoryAuth();
  const [documents, setDocuments] = useState<RepositoryDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repositoryUser) {
      setDocuments([]);
      setLoading(false);
      setError(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await repositoryService.getRepository();
        setDocuments(data.documents || []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить документы пользователя.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [repositoryUser]);

  const userEmail = normalizeText(repositoryUser?.email);
  const userName = normalizeText(repositoryUser?.name);
  const userFullName = normalizeText(repositoryUser?.full_name || undefined);

  const userDocuments = useMemo(() => {
    return documents
      .filter((document) => {
        const creatorEmail = normalizeText(document.meta?.creatorEmail || document.creatorEmail);
        const reviewEditorEmail = normalizeText(document.meta?.reviewEditorEmail);
        const creatorName = normalizeText(document.meta?.creatorName || document.creatorName);
        const reviewEditorName = normalizeText(document.meta?.reviewEditorName);

        if (userEmail && (creatorEmail === userEmail || reviewEditorEmail === userEmail)) {
          return true;
        }

        if (userFullName && (creatorName === userFullName || reviewEditorName === userFullName)) {
          return true;
        }

        return Boolean(userName && (creatorName === userName || reviewEditorName === userName));
      })
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.meta?.publicationDate || '') || 0;
        const rightTime = Date.parse(right.updatedAt || right.meta?.publicationDate || '') || 0;
        return rightTime - leftTime;
      });
  }, [documents, userEmail, userFullName, userName]);

  const statusCounters = useMemo(() => {
    return userDocuments.reduce(
      (acc, document) => {
        const status = document.documentStatus || 'needs_revision';
        acc.total += 1;
        if (status === 'under_review') {
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
        needsRevision: 0,
        underReview: 0,
        verified: 0,
      }
    );
  }, [userDocuments]);

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
          Здесь отображаются документы, которые вы заполняли в репозитории.
        </p>

        <div className='repository-cabinet__stats'>
          <div className='repository-cabinet__stat'>
            <span>Всего</span>
            <strong>{statusCounters.total}</strong>
          </div>
          <div className='repository-cabinet__stat'>
            <span>На доработке</span>
            <strong>{statusCounters.needsRevision}</strong>
          </div>
          <div className='repository-cabinet__stat'>
            <span>На проверке</span>
            <strong>{statusCounters.underReview}</strong>
          </div>
          <div className='repository-cabinet__stat'>
            <span>Проверенные</span>
            <strong>{statusCounters.verified}</strong>
          </div>
        </div>

        {loading && <div className='repository-cabinet__state'>Загрузка...</div>}
        {error && <div className='repository-cabinet__state repository-cabinet__state--error'>{error}</div>}

        {!loading && !error && userDocuments.length === 0 && (
          <div className='repository-cabinet__state'>По вашему профилю пока нет заполненных документов.</div>
        )}

        {!loading && !error && userDocuments.length > 0 && (
          <div className='repository-cabinet__table-wrap'>
            <table className='repository-cabinet__table'>
              <thead>
                <tr>
                  <th>Документ</th>
                  <th>Статус</th>
                  <th>Дата публикации</th>
                  <th>Обновлён</th>
                </tr>
              </thead>
              <tbody>
                {userDocuments.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <Link to={buildWorkspaceDocumentPath(document.id)} className='repository-cabinet__document-link'>
                        {document.name}
                      </Link>
                    </td>
                    <td>{DOCUMENT_STATUS_LABELS[document.documentStatus || 'needs_revision']}</td>
                    <td>{document.meta?.publicationDate || '\u2014'}</td>
                    <td>{formatUpdatedAt(document.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
