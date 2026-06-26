export interface RepositoryUser {
  id: number;
  name: string;
  full_name: string | null;
  email: string;
  organization: string;
  organization_id?: number | null;
  organizationId?: number | null;
  position: string | null;
  role: 'admin' | 'editor' | 'user';
  status: 'pending' | 'active' | 'blocked';
  created_at: string;
  approved_at?: string;
  approver_name?: string;
}

export type RepositoryAuthFieldKey =
  | 'name'
  | 'fullName'
  | 'email'
  | 'organization'
  | 'organizationId'
  | 'position'
  | 'personalDataConsent'
  | 'password'
  | 'confirmPassword'
  | 'login'
  | 'token'
  | 'newPassword'
  | 'oldPassword'
  | 'confirmNewPassword';

export type RepositoryAuthFieldErrors = Partial<Record<RepositoryAuthFieldKey, string>>;

export interface RepositoryAuthResultMeta {
  message?: string;
  fieldErrors?: RepositoryAuthFieldErrors;
  retryAfterSeconds?: number;
}

export interface RepositoryAuthSuccess {
  success: true;
  message?: string;
  fieldErrors?: RepositoryAuthFieldErrors;
  retryAfterSeconds?: number;
  token?: string;
  user: RepositoryUser;
}

export interface RepositoryAuthError {
  success: false;
  message: string;
  fieldErrors?: RepositoryAuthFieldErrors;
  retryAfterSeconds?: number;
}

export type RepositoryAuthResponse = RepositoryAuthSuccess | RepositoryAuthError;

export interface RepositoryPasswordResponse extends RepositoryAuthResultMeta {
  success: boolean;
  message: string;
  email?: string;
}

export type RepositoryProfileUpdateStatus = 'pending' | 'approved' | 'rejected';

export interface RepositoryProfileUpdateChanges {
  full_name?: string;
  email?: string;
  organization?: string;
  organization_id?: number | null;
  position?: string;
}

export interface RepositoryProfileUpdateRequest {
  id: number;
  repository_user_id: number;
  requested_changes: RepositoryProfileUpdateChanges;
  requestedChanges?: RepositoryProfileUpdateChanges;
  status: RepositoryProfileUpdateStatus;
  admin_comment?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string;
  reviewer_name?: string | null;
  user?: RepositoryUser | null;
}
