import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ConfirmModal from '@/components/ConfirmModal/ConfirmModal';
import { useRepositoryAuth } from '@/contexts/RepositoryAuthContext';
import './RepositoryInstruction.scss';

function RepositoryInstruction() {
  const navigate = useNavigate();
  const location = useLocation();
  const { canEditRepository, repositoryUser } = useRepositoryAuth();
  const [authRequiredModalOpen, setAuthRequiredModalOpen] = useState(false);

  const handleProtectedActionClick = () => {
    if (canEditRepository) {
      return;
    }

    setAuthRequiredModalOpen(true);
  };

  const handleGoToRegistration = () => {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    setAuthRequiredModalOpen(false);
    navigate('/repository/registration', { state: { from: returnTo } });
  };

  const registrationRequiredMessage = repositoryUser
    ? 'Для доступа к разделам добавления и редактирования нужна учетная запись пользователя, editor или admin. Если доступ ещё не выдан, обратитесь к администратору репозитория.'
    : 'Для доступа к разделам добавления и редактирования необходимо зарегистрироваться и войти в репозиторий.';

  return (
    <section className='repository-instruction'>
      <div className='repository-instruction__container'>
        <header className='repository-instruction__hero'>
          <h1>Инструкция по заполнению документа</h1>
          <p>
            На этой странице собраны примеры, как корректно заполнить метаданные и блоки контента
            перед сохранением и отправкой на проверку.
          </p>
        </header>

        <article className='repository-instruction__card'>
          <h2>1. Пример заполнения обязательных полей Metadata</h2>
          <div className='repository-instruction__table'>
            <div className='repository-instruction__row repository-instruction__row--head'>
              <span>Поле</span>
              <span>Пример значения</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Аннотация / Annotation</span>
              <span>Каталог локальных сейсмических событий в районе Камчатки за 2020-2024 гг.</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Аннотация (EN) / Annotation (EN)</span>
              <span>
                Catalogue of local seismic events in the Kamchatka region for 2020-2024, including reviewed picks and
                event parameters.
              </span>
            </div>
            <div className='repository-instruction__row'>
              <span>Дата публикации / Publication Date</span>
              <span>2026-04-16</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Авторы (RU) / Authors (RU)</span>
              <span>Иванов И.И.; Петров П.П.</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Авторы (EN) / Authors (EN)</span>
              <span>Ivanov I.I.; Petrov P.P.</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Аффилиации / Affiliations</span>
              <span>ФИЦ ЕГС РАН, Обнинск, Россия; ИФЗ РАН, Москва, Россия</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Организация (RU) / Organization (RU)</span>
              <span>Федеральный исследовательский центр «Единая геофизическая служба РАН»</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Организация (EN) / Organization (EN)</span>
              <span>Geophysical Survey of the Russian Academy of Sciences</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Тип документа / Document Type</span>
              <span>Event catalogue</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Название (EN) / Title (EN)</span>
              <span>Kamchatka Local Seismic Events Catalogue 2020-2024</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Тип записи / Record Type</span>
              <span>dataset</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Код издания / Journal Code</span>
              <span>rjs</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Том / Volume</span>
              <span>2</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Номер статьи / Article Number</span>
              <span>02</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Ссылка для цитирования / Citation Link</span>
              <span>https://repo.gsras.ru/repository/document/kamchatka-local-events-2020-2024</span>
            </div>
            <div className='repository-instruction__row'>
              <span>Лицензия / License</span>
              <span>CC BY 4.0</span>
            </div>
          </div>
          <p className='repository-instruction__hint'>
            Примечание: поля <strong>DOI</strong> и <strong>Crossref XML</strong> заполняются системой
            автоматически и не требуют ручного ввода.
          </p>
        </article>

        <article className='repository-instruction__card'>
          <h2>2. Пример структуры блоков документа</h2>
          <ul className='repository-instruction__list'>
            <li>
              <strong>Блок 1 (text):</strong> Краткое описание набора данных, география, период наблюдений.
            </li>
            <li>
              <strong>Блок 2 (image):</strong> Карта станций или иллюстрация (подпись: «Расположение станций»).
            </li>
            <li>
              <strong>Блок 3 (file):</strong> Основной архив данных (например, `dataset_v1.zip`).
            </li>
            <li>
              <strong>Блок 4 (link):</strong> Внешняя публикация или проектный сайт.
            </li>
          </ul>
        </article>

        <article className='repository-instruction__card'>
          <h2>3. Мини-чеклист перед сохранением</h2>
          <ol className='repository-instruction__list repository-instruction__list--ordered'>
            <li>Заполнены все обязательные поля metadata.</li>
            <li>Дата публикации указана в формате YYYY-MM-DD.</li>
            <li>Русские и английские поля согласованы по смыслу.</li>
            <li>Ссылка для цитирования и лицензия заполнены без опечаток.</li>
            <li>После сохранения появилась ссылка representation_xml и XML открывается.</li>
            <li>В блоках нет битых ссылок и пустых файлов.</li>
          </ol>
        </article>

        <div className='repository-instruction__actions'>
          {canEditRepository ? (
            <>
              <Link to='/repository/add' className='repository-instruction__button'>
                Перейти к добавлению
              </Link>
              <Link to='/repository/edit' className='repository-instruction__button repository-instruction__button--ghost'>
                Перейти к редактированию
              </Link>
            </>
          ) : (
            <>
              <button type='button' className='repository-instruction__button' onClick={handleProtectedActionClick}>
                Перейти к добавлению
              </button>
              <button
                type='button'
                className='repository-instruction__button repository-instruction__button--ghost'
                onClick={handleProtectedActionClick}
              >
                Перейти к редактированию
              </button>
            </>
          )}
        </div>
      </div>
      <ConfirmModal
        isOpen={authRequiredModalOpen}
        title='Требуется регистрация'
        message={registrationRequiredMessage}
        variant='warning'
        confirmText={repositoryUser ? 'Понятно' : 'Перейти к регистрации'}
        cancelText='Закрыть'
        showCancel={!repositoryUser}
        onConfirm={repositoryUser ? () => setAuthRequiredModalOpen(false) : handleGoToRegistration}
        onCancel={() => setAuthRequiredModalOpen(false)}
      />
    </section>
  );
}

export default RepositoryInstruction;
