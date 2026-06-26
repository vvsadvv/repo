import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { repositoryAuthService } from '@/services/repositoryAuthService';
import type { RepositoryAuthFieldErrors, RepositoryPasswordResponse, RepositoryUser } from '@/types/repositoryAuth';
import {
  clearRepositoryToken,
  clearStoredRepositoryUser,
  getRepositoryToken,
  getStoredRepositoryUser,
  hasRepositoryToken,
  notifyRepositoryAuthInvalid,
  REPOSITORY_AUTH_INVALID_EVENT,
  setRepositoryToken,
  setStoredRepositoryUser,
} from '@/utils/repositoryAuthStorage';
import { getApiErrorDetails } from '@/utils/apiErrors';

type RepositoryActionFailure = {
  success: false;
  message: string;
  fieldErrors?: RepositoryAuthFieldErrors;
  retryAfterSeconds?: number;
};

type RepositoryLoginResult =
  | { success: true; message?: string; user: RepositoryUser }
  | RepositoryActionFailure;

type RepositoryRegisterResult =
  | { success: true; message?: string; user: RepositoryUser }
  | RepositoryActionFailure;

interface RepositoryAuthContextType {
  repositoryUser: RepositoryUser | null;
  loading: boolean;
  isRepositoryAdmin: boolean;
  canEditRepository: boolean;
  login: (credentials: { login: string; password: string }) => Promise<RepositoryLoginResult>;
  register: (payload: {
    name: string;
    fullName: string;
    email: string;
    organization: string;
    organizationId?: number | null;
    position: string;
    personalDataConsent: boolean;
    password: string;
    confirmPassword: string;
  }) => Promise<RepositoryRegisterResult>;
  forgotPassword: (email: string) => Promise<RepositoryPasswordResponse>;
  verifyResetToken: (token: string) => Promise<RepositoryPasswordResponse>;
  resetPassword: (token: string, newPassword: string) => Promise<RepositoryPasswordResponse>;
  refreshProfile: () => Promise<RepositoryUser | null>;
  logout: () => void;
}

const RepositoryAuthContext = createContext<RepositoryAuthContextType | undefined>(undefined);

/* Делает: Инкапсулирует логику React-хука useRepositoryAuth и возвращает связанные данные или обработчики. Применение: экспортируется из модуля src/contexts/RepositoryAuthContext.tsx и используется React-компонентами проекта. */
export const useRepositoryAuth = () => {
  const context = useContext(RepositoryAuthContext);
  if (!context) {
    throw new Error('useRepositoryAuth must be used within a RepositoryAuthProvider');
  }
  return context;
};

/* Делает: Выполняет to repository action failure. Применение: используется локально в файле src/contexts/RepositoryAuthContext.tsx. */
function toRepositoryActionFailure(error: unknown, fallbackMessage: string): RepositoryActionFailure {
  const details = getApiErrorDetails(error, fallbackMessage);
  return {
    success: false,
    message: details.message,
    fieldErrors: details.fieldErrors as RepositoryAuthFieldErrors | undefined,
    retryAfterSeconds: details.retryAfterSeconds,
  };
}

/* Делает: Рендерит React-компонент RepositoryAuthProvider и связывает его с состоянием и обработчиками модуля. Применение: экспортируется из модуля и используется UI-кодом проекта. */
export function RepositoryAuthProvider({ children }: { children: ReactNode }) {
  const [repositoryUser, setRepositoryUser] = useState<RepositoryUser | null>(null);
  const [repositoryTokenPresent, setRepositoryTokenPresent] = useState(hasRepositoryToken());
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(/* Делает: Создаёт мемоизированный обработчик для React-компонента. Применение: передаётся как callback в useCallback внутри RepositoryAuthProvider. */ async () => {
    const token = getRepositoryToken();

    if (!token) {
      clearStoredRepositoryUser();
      setRepositoryUser(null);
      setRepositoryTokenPresent(false);
      return null;
    }

    try {
      const profile = await repositoryAuthService.getProfile();
      setRepositoryUser(profile.user);
      setStoredRepositoryUser(profile.user);
      setRepositoryTokenPresent(true);
      return profile.user;
    } catch {
      const tokenStillPresent = hasRepositoryToken();
      const currentStoredUser = getStoredRepositoryUser();
      setRepositoryUser(tokenStillPresent ? currentStoredUser : null);
      setRepositoryTokenPresent(tokenStillPresent);
      return tokenStillPresent ? currentStoredUser : null;
    }
  }, []);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryAuthProvider. */ () => {
        /* Делает: Выполняет initialize. Применение: используется внутри функции useEffectCallback. */
    const initialize = async () => {
      const token = getRepositoryToken();
      const savedUser = getStoredRepositoryUser();

      if (!token) {
        clearStoredRepositoryUser();
        setRepositoryTokenPresent(false);
        setRepositoryUser(null);
        setLoading(false);
        return;
      }

      if (savedUser) {
        setRepositoryUser(savedUser);
        setRepositoryTokenPresent(true);
      }

      try {
        await refreshProfile();
      } finally {
        setLoading(false);
      }
    };

    void initialize();
  }, [refreshProfile]);

    /* Делает: Выполняет вход. Применение: используется внутри функции RepositoryAuthProvider. */
  const login: RepositoryAuthContextType['login'] = async (credentials) => {
    try {
      const result = await repositoryAuthService.login(credentials);
      if (!result.success || !result.user || !result.token) {
        return {
          success: false,
          message: result.message || 'Ошибка входа в репозиторий',
          fieldErrors: result.fieldErrors,
          retryAfterSeconds: result.retryAfterSeconds,
        };
      }

      setRepositoryToken(result.token);
      setStoredRepositoryUser(result.user);
      setRepositoryUser(result.user);
      setRepositoryTokenPresent(true);
      return { success: true, user: result.user, message: result.message };
    } catch (error) {
      return toRepositoryActionFailure(error, 'Ошибка входа в репозиторий');
    }
  };

    /* Делает: Выполняет register. Применение: используется внутри функции RepositoryAuthProvider. */
  const register: RepositoryAuthContextType['register'] = async (payload) => {
    try {
      const result = await repositoryAuthService.register(payload);
      if (!result.success || !result.user) {
        return {
          success: false,
          message: result.message || 'Ошибка регистрации в репозитории',
          fieldErrors: result.fieldErrors,
          retryAfterSeconds: result.retryAfterSeconds,
        };
      }
      return { success: true, user: result.user, message: result.message };
    } catch (error) {
      return toRepositoryActionFailure(error, 'Ошибка регистрации в репозитории');
    }
  };

    /* Делает: Выполняет пароль forgot. Применение: используется внутри функции RepositoryAuthProvider. */
  const forgotPassword: RepositoryAuthContextType['forgotPassword'] = async (email) => {
    try {
      return await repositoryAuthService.forgotPassword(email);
    } catch (error) {
      return toRepositoryActionFailure(error, 'Ошибка восстановления пароля');
    }
  };

    /* Делает: Проверяет токен сброса. Применение: используется внутри функции RepositoryAuthProvider. */
  const verifyResetToken: RepositoryAuthContextType['verifyResetToken'] = async (token) => {
    try {
      return await repositoryAuthService.verifyResetToken(token);
    } catch (error) {
      return toRepositoryActionFailure(error, 'Ошибка проверки токена');
    }
  };

    /* Делает: Выполняет пароль сброса. Применение: используется внутри функции RepositoryAuthProvider. */
  const resetPassword: RepositoryAuthContextType['resetPassword'] = async (token, newPassword) => {
    try {
      return await repositoryAuthService.resetPassword(token, newPassword);
    } catch (error) {
      return toRepositoryActionFailure(error, 'Ошибка смены пароля');
    }
  };

    /* Делает: Выполняет logout. Применение: используется внутри функции RepositoryAuthProvider. */
  const logout = () => {
    clearRepositoryToken();
    clearStoredRepositoryUser();
    setRepositoryUser(null);
    setRepositoryTokenPresent(false);
  };

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryAuthProvider. */ () => {
        /* Делает: Обрабатывает хранилище. Применение: используется внутри функции useEffectCallback. */
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== 'repository_token' && event.key !== 'repository_user') {
        return;
      }

      const tokenPresent = hasRepositoryToken();
      const storedUser = getStoredRepositoryUser();
      setRepositoryTokenPresent(tokenPresent);

      if (!tokenPresent) {
        setRepositoryUser(null);
        return;
      }

      if (storedUser) {
        setRepositoryUser(storedUser);
      }
    };

    window.addEventListener('storage', handleStorage);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(/* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри RepositoryAuthProvider. */ () => {
        /* Делает: Обрабатывает auth invalid. Применение: используется внутри функции useEffectCallback. */
    const handleAuthInvalid = () => {
      clearRepositoryToken();
      clearStoredRepositoryUser();
      setRepositoryUser(null);
      setRepositoryTokenPresent(false);
    };

    window.addEventListener(REPOSITORY_AUTH_INVALID_EVENT, handleAuthInvalid);
    return /* Делает: Выполняет побочный эффект и синхронизирует состояние компонента. Применение: передаётся как callback в useEffect внутри useEffectCallback. */ () => window.removeEventListener(REPOSITORY_AUTH_INVALID_EVENT, handleAuthInvalid);
  }, []);

  const value = useMemo(
    /* Делает: Вычисляет мемоизированное значение для компонента. Применение: передаётся как callback в useMemo внутри RepositoryAuthProvider. */ () => ({
      repositoryUser,
      loading,
      isRepositoryAdmin: repositoryTokenPresent && repositoryUser?.role === 'admin',
      canEditRepository:
        repositoryTokenPresent &&
        (repositoryUser?.role === 'admin' || repositoryUser?.role === 'editor' || repositoryUser?.role === 'user'),
      login,
      register,
      forgotPassword,
      verifyResetToken,
      resetPassword,
      refreshProfile,
      logout,
    }),
    [repositoryUser, repositoryTokenPresent, loading, refreshProfile]
  );

  return <RepositoryAuthContext.Provider value={value}>{children}</RepositoryAuthContext.Provider>;
}
