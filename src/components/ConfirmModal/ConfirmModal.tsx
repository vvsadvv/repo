import React from 'react';
import './ConfirmModal.scss';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  showCancel?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

/* Делает: Рендерит React-компонент ConfirmModal и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  secondaryText = '',
  variant = 'info',
  showCancel = true,
  children,
  onConfirm,
  onCancel,
  onSecondary,
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/components/ConfirmModal/ConfirmModal.tsx. */ (e) => e.stopPropagation()}>
        <h3 className={`confirm-modal__title confirm-modal__title--${variant}`}>
          {title}
        </h3>
        <p className="confirm-modal__message">{message}</p>
        {children ? <div className="confirm-modal__extra">{children}</div> : null}
        <div className="confirm-modal__actions">
          {showCancel && (
            <button className="confirm-modal__btn confirm-modal__btn--cancel" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          {secondaryText && onSecondary && (
            <button className="confirm-modal__btn confirm-modal__btn--secondary" onClick={onSecondary}>
              {secondaryText}
            </button>
          )}
          <button
            className={`confirm-modal__btn confirm-modal__btn--${variant}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
