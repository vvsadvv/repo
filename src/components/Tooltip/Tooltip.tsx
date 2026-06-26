import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.scss';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/* Делает: Рендерит React-компонент Tooltip и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function Tooltip({ content, children, className = '', ariaLabel = 'Показать подсказку' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12 });

    /* Делает: Проверяет возможность cel close. Применение: используется внутри функции Tooltip. */
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

    /* Делает: Открывает tooltip. Применение: используется внутри функции Tooltip. */
  const openTooltip = () => {
    cancelClose();
    setIsOpen(true);
  };

    /* Делает: Выполняет schedule close. Применение: используется внутри функции Tooltip. */
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(/* Делает: Запускает отложенное действие по таймеру. Применение: передаётся как callback в setTimeout внутри scheduleClose. */ () => setIsOpen(false), 120);
  };

  const updatePosition = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри Tooltip. */ () => {
    const trigger = triggerRef.current;
    const tooltip = contentRef.current;
    if (!trigger || !tooltip) {
      return;
    }

    const viewportPadding = 12;
    const gap = 10;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maxLeft = Math.max(viewportPadding, window.innerWidth - tooltipRect.width - viewportPadding);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2),
      maxLeft
    );
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - tooltipRect.height - gap;
    const top = belowTop + tooltipRect.height <= window.innerHeight - viewportPadding || aboveTop < viewportPadding
      ? Math.min(belowTop, window.innerHeight - tooltipRect.height - viewportPadding)
      : aboveTop;

    setPosition({ left, top: Math.max(viewportPadding, top) });
  }, []);

  useLayoutEffect(/* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в useLayoutEffect внутри Tooltip. */ () => {
    if (isOpen) {
      updatePosition();
    }
  }, [content, isOpen, updatePosition]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри Tooltip. */ () => {
    if (!isOpen) {
      return undefined;
    }

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри Tooltip. */ () => /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => cancelClose(), []);

  return (
    <span
      ref={triggerRef}
      className={`ui-tooltip-trigger ${className}`.trim()}
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleClose}
      onFocus={openTooltip}
      onBlur={scheduleClose}
      onKeyDown={/* Делает: Обрабатывает событие onKeyDown в JSX-разметке. Применение: используется как inline-обработчик onKeyDown внутри файла src/components/Tooltip/Tooltip.tsx. */ (event) => {
        if (event.key === 'Escape') {
          cancelClose();
          setIsOpen(false);
        }
      }}
    >
      {children}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={contentRef}
              className='ui-tooltip-content'
              role='tooltip'
              style={position}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

/* Делает: Рендерит React-компонент FieldHelp и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export function FieldHelp({ text, ariaLabel }: { text: ReactNode; ariaLabel?: string }) {
  const resolvedAriaLabel = ariaLabel || (typeof text === 'string' ? `Пояснение: ${text}` : 'Показать пояснение');

  return (
    <Tooltip content={text} className='ui-field-help' ariaLabel={resolvedAriaLabel}>
      <span aria-hidden='true'>?</span>
    </Tooltip>
  );
}
