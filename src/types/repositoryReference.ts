export interface RepositoryOrganizationReference {
  id: number;
  name_ru: string;
  name_en: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requester_name?: string | null;
  requester_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RepositoryAuthorReferenceOrganization {
  id: number;
  name_ru: string;
  name_en: string | null;
  link_status?: 'pending' | 'approved' | 'rejected';
}

export interface RepositoryAuthorReference {
  id: number;
  name_ru: string;
  name_en: string;
  status: 'pending' | 'approved' | 'rejected';
  requester_name?: string | null;
  requester_email?: string | null;
  organizations: RepositoryAuthorReferenceOrganization[];
  created_at?: string;
  updated_at?: string;
}
