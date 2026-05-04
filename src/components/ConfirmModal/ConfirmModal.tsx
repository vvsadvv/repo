import React from 'react';
import './ConfirmModal.scss';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  showCancel?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  variant = 'info',
  showCancel = true,
  children,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
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
