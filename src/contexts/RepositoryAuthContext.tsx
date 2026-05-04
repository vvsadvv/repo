import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { repositoryAuthService } from '@/services/repositoryAuthService';
import type { RepositoryUser } from '@/types/repositoryAuth';
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

interface RepositoryAuthContextType {
  repositoryUser: RepositoryUser | null;
  loading: boolean;
  isRepositoryAdmin: boolean;
  canEditRepository: boolean;
  login: (credentials: { login: string; password: string }) => Promise<{ success: boolean; message?: string; user?: RepositoryUser }>;
  register: (payload: {
    name: string;
    fullName: string;
    email: string;
    organization: string;
    organizationId?: number | null;
    position: string;
    password: string;
    confirmPassword: string;
  }) => Promise<{ success: boolean; message?: string; user?: RepositoryUser }>;
  forgotPassword: (email: string) => Promise<{ success: boolean; message?: string }>;
  verifyResetToken: (token: string) => Promise<{ success: boolean; message?: string; email?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ success: boolean; message?: string }>;
  refreshProfile: () => Promise<RepositoryUser | null>;
  logout: () => void;
}

const RepositoryAuthContext = createContext<RepositoryAuthContextType | undefined>(undefined);

export const useRepositoryAuth = () => {
  const context = useContext(RepositoryAuthContext);
  if (!context) {
    throw new Error('useRepositoryAuth must be used within a RepositoryAuthProvider');
  }
  return context;
};

export function RepositoryAuthProvider({ children }: { children: ReactNode }) {
  const [repositoryUser, setRepositoryUser] = useState<RepositoryUser | null>(null);
  const [repositoryTokenPresent, setRepositoryTokenPresent] = useState(hasRepositoryToken());
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
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

  useEffect(() => {
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

  const login: RepositoryAuthContextType['login'] = async (credentials) => {
    try {
      const result = await repositoryAuthService.login(credentials);
      if (!result.success || !result.user || !result.token) {
        return { success: false, message: result.message || 'Ошибка входа в репозиторий' };
      }

      setRepositoryToken(result.token);
      setStoredRepositoryUser(result.user);
      setRepositoryUser(result.user);
      setRepositoryTokenPresent(true);
      return { success: true, user: result.user };
    } catch (error: any) {
      return { success: false, message: error.message || 'Ошибка входа в репозиторий' };
    }
  };

  const register: RepositoryAuthContextType['register'] = async (payload) => {
    try {
      const result = await repositoryAuthService.register(payload);
      if (!result.success || !result.user) {
        return { success: false, message: result.message || 'Ошибка регистрации в репозитории' };
      }
      return { success: true, user: result.user, message: result.message };
    } catch (error: any) {
      return { success: false, message: error.message || 'Ошибка регистрации в репозитории' };
    }
  };

  const forgotPassword: RepositoryAuthContextType['forgotPassword'] = async (email) => {
    try {
      return await repositoryAuthService.forgotPassword(email);
    } catch (error: any) {
      return { success: false, message: error.message || 'Ошибка восстановления пароля' };
    }
  };

  const verifyResetToken: RepositoryAuthContextType['verifyResetToken'] = async (token) => {
    try {
      return await repositoryAuthService.verifyResetToken(token);
    } catch (error: any) {
      return { success: false, message: error.message || 'Ошибка проверки токена' };
    }
  };

  const resetPassword: RepositoryAuthContextType['resetPassword'] = async (token, newPassword) => {
    try {
      return await repositoryAuthService.resetPassword(token, newPassword);
    } catch (error: any) {
      return { success: false, message: error.message || 'Ошибка смены пароля' };
    }
  };

  const logout = () => {
    clearRepositoryToken();
    clearStoredRepositoryUser();
    setRepositoryUser(null);
    setRepositoryTokenPresent(false);
  };

  useEffect(() => {
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
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const handleAuthInvalid = () => {
      clearRepositoryToken();
      clearStoredRepositoryUser();
      setRepositoryUser(null);
      setRepositoryTokenPresent(false);
    };

    window.addEventListener(REPOSITORY_AUTH_INVALID_EVENT, handleAuthInvalid);
    return () => window.removeEventListener(REPOSITORY_AUTH_INVALID_EVENT, handleAuthInvalid);
  }, []);

  const value = useMemo(
    () => ({
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
