export interface RepositoryUser {
  id: number;
  name: string;
  full_name: string | null;
  email: string;
  organization: string;
  position: string | null;
  role: 'admin' | 'editor' | 'user';
  status: 'pending' | 'active' | 'blocked';
  created_at: string;
  approved_at?: string;
  approver_name?: string;
}

export interface RepositoryAuthSuccess {
  success: true;
  message?: string;
  token?: string;
  user: RepositoryUser;
}

export interface RepositoryAuthError {
  success: false;
  message: string;
}

export type RepositoryAuthResponse = RepositoryAuthSuccess | RepositoryAuthError;
