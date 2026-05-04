# Repository Pages DB ER Diagram

```mermaid
%%{init: {"theme":"base","themeVariables":{
  "primaryColor":"#dce8f6",
  "primaryTextColor":"#1f2a44",
  "primaryBorderColor":"#1f2a44",
  "lineColor":"#1f2a44",
  "tertiaryColor":"#dce8f6",
  "fontSize":"14px"
}}}%%
erDiagram
    repository_nodes {
      TEXT id PK
      TEXT parent_id FK
      TEXT name
      VARCHAR type
      INT sort_order
      JSONB meta
      JSONB blocks
      TEXT document_type
      TEXT doi
      TEXT xml_path
      VARCHAR document_status
      TIMESTAMP review_requested_at
      TIMESTAMP verified_at
      TIMESTAMP created_at
      TIMESTAMP updated_at
    }

    repository_nodes ||--o{ repository_nodes : "parent-child tree"
```

## Description

1. `repository_nodes` stores both directories and documents in one table.
2. `type` defines node kind: `directory` or `document`.
3. Tree hierarchy is implemented by self-reference: `parent_id -> repository_nodes.id`.
4. `sort_order` controls sibling ordering inside the same parent.
5. `meta` (`JSONB`) keeps document metadata such as annotation, authors, and workflow comments.
6. `blocks` (`JSONB`) stores document content blocks (text, image, link, file).
7. `document_type`, `doi`, and `xml_path` are document-specific publication fields.
8. `document_status` tracks workflow state: `needs_revision`, `under_review`, `verified`.
9. `review_requested_at` and `verified_at` record key workflow timestamps.
10. `created_at` and `updated_at` provide audit and chronological sorting fields.
