import type { RepositoryUser } from './repositoryAuth';

export type RepositoryBlockType = 'text' | 'image' | 'link' | 'file';
export type RepositoryDocumentStatus = 'needs_revision' | 'under_review' | 'verified';

export interface RepositoryBlock {
  id: string;
  type: RepositoryBlockType;
  content?: string;
  label?: string;
  url?: string;
  fileName?: string;
}

export interface RepositoryAuthorEntry {
  id: string;
  authorRu: string;
  authorEn: string;
  organizationRu: string;
  organizationEn: string;
  referenceAuthorId: number | null;
  referenceOrganizationId: number | null;
}

export interface RepositoryDocumentMeta {
  annotation: string;
  publicationDate: string;
  authors: string;
  affiliations: string;
  organization: string;
  titleEn: string;
  authorsEn: string;
  organizationEn: string;
  descriptionEn: string;
  authorEntries?: RepositoryAuthorEntry[];
  creatorUserId?: string;
  creatorName?: string;
  creatorEmail?: string;
  reviewEditorName?: string;
  reviewEditorEmail?: string;
  revisionComment?: string;
  revisionCommentAuthor?: string;
  revisionCommentUpdatedAt?: string;
  documentType: string;
  recordType: string;
  journalCode: string;
  volume: string;
  articleNumber: string;
  doi: string;
  citationLink: string;
  citationLinkEn?: string;
  xmlPath: string;
  license: string;
  position?: number;
}

export interface RepositoryPersonalDraft {
  name: string;
  meta: Partial<RepositoryDocumentMeta>;
  blocks: RepositoryBlock[];
  savedAt: string;
  sourceUpdatedAt?: string;
}

export interface RepositoryDirectory {
  id: string;
  name: string;
  type: 'directory';
  children: RepositoryNode[];
}

export interface RepositoryDocument {
  id: string;
  name: string;
  type: 'document';
  meta: RepositoryDocumentMeta;
  blocks: RepositoryBlock[];
  updatedAt?: string;
  documentStatus: RepositoryDocumentStatus;
  reviewRequestedAt?: string;
  verifiedAt?: string;
}

export type RepositoryNode = RepositoryDirectory | RepositoryDocument;

export interface RepositoryDocumentSummary extends RepositoryDocument {
  parentPath: string[];
  creatorName?: string;
  creatorEmail?: string;
  documentType?: string;
}

export interface RepositoryResponse {
  tree: RepositoryDirectory;
  documents: RepositoryDocumentSummary[];
  canEdit: boolean;
  repositoryUser?: RepositoryUser | null;
}
