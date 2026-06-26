import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterSelectableItems } from '@/utils/search';
import './SearchableSelect.scss';

export interface SearchableSelectOption {
  id: string;
  label: string;
  description?: string;
  searchValues?: unknown[];
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onSelect: (value: string) => void;
  onQueryChange?: (query: string) => void;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
  inputClassName?: string;
}

/* Делает: Рендерит React-компонент SearchableSelect и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export default function SearchableSelect({
  options,
  value,
  onSelect,
  onQueryChange,
  placeholder,
  emptyText,
  disabled = false,
  inputClassName = '',
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [hasTypedSinceFocus, setHasTypedSinceFocus] = useState(false);

  const selectedOption = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри SearchableSelect. */ () => options.find(/* Делает: Проверяет, подходит ли элемент под условие поиска. Применение: передаётся как callback в find внутри useMemoCallback. */ (option) => option.id === value) || null,
    [options, value]
  );

  const effectiveQuery = !hasTypedSinceFocus && selectedOption && query === selectedOption.label ? '' : query;

  const filteredOptions = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри SearchableSelect. */ () =>
      filterSelectableItems(
        options,
        effectiveQuery,
        /* Делает: Выполняет локальный callback в текущем вызове. Применение: передаётся как callback в filterSelectableItems внутри useMemoCallback. */ (option) => [option.label, option.description, ...(option.searchValues || [])],
        value
      ),
    [effectiveQuery, options, value]
  );

  const displayValue = query || selectedOption?.label || '';

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри SearchableSelect. */ () => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);

  const updateQuery = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри SearchableSelect. */ (nextQuery: string) => {
    setQuery(nextQuery);
    onQueryChangeRef.current?.(nextQuery);
  }, []);

    /* Делает: Закрывает menu. Применение: используется внутри функции SearchableSelect. */
  const closeMenu = (restoreSelectedLabel: boolean) => {
    setIsOpen(false);
    setHasTypedSinceFocus(false);

    if (restoreSelectedLabel && selectedOption && query && query !== selectedOption.label) {
      updateQuery('');
    }
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри SearchableSelect. */ () => {
    if (value) {
      updateQuery('');
      setHasTypedSinceFocus(false);
    }
  }, [updateQuery, value]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри SearchableSelect. */ () => {
    if (!disabled) {
      return undefined;
    }

    setIsOpen(false);
    return undefined;
  }, [disabled]);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри SearchableSelect. */ () => {
        /* Делает: Обрабатывает pointer down. Применение: используется внутри функции useEffectCallback. */
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeMenu(true);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => document.removeEventListener('mousedown', handlePointerDown);
  });

  return (
    <div ref={containerRef} className={`searchable-select${disabled ? ' searchable-select--disabled' : ''}`}>
      <div className={`searchable-select__control${isOpen ? ' searchable-select__control--open' : ''}`}>
        <input
          ref={inputRef}
          type='text'
          className={`searchable-select__input ${inputClassName}`.trim()}
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete='off'
          onFocus={/* Делает: Обрабатывает событие onFocus в JSX-разметке. Применение: используется как inline-обработчик onFocus внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ (event) => {
            setIsOpen(true);
            setHasTypedSinceFocus(false);

            if (!query && selectedOption) {
              event.currentTarget.select();
              updateQuery(selectedOption.label);
            }
          }}
          onChange={/* Делает: Обрабатывает событие onChange в JSX-разметке. Применение: используется как inline-обработчик onChange внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ (event) => {
            const nextValue = event.target.value;
            updateQuery(nextValue);
            setHasTypedSinceFocus(true);
            setIsOpen(true);

            if (nextValue.trim() === '' && value) {
              onSelect('');
            }
          }}
          onKeyDown={/* Делает: Обрабатывает событие onKeyDown в JSX-разметке. Применение: используется как inline-обработчик onKeyDown внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ (event) => {
            if (event.key === 'Escape') {
              closeMenu(true);
              inputRef.current?.blur();
            }
          }}
        />
        <button
          type='button'
          className='searchable-select__toggle'
          aria-label='Показать варианты'
          disabled={disabled}
          onMouseDown={/* Делает: Обрабатывает событие onMouseDown в JSX-разметке. Применение: используется как inline-обработчик onMouseDown внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ (event) => event.preventDefault()}
          onClick={/* Делает: Обрабатывает событие onClick в JSX-разметке. Применение: используется как inline-обработчик onClick внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ () => {
            const nextOpen = !isOpen;
            setIsOpen(nextOpen);
            setHasTypedSinceFocus(false);

            if (nextOpen) {
              inputRef.current?.focus();
              if (!query && selectedOption) {
                updateQuery(selectedOption.label);
                inputRef.current?.select();
              }
            } else {
              closeMenu(true);
            }
          }}
        >
          <span className='searchable-select__chevron' aria-hidden='true' />
        </button>
      </div>

      {isOpen && (
        <div className='searchable-select__menu'>
          {filteredOptions.length > 0 ? (
            filteredOptions.map(/* Делает: Преобразует элемент коллекции в новое значение. Применение: передаётся как callback в map внутри SearchableSelect. */ (option) => (
              <button
                key={option.id}
                type='button'
                className={`searchable-select__option${option.id === value ? ' searchable-select__option--selected' : ''}`}
                onMouseDown={/* Делает: Обрабатывает событие onMouseDown в JSX-разметке. Применение: используется как inline-обработчик onMouseDown внутри файла src/components/SearchableSelect/SearchableSelect.tsx. */ (event) => {
                  event.preventDefault();
                  onSelect(option.id);
                  updateQuery('');
                  setIsOpen(false);
                  setHasTypedSinceFocus(false);
                }}
              >
                <span className='searchable-select__option-label'>{option.label}</span>
                {option.description && <span className='searchable-select__option-description'>{option.description}</span>}
              </button>
            ))
          ) : (
            <div className='searchable-select__empty'>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
