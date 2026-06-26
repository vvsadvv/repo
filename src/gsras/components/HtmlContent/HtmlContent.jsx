import { useEffectEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import './HtmlContent.scss';

/* Делает: Рендерит React-компонент HtmlContent и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function HtmlContent({ html, className = '' }) {
  const navigate = useNavigate();

  const handleNativeLinkClick = useEffectEvent(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в useEffectEvent внутри HtmlContent. */ (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const anchor = target.closest('a[data-native-link="true"]');

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const href = anchor.getAttribute('href');

    if (!href || !href.startsWith('/')) {
      return;
    }

    event.preventDefault();
    navigate(href);
  });

  if (!html) {
    return null;
  }

  return (
    <div
      className={`html-content ${className}`.trim()}
      onClick={handleNativeLinkClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

