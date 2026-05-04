import './Button.scss'

interface ButtonProps {
  aim: string;
  content: string;
  form?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: () => void;
}

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