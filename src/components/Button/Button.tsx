import './Button.scss'

interface ButtonProps {
  aim: string;
  content: string;
  form?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: () => void;
}

/* Делает: Рендерит React-компонент Button и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
function Button({ aim, content, form, type = 'button', disabled, onClick}: ButtonProps) {
  return (
    <button 
      disabled={disabled} 
      onClick={onClick} 
      form={form} 
      type={type} 
      className={`button ${aim}__button`}
    >
      {content}
    </button>
  );
}

export default Button;